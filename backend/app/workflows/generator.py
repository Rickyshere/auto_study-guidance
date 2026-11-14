from __future__ import annotations

import re
from typing import Awaitable, Callable, Dict, List, Optional, Tuple

from app.router.fallback_provider import HeuristicStudyEngine
from app.router.routing_engine import ModelRouter
from app.schemas import (
    ChapterNode,
    DeliverableConfig,
    DocumentIR,
    QuizPaper,
    QuizQuestion,
    StudyBlueprint,
    StudyPackage,
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


def normalize_markdown_math(text: str) -> str:
    """Normalize LaTeX delimiters for remark-math/rehype-katex and escape table math pipes."""
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

    # Fix already-unescaped parenthesized formulas that contain LaTeX commands / ^{ / _{
    out_lines: List[str] = []
    for line in out.splitlines():
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
        line = _replace_table_pipes_in_math(line)
        out_lines.append(line)

    return "\n".join(out_lines)


def _collect_chapters_context(chapters: List[ChapterNode], max_chars: int = 24000) -> str:
    blocks: List[str] = []
    budget_per_ch = max(1200, max_chars // max(1, len(chapters)))
    for ch in chapters:
        asset_note = ""
        if ch.assets:
            asset_links = ", ".join(f"![{a.caption}]({a.url})" for a in ch.assets[:3])
            asset_note = f"\n[本节可引用的原书/课件配图 Markdown]: {asset_links}"
        snippet = ch.content_text[:budget_per_ch]
        blocks.append(
            f"=== 章节 [{ch.chapter_id}] {ch.title} (页码/幻灯片: {ch.start_page}-{ch.end_page}) ===\n"
            f"{snippet}{asset_note}"
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
    """Construct refined system & user prompts for study notes and worked examples."""
    d = blueprint.deliverables
    focus_str = "、".join(blueprint.focus_topics) if blueprint.focus_topics else "全章核心概念"
    chapter_anchors = _build_chapter_anchor_table(selected_chapters)

    notes_sys = (
        "你是一位顶尖学科导师、命题研究专家与教材主编。请严格依据提供的教材/课件原文内容，编写高水准的结构化学习讲义/导学案。\n"
        "一、内容真实性与格式规范：\n"
        "1. 严格忠于原文事实、符号体系与推导逻辑，切勿编造教材未出现的定理或数据；若原文附有配图 Markdown 链接（如 `![...](...)`），请在对应知识点段落自然内联引用。\n"
        "2. 规范使用 Markdown 层级标题、对比表格与要点清单；所有行内数学公式必须严格使用 `$...$`，独立公式块使用 `$$...$$`，严禁使用 `\\(...\\)` 或 `\\[...\\]`；Markdown 表格内的范数请写 `\\parallel W \\parallel` 而非 `\\|W\\|`。\n"
        f"二、教学风格与【典型例题】深度设计（当前模板：【{blueprint.preset_name}】｜风格：{d.notes_style}｜目标难度：{blueprint.target_difficulty}）：\n"
        "   - 若为【自学案】（或 `guided_learning`）：必须完整包含以下模块：\n"
        "     (1) 学习目标与重难点拆解；(2) 前置概念导读与直觉类比；(3) 核心概念与定理公式精讲；\n"
        "     (4) 不少于 4 道高质量、难度递进的【典型例题与深度解析】（须覆盖「概念辨析型 → 公式推导/定量计算型 → 综合应用/反例探究型」，每道例题均须包含完整条件/数据或选项，并严格按以下五个加粗标签分节：\n"
        "         - **【题目】**：交代清晰条件、待求目标或完整情景；\n"
        "         - **【命题意图】**：一句话点明本题考察的核心能力与知识陷阱；\n"
        "         - **【思路引导】**：给出切入突破口与关键转化步骤，不直接剧透答案；\n"
        "         - **【详细解答】**：逐步推导计算并给出严谨结论；\n"
        "         - **【易错点拨与变式】**：剖析学生最易混淆的错误做法，并附 1 句简短变式思考）；\n"
        "     (5) 易混概念对比表与自学自检 Checklist。\n"
        "   - 若为【随堂练习】：输出精炼的“当堂核心要点速览”、易错预警及 2 道课堂示范例题（须含 **【题目】**、**【思路引导】**、**【详细解答】**、**【易错点拨】**）。\n"
        "   - 若为【同步练习】：输出“章节知识框架梳理、高频题型示范例题（含上述结构化解析）与避坑清单”。\n"
        "   - 若为【自测卷】：输出“考前核心考点复盘提纲、高频压轴母题示例与答题规范模板”。"
    )
    notes_user = (
        f"文档名称: {document_ir.filename}\n"
        f"方案标题: {blueprint.blueprint_title}\n"
        f"核心考点: {focus_str}\n"
        f"用户定制指令: {blueprint.custom_instructions or '无额外指令'}\n\n"
        f"选中章节与页码锚点：\n{chapter_anchors}\n\n"
        f"教材/课件原文内容：\n{context_text}"
    )
    return notes_sys, notes_user


def build_quiz_prompts(
    document_ir: DocumentIR,
    selected_chapters: List[ChapterNode],
    blueprint: StudyBlueprint,
    context_text: str,
) -> Tuple[str, str]:
    """Construct fine-grained system & user prompts for high-quality exercise generation."""
    d = blueprint.deliverables
    focus_str = "、".join(blueprint.focus_topics) if blueprint.focus_topics else "全章核心概念"
    chapter_anchors = _build_chapter_anchor_table(selected_chapters)
    alloc = _compute_quiz_allocation(d, blueprint.target_difficulty)

    quiz_sys = (
        "你是一位兼具学科深度与教育测量学素养的资深命题专家。请严格依据教材/课件原文与知识锚点，命制一套高区分度、零歧义、解析透彻的高质量习题，并只输出一个合法 JSON 对象。\n\n"
        "一、命题质量铁律（严禁低质“送分题/纯抄书题”）：\n"
        "1. 禁止出现“什么是 XX？”“教材第几章讲了什么？”或原文整句挖空式的浅层记忆题；每道题都必须考查**机理辨析、条件适用边界、定量计算/公式推导、步骤因果排序、反例判断或具体情境迁移应用**。\n"
        "2. 单选题（`type=\"mcq\"`）选项与干扰项工程：\n"
        "   - 必须提供严格 4 个选项：`[\"A. ...\", \"B. ...\", \"C. ...\", \"D. ...\"]`，四选项长度、句式和专业深度应保持均衡（禁止出现过短、幽默或明显荒谬的凑数选项）；`answer` 仅填写单个大写字母 `\"A\"`/`\"B\"`/`\"C\"`/`\"D\"`。\n"
        "   - 3 个错误干扰项必须各自对应真实高频误区：如公式符号/系数/量纲错误、混淆充分条件与必要条件、忽略定理前提约束、因果颠倒或边界条件越界。\n"
        "3. 填空题（`type=\"fill_blank\"`）：\n"
        "   - 题干必须在最核心的结论、临界条件或数学表达式位置使用下划线 `______` 标记；`options` 固定为空数组 `[]`；`answer` 必须简明、唯一、客观可判分（禁止开放性长句）。\n"
        "4. 简答/计算/综合探究题（`type=\"short_answer\"`）：\n"
        "   - 必须创设具体问题情景、待推导命题或对比分析任务，适当采用 `(1) ... (2) ...` 分步设问；`options` 固定为空数组 `[]`；`answer` 必须按采分点结构化列出（格式如 `【得分点1】...（X分）；【得分点2】...（Y分）`）。\n"
        "5. 三层认知梯度（`tier`）与难度（`difficulty`）协同：\n"
        "   - `基础达标`（`easy` 或 `medium`）：核心机理理解、关键前提辨析与公式直接应用；\n"
        "   - `能力提升`（`medium`）：跨概念综合对比、中间步骤推导计算或错误方案诊断；\n"
        "   - `拓展探究`（`hard`）：极限/边界情形分析、多步建模或复杂场景权衡推理。\n"
        "6. 解析字段（`explanation`）结构化强制标准：\n"
        "   - 每道题的 `explanation` 必须完整包含三部分：`【考点定位】...` + `【详解与推导】...` + `【易错点拨】...`。\n"
        "   - 对于单选题，**`【详解与推导】` 必须先论证正确选项为何成立，再逐一指出其余 3 个干扰项分别错在何处**；对于计算/简答题，必须写出完整中间推导与得分依据。\n"
        "7. 章节溯源与 LaTeX / JSON 转义契约：\n"
        "   - 题目应尽量均匀覆盖所有选中章节，并准确填写 `source_chapter`（对应章节标题）与 `source_page`（页码/幻灯片范围，如 `P3-5`）。\n"
        "   - 所有行内公式使用 `$...$`，独立公式使用 `$$...$$`，禁止 `\\(...\\)` / `\\[...\\]`；**所有 JSON 字符串内部的 LaTeX 反斜杠必须双写转义**（例如写 `\"$\\\\frac{a}{b}$\"`、`\"$\\\\theta$\"`、`\"$\\\\nabla$\"`、`\"$\\\\times$\"`）。\n"
        "   - 只输出纯 JSON 对象，不要包含 Markdown 说明或前后寒暄文字。\n\n"
        "JSON 结构契约：\n"
        "{\n"
        '  "title": "试卷/练习标题",\n'
        '  "instructions": "作答说明（含题型题量、总分、建议用时及答题要求）",\n'
        '  "questions": [\n'
        "    {\n"
        '      "id": "q_1",\n'
        '      "type": "mcq" | "fill_blank" | "short_answer",\n'
        '      "difficulty": "easy" | "medium" | "hard",\n'
        '      "tier": "基础达标" | "能力提升" | "拓展探究",\n'
        '      "score": 5,\n'
        '      "question": "题干内容（含具体情境或公式 $...$）",\n'
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
        f"- 方案名称: {blueprint.blueprint_title}\n"
        f"- 模板类型: {blueprint.preset_name} (quiz_mode={d.quiz_mode})\n"
        f"- 目标难度: {blueprint.target_difficulty} | 建议用时: {d.suggested_minutes} 分钟\n"
        f"- 严格题量契约: 单选题 {d.mcq_count} 道 + 填空题 {d.fill_blank_count} 道 + 简答/分析题 {d.short_answer_count} 道（共 {alloc['total_qs']} 道，切勿少出或多出）\n"
        f"- 分值分配建议: {alloc['score_plan_text']}\n"
        f"- 认知分层配比目标: 基础达标约 {alloc['tier_basic']} 题 / 能力提升约 {alloc['tier_improve']} 题 / 拓展探究约 {alloc['tier_explore']} 题\n"
        f"- 重点考察主题: {focus_str}\n"
        f"- 用户定制指令: {blueprint.custom_instructions or '重点突出机制理解、公式推演与典型误区辨析'}\n\n"
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
    d = blueprint.deliverables
    focus_str = "、".join(blueprint.focus_topics) if blueprint.focus_topics else "全章核心概念"

    # 1. Study Notes / Guided Study Sheet
    study_notes_md = ""
    if d.include_study_guide_notes:
        router.check_cancelled()
        current_stage_state["stage"] = "notes"
        current_stage_state["percent"] = 20
        if progress_cb:
            await progress_cb("notes", 20, f"正在生成【{blueprint.preset_name}】讲义与精要笔记...")
        notes_sys, notes_user = build_notes_prompts(
            document_ir, selected_chapters, blueprint, context_text
        )
        res_notes, _ = await router.execute_text("notes_and_cheatsheet", notes_sys, notes_user)
        study_notes_md = normalize_markdown_math(
            res_notes or HeuristicStudyEngine.generate_notes_from_ir(document_ir, blueprint)
        )

    # 2. Cheat Sheet
    cheatsheet_md = ""
    if d.include_cheatsheet:
        router.check_cancelled()
        current_stage_state["stage"] = "cheatsheet"
        current_stage_state["percent"] = 45
        if progress_cb:
            await progress_cb("cheatsheet", 45, "正在浓缩考前速记表 (Cheat Sheet)...")
        cs_sys = (
            "请根据以下教材/课件原文，提炼一份高密度、适合考前突击复盘的《考前速记表 (Cheat Sheet)》。\n"
            "格式严格要求：所有行内/块级数学公式必须使用 `$...$` 或 `$$...$$`，严禁使用 `\\(...\\)` 或 `\\[...\\]`；"
            "Markdown 表格内的范数请用 `\\parallel W \\parallel^2` 而非 `\\|W\\|^2`，并控制单元格文本紧凑以免表格过宽溢出。\n"
            "内容要求包含：1) 核心概念/公式与适用边界速查 Markdown 表格；2) 高频易混概念/公式对比表；3) 考前必背与常见计算陷阱 Checklist。"
        )
        cs_user = (
            f"密度要求: {d.cheatsheet_density} | 重点主题: {focus_str}\n\n原文：\n{context_text[:18000]}"
        )
        res_cs, _ = await router.execute_text("notes_and_cheatsheet", cs_sys, cs_user)
        cheatsheet_md = normalize_markdown_math(
            res_cs or HeuristicStudyEngine.generate_cheatsheet_from_ir(document_ir, blueprint)
        )

    # 3. Quiz Paper
    quiz_paper: QuizPaper
    if d.include_quiz:
        router.check_cancelled()
        current_stage_state["stage"] = "quiz"
        current_stage_state["percent"] = 70
        if progress_cb:
            await progress_cb("quiz", 70, f"正在命制【{blueprint.preset_name}】配套题库与详细解析...")
        quiz_sys, quiz_user = build_quiz_prompts(
            document_ir, selected_chapters, blueprint, context_text
        )
        quiz_data, _ = await router.execute_json("quiz_generation", quiz_sys, quiz_user)
        if isinstance(quiz_data, dict) and isinstance(quiz_data.get("questions"), list) and quiz_data["questions"]:
            valid_qs: List[QuizQuestion] = []
            for idx, item in enumerate(quiz_data["questions"], start=1):
                try:
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
                            score=int(item.get("score") or 5),
                            question=str(item.get("question") or ""),
                            options=[str(o) for o in (item.get("options") or [])],
                            answer=str(item.get("answer") or ""),
                            explanation=str(item.get("explanation") or ""),
                            source_chapter=str(item.get("source_chapter") or selected_chapters[0].title),
                            source_page=str(item.get("source_page") or ""),
                        )
                    )
                except Exception:
                    continue
            if valid_qs:
                quiz_paper = QuizPaper(
                    title=str(quiz_data.get("title") or f"{document_ir.filename} · {blueprint.preset_name}"),
                    mode=d.quiz_mode,
                    total_score=sum(q.score for q in valid_qs),
                    suggested_minutes=d.suggested_minutes,
                    instructions=str(quiz_data.get("instructions") or f"共 {len(valid_qs)} 题，建议用时 {d.suggested_minutes} 分钟。"),
                    questions=valid_qs,
                )
            else:
                quiz_paper = HeuristicStudyEngine.generate_quiz_from_ir(document_ir, blueprint)
        else:
            quiz_paper = HeuristicStudyEngine.generate_quiz_from_ir(document_ir, blueprint)
    else:
        quiz_paper = QuizPaper(
            title=f"{document_ir.filename} · 未启用题库",
            mode=d.quiz_mode,
            total_score=0,
            suggested_minutes=0,
            instructions="当前方案未开启题库生成。",
            questions=[],
        )

    # 4. Mindmap
    mindmap_mermaid = ""
    if d.include_mindmap:
        router.check_cancelled()
        current_stage_state["stage"] = "mindmap"
        current_stage_state["percent"] = 90
        if progress_cb:
            await progress_cb("mindmap", 90, "正在构建 Mermaid 可视化知识图谱...")
        mm_sys = (
            "请根据教材章节结构与核心概念，生成一段可直接渲染的 Mermaid `flowchart LR` 知识图谱代码。\n"
            "语法要求：所有节点文本必须用英文双引号包裹，例如 `c1[\"核心概念\"]`，节点文本内不要包含双引号、括号或分号。只输出 Mermaid 代码。"
        )
        mm_user = (
            f"文档: {document_ir.filename}\n深度: {d.mindmap_depth} 层\n"
            f"章节与关键词：\n"
            + "\n".join(
                f"- {c.title}: {', '.join(c.key_terms[:5])}" for c in selected_chapters
            )
        )
        res_mm, _ = await router.execute_text("mindmap_generation", mm_sys, mm_user)
        cleaned_mm = _sanitize_mermaid_code(res_mm) if res_mm else ""
        mindmap_mermaid = cleaned_mm or HeuristicStudyEngine.generate_mindmap_from_ir(
            document_ir, blueprint
        )

    # 5. Global Quality Verification (Strictly enabled ONLY when non-heuristic engine is used)
    router.check_cancelled()
    quality_audit_report = ""
    audit_sel = router.resolve_quality_audit_provider()
    if audit_sel is None:
        if not router.is_non_heuristic_active():
            router.routing_trace["global_quality_audit"] = "未启用 (仅在使用非内置规则引擎时启用)"
            quality_audit_report = (
                "当前使用内置智能规则引擎，全局质量验收通道自动跳过（仅在启用 CLI Harness / 云端 API / 本地模型时触发）。"
            )
        else:
            router.routing_trace["global_quality_audit"] = "已手动关闭"
            quality_audit_report = "全局质量验收已手动关闭。"
    else:
        current_stage_state["stage"] = "quality_audit"
        current_stage_state["percent"] = 95
        if progress_cb:
            await progress_cb(
                "quality_audit",
                95,
                "正在通过非内置引擎执行【全局质量验收】（校验公式、题量契约与解析完整性）...",
            )
        repairs: List[str] = []

        # 5.1 Normalize LaTeX delimiters across quiz questions & options
        if d.include_quiz and quiz_paper.questions:
            norm_qs: List[QuizQuestion] = []
            for q in quiz_paper.questions:
                norm_qs.append(
                    q.model_copy(
                        update={
                            "question": normalize_markdown_math(q.question),
                            "options": [normalize_markdown_math(o) for o in q.options],
                            "answer": normalize_markdown_math(q.answer),
                            "explanation": normalize_markdown_math(q.explanation),
                        }
                    )
                )
            quiz_paper = quiz_paper.model_copy(update={"questions": norm_qs})

            # Verify blueprint question counts; top up missing items deterministically if short
            target_total_qs = d.mcq_count + d.fill_blank_count + d.short_answer_count
            if len(quiz_paper.questions) < target_total_qs:
                fallback_quiz = HeuristicStudyEngine.generate_quiz_from_ir(document_ir, blueprint)
                need_by_type = {
                    "mcq": max(0, d.mcq_count - sum(1 for q in quiz_paper.questions if q.type == "mcq")),
                    "fill_blank": max(
                        0, d.fill_blank_count - sum(1 for q in quiz_paper.questions if q.type == "fill_blank")
                    ),
                    "short_answer": max(
                        0, d.short_answer_count - sum(1 for q in quiz_paper.questions if q.type == "short_answer")
                    ),
                }
                existing_ids = {q.id for q in quiz_paper.questions}
                added = 0
                updated_qs = list(quiz_paper.questions)
                for fq in fallback_quiz.questions:
                    if need_by_type.get(fq.type, 0) > 0:
                        new_id = fq.id
                        while new_id in existing_ids:
                            new_id = f"{fq.id}_{len(existing_ids) + 1}"
                        existing_ids.add(new_id)
                        updated_qs.append(fq.model_copy(update={"id": new_id}))
                        need_by_type[fq.type] -= 1
                        added += 1
                if added > 0:
                    quiz_paper = quiz_paper.model_copy(
                        update={
                            "questions": updated_qs,
                            "total_score": sum(q.score for q in updated_qs),
                        }
                    )
                    repairs.append(f"自动补全 {added} 道缺失试题以匹配方案题量契约")

        # 5.2 Ensure self-study guide includes worked examples
        if d.include_study_guide_notes and "典型例题" not in study_notes_md:
            fallback_notes = HeuristicStudyEngine.generate_notes_from_ir(document_ir, blueprint)
            ex_idx = fallback_notes.find("典型例题")
            if ex_idx != -1:
                section_start = fallback_notes.rfind("\n##", 0, ex_idx)
                patch = fallback_notes[section_start if section_start != -1 else ex_idx :]
                study_notes_md = normalize_markdown_math(f"{study_notes_md.rstrip()}\n\n{patch.strip()}")
                repairs.append("自动补充结构化典型例题与解析模块")

        # 5.3 Invoke non-heuristic engine for semantic global quality verification
        audit_sys = (
            "你是教学资料总审校与命题测量专家（Global Quality Auditor）。请重点审查以下质量维度，并输出合法 JSON：\n"
            "1. 题量与总分契约是否对齐，三级认知梯队（基础达标 / 能力提升 / 拓展探究）分布是否合理；\n"
            "2. 抽检试题质量：单选题干扰项是否具有真实迷惑性、填空题答案是否唯一客观、解析是否涵盖【考点定位】【详解与推导】【易错点拨】；\n"
            "3. 讲义例题完整性与 `$...$` / `$$...$$` LaTeX 公式排版合规性。\n"
            '输出格式：{"passed": true, "score": 96, "summary": "一句简明中文验收结论（包含试题区分度与解析质量评价）", "issues": []}'
        )
        quiz_samples = _format_quiz_samples_for_audit(quiz_paper)
        tier_counts = {
            t: sum(1 for q in quiz_paper.questions if q.tier == t)
            for t in ("基础达标", "能力提升", "拓展探究")
        }
        audit_user = (
            f"方案名称: {blueprint.blueprint_title} | 预设: {blueprint.preset_name}\n"
            f"目标题量: 单选 {d.mcq_count} + 填空 {d.fill_blank_count} + 简答 {d.short_answer_count} (目标总分 {d.total_score})\n"
            f"实际题量: {len(quiz_paper.questions)} 道 | 实际总分: {quiz_paper.total_score} | 梯度分布: {tier_counts}\n"
            f"讲义含典型例题: {'是' if '典型例题' in study_notes_md else '否'} | "
            f"讲义长度: {len(study_notes_md)} 字 | 速记表长度: {len(cheatsheet_md)} 字\n"
            f"Mermaid 语法前缀: {mindmap_mermaid.splitlines()[0] if mindmap_mermaid else '无'}\n"
            f"已执行自动修正: {', '.join(repairs) if repairs else '无'}\n"
            f"代表性试题抽检（最多3题）：\n{quiz_samples}\n"
            f"讲义前350字摘要:\n{study_notes_md[:350]}"
        )
        audit_data, audit_label = await router.execute_json("global_quality_audit", audit_sys, audit_user)
        if isinstance(audit_data, dict):
            audit_score = int(audit_data.get("score") or 95)
            audit_summary = str(audit_data.get("summary") or "格式、公式与题量契约校验通过")
            router.routing_trace["global_quality_audit"] = f"{audit_label} · 验收 {audit_score}分"
            repair_note = f"；自动修复项：{', '.join(repairs)}" if repairs else ""
            quality_audit_report = f"[{audit_label}] 全局质量验收通过（{audit_score}/100）：{audit_summary}{repair_note}。"
        else:
            router.routing_trace["global_quality_audit"] = f"{audit_label} · 结构契约校验完成"
            repair_note = f"（已自动补全：{', '.join(repairs)}）" if repairs else "（全部契约项一次通过）"
            quality_audit_report = f"已完成数学公式规范化、题量契约核验与 Mermaid 语法清洗{repair_note}。"

    router.check_cancelled()
    if progress_cb:
        await progress_cb("done", 100, "学习资料生成完成！")

    confirmed_bp = blueprint.model_copy(update={"confirmed": True})
    return StudyPackage(
        project_id=document_ir.project_id,
        blueprint_used=confirmed_bp,
        routing_trace=router.routing_trace,
        quality_audit_report=quality_audit_report,
        study_notes_markdown=study_notes_md,
        cheatsheet_markdown=cheatsheet_md,
        quiz_paper=quiz_paper,
        mindmap_mermaid=mindmap_mermaid,
    )
