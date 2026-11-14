from __future__ import annotations

import uuid
from typing import List, Optional

from app.router.fallback_provider import HeuristicStudyEngine
from app.router.routing_engine import ModelRouter
from app.schemas import DeliverableConfig, DocumentIR, StudyBlueprint
from app.workflows.presets import get_preset


def _build_document_digest(document_ir: DocumentIR) -> str:
    lines = [
        f"文档名称: {document_ir.filename} (类型: {document_ir.file_type}, 总页/张数: {document_ir.total_pages_or_slides})",
        "章节目录结构:",
    ]
    for ch in document_ir.chapters:
        terms = ", ".join(ch.key_terms[:6]) if ch.key_terms else "无"
        lines.append(
            f"- [{ch.chapter_id}] {ch.title} (P{ch.start_page}-{ch.end_page}, {ch.char_count}字) | 关键词: {terms} | 摘要: {ch.summary_preview[:100]}"
        )
    return "\n".join(lines)


async def negotiate_study_blueprint(
    document_ir: DocumentIR,
    preset_id: Optional[str],
    user_prompt: str,
    current_blueprint: Optional[StudyBlueprint],
    router: ModelRouter,
) -> StudyBlueprint:
    preset = get_preset(
        preset_id or (current_blueprint.preset_id if current_blueprint else "self_study_guide")
    )

    digest = _build_document_digest(document_ir)
    current_bp_json = (
        current_blueprint.model_dump_json(indent=2) if current_blueprint else "无（首次方案制定）"
    )

    system_prompt = (
        "你是一位资深教学设计与学习科学专家。现在处于【阶段一：需求解析与方案协商】。\n"
        "请阅读用户上传教材/课件的章节结构，结合用户选定的教学预设模板和自然语言需求，"
        "生成一份清晰、可交互确认的《学习资料定制方案 (StudyBlueprint)》。\n"
        "你必须严格输出合法 JSON，不要包含额外无关文本。JSON 字段必须包括：\n"
        "{\n"
        '  "blueprint_title": "方案标题",\n'
        '  "parsed_intent_summary": "一句话总结你对用户需求与文档重点的解析",\n'
        '  "ai_feedback_message": "给用户的详细方案反馈与确认提示（Markdown格式，列出覆盖范围、难度定位、产出清单，并询问是否需要继续调整）",\n'
        '  "target_difficulty": "beginner" | "intermediate" | "advanced" | "exam_sprint",\n'
        '  "selected_chapter_ids": ["ch_1", ...],\n'
        '  "deliverables": {\n'
        '    "include_study_guide_notes": true,\n'
        '    "notes_style": "guided_learning" | "concise_outline" | "deep_dive" | "in_class_recap",\n'
        '    "include_cheatsheet": true,\n'
        '    "cheatsheet_density": "compact" | "comprehensive",\n'
        '    "include_quiz": true,\n'
        '    "quiz_mode": "in_class" | "sync_layered" | "exam_paper" | "custom",\n'
        '    "mcq_count": 6,\n'
        '    "fill_blank_count": 3,\n'
        '    "short_answer_count": 2,\n'
        '    "total_score": 100,\n'
        '    "suggested_minutes": 30,\n'
        '    "include_mindmap": true,\n'
        '    "mindmap_depth": 3\n'
        "  },\n"
        '  "focus_topics": ["重点概念1", "重点概念2"],\n'
        '  "custom_instructions": "给后续【阶段二】出题与讲义生成的具体教学指令：明确学科侧重点（如概念辨析/公式推导/定量计算/案例分析/边界条件）、高频易错点与干扰项设计方向"\n'
        "}\n"
        "请确保 `custom_instructions` 结合上传文档的学科特点给出可落地的出题导向，而非空泛复述。"
    )

    user_msg = (
        f"## 选定预设模板\n"
        f"- preset_id: {preset.preset_id}\n"
        f"- 名称: {preset.name} ({preset.badge})\n"
        f"- 教学定位: {preset.description}\n"
        f"- 默认配置: {preset.default_deliverables.model_dump_json()}\n\n"
        f"## 文档目录摘要\n{digest}\n\n"
        f"## 当前已有方案（若用户正在进行多轮修改）\n{current_bp_json}\n\n"
        f"## 用户本轮自然语言需求\n{user_prompt.strip() or preset.sample_prompt}\n"
    )

    data, _ = await router.execute_json("requirement_negotiation", system_prompt, user_msg)
    if not isinstance(data, dict):
        return HeuristicStudyEngine.build_blueprint_from_ir(
            document_ir, preset, user_prompt, current_blueprint
        )

    valid_ids = {c.chapter_id for c in document_ir.chapters}
    raw_sel = data.get("selected_chapter_ids") or []
    sel_ids: List[str] = [cid for cid in raw_sel if cid in valid_ids]
    if not sel_ids:
        sel_ids = [c.chapter_id for c in document_ir.chapters]

    try:
        deliverables = DeliverableConfig.model_validate(
            data.get("deliverables") or preset.default_deliverables.model_dump()
        )
    except Exception:
        deliverables = preset.default_deliverables.model_copy()

    diff = data.get("target_difficulty", preset.target_difficulty)
    if diff not in ("beginner", "intermediate", "advanced", "exam_sprint"):
        diff = preset.target_difficulty

    focus_topics = [str(x).strip() for x in (data.get("focus_topics") or []) if str(x).strip()][:12]
    if not focus_topics:
        for ch in document_ir.chapters:
            if ch.chapter_id in sel_ids:
                focus_topics.extend(ch.key_terms[:3])
        focus_topics = list(dict.fromkeys(focus_topics))[:10]

    return StudyBlueprint(
        blueprint_id=current_blueprint.blueprint_id if current_blueprint else f"bp_{uuid.uuid4().hex[:8]}",
        blueprint_title=str(data.get("blueprint_title") or f"{document_ir.filename} - {preset.name}"),
        preset_id=preset.preset_id,
        preset_name=preset.name,
        parsed_intent_summary=str(
            data.get("parsed_intent_summary")
            or f"已按【{preset.name}】模式分析 {len(sel_ids)} 个章节的学习需求。"
        ),
        ai_feedback_message=str(
            data.get("ai_feedback_message")
            or "已为您生成定制方案，请在下方检查并微调章节与题量配置后点击“确认方案并生成”。"
        ),
        target_difficulty=diff,  # type: ignore
        selected_chapter_ids=sel_ids,
        deliverables=deliverables,
        focus_topics=focus_topics,
        custom_instructions=str(data.get("custom_instructions") or user_prompt.strip()),
        confirmed=False,
    )
