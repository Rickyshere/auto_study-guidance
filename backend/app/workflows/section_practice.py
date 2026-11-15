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
from app.schemas import ChapterNode, DocumentIR, QuizPaper, QuizQuestion, StudyBlueprint
from app.workflows.generator import normalize_markdown_math

_HEADING_RE = re.compile(r"^(#{1,3})\s+(.+?)\s*$")
_SECTION_ID_RE = re.compile(r"[^a-z0-9]+")
MAX_SECTIONS = 24
EXCERPT_LIMIT = 2600


def _slugify(title: str, index: int) -> str:
    ascii_part = _SECTION_ID_RE.sub("-", title.lower()).strip("-")
    return f"sec_{index + 1:02d}" + (f"_{ascii_part[:24]}" if ascii_part else "")


def extract_note_sections(markdown: str) -> List[Dict[str, Any]]:
    """把讲义 Markdown 切成「节」：优先 H1，其次 H2；忽略"参考答案"等尾部结构。"""
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

    min_level = min(h[0] for h in headings)
    top = [h for h in headings if h[0] == min_level]
    if len(top) < 2:
        # 只有一两个 H1 时退化到 H2，让分节更有意义
        top = [h for h in headings if h[0] <= min_level + 1]

    skip_words = (
        "参考答案",
        "答案与解析",
        "目录",
        "附录",
        "单元检测",
        "检测卷",
        "期中",
        "期末",
        "试卷",
        "作业",
    )
    _SECTION_MARK_RE = re.compile(r"第\s*[0-9一二三四五六七八九十百]+\s*[节讲课篇]")
    sections: List[Dict[str, Any]] = []
    for order, (level, line_no, title) in enumerate(top):
        if any(w in title for w in skip_words):
            continue
        end_line = top[order + 1][1] if order + 1 < len(top) else len(lines)
        body = "\n".join(lines[line_no + 1 : end_line]).strip()
        body = re.sub(r"@@ASG_PAGE_BREAK@@", "", body).strip()
        if len(body) < 60:
            continue
        sections.append(
            {
                "section_id": _slugify(title, len(sections)),
                "title": title,
                "level": level,
                "excerpt": body[:EXCERPT_LIMIT],
                "char_count": len(body),
            }
        )
        if len(sections) >= MAX_SECTIONS:
            break

    # 第一个标题通常是讲义自己的大标题（如「第02章 … 详细自学案」），不是可练的小节
    if len(sections) >= 2:
        first = sections[0]
        rest = sections[1:]
        rest_are_sections = sum(1 for s in rest if _SECTION_MARK_RE.search(s["title"])) >= max(
            1, len(rest) // 2
        )
        if rest_are_sections and not _SECTION_MARK_RE.search(first["title"]):
            sections = rest
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
        "4. 公式一律 LaTeX：行内 $...$，独立 $$...$$；JSON 字符串里的反斜杠要双写。\n"
        "JSON 结构：\n"
        '{"title":"本节练习标题","questions":[{"id":"q_1","type":"mcq|fill_blank|short_answer",'
        '"difficulty":"easy|medium|hard","tier":"基础达标|能力提升|拓展探究","score":5,'
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


def _parse_questions(raw: Any, section_title: str) -> List[QuizQuestion]:
    if not isinstance(raw, list):
        return []
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
        questions.append(
            QuizQuestion(
                id=str(item.get("id") or f"sp_{idx}"),
                type=q_type,  # type: ignore[arg-type]
                difficulty=diff,  # type: ignore[arg-type]
                tier=tier,  # type: ignore[arg-type]
                score=max(1, int(item.get("score") or 5)),
                question=normalize_markdown_math(str(item.get("question") or "")),
                options=[normalize_markdown_math(str(o)) for o in (item.get("options") or [])],
                answer=normalize_markdown_math(str(item.get("answer") or "")),
                explanation=normalize_markdown_math(str(item.get("explanation") or "")),
                source_chapter=str(item.get("source_chapter") or section_title),
                source_page=str(item.get("source_page") or ""),
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
    questions = _parse_questions(data.get("questions"), str(section["title"]))
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
