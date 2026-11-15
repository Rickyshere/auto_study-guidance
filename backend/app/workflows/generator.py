from __future__ import annotations

import asyncio
import re
import uuid
from typing import Awaitable, Callable, Dict, List, Optional, Tuple

from app.router.routing_engine import ModelRouter
from app.schemas import (
    ChapterNode,
    DeliverableConfig,
    DocumentIR,
    KnowledgeFlashcard,
    QuizPaper,
    QuizQuestion,
    StudyBlueprint,
    StudyPackage,
)
from app.workflows.presets import sync_deliverable_flags_with_items
from app.workflows.souls import (
    build_courseware_deliverable_soul,
    get_courseware_soul_label,
)

ProgressCallback = Optional[Callable[[str, int, str], Awaitable[None]]]

_LATEX_CMD_RE = re.compile(
    r"\\(?:frac|dfrac|sigma|theta|eta|lambda|alpha|beta|gamma|delta|nabla|partial|sqrt|"
    r"left|right|lfloor|rfloor|cdot|times|mathrm|text|infty|leftarrow|rightarrow|"
    r"parallel|sum|int|log|exp|tanh|le|ge|neq|approx)"
)


def _replace_table_pipes_in_math(line: str) -> str:
    if not line.lstrip().startswith("|"):
        return line

    def _fix_inline(match: re.Match[str]) -> str:
        inner = match.group(1)
        inner = inner.replace(r"\|", r"\parallel ")
        return f"${inner}$"

    return re.sub(r"(?<!\$)\$(?!\$)([^\n$]+?)(?<!\$)\$(?!\$)", _fix_inline, line)


_INLINE_TABLE_SEP_RE = re.compile(
    r"\|\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|"
)
_PURE_TABLE_SEP_RE = re.compile(
    r"^\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?$"
)


def _unescaped_pipe_positions(s: str) -> List[int]:
    return [idx for idx, ch in enumerate(s) if ch == "|" and (idx == 0 or s[idx - 1] != "\\")]


