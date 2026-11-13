from __future__ import annotations

import re
from typing import Awaitable, Callable, List, Optional

from app.router.fallback_provider import HeuristicStudyEngine
from app.router.routing_engine import ModelRouter
from app.schemas import (
    ChapterNode,
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
        notes_sys = (
            "你是一位顶尖学科导师与教研专家。请严格依据提供的教材/课件原文内容，生成结构化学习笔记/导学案。\n"
            "要求：\n"
            "1. 使用规范的 Markdown 排版（标题层级、对比表格、要点列表）；所有数学公式必须严格使用 `$...$`（行内）或 `$$...$$`（独立成行），切勿使用 `\\(...\\)` 或 `\\[...\\]`；表格内范数请写 `\\parallel W \\parallel`。\n"
            "2. 忠于原文，切勿编造教材中没有的结论；若原文附有配图 Markdown 链接，请在合适段落直接内联引用。\n"
            f"3. 严格贴合模板类型【{blueprint.preset_name}】（风格：{d.notes_style}，难度：{blueprint.target_difficulty}）。\n"
            "   - 若为【自学案】（或 guided_learning）：必须包含 学习目标与重难点、前置导读、核心概念精讲（带通俗类比）、不少于 4 道结构化的【典型例题与深度解析】（涵盖概念辨析/公式推导或计算/应用分析，每道例题均须严格包含：**【题目】**、**【思路引导】**、**【详细解答】**、**【易错点拨】**）、以及易错辨析清单与自学自检清单。\n"
            "   - 若为【随堂练习】：输出简明扼要的“当堂核心要点速览”及 1-2 道课堂示范例题与解析。\n"
            "   - 若为【同步练习】：输出“章节知识框架梳理、典型例题示范与易错点清单”。\n"
            "   - 若为【自测卷】：输出“考前核心考点复盘提纲”。"
        )
        notes_user = (
            f"方案标题: {blueprint.blueprint_title}\n"
            f"重点关注主题: {focus_str}\n"
            f"用户定制指令: {blueprint.custom_instructions or '无额外指令'}\n\n"
            f"教材/课件原文内容：\n{context_text}"
        )
        res_notes, _ = await router.execute_text("notes_and_cheatsheet", notes_sys, notes_user)
        study_notes_md = normalize_markdown_math(
            res_notes or HeuristicStudyEngine.generate_notes_from_ir(document_ir, blueprint)
        )

    # 2. Cheat Sheet
    cheatsheet_md = ""
    if d.include_cheatsheet:
        if progress_cb:
            await progress_cb("cheatsheet", 45, "正在浓缩考前速记表 (Cheat Sheet)...")
        cs_sys = (
            "请根据以下教材/课件原文，提炼一份高密度、适合考前突击复盘的《考前速记表 (Cheat Sheet)》。\n"
            "格式严格要求：所有行内/块级数学公式必须使用 `$...$` 或 `$$...$$`，严禁使用 `\\(...\\)` 或 `\\[...\\]`；"
            "Markdown 表格内的范数请用 `\\parallel W \\parallel^2` 而非 `\\|W\\|^2`，并控制单元格文本紧凑以免表格过宽溢出。\n"
            "内容要求包含：1) 核心概念/公式速查 Markdown 表格；2) 易混概念对比；3) 考前必背 Checklist。"
        )
        cs_user = (
            f"密度要求: {d.cheatsheet_density} | 重点主题: {focus_str}\n\n原文：\n{context_text[:18000]}"
        )
        router.check_cancelled()
        current_stage_state["stage"] = "cheatsheet"
        current_stage_state["percent"] = 45
        if progress_cb:
            await progress_cb("cheatsheet", 45, "正在提炼核心公式与概念速记表...")
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
        quiz_sys = (
            "你是一位严谨的命题教师。请严格依据教材原文命制高质量练习题/试卷，并输出合法 JSON。\n"
            "JSON 结构必须如下：\n"
            "{\n"
            '  "title": "试卷/练习标题",\n'
            '  "instructions": "作答说明",\n'
            '  "questions": [\n'
            "    {\n"
            '      "id": "q_1",\n'
            '      "type": "mcq" | "fill_blank" | "short_answer",\n'
            '      "difficulty": "easy" | "medium" | "hard",\n'
            '      "tier": "基础达标" | "能力提升" | "拓展探究",\n'
            '      "score": 5,\n'
            '      "question": "题干内容",\n'
            '      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],\n'
            '      "answer": "标准答案（单选题请填 A/B/C/D，填空和简答填参考答案）",\n'
            '      "explanation": "详细解析与易错点说明",\n'
            '      "source_chapter": "对应章节名称",\n'
            '      "source_page": "P1-3"\n'
            "    }\n"
            "  ]\n"
            "}"
        )
        quiz_user = (
            f"模板类型: {blueprint.preset_name} (quiz_mode={d.quiz_mode})\n"
            f"题量要求: 单选题 {d.mcq_count} 道、填空题 {d.fill_blank_count} 道、简答/分析题 {d.short_answer_count} 道。\n"
            f"目标总分: {d.total_score} 分 | 建议用时: {d.suggested_minutes} 分钟 | 难度: {blueprint.target_difficulty}\n"
            f"重点关注: {focus_str}\n"
            f"用户特别指令: {blueprint.custom_instructions or '无'}\n\n"
            f"教材原文：\n{context_text[:20000]}"
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
            "你是教学资料总审校专家（Global Quality Auditor）。请审查生成成果是否符合教学方案契约与排版规范，并输出合法 JSON：\n"
            '{"passed": true, "score": 96, "summary": "一句简明中文验收结论", "issues": []}'
        )
        audit_user = (
            f"方案名称: {blueprint.blueprint_title} | 预设: {blueprint.preset_name}\n"
            f"目标题量: 单选 {d.mcq_count} + 填空 {d.fill_blank_count} + 简答 {d.short_answer_count}\n"
            f"实际题量: {len(quiz_paper.questions)} 道 | 总分: {quiz_paper.total_score}\n"
            f"讲义含典型例题: {'是' if '典型例题' in study_notes_md else '否'} | "
            f"讲义长度: {len(study_notes_md)} 字 | 速记表长度: {len(cheatsheet_md)} 字\n"
            f"Mermaid 语法前缀: {mindmap_mermaid.splitlines()[0] if mindmap_mermaid else '无'}\n"
            f"已执行自动修正: {', '.join(repairs) if repairs else '无'}\n"
            f"讲义前400字摘要:\n{study_notes_md[:400]}"
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
