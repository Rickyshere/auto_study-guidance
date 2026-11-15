"""分节练习：把「整本资料的课后作业」改成「依托讲义小节的分节作业」。

讲义（study_notes_markdown）里已经有 `# 第1节 …` / `## 2.3 …` 这样的结构，这里把这些
标题切成节，再按节生成 3~5 道题。结果按「节 + 讲义指纹」缓存在项目目录，讲义重新生成后
自动失效，不会拿旧题糊弄用户。
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from app.router.routing_engine import ModelRouter
from app.schemas import ChapterNode, DocumentIR, QuestionFigureBlock, QuizPaper, QuizQuestion, StudyBlueprint
from app.workflows.generator import normalize_markdown_math
from app.workflows.visual_compiler import compile_figure_block_with_fallbacks

_HEADING_RE = re.compile(r"^(#{1,4})\s+(.+?)\s*$")
_SECTION_ID_RE = re.compile(r"[^a-z0-9]+")
MAX_SECTIONS = 24
EXCERPT_LIMIT = 2600
# 少于这么多字的「节」当作空标题丢掉（正文太短也给不出题）
MIN_SECTION_CHARS = 20
# 「第 1 节 / 第三讲 / 第2课」这类标题才是真正可以出题的知识小节
_SECTION_MARK_RE = re.compile(r"第\s*[0-9一二三四五六七八九十百]+\s*[节讲课]")
# 这类小节只用来导览/速查，读完就该放行，不该卡练习
_OPTIONAL_TITLE_RE = re.compile(
    r"(学习地图|知识地图|思维导图|导览|导读|导学|学习目标|学习路线|使用说明|讲义说明|"
    r"前言|引言|序言|绪论|目录|速查|公式表|知识清单|考点清单|一页纸|"
    r"例题|同步练习|随堂练习|课堂练习|习题|练习题|例题与训练)"
)


def _slugify(title: str, index: int) -> str:
    ascii_part = _SECTION_ID_RE.sub("-", title.lower()).strip("-")
    return f"sec_{index + 1:02d}" + (f"_{ascii_part[:24]}" if ascii_part else "")


_SKIP_TITLE_WORDS = (
    "参考答案",
    "答案与解析",
    "答案",
    "目录",
    "附录",
    "单元检测",
    "检测卷",
    "单元基本功",
    "期中",
    "期末",
    "试卷",
    "作业",
    "索引",
)


def _sections_at_level(
    lines: List[str], headings: List[Tuple[int, int, str]], level: int
) -> List[Dict[str, Any]]:
    """只按指定层级的标题切节，其它层级一律当正文。"""
    nodes = [h for h in headings if h[0] == level]
    out: List[Dict[str, Any]] = []
    for order, (lvl, line_no, title) in enumerate(nodes):
        if any(w in title for w in _SKIP_TITLE_WORDS):
            continue
        end_line = nodes[order + 1][1] if order + 1 < len(nodes) else len(lines)
        body = "\n".join(lines[line_no + 1 : end_line])
        body = re.sub(r"@@ASG_PAGE_BREAK@@", "", body).strip()
        if len(body) < MIN_SECTION_CHARS:
            continue
        full = re.sub(r"@@ASG_PAGE_BREAK@@", "", "\n".join(lines[line_no:end_line])).strip()
        out.append(
            {
                "title": title,
                "level": lvl,
                "markdown": full,
                "excerpt": body[:EXCERPT_LIMIT],
                "char_count": len(body),
            }
        )
    return out


def _choose_split_level(
    lines: List[str], headings: List[Tuple[int, int, str]]
) -> Tuple[List[Dict[str, Any]], int]:
    """挑一个「像单元」的标题层级。

    从最粗的层级往下试：切不出两节、或者切出来某一节独吞全文（说明这一层只有一个
    大标题，讲义是按更低层级组织的，比如 C 模式把整章写成一个 H1 再用 H2 分块），
    就再往下一层。这样 A 模式落在「第 N 节」，C 模式落在「考点 / 模块」那一层。
    """
    levels = sorted({h[0] for h in headings})
    total_chars = max(1, sum(len(line) for line in lines))
    fallback: Tuple[List[Dict[str, Any]], int] = ([], levels[0] if levels else 1)
    for level in levels:
        candidate = _sections_at_level(lines, headings, level)
        if len(candidate) < 2:
            continue
        biggest = max(s["char_count"] for s in candidate)
        if len(fallback[0]) < len(candidate):
            fallback = (candidate, level)
        if biggest / total_chars <= 0.7:
            return candidate, level
    return fallback


def extract_note_sections(markdown: str) -> List[Dict[str, Any]]:
    """把讲义 Markdown 切成「节」：自动挑层级，忽略"参考答案"等尾部结构。

    每一节同时带 `markdown`（标题 + 正文，前端按节渲染就用这一段，保证和分节练习
    一一对应）和 `practice_required`（导览类小节读完即可，不强制做题）。
    """
    if not (markdown or "").strip():
        return []

    lines = markdown.splitlines()
    headings: List[Tuple[int, int, str]] = []  # (level, line_no, title)
    in_fence = False
    for idx, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        m = _HEADING_RE.match(stripped)
        if m:
            title = m.group(2).strip().strip("*_`#").strip()
            if title:
                headings.append((len(m.group(1)), idx, title))
    if not headings:
        return []

    raw_sections, _level = _choose_split_level(lines, headings)

    sections: List[Dict[str, Any]] = []
    for item in raw_sections:
        item = dict(item)
        item["section_id"] = _slugify(item["title"], len(sections))
        sections.append(item)
        if len(sections) >= MAX_SECTIONS:
            break

    if len(sections) < 2:
        for s in sections:
            s["practice_required"] = not _OPTIONAL_TITLE_RE.search(s["title"])
        return sections

    # 第一个标题有时是讲义自己的大标题（如「第02章 … 详细自学案」），不是可学的小节
    first = sections[0]
    rest = sections[1:]
    rest_are_sections = sum(1 for s in rest if _SECTION_MARK_RE.search(s["title"])) >= max(
        1, len(rest) // 2
    )
    doc_title_like = bool(
        re.search(r"第\s*[0-9一二三四五六七八九十百]+\s*[章篇部]", first["title"])
    ) and bool(re.search(r"(自学案|讲义|笔记|浓缩|梳理|总结|提取|解析)", first["title"]))
    if rest_are_sections and not _SECTION_MARK_RE.search(first["title"]) and doc_title_like:
        sections = rest

    has_section_marks = any(_SECTION_MARK_RE.search(s["title"]) for s in sections)
    for s in sections:
        if _OPTIONAL_TITLE_RE.search(s["title"]):
            # 导学 / 地图 / 速查 / 例题 / 同步练习：读完就放行，不强制做题
            s["practice_required"] = False
        elif has_section_marks:
            # 结构清晰的讲义：只给「第 N 节」正文出题
            s["practice_required"] = bool(_SECTION_MARK_RE.search(s["title"]))
        else:
            s["practice_required"] = True
    return sections


def notes_fingerprint(markdown: str) -> str:
    return hashlib.sha256((markdown or "").encode("utf-8")).hexdigest()[:12]


# ---------------------------------------------------------------- 缓存


def _cache_path(project_dir: Path) -> Path:
    return project_dir / "section_practice.json"


def load_cache(project_dir: Path, fingerprint: str) -> Dict[str, Any]:
    path = _cache_path(project_dir)
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if data.get("notes_fingerprint") != fingerprint:
        return {}
    papers = data.get("papers")
    return papers if isinstance(papers, dict) else {}


def save_cache(project_dir: Path, fingerprint: str, papers: Dict[str, Any]) -> None:
    try:
        _cache_path(project_dir).write_text(
            json.dumps(
                {"notes_fingerprint": fingerprint, "papers": papers},
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
    except Exception:
        pass


# ---------------------------------------------------------------- 生成


def _build_section_prompt(
    section: Dict[str, Any],
    blueprint: StudyBlueprint,
    document_ir: DocumentIR,
    total_sections: int,
    per_type: Tuple[int, int, int],
) -> Tuple[str, str]:
    mcq_n, fill_n, short_n = per_type
    d = blueprint.deliverables
    mode_line = {
        "A_beginner": "零基础入门：以概念辨析与公式直接套用为主，讲清每一步依据。",
        "B_consolidate": "巩固提高：加入易错边界、变式迁移与高迷惑性干扰项。",
        "C_sprint": "考前冲刺：只考高频必考点，解析直接给「题眼 → 结论」和采分词。",
    }.get(d.scenario_type, "紧扣讲义本节的必考知识。")

    system_prompt = (
        "你是资深学科命题教师。请针对【指定的讲义小节】出题，题目必须能只靠该小节内容作答。\n"
        f"当前学习场景：{blueprint.preset_name}；命题取向：{mode_line}\n"
        "硬性要求：\n"
        "1. 只输出一个合法 JSON 对象，不要任何解释或代码围栏。\n"
        "2. 单选题必须 4 个选项，answer 只填 A/B/C/D；填空题题干空位用 `__________`，options 为 []；"
        "简答/计算题 options 为 []，answer 按【得分点1】…列出。\n"
        "3. 每道题的 explanation 必须包含【考点定位】【详解与推导】【易错点拨】三段。\n"
        "4. 配图按需：只有「文字说不清、看图才秒懂」的考点才配图（如曲线走向、结构式、机理流程、四图辨析），"
        "纯概念/纯计算/纯记忆题一律不配图，**不要为了凑数给不需要图的题硬配图**；确需配图时支持 "
        "`ECHARTS` / `MERMAID` / `SMILES` / `SVG`，可用 `BELOW_STEM`（题干主图）或 `OPTIONS_GRID`（一题四图选项），"
        "并必须给出可解析的 `original_graphic_modeling`，否则系统会直接丢弃该图。\n"
        "5. 公式一律 LaTeX：行内 $...$，独立 $$...$$；JSON 字符串里的反斜杠要双写。\n"
        "JSON 结构：\n"
        '{"title":"本节练习标题","questions":[{"id":"q_1","type":"mcq|fill_blank|short_answer",'
        '"difficulty":"easy|medium|hard","tier":"基础达标|能力提升|拓展探究","score":5,'
        '"is_original_question":true,"has_figure":false,"original_graphic_modeling":"",'
        '"figure_block":{"position":"BELOW_STEM|OPTIONS_GRID","visual_strategy":"ORIGINAL_SYNTHESIS","original_recipe":"ORIGINAL_DUAL_CURVE","render_engine":"ECHARTS","raw_payload":"","sub_figures":null,"figure_caption":""},'
        '"question":"题干","options":["A. ..."],"answer":"答案","explanation":"【考点定位】…",'
        '"source_chapter":"小节标题","source_page":"P?"}]}'
    )

    user_prompt = (
        f"## 讲义小节（第 {section['section_id']} 节，全篇共 {total_sections} 节）\n"
        f"### {section['title']}\n{section['excerpt']}\n\n"
        f"## 出题数量\n单选题 {mcq_n} 道、填空题 {fill_n} 道、简答/计算题 {short_n} 道。\n"
        f"## 溯源要求\n所有题目的 source_chapter 一律填「{section['title']}」。"
    )
    return system_prompt, user_prompt


def _parse_questions(
    raw: Any,
    section_title: str,
    *,
    doc_ir: Optional[DocumentIR] = None,
    scenario_type: str = "A_beginner",
    assets_dir: Optional[Path] = None,
) -> List[QuizQuestion]:
    if not isinstance(raw, list):
        return []
    source_mode_map = {
        "A_beginner": "TEXTBOOK_MODE_A",
        "B_consolidate": "TEXTBOOK_MODE_B",
        "C_sprint": "TEXTBOOK_MODE_C",
    }
    source_mode = source_mode_map.get(scenario_type, "TEXTBOOK_MODE_A")
    questions: List[QuizQuestion] = []
    for idx, item in enumerate(raw, start=1):
        if not isinstance(item, dict):
            continue
        q_type = str(item.get("type") or "mcq")
        if q_type not in ("mcq", "fill_blank", "short_answer"):
            q_type = "mcq"
        tier = str(item.get("tier") or "基础达标")
        if tier not in ("基础达标", "能力提升", "拓展探究"):
            tier = "基础达标"
        diff = str(item.get("difficulty") or "medium")
        if diff not in ("easy", "medium", "hard"):
            diff = "medium"

        stem_txt = normalize_markdown_math(str(item.get("question") or ""))
        modeling_txt = normalize_markdown_math(str(item.get("original_graphic_modeling") or ""))
        raw_fb = item.get("figure_block") if isinstance(item.get("figure_block"), dict) else {}
        has_fig_req = bool(item.get("has_figure")) or bool(
            raw_fb.get("raw_payload") or raw_fb.get("figure_payload") or raw_fb.get("sub_figures")
        )
        compiled_fig: Optional[QuestionFigureBlock] = None
        if has_fig_req:
            ok_fig, compiled_fig, stem_txt = compile_figure_block_with_fallbacks(
                stem=stem_txt,
                position=str(raw_fb.get("position") or raw_fb.get("figure_position") or "BELOW_STEM"),
                visual_strategy=str(raw_fb.get("visual_strategy") or "ORIGINAL_SYNTHESIS"),
                original_recipe=raw_fb.get("original_recipe"),
                render_engine=str(raw_fb.get("render_engine") or "ECHARTS"),
                raw_payload=str(raw_fb.get("raw_payload") or raw_fb.get("figure_payload") or ""),
                sub_figures=raw_fb.get("sub_figures") or raw_fb.get("sub_figures_compiled"),
                figure_caption=str(raw_fb.get("figure_caption") or ""),
                original_graphic_modeling=modeling_txt,
                original_image_id=raw_fb.get("original_image_id") or item.get("original_image_id"),
                assets_dir=assets_dir,
                doc_ir=doc_ir,
            )
            has_fig_req = ok_fig and compiled_fig is not None

        questions.append(
            QuizQuestion(
                id=str(item.get("id") or f"sp_{idx}"),
                type=q_type,  # type: ignore[arg-type]
                difficulty=diff,  # type: ignore[arg-type]
                tier=tier,  # type: ignore[arg-type]
                score=max(1, int(item.get("score") or 5)),
                question=stem_txt,
                options=[normalize_markdown_math(str(o)) for o in (item.get("options") or [])],
                answer=normalize_markdown_math(str(item.get("answer") or "")),
                explanation=normalize_markdown_math(str(item.get("explanation") or "")),
                source_chapter=str(item.get("source_chapter") or section_title),
                source_page=str(item.get("source_page") or ""),
                is_original_question=bool(item.get("is_original_question", True)),
                source_mode=source_mode,  # type: ignore[arg-type]
                has_figure=has_fig_req,
                figure_block=compiled_fig,
                original_graphic_modeling=modeling_txt,
                print_space_height_px=96 if q_type in ("fill_blank", "short_answer") else 0,
            )
        )
    return questions


async def generate_section_practice(
    section: Dict[str, Any],
    blueprint: StudyBlueprint,
    document_ir: DocumentIR,
    total_sections: int,
    router: ModelRouter,
    per_type: Tuple[int, int, int] = (2, 1, 1),
) -> QuizPaper:
    system_prompt, user_prompt = _build_section_prompt(
        section, blueprint, document_ir, total_sections, per_type
    )
    data, label = await router.execute_json("quiz_generation", system_prompt, user_prompt)
    if not isinstance(data, dict):
        raise RuntimeError(f"分节练习生成失败：{label} 未返回合法 JSON")
    questions = _parse_questions(
        data.get("questions"),
        str(section["title"]),
        doc_ir=document_ir,
        scenario_type=blueprint.deliverables.scenario_type,
    )
    if not questions:
        raise RuntimeError("分节练习解析后没有有效题目，请重试")

    return QuizPaper(
        paper_id=f"section:{section['section_id']}",
        deliverable_type="section_practice",
        title=str(data.get("title") or f"{section['title']} · 分节练习"),
        mode="sync_layered",
        total_score=sum(q.score for q in questions),
        suggested_minutes=max(10, len(questions) * 4),
        instructions=(
            f"本练习只覆盖讲义「{section['title']}」一节，共 {len(questions)} 题。"
            "先独立作答，再展开答案与解析。"
        ),
        questions=questions,
    )


SECTIONS_WITH_PRACTICE_CACHE_VERSION = 1