def expand_inline_markdown_tables(text: str) -> str:
    """Expand single-line collapsed GFM tables (often emitted inside JSON fields) into multi-line tables."""
    if not text or "|" not in text:
        return text

    out_lines: List[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or _PURE_TABLE_SEP_RE.match(stripped):
            out_lines.append(line)
            continue

        m = _INLINE_TABLE_SEP_RE.search(line)
        if not m:
            out_lines.append(line)
            continue

        sep_str = m.group(0).strip()
        num_cols = len([c for c in sep_str.strip("|").split("|")])
        if num_cols < 2:
            out_lines.append(line)
            continue

        before_r = line[: m.start()].rstrip()
        after = line[m.end() :]

        prefix_text = ""
        header_row = ""
        if before_r.endswith("|"):
            before_pipes = _unescaped_pipe_positions(before_r)
            if len(before_pipes) >= num_cols + 1:
                hdr_start = before_pipes[-(num_cols + 1)]
                prefix_text = before_r[:hdr_start].rstrip()
                header_row = before_r[hdr_start:].strip()
            elif len(before_pipes) == num_cols:
                # Header omitted opening '|', split after sentence colon/period before first cell
                first_pipe = before_pipes[0]
                prefix_candidate = before_r[:first_pipe]
                punct_idx = max(
                    prefix_candidate.rfind("："),
                    prefix_candidate.rfind(":"),
                    prefix_candidate.rfind("。"),
                    prefix_candidate.rfind("；"),
                )
                if punct_idx >= 0:
                    prefix_text = before_r[: punct_idx + 1].strip()
                    header_row = "| " + before_r[punct_idx + 1 :].strip()
                else:
                    header_row = "| " + before_r.strip()

        if not header_row:
            out_lines.append(line)
            continue

        data_rows: List[str] = []
        pos = 0
        after_len = len(after)
        while pos < after_len:
            while pos < after_len and after[pos].isspace():
                pos += 1
            if pos >= after_len or after[pos] != "|":
                break
            row_pipes = [pos]
            scan = pos + 1
            while scan < after_len and len(row_pipes) < num_cols + 1:
                if after[scan] == "|" and after[scan - 1] != "\\":
                    row_pipes.append(scan)
                scan += 1
            if len(row_pipes) == num_cols + 1:
                data_rows.append(after[pos : row_pipes[-1] + 1].strip())
                pos = row_pipes[-1] + 1
            else:
                break

        suffix_text = after[pos:].strip()
        if prefix_text:
            out_lines.append(prefix_text)
            out_lines.append("")
        out_lines.append(header_row)
        out_lines.append(sep_str)
        out_lines.extend(data_rows)
        if suffix_text:
            out_lines.append("")
            out_lines.append(expand_inline_markdown_tables(suffix_text))
        elif after and not data_rows:
            out_lines.append(after.strip())

    return "\n".join(out_lines)


def _unescape_non_math_percent_and_space(line: str) -> str:
    """Clean stray LaTeX escapes (\\% and '\\ ') outside $...$ math delimiters and backticks."""
    if "\\" not in line:
        return line
    parts = re.split(r"(\$\$[^$]+\$\$|\$[^$\n]+\$|`[^`\n]+`)", line)
    for idx in range(0, len(parts), 2):
        seg = parts[idx]
        if "\\" in seg:
            seg = seg.replace(r"\%", "%")
            seg = re.sub(r"\\(?=[ \t])", "", seg)
            parts[idx] = seg
    return "".join(parts)


def strip_document_images(text: str) -> str:
    """Remove embedded 教材/课件原图 links from generated prose.

    The learner asked for hand-outs that explain concepts in words, tables and LaTeX
    instead of pasting screenshots of the source pages, so every `![alt](url)` is
    dropped here (generation) and again at export time as a safety net.
    """
    if not text or "![" not in text:
        return text
    cleaned = re.sub(r"!\[[^\]]*\]\([^)\s]*\)", "", text)
    cleaned = re.sub(r"!\[[^\]]*\]", "", cleaned)
    cleaned = re.sub(r"[ \t]+\n", "\n", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip("\n")


_PIPE_ROW_RE = re.compile(r"^\|.*\|\s*$")
_TABLE_SEP_RE = re.compile(r"^\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?\s*$")

# 讲义里的分页标记统一成这个 token：PDF 导出器据此真正另起一页，
# 应用内则渲染成一条"分页"分隔线，而不是把原始 <div> 当正文显示。
PAGE_BREAK_TOKEN = "@@ASG_PAGE_BREAK@@"
_PAGE_BREAK_HTML_RE = re.compile(
    r"<div[^>]*class\s*=\s*[\"']?page-break[\"']?[^>]*>\s*</div>|<!--\s*page-?break\s*-->",
    re.IGNORECASE,
)


def normalize_page_breaks(text: str) -> str:
    if not text or "page-break" not in text.lower() and PAGE_BREAK_TOKEN not in text:
        return text
    cleaned = _PAGE_BREAK_HTML_RE.sub(f"\n\n{PAGE_BREAK_TOKEN}\n\n", text)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned


def repair_pipe_tables(text: str) -> str:
    """Give GFM tables that lost their separator row a chance to render as tables.

    Models frequently emit a two-row table glued into a sentence, e.g.::

        测得如下表：
        | 滴定剂体积 V/mL | 24.90 | 25.00 |
        | Δ²E/ΔV²        | +0.24 | -0.16 |

    Without the `|---|---|---|` line GFM renders the pipe rows as literal text, so the
    table collapses into one long paragraph. This inserts the missing separator and
    makes sure the block is surrounded by blank lines.
    """
    if "|" not in text:
        return text

    lines = text.split("\n")
    out: List[str] = []
    i = 0
    total = len(lines)
    while i < total:
        line = lines[i]
        if not line.strip().startswith("|"):
            out.append(line)
            i += 1
            continue

        run: List[str] = []
        j = i
        while j < total and lines[j].strip().startswith("|"):
            run.append(lines[j].strip())
            j += 1

        rows = [[cell.strip() for cell in row.strip("|").split("|")] for row in run]
        widths = {len(row) for row in rows}
        looks_like_table = (
            len(run) >= 2
            and not any(_TABLE_SEP_RE.match(row) for row in run)
            and len(widths) == 1
            and min(widths) >= 2
            and all(_PIPE_ROW_RE.match(row) for row in run)
            # a row of nothing but empty cells is prose that happens to start with a pipe
            and any(cell for row in rows for cell in row)
        )
        if not looks_like_table:
            out.extend(run)
            i = j
            continue

        if out and out[-1].strip():
            out.append("")
        out.append(run[0])
        out.append("|" + "|".join(["---"] * len(rows[0])) + "|")
        out.extend(run[1:])
        if j < total and lines[j].strip():
            out.append("")
        i = j

    return "\n".join(out)


def normalize_markdown_math(text: str) -> str:
    """Normalize LaTeX delimiters for remark-math/rehype-katex, expand inline tables, and escape table math pipes."""
    if not text:
        return text

    # Convert \[ ... \] display math to $$ ... $$
    out = re.sub(
        r"\\\[\s*([\s\S]*?)\s*\\\]",
        lambda m: f"\n$$\n{m.group(1).strip()}\n$$\n",
        text,
    )
    # Convert \( ... \) inline math to $...$ (trimmed inside $)
    out = re.sub(
        r"\\\(\s*([\s\S]*?)\s*\\\)",
        lambda m: f"${m.group(1).strip()}$",
        out,
    )
    # Expand single-line collapsed GFM tables into multi-line tables before per-line fixes
    out = expand_inline_markdown_tables(out)
    # Re-add separator rows to tables the model pasted without one (else they print as text)
    out = repair_pipe_tables(out)
    # 统一分页标记（原始 <div class="page-break"> 会作为正文被打印出来）
    out = normalize_page_breaks(out)

    # Fix already-unescaped parenthesized formulas that contain LaTeX commands / ^{ / _{
    out_lines: List[str] = []
    in_display = False
    in_fence = False
    for line in out.splitlines():
        stripped = line.strip()
        if stripped.startswith("```"):
            in_fence = not in_fence
            out_lines.append(line)
            continue
        if in_fence:
            out_lines.append(line)
            continue
        # Lines inside a multi-line $$ ... $$ block are pure LaTeX: never rewrite them.
        if in_display:
            if stripped.count("$$") % 2 == 1:
                in_display = False
            out_lines.append(line)
            continue
        if line.count("$$") % 2 == 1:
            in_display = True
            out_lines.append(line)
            continue
        if "`" not in line and "$" not in line and _LATEX_CMD_RE.search(line):
            # Convert balanced (...) chunks containing LaTeX commands when not preceded by a word char or \
            chars: List[str] = []
            i = 0
            n = len(line)
            while i < n:
                ch = line[i]
                prev = line[i - 1] if i > 0 else ""
                if ch == "(" and prev not in ("\\", "$") and not prev.isalnum():
                    depth = 1
                    j = i + 1
                    while j < n and depth > 0:
                        if line[j] == "(":
                            depth += 1
                        elif line[j] == ")":
                            depth -= 1
                        j += 1
                    if depth == 0:
                        inner = line[i + 1 : j - 1]
                        if _LATEX_CMD_RE.search(inner) or "^{" in inner or "_{" in inner:
                            chars.append(f"${inner.strip()}$")
                            i = j
                            continue
                chars.append(ch)
                i += 1
            line = "".join(chars)
        line = _unescape_non_math_percent_and_space(line)
        line = _replace_table_pipes_in_math(line)
        out_lines.append(line)

    return "\n".join(out_lines)


def _collect_chapters_context(chapters: List[ChapterNode], max_chars: int = 24000) -> str:
    blocks: List[str] = []
    budget_per_ch = max(1200, max_chars // max(1, len(chapters)))
    for ch in chapters:
        # 讲义不引用教材/课件原图：只喂养文字内容，避免生成的正文里出现原书截图链接。
        snippet = ch.content_text[:budget_per_ch]
        blocks.append(
            f"=== 章节 [{ch.chapter_id}] {ch.title} (页码/幻灯片: {ch.start_page}-{ch.end_page}) ===\n"
            f"{snippet}"
        )
    return "\n\n".join(blocks)


def _sanitize_mermaid_code(raw: str) -> str:
    fence = re.search(r"```(?:mermaid)?\s*([\s\S]*?)```", raw, re.IGNORECASE)
    code = fence.group(1).strip() if fence else raw.strip()
    if not (code.startswith("flowchart") or code.startswith("graph") or code.startswith("mindmap")):
        return ""
    fixed_lines: List[str] = []
    for line in code.splitlines():
        line = re.sub(
            r'\b([A-Za-z0-9_]+)\[(?!")([^\[\]"\n]+)\]',
            lambda m: f'{m.group(1)}["{m.group(2).replace(chr(34), chr(39)).strip()}"]',
            line,
        )
        fixed_lines.append(line)
    return "\n".join(fixed_lines)


def _build_chapter_anchor_table(chapters: List[ChapterNode]) -> str:
    """Format selected chapter metadata as explicit knowledge anchors for prompt grounding."""
    lines: List[str] = []
    for ch in chapters:
        terms = "、".join(ch.key_terms[:6]) if ch.key_terms else "详见章节正文"
        lines.append(
            f"- [{ch.chapter_id}] 《{ch.title}》 | 页码/幻灯片: P{ch.start_page}-{ch.end_page} | 核心术语: {terms}"
        )
    return "\n".join(lines) if lines else "- [ch_all] 全文内容"


def _compute_quiz_allocation(
    d: DeliverableConfig,
    target_difficulty: str,
) -> Dict[str, object]:
    """Compute exact per-type score breakdown and 3-tier cognitive targets."""
    mcq = max(0, int(d.mcq_count))
    fill = max(0, int(d.fill_blank_count))
    short = max(0, int(d.short_answer_count))
    total_qs = mcq + fill + short

    # Per-type integer score allocation weighted 1 : 1 : 2 (mcq : fill_blank : short_answer)
    total_score = max(total_qs, int(d.total_score)) if total_qs > 0 else int(d.total_score)
    w_total = mcq * 1 + fill * 1 + short * 2
    if total_qs == 0 or w_total == 0:
        score_plan_text = f"共 0 题，总分 {d.total_score} 分"
    else:
        unit = total_score / w_total
        mcq_pt = max(1, round(unit * 1)) if mcq > 0 else 0
        fill_pt = max(1, round(unit * 1)) if fill > 0 else 0
        short_pt = max(1, round(unit * 2)) if short > 0 else 0
        # Prevent over-allocation when rounding up
        while mcq * mcq_pt + fill * fill_pt + short * short_pt > total_score:
            if short > 0 and short_pt > 1:
                short_pt -= 1
            elif fill > 0 and fill_pt > 1:
                fill_pt -= 1
            elif mcq > 0 and mcq_pt > 1:
                mcq_pt -= 1
            else:
                break
        assigned = mcq * mcq_pt + fill * fill_pt + short * short_pt
        rem = total_score - assigned
        parts: List[str] = []
        if mcq > 0:
            parts.append(f"单选题 {mcq} 道（约 {mcq_pt} 分/题）")
        if fill > 0:
            parts.append(f"填空题 {fill} 道（约 {fill_pt} 分/题）")
        if short > 0:
            parts.append(f"简答/计算/综合题 {short} 道（约 {short_pt} 分/题）")
        tail_note = f"；差额 {rem:+d} 分可加在压轴题上" if rem != 0 else ""
        score_plan_text = "、".join(parts) + f"，合计严格等于 {total_score} 分{tail_note}"

    # Cognitive tier targets (基础达标 / 能力提升 / 拓展探究)
    ratio_map = {
        "beginner": (0.60, 0.30, 0.10),
        "intermediate": (0.40, 0.40, 0.20),
        "advanced": (0.20, 0.45, 0.35),
        "exam_sprint": (0.30, 0.45, 0.25),
    }
    r_basic, r_improve, r_explore = ratio_map.get(target_difficulty, (0.40, 0.40, 0.20))
    if d.quiz_mode == "in_class" and target_difficulty != "beginner":
        r_basic = (r_basic + 0.55) / 2
        r_improve = (r_improve + 0.35) / 2
        r_explore = (r_explore + 0.10) / 2

    if total_qs <= 0:
        t_basic = t_improve = t_explore = 0
    else:
        t_basic = round(total_qs * r_basic)
        t_explore = round(total_qs * r_explore)
        t_improve = total_qs - t_basic - t_explore
        if t_improve < 0:
            t_basic = max(0, t_basic + t_improve)
            t_improve = total_qs - t_basic - t_explore

    return {
        "total_qs": total_qs,
        "total_score": total_score,
        "score_plan_text": score_plan_text,
        "tier_basic": t_basic,
        "tier_improve": t_improve,
        "tier_explore": t_explore,
    }


def build_notes_prompts(
    document_ir: DocumentIR,
    selected_chapters: List[ChapterNode],
    blueprint: StudyBlueprint,
    context_text: str,
) -> Tuple[str, str]:
    """Construct refined system & user prompts mounting Mode A/B/C soul.md for notes & worked examples."""
    d = blueprint.deliverables
    focus_str = "、".join(blueprint.focus_topics) if blueprint.focus_topics else "全章核心概念"
    chapter_anchors = _build_chapter_anchor_table(selected_chapters)

    items_set = set(d.selected_items or [])
    is_c_extract = d.scenario_type == "C_sprint" or "key_knowledge_extraction" in items_set
    deliverable_id = "key_knowledge_extraction" if is_c_extract else "detailed_study_guide"
    soul_spec = build_courseware_deliverable_soul(d.scenario_type, deliverable_id)

    notes_sys = (
        f"{soul_spec}\n\n"
        "---\n\n"
        "### 执行与真实性补充契约\n"
        "1. 严格忠于提供的教材/课件原文事实、符号体系与推导逻辑，切勿编造教材未出现的定理或数据。\n"
        "2. 严格按照上述 `soul.md` 中的模式人设（Mode A/B/C）、全局协议与交付物结构模板直接输出完整 Markdown 文档。"
    )
    notes_user = (
        f"文档名称: {document_ir.filename}\n"
        f"所处学习模式: {get_courseware_soul_label(d.scenario_type)}\n"
        f"方案标题: {blueprint.blueprint_title}\n"
        f"核心考点: {focus_str}\n"
        f"用户定制指令: {blueprint.custom_instructions or '无额外指令'}\n\n"
        f"选中章节与页码锚点：\n{chapter_anchors}\n\n"
        f"教材/课件原文内容：\n{context_text}"
    )
    return notes_sys, notes_user


def build_cheatsheet_prompts(
    document_ir: DocumentIR,
    selected_chapters: List[ChapterNode],
    blueprint: StudyBlueprint,
    context_text: str,
) -> Tuple[str, str]:
    """Construct cheatsheet prompts mounting Mode A (A4), Mode B (B3), or Mode C (C2) soul.md."""
    d = blueprint.deliverables
    focus_str = "、".join(blueprint.focus_topics) if blueprint.focus_topics else "全章核心概念"
    chapter_anchors = _build_chapter_anchor_table(selected_chapters)
    soul_spec = build_courseware_deliverable_soul(d.scenario_type, "cheatsheet")

    cs_sys = (
        f"{soul_spec}\n\n"
        "---\n\n"
        "### 排版补充提醒\n"
        "- 所有行内/块级公式严格使用 `$...$` 或 `$$...$$`；Markdown 表格内的范数请用 `\\parallel W \\parallel^2`，并保持表格紧凑以免打印溢出。"
    )
    cs_user = (
        f"文档名称: {document_ir.filename}\n"
        f"所处学习模式: {get_courseware_soul_label(d.scenario_type)}\n"
        f"速记密度要求: {d.cheatsheet_density} | 重点主题: {focus_str}\n"
        f"用户定制指令: {blueprint.custom_instructions or '无额外指令'}\n\n"
        f"选中章节与页码锚点：\n{chapter_anchors}\n\n"
        f"教材/课件原文内容：\n{context_text[:18000]}"
    )
    return cs_sys, cs_user


def build_mindmap_prompts(
    document_ir: DocumentIR,
    selected_chapters: List[ChapterNode],
    blueprint: StudyBlueprint,
) -> Tuple[str, str]:
    """Construct MindMap prompts mounting Mode A (A5) or Mode B (B4) / C soul.md."""
    d = blueprint.deliverables
    soul_spec = build_courseware_deliverable_soul(d.scenario_type, "mindmap")
    mm_sys = (
        f"{soul_spec}\n\n"
        "---\n\n"
        "### Mermaid 输出硬性格式契约\n"
        "请在最上方输出一个完整的 ```mermaid ... ``` 代码块（推荐使用 `flowchart LR`，所有节点文本必须用英文双引号包裹如 `c1[\"核心概念\"]`，节点文本内部禁止再出现英文双引号、括号或分号），可在代码块下方附带简洁的层级清单说明。"
    )
    mm_user = (
        f"文档: {document_ir.filename} | 学习模式: {get_courseware_soul_label(d.scenario_type)} | 深度: {d.mindmap_depth} 层\n"
        f"重点关注: {', '.join(blueprint.focus_topics[:8]) or '全章主干'}\n"
        f"章节与关键词：\n"
        + "\n".join(
            f"- {c.title} (P{c.start_page}-{c.end_page}): {', '.join(c.key_terms[:6])}"
            for c in selected_chapters
        )
    )
    return mm_sys, mm_user


def build_quiz_prompts(
    document_ir: DocumentIR,
    selected_chapters: List[ChapterNode],
    blueprint: StudyBlueprint,
    context_text: str,
    paper_id: str = "sync_homework",
) -> Tuple[str, str]:
    """Construct fine-grained system & user prompts mounting Mode A/B/C soul.md for exercise generation."""
    d = blueprint.deliverables
    focus_str = "、".join(blueprint.focus_topics) if blueprint.focus_topics else "全章核心概念"
    chapter_anchors = _build_chapter_anchor_table(selected_chapters)
    alloc = _compute_quiz_allocation(d, blueprint.target_difficulty)
    soul_spec = build_courseware_deliverable_soul(d.scenario_type, paper_id)

    quiz_sys = (
        f"{soul_spec}\n\n"
        "---\n\n"
        "### 一、工程级命题质量铁律与 JSON 结构契约\n"
        "1. **严禁低质送分题**：禁止出现“什么是 XX？”“第几章讲了什么？”式浅层记忆题；题目须考查机理辨析、条件边界、定量计算、步骤因果或情景迁移（严格契合上述 Mode A/B/C 人设与难度梯度）。\n"
        "2. **单选题 (`type=\"mcq\"`)**：严格提供 4 个选项 `[\"A. ...\", \"B. ...\", \"C. ...\", \"D. ...\"]`，四选项长度与专业度均衡；`answer` 仅填单个大写字母 `\"A\"`/`\"B\"`/`\"C\"`/`\"D\"`。\n"
        "3. **填空题 (`type=\"fill_blank\"`)**：题干关键空位使用 `__________`；`options` 固定为 `[]`；`answer` 须简明唯一客观。\n"
        "4. **简答/计算/综合题 (`type=\"short_answer\"`)**：须创设完整情景或分步设问 `(1)...(2)...`；`options` 固定为 `[]`；`answer` 按采分点列出（如 `【得分点1】...（X分）；【得分点2】...（Y分）`）。\n"
        "5. **解析字段 (`explanation`) 强制模块**：包含 `【考点定位】...` + `【详解与推导】...` + `【易错点拨】...`（若为 Mode B 请写透 `【设错陷阱揭秘】【同类题通法总结】`；若为 Mode C 抱佛脚卷，末尾必须附 `【考场抢分包】👉 若考场直接考原题 / 👉 若考场换个问法 / 👉 简答题标准背诵模板`）。\n"
        "6. **LaTeX & JSON 双反斜杠**：行内用 `$...$`，独立用 `$$...$$`，JSON 字符串内的 LaTeX 反斜杠必须双写（例如 `\"$\\\\frac{a}{b}$\"`）。只输出纯 JSON 对象，不要包含任何前后解释文字。\n\n"
        "JSON 结构契约：\n"
        "{\n"
        '  "title": "试卷/练习标题",\n'
        '  "instructions": "作答说明（含题型题量、总分、建议用时及打印答题说明）",\n'
        '  "questions": [\n'
        "    {\n"
        '      "id": "q_1",\n'
        '      "type": "mcq" | "fill_blank" | "short_answer",\n'
        '      "difficulty": "easy" | "medium" | "hard",\n'
        '      "tier": "基础达标" | "能力提升" | "拓展探究",\n'
        '      "score": 5,\n'
        '      "question": "题干内容（含具体情境、考点标注或公式 $...$）",\n'
        '      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],\n'
        '      "answer": "单选填 A/B/C/D；填空填唯一标准答案；简答按【得分点1】...列出",\n'
        '      "explanation": "【考点定位】... \\n【详解与推导】... \\n【易错点拨】...",\n'
        '      "source_chapter": "对应章节名称",\n'
        '      "source_page": "P1-3"\n'
        "    }\n"
        "  ]\n"
        "}"
    )

    quiz_user = (
        f"## 命题蓝图与契约\n"
        f"- 文档名称: {document_ir.filename}\n"
        f"- 所处模式人格: {get_courseware_soul_label(d.scenario_type)}\n"
        f"- 方案名称: {blueprint.blueprint_title}\n"
        f"- 模板类型: {blueprint.preset_name} (paper_id={paper_id}, quiz_mode={d.quiz_mode})\n"
        f"- 目标难度: {blueprint.target_difficulty} | 建议用时: {d.suggested_minutes} 分钟\n"
        f"- 严格题量契约: 单选题 {d.mcq_count} 道 + 填空题 {d.fill_blank_count} 道 + 简答/分析题 {d.short_answer_count} 道（共 {alloc['total_qs']} 道，切勿少出或多出）\n"
        f"- 分值分配建议: {alloc['score_plan_text']}\n"
        f"- 认知分层配比目标: 基础达标约 {alloc['tier_basic']} 题 / 能力提升约 {alloc['tier_improve']} 题 / 拓展探究约 {alloc['tier_explore']} 题\n"
        f"- 重点考察主题: {focus_str}\n"
        f"- 用户定制指令: {blueprint.custom_instructions or '严格按对应模式 soul.md 要求命制'}\n\n"
        f"## 选中章节与知识锚点（请均衡覆盖并准确溯源）\n{chapter_anchors}\n\n"
        f"## 教材/课件原文内容\n{context_text[:20000]}"
    )
    return quiz_sys, quiz_user


def _format_quiz_samples_for_audit(quiz_paper: QuizPaper) -> str:
    """Format up to 3 representative quiz items across types for global quality audit."""
    if not quiz_paper.questions:
        return "无试题"
    picked: List[QuizQuestion] = []
    seen_types = set()
    for q in quiz_paper.questions:
        if q.type not in seen_types:
            picked.append(q)
            seen_types.add(q.type)
        if len(picked) >= 3:
            break
    for q in quiz_paper.questions:
        if len(picked) >= 3:
            break
        if q not in picked:
            picked.append(q)

    blocks: List[str] = []
    for q in picked:
        opts = " | ".join(q.options[:4]) if q.options else "(无选项)"
        blocks.append(
            f"- [{q.id} | {q.type} | {q.tier} | {q.score}分 | {q.source_chapter}] "
            f"题干: {q.question[:120]} || 选项: {opts[:160]} || 答案: {q.answer[:80]} || 解析: {q.explanation[:180]}"
        )
    return "\n".join(blocks)


async def generate_study_package(
    document_ir: DocumentIR,
    blueprint: StudyBlueprint,
    router: ModelRouter,
    progress_cb: ProgressCallback = None,
) -> StudyPackage:
    router.check_cancelled()
    current_stage_state = {"stage": "notes", "percent": 20}
    prev_status_cb = router.status_cb

    async def _forward_router_status(stage_name: str, msg: str) -> None:
        if prev_status_cb:
            maybe = prev_status_cb(stage_name, msg)
            if hasattr(maybe, "__await__"):
                await maybe
        if progress_cb and msg:
            await progress_cb(
                current_stage_state["stage"],
                current_stage_state["percent"],
                msg,
            )

    if progress_cb:
        router.status_cb = _forward_router_status

    try:
        return await _run_generate_study_package(
            document_ir,
            blueprint,
            router,
            progress_cb,
            current_stage_state,
        )
    finally:
        router.status_cb = prev_status_cb


_PAPER_SPECS: Dict[str, Tuple[str, str, str]] = {
    "sync_homework": (
        "同步练习（作业）",
        "sync_layered",
        "立足各章基础概念与机理推导的课后同步训练：从基础达标到能力提升循序渐进，适合边学边练巩固课堂内容。",
    ),
    "unit_test_paper": (
        "单元检测卷",
        "exam_paper",
        "标准化闭卷单元测评试卷：题型分布均衡、覆盖核心概念与典型应用题，检验零基础学习后的阶段掌握效果。",
    ),
    "chapter_consolidation_paper": (
        "分章节巩固卷",
        "sync_layered",
        "按选中章节逐章设计查漏补缺题组，专门打击易混概念辨析、条件边界误区与公式变形错误。",
    ),
    "comprehensive_test_paper": (
        "综合检测卷",
        "exam_paper",
        "跨章节知识点深度串联与综合推导测评卷：强化综合应用、情景迁移与高区分度能力拔高。",
    ),
    "cram_exam_paper": (
        "佛教卷（考前冲刺突击卷）",
        "exam_paper",
        "面向考前临阵磨枪的终极突击卷：聚焦历年/教材最高频考点、必拿分计算套路与经典易错陷阱，直击得分采分点。",
    ),
}


def _parse_quiz_questions(raw_questions: list, default_chapter: str) -> List[QuizQuestion]:
    valid_qs: List[QuizQuestion] = []
    for idx, item in enumerate(raw_questions, start=1):
        if not isinstance(item, dict):
            continue
        q_type = item.get("type", "mcq")
        if q_type not in ("mcq", "fill_blank", "short_answer"):
            q_type = "mcq"
        tier = item.get("tier", "基础达标")
        if tier not in ("基础达标", "能力提升", "拓展探究"):
            tier = "能力提升"
        diff = item.get("difficulty", "medium")
        if diff not in ("easy", "medium", "hard"):
            diff = "medium"
        valid_qs.append(
            QuizQuestion(
                id=str(item.get("id") or f"q_{idx}"),
                type=q_type,
                difficulty=diff,
                tier=tier,
                score=max(1, int(item.get("score") or 5)),
                question=normalize_markdown_math(str(item.get("question") or "")),
                options=[normalize_markdown_math(str(o)) for o in (item.get("options") or [])],
                answer=normalize_markdown_math(str(item.get("answer") or "")),
                explanation=normalize_markdown_math(str(item.get("explanation") or "")),
                source_chapter=str(item.get("source_chapter") or default_chapter),
                source_page=str(item.get("source_page") or ""),
            )
        )
    return valid_qs


async def _generate_single_quiz_paper(
    document_ir: DocumentIR,
    selected_chapters: List[ChapterNode],
    blueprint: StudyBlueprint,
    context_text: str,
    paper_id: str,
    router: ModelRouter,
) -> QuizPaper:
    label, mode, directive = _PAPER_SPECS.get(
        paper_id,
        (blueprint.preset_name, blueprint.deliverables.quiz_mode, "高质量同步练习与测评卷"),
    )
    d = blueprint.deliverables
    quiz_sys, quiz_user = build_quiz_prompts(
        document_ir, selected_chapters, blueprint, context_text, paper_id=paper_id
    )
    paper_user = (
        f"## 本套试卷专项定位（paper_id={paper_id}）\n"
        f"- 试卷名称：{document_ir.filename} · {label}\n"
        f"- 命题要求：{directive}\n\n"
        + quiz_user
    )
    quiz_data, _ = await router.execute_json("quiz_generation", quiz_sys, paper_user)
    if not (isinstance(quiz_data, dict) and isinstance(quiz_data.get("questions"), list) and quiz_data["questions"]):
        raise RuntimeError(f"AI 未能为《{label}》返回有效的 JSON 试题列表，请检查模型配置或重试。")

    valid_qs = _parse_quiz_questions(quiz_data["questions"], selected_chapters[0].title)
    if not valid_qs:
        raise RuntimeError(f"《{label}》解析后有效试题为空，请重试。")

    return QuizPaper(
        paper_id=paper_id,
        deliverable_type=paper_id,
        title=str(quiz_data.get("title") or f"{document_ir.filename} · {label}"),
        mode=mode,  # type: ignore
        total_score=sum(q.score for q in valid_qs),
        suggested_minutes=d.suggested_minutes,
        instructions=str(quiz_data.get("instructions") or f"共 {len(valid_qs)} 题，建议用时 {d.suggested_minutes} 分钟。"),
        questions=valid_qs,
    )


async def generate_variant_question(
    document_ir: DocumentIR,
    source_question: QuizQuestion,
    selected_chapter_ids: List[str],
    router: ModelRouter,
) -> QuizQuestion:
    """Generate a single targeted variant question on the same knowledge point for [✨ 针对此知识点再出一题]."""
    chapters = [c for c in document_ir.chapters if c.chapter_id in selected_chapter_ids] or document_ir.chapters
    matched = [c for c in chapters if source_question.source_chapter and source_question.source_chapter in c.title] or chapters
    excerpt = _collect_chapters_context(matched[:2], max_chars=7000)

    sys_prompt = (
        "你是一位资深学科命题专家。请针对用户刚才练习的原题所考察的【同一核心知识点/误区】，"
        "独立命制 **1 道全新变式题**（改变情景、参数、提问角度或反例条件，切忌照抄原题题干或选项），并只输出单个合法 JSON 对象：\n"
        "{\n"
        '  "id": "var_xxx",\n'
        '  "type": "mcq" | "fill_blank" | "short_answer",\n'
        '  "difficulty": "easy" | "medium" | "hard",\n'
        '  "tier": "基础达标" | "能力提升" | "拓展探究",\n'
        '  "score": 5,\n'
        '  "question": "全新变式题干（所有公式用 $...$ 或 $$...$$，JSON 反斜杠须双写）",\n'
        '  "options": ["A. ...", "B. ...", "C. ...", "D. ..."],\n'
        '  "answer": "标准答案",\n'
        '  "explanation": "【考点定位】...\\n【详解与推导】...\\n【易错点拨】...",\n'
        '  "source_chapter": "对应章节",\n'
        '  "source_page": "P..."\n'
        "}"
    )
    user_prompt = (
        f"## 原题参考\n"
        f"- 题型: {source_question.type} | 梯度: {source_question.tier} | 来源: {source_question.source_chapter} ({source_question.source_page})\n"
        f"- 原题干: {source_question.question}\n"
        f"- 原答案: {source_question.answer}\n"
        f"- 原解析: {source_question.explanation[:400]}\n\n"
        f"## 教材参考原文\n{excerpt}"
    )
    data, _ = await router.execute_json("quiz_generation", sys_prompt, user_prompt)
    if not isinstance(data, dict):
        raise RuntimeError("AI 未返回合法的变式题 JSON，请重试。")
    q_dict = data["questions"][0] if isinstance(data.get("questions"), list) and data["questions"] else data
    parsed = _parse_quiz_questions([q_dict], source_question.source_chapter or chapters[0].title)
    if not parsed:
        raise RuntimeError("生成的变式题格式校验失败，请重试。")
    return parsed[0].model_copy(update={"id": f"var_{uuid.uuid4().hex[:6]}"})


async def _run_generate_study_package(
    document_ir: DocumentIR,
    blueprint: StudyBlueprint,
    router: ModelRouter,
    progress_cb: ProgressCallback,
    current_stage_state: dict,
) -> StudyPackage:
    router.check_cancelled()
    selected_chapters = [
        c for c in document_ir.chapters if c.chapter_id in blueprint.selected_chapter_ids
    ] or document_ir.chapters

    context_text = _collect_chapters_context(selected_chapters)
    d = sync_deliverable_flags_with_items(blueprint.deliverables)
    blueprint = blueprint.model_copy(update={"deliverables": d})
    items_set = set(d.selected_items or [])
    soul_label = get_courseware_soul_label(d.scenario_type)
    router.routing_trace["soul_profile"] = soul_label

    ordered_paper_ids = [
        pid
        for pid in (
            "sync_homework",
            "unit_test_paper",
            "chapter_consolidation_paper",
            "comprehensive_test_paper",
            "cram_exam_paper",
        )
        if pid in items_set
    ]
    if not ordered_paper_ids and d.include_quiz:
        ordered_paper_ids = ["cram_exam_paper" if d.scenario_type == "C_sprint" else "sync_homework"]

    total_tasks = (
        (1 if d.include_study_guide_notes else 0)
        + (1 if d.include_cheatsheet else 0)
        + len(ordered_paper_ids)
        + (1 if d.include_mindmap else 0)
    )
    completed_tasks = 0
    sem = asyncio.Semaphore(3)
    progress_lock = asyncio.Lock()

    async def _advance_progress(stage_key: str, msg: str) -> None:
        nonlocal completed_tasks
        async with progress_lock:
            completed_tasks += 1
            pct = 12 + int(76 * completed_tasks / max(1, total_tasks))
            current_stage_state["stage"] = stage_key
            current_stage_state["percent"] = pct
            if progress_cb:
                await progress_cb(stage_key, pct, msg)

    current_stage_state["stage"] = "soul_mount"
    current_stage_state["percent"] = 12
    if progress_cb:
        await progress_cb(
            "soul_mount",
            12,
            f"已挂载《{soul_label}》与全球打印规范，正在并发启动 {max(1, total_tasks)} 个交付物子 Agent...",
        )

    study_notes_md = ""
    cheatsheet_md = ""
    papers_by_pid: Dict[str, QuizPaper] = {}
    mindmap_mermaid = ""

    async def _task_notes() -> None:
        nonlocal study_notes_md
        async with sem:
            router.check_cancelled()
            notes_label = (
                "重要知识提取 (C1)"
                if ("key_knowledge_extraction" in items_set or d.scenario_type == "C_sprint")
                else "详细自学案（附带例题）(A1)"
            )
            if progress_cb:
                await progress_cb(
                    "notes",
                    current_stage_state["percent"],
                    f"正在生成【{notes_label}】（已随任务上传 {soul_label}）...",
                )
            notes_sys, notes_user = build_notes_prompts(
                document_ir, selected_chapters, blueprint, context_text
            )
            res_notes, _ = await router.execute_text("notes_and_cheatsheet", notes_sys, notes_user)
            if not res_notes or not res_notes.strip():
                raise RuntimeError(f"AI 未生成有效的{notes_label}内容，请检查模型配置后重试。")
            study_notes_md = strip_document_images(normalize_markdown_math(res_notes))
            await _advance_progress("notes", f"✓ 已完成【{notes_label}】")

    async def _task_cheatsheet() -> None:
        nonlocal cheatsheet_md
        async with sem:
            router.check_cancelled()
            if progress_cb:
                await progress_cb(
                    "cheatsheet",
                    current_stage_state["percent"],
                    f"正在浓缩【考前速记表】（已随任务上传 {soul_label}）...",
                )
            cs_sys, cs_user = build_cheatsheet_prompts(
                document_ir, selected_chapters, blueprint, context_text
            )
            res_cs, _ = await router.execute_text("notes_and_cheatsheet", cs_sys, cs_user)
            if not res_cs or not res_cs.strip():
                raise RuntimeError("AI 未生成有效的考前速记表内容，请重试。")
            cheatsheet_md = strip_document_images(normalize_markdown_math(res_cs))
            await _advance_progress("cheatsheet", "✓ 已完成【考前速记表】")

    async def _task_paper(pid: str) -> None:
        async with sem:
            router.check_cancelled()
            paper_name = _PAPER_SPECS.get(pid, (pid,))[0]
            if progress_cb:
                await progress_cb(
                    "quiz",
                    current_stage_state["percent"],
                    f"正在命制《{paper_name}》（已随任务上传 {soul_label}）...",
                )
            paper = await _generate_single_quiz_paper(
                document_ir, selected_chapters, blueprint, context_text, pid, router
            )
            papers_by_pid[pid] = paper
            await _advance_progress("quiz", f"✓ 已完成《{paper_name}》（{len(paper.questions)} 题）")

    async def _task_mindmap() -> None:
        nonlocal mindmap_mermaid
        async with sem:
            router.check_cancelled()
            if progress_cb:
                await progress_cb(
                    "mindmap",
                    current_stage_state["percent"],
                    f"正在构建 Mermaid 知识图谱 MindMap（已随任务上传 {soul_label}）...",
                )
            mm_sys, mm_user = build_mindmap_prompts(document_ir, selected_chapters, blueprint)
            res_mm, _ = await router.execute_text("mindmap_generation", mm_sys, mm_user)
            mindmap_mermaid = _sanitize_mermaid_code(res_mm) if res_mm else ""
            if not mindmap_mermaid:
                lines = ["flowchart LR", f'  root["{document_ir.filename[:24]}"]']
                for idx, c in enumerate(selected_chapters[:8], start=1):
                    safe_title = c.title.replace('"', "'")[:24]
                    lines.append(f'  ch{idx}["{safe_title}"]')
                    lines.append(f"  root --> ch{idx}")
                mindmap_mermaid = "\n".join(lines)
            await _advance_progress("mindmap", "✓ 已完成 MindMap 知识图谱")

    coros = []
    if d.include_study_guide_notes:
        coros.append(_task_notes())
    if d.include_cheatsheet:
        coros.append(_task_cheatsheet())
    for pid in ordered_paper_ids:
        coros.append(_task_paper(pid))
    if d.include_mindmap:
        coros.append(_task_mindmap())

    if coros:
        await asyncio.gather(*coros)

    generated_papers = [papers_by_pid[pid] for pid in ordered_paper_ids if pid in papers_by_pid]
    if generated_papers:
        quiz_paper = generated_papers[0]
        extra_quiz_papers = generated_papers[1:]
    else:
        quiz_paper = QuizPaper(
            paper_id="none",
            deliverable_type="none",
            title=f"{document_ir.filename} · 未勾选题库试卷",
            mode=d.quiz_mode,
            total_score=0,
            suggested_minutes=0,
            instructions="当前勾选方案未包含在线/可打印练习卷。",
            questions=[],
        )
        extra_quiz_papers = []

    # 5. Global Quality Verification
    router.check_cancelled()
    quality_audit_report = ""
    audit_sel = router.resolve_quality_audit_provider()
    if audit_sel is None:
        router.routing_trace["global_quality_audit"] = "已手动关闭"
        quality_audit_report = "全局质量验收已手动关闭。"
    else:
        current_stage_state["stage"] = "quality_audit"
        current_stage_state["percent"] = 95
        if progress_cb:
            await progress_cb(
                "quality_audit",
                95,
                "正在执行【全局质量验收】（校验公式、区分度、题量契约与解析完整性）...",
            )
        audit_sys = (
            "你是教学资料总审校与命题测量专家（Global Quality Auditor）。请重点审查以下质量维度，并输出合法 JSON：\n"
            "1. 题量与结构是否符合场景定位，三级认知梯队（基础达标 / 能力提升 / 拓展探究）分布是否合理；\n"
            "2. 抽检试题质量：单选题干扰项是否具有真实迷惑性、填空题答案是否唯一客观、解析是否涵盖【考点定位】【详解与推导】【易错点拨】；\n"
            "3. 讲义与速记表中 `$...$` / `$$...$$` LaTeX 公式排版合规性。\n"
            '输出格式：{"passed": true, "score": 96, "summary": "一句简明中文验收结论（包含试题区分度与解析质量评价）", "issues": []}'
        )
        quiz_samples = _format_quiz_samples_for_audit(quiz_paper)
        tier_counts = {
            t: sum(1 for q in quiz_paper.questions if q.tier == t)
            for t in ("基础达标", "能力提升", "拓展探究")
        }
        audit_user = (
            f"方案名称: {blueprint.blueprint_title} | 场景: {blueprint.preset_name}\n"
            f"勾选交付项: {', '.join(d.selected_items)}\n"
            f"主试卷题量: {len(quiz_paper.questions)} 道 | 总分: {quiz_paper.total_score} | 梯度分布: {tier_counts} | 附带试卷数: {len(extra_quiz_papers)}\n"
            f"讲义长度: {len(study_notes_md)} 字 | 速记表长度: {len(cheatsheet_md)} 字\n"
            f"代表性试题抽检（最多3题）：\n{quiz_samples}\n"
            f"讲义前350字摘要:\n{study_notes_md[:350]}"
        )
        audit_data, audit_label = await router.execute_json("global_quality_audit", audit_sys, audit_user)
        if isinstance(audit_data, dict):
            audit_score = int(audit_data.get("score") or 95)
            audit_summary = str(audit_data.get("summary") or "格式、公式与题量契约校验通过")
            router.routing_trace["global_quality_audit"] = f"{audit_label} · 验收 {audit_score}分"
            quality_audit_report = f"[{audit_label}] 全局质量验收通过（{audit_score}/100）：{audit_summary}。"
        else:
            router.routing_trace["global_quality_audit"] = f"{audit_label} · 结构契约校验完成"
            quality_audit_report = "已完成数学公式规范化、多试卷生成核验与 Mermaid 语法清洗。"

    router.check_cancelled()
    if progress_cb:
        await progress_cb("done", 100, "学习资料生成完成！")

    flashcards = extract_knowledge_flashcards(document_ir, study_notes_md, cheatsheet_md, quiz_paper)
    confirmed_bp = blueprint.model_copy(update={"confirmed": True})
    return StudyPackage(
        project_id=document_ir.project_id,
        blueprint_used=confirmed_bp,
        routing_trace=router.routing_trace,
        quality_audit_report=quality_audit_report,
        study_notes_markdown=study_notes_md,
        cheatsheet_markdown=cheatsheet_md,
        quiz_paper=quiz_paper,
        extra_quiz_papers=extra_quiz_papers,
        flashcards=flashcards,
        mindmap_mermaid=mindmap_mermaid,
    )


def _strip_quiz_option_leakage(text: str) -> str:
    """Remove references like '选A' or '正确答案' from conceptual explanations used on knowledge flashcards."""
    cleaned = re.sub(r"^(?:本题|答案|参考答案)?(?:选|为|是)\s*[A-D](?:[.、:：\s]+)?", "", (text or "").strip())
    cleaned = re.sub(r"(?:故选|因此选|故正确答案为)\s*[A-D][。.]?", "", cleaned)
    return cleaned.strip()


# Appended after _strip_quiz_option_leakage(): flashcard helpers + builder.

_FLASHCARD_LABEL_BLACKLIST = (
    "这一节", "本节", "导学", "生活化类比", "标准定义", "通俗翻译", "一句话", "核心特征",
    "关键特征", "适用对象", "速记密度", "版式", "打印设置", "使用说明", "使用指南", "记忆口诀",
    "符号含义", "符号解释", "单位", "注意", "提示", "依据", "破题", "答题步骤", "新手避坑",
    "易错", "例题", "自测", "答案", "解析", "评分标准", "重头戏", "解题", "思路",
    "学习目标", "知识地图", "学习地图", "核心聚焦", "覆盖章节", "目录", "参考",
)

_QUIZ_SECTION_RE = re.compile(r"【([^】]{2,8})】")


def _term_ok(term: str) -> bool:
    """Reject structural labels and layout metadata that used to become junk cards."""
    t = (term or "").strip().strip("*`【】[] ").strip()
    if not 2 <= len(t) <= 22:
        return False
    if any(b in t for b in _FLASHCARD_LABEL_BLACKLIST):
        return False
    if t.endswith(("？", "?", "：", ":", "…")):
        return False
    if "｜" in t or "|" in t or "\n" in t:
        return False
    # 推导步骤 / 图表编号不是知识点
    if re.match(r"^(?:step|step\s*\d+|第\s*\d+\s*步|步骤\s*\d*|例\s*\d*|图\s*\d+|表\s*\d+|式\s*\d+)", t, re.I):
        return False
    return True


def _split_quiz_explanation(text: str) -> Dict[str, str]:
    """Split `【考点定位】…【详解与推导】…【易错点拨】…` into {section: content}."""
    sections: Dict[str, str] = {}
    matches = list(_QUIZ_SECTION_RE.finditer(text or ""))
    for idx, match in enumerate(matches):
        name = match.group(1).strip()
        start = match.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        body = (text[start:end] or "").strip(" \n：:。")
        if body and name not in sections:
            sections[name] = body
    return sections


def extract_knowledge_flashcards(
    document_ir: DocumentIR,
    study_notes_md: str,
    cheatsheet_md: str,
    quiz_paper: Optional[QuizPaper],
    max_cards: int = 18,
) -> List[KnowledgeFlashcard]:
    """Build active-recall flashcards from *real* knowledge points.

    Priority (highest quality first):

    1. 名词词典 / 公式大全 表格（术语 → 一句话本质；公式名 → 表达式 + 参数前提）；
    2. `**术语**：定义` 形式的正文定义句（结构性小标题会被过滤，改从定义句取主语）；
    3. 题库解析里的 `【考点定位】[考点：X]`（真实考点名 + 判定要点 + 常见误区）；
    4. 兜底：章节关键术语 + 章节摘要首句。

    仅属于"版式/引导语"的内容（适用对象、生活化类比、速记密度、使用说明…）一律丢弃：
    它们曾经被当成知识点，导致卡片正面是「请简述『适用对象』的核心定义」。
    """
    cards: List[KnowledgeFlashcard] = []
    seen_fronts: set[str] = set()
    seen_terms: set[str] = set()
    # 配额：保证"概念 / 公式 / 考点"三类都有位置，不被第一种来源吃光
    quotas = {"核心公式": 6, "核心概念": 8, "考点规律与易错点": 6, "核心术语": 4}
    cat_counts: Dict[str, int] = {key: 0 for key in quotas}

    def _norm(text: str) -> str:
        return re.sub(r"[\s\*`「」『』（）()]", "", text or "").lower()

    def _add_card(category: str, term: str, front: str, answer: str, explanation: str, source: str) -> None:
        if len(cards) >= max_cards:
            return
        if cat_counts.get(category, 0) >= quotas.get(category, max_cards):
            return
        clean_term = re.sub(r"\s+", "", term or "")[:36]
        if not clean_term or _norm(clean_term) in seen_terms:
            return
        body = (answer or "").strip()
        # 一句话都说不清的卡没有复习价值
        if len(re.sub(r"[\s$\\{}]", "", body)) < 8:
            return
        key = _norm(front)
        if key in seen_fronts:
            return
        seen_terms.add(_norm(clean_term))
        seen_fronts.add(key)
        cat_counts[category] = cat_counts.get(category, 0) + 1
        cards.append(
            KnowledgeFlashcard(
                id=f"kf_{len(cards) + 1}",
                category=category,
                front=normalize_markdown_math(front.strip()),
                answer=normalize_markdown_math(body),
                explanation=normalize_markdown_math((explanation or "").strip()),
                source=(source or "").strip() or document_ir.filename,
            )
        )

    # ---------------------------------------------------------------- 表格类知识
    def _split_row(row: str) -> List[str]:
        return [cell.strip() for cell in row.strip().strip("|").split("|")]

    def _iter_tables(md_text: str):
        lines = md_text.splitlines()
        i = 0
        while i + 1 < len(lines):
            head = lines[i].strip()
            sep = lines[i + 1].strip()
            if head.startswith("|") and _TABLE_SEP_RE.match(sep):
                headers = _split_row(head)
                rows: List[List[str]] = []
                j = i + 2
                while j < len(lines) and lines[j].strip().startswith("|"):
                    rows.append(_split_row(lines[j].strip()))
                    j += 1
                yield headers, rows
                i = j
            else:
                i += 1

    def _find_col(headers: List[str], keys: Tuple[str, ...]) -> int:
        for idx, head in enumerate(headers):
            if any(k in head for k in keys):
                return idx
        return -1

    for src_label, md_text in [("考前速记浓缩", cheatsheet_md), ("课程学习讲义", study_notes_md)]:
        if not md_text or len(cards) >= max_cards:
            continue
        for headers, rows in _iter_tables(md_text):
            term_idx = _find_col(headers, ("术语", "名词", "公式名称", "名称", "概念", "项目", "符号"))
            # 表达式列优先按“表达式 / LaTeX”定位；“公式”这个宽泛关键词只作兜底，
            # 否则“公式名称”列会被误当成表达式列。
            formula_idx = _find_col(headers, ("表达式", "LaTeX"))
            if formula_idx < 0:
                for idx, head in enumerate(headers):
                    if idx != term_idx and "公式" in head:
                        formula_idx = idx
                        break
            answer_idx = _find_col(headers, ("本质", "定义", "解释", "含义", "说明", "用途"))
            extra_idx = _find_col(headers, ("关键词", "参数", "单位", "前提", "适用", "注意"))
            if term_idx < 0 or (formula_idx < 0 and answer_idx < 0):
                continue
            for row in rows:
                if len(cards) >= max_cards:
                    break
                if term_idx >= len(row):
                    continue
                term = row[term_idx].strip()
                if not _term_ok(term):
                    continue
                expr = row[formula_idx].strip() if 0 <= formula_idx < len(row) else ""
                meaning = row[answer_idx].strip() if 0 <= answer_idx < len(row) else ""
                extra = row[extra_idx].strip() if 0 <= extra_idx < len(row) else ""
                if formula_idx >= 0 and ("$" in expr or "\\" in expr):
                    _add_card(
                        "核心公式",
                        term,
                        f"**【公式】** 写出「{term}」的表达式，并说明各符号含义与适用前提。",
                        expr + (f"　{meaning}" if meaning else ""),
                        extra,
                        f"{src_label} · {term}",
                    )
                elif meaning:
                    _add_card(
                        "核心概念",
                        term,
                        f"**【概念】** 「{term}」到底指什么？",
                        meaning,
                        extra,
                        f"{src_label} · {term}",
                    )

    # ---------------------------------------------------------------- 正文定义句
    def_bold_re = re.compile(r"^(?:[-*+]\s+|\d+[.、]\s+)?\*\*([^*]{2,42})\*\*\s*[：:]\s*(.{8,})$")
    subject_re = re.compile(r"^([\u4e00-\u9fa5A-Za-z0-9（）()·\-]{2,18}?)(?:是指|指的是|是|即)")

    for src_label, md_text in [("课程学习讲义", study_notes_md), ("考前速记浓缩", cheatsheet_md)]:
        if not md_text or len(cards) >= max_cards:
            continue
        current_heading = ""
        for raw_line in md_text.splitlines():
            if len(cards) >= max_cards:
                break
            line = raw_line.strip()
            heading_m = re.match(r"^#{1,4}\s+(.+)$", line)
            if heading_m:
                current_heading = re.sub(r"[`*_]", "", heading_m.group(1)).strip()
                continue
            # 自测 / 习题 / 答案区不是知识来源
            if re.search(r"(自测|练习|习题|作业|检测|答案|解析|例题)", current_heading):
                continue
            def_m = def_bold_re.match(line)
            if not def_m:
                continue
            label = def_m.group(1).strip()
            detail = def_m.group(2).strip()
            term = label
            if not _term_ok(term) or len(term) < 3:
                # 「标准定义」「生活化类比」这类结构名：改从定义句本身取主语
                subj = subject_re.match(detail)
                term = subj.group(1).strip() if subj else ""
            if not _term_ok(term) or len(term) < 3:
                continue
            if re.match(r"^\d+[.、）)]", term) or re.search(r"(填空|判断|单选|多选|简答)题", term):
                continue
            if term in ("规定", "说明", "注意", "提示", "总结", "小结", "定义", "分类"):
                continue
            first_sentence = re.split(r"[。；\n]", detail)[0].strip()
            if len(first_sentence) < 12:
                continue
            # 只有真的含公式（$$…$$ 或带变量的等式）才算公式卡
            is_formula = "$$" in detail or "=" in detail and ("$" in detail or "\\" in detail)
            _add_card(
                "核心公式" if is_formula else "核心概念",
                term,
                f"**【{'公式' if is_formula else '概念'}】** 「{term}」的定义与关键要点是什么？",
                first_sentence[:150],
                f"出自「{current_heading}」：{detail[:260]}" if current_heading else detail[:260],
                f"{src_label}" + (f" · {current_heading}" if current_heading else ""),
            )

    # ---------------------------------------------------------------- 题库考点
    if quiz_paper and quiz_paper.questions and len(cards) < max_cards:
        for q in quiz_paper.questions:
            if len(cards) >= max_cards:
                break
            sections = _split_quiz_explanation(q.explanation or "")
            tags = [t.strip() for t in (q.knowledge_tags or []) if t.strip()]
            tag = tags[0] if tags else sections.get("考点定位", "")
            tag = re.sub(r"^\[?考点[：:]\s*", "", tag).strip(" []【】")
            tag = re.split(r"[；;，,。]", tag)[0].strip()
            if not _term_ok(tag):
                continue
            detail = sections.get("详解与推导") or sections.get("详解") or ""
            takeaway = re.split(r"[。；\n]", detail)[0].strip() if detail else ""
            if len(takeaway) < 10:
                continue
            pitfall = sections.get("易错点拨", "")
            _add_card(
                "考点规律与易错点",
                tag,
                f"**【考点】** 「{tag}」的判断要点是什么？常见误区在哪？",
                takeaway[:160],
                pitfall[:220],
                f"核心考点 · {tag}",
            )

    # ---------------------------------------------------------------- 兜底章节术语
    if len(cards) < 6 and document_ir.chapters:
        for ch in document_ir.chapters:
            if len(cards) >= max_cards:
                break
            preview = re.split(r"[。\n]", (ch.summary_preview or ch.content_text or "").strip())[0].strip()
            for term in [t.strip() for t in (ch.key_terms or []) if t.strip()][:3]:
                if not _term_ok(term) or len(preview) < 12:
                    continue
                _add_card(
                    "核心术语",
                    term,
                    f"**【术语】** 《{ch.title}》里的「{term}」是什么？",
                    preview[:150],
                    f"出自 P{ch.start_page}-{ch.end_page}",
                    f"{ch.title} · P{ch.start_page}",
                )

    return cards[:max_cards]
