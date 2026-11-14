from __future__ import annotations

import uuid
from typing import List, Optional

from app.router.routing_engine import ModelRouter
from app.schemas import DeliverableConfig, DocumentIR, StudyBlueprint
from app.workflows.presets import (
    SCENARIO_ITEMS_MAP,
    build_default_blueprint_from_ir,
    get_preset,
    sync_deliverable_flags_with_items,
)


def _build_document_digest(document_ir: DocumentIR) -> str:
    lines = [
        f"文档名称: {document_ir.filename} (类型: {document_ir.file_type}, 总页/张数: {document_ir.total_pages_or_slides}, 总字数: {document_ir.total_chars})",
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
        preset_id or (current_blueprint.scenario_type if current_blueprint else "A_beginner")
    )
    base_bp = current_blueprint or build_default_blueprint_from_ir(document_ir, preset, user_prompt)
    selected_items = base_bp.deliverables.selected_items or preset.default_deliverables.selected_items

    digest = _build_document_digest(document_ir)
    current_bp_json = base_bp.model_dump_json(indent=2)
    items_desc = ", ".join(
        f"{opt.item_id}({opt.label})"
        for opt in SCENARIO_ITEMS_MAP.get(preset.scenario_type, [])
    )

    system_prompt = (
        "你是一位资深教学设计与学习科学专家。现在处于【学习资料方案定制与参数协商阶段】。\n"
        "请阅读用户上传教材/课件的章节结构，结合用户选定的使用场景（A 入门零基础 / B 巩固提高 / C 考前冲刺）及已勾选资料项，"
        "生成或优化一份《学习资料定制方案 (StudyBlueprint)》。\n"
        "你必须严格输出合法 JSON，不要包含任何 Markdown 代码围栏以外的废话。JSON 字段必须包括：\n"
        "{\n"
        '  "blueprint_title": "方案标题",\n'
        '  "parsed_intent_summary": "一句话总结你对用户场景、核心重点与资料结构的解析",\n'
        '  "ai_feedback_message": "给用户的方案反馈与确认说明（Markdown格式）",\n'
        '  "target_difficulty": "beginner" | "intermediate" | "advanced" | "exam_sprint",\n'
        '  "selected_chapter_ids": ["ch_1", ...],\n'
        '  "deliverables": {\n'
        f'    "scenario_type": "{preset.scenario_type}",\n'
        f'    "selected_items": {selected_items},\n'
        '    "notes_style": "guided_learning" | "concise_outline" | "deep_dive" | "in_class_recap",\n'
        '    "cheatsheet_density": "compact" | "comprehensive",\n'
        '    "quiz_mode": "in_class" | "sync_layered" | "exam_paper" | "custom",\n'
        '    "mcq_count": 6,\n'
        '    "fill_blank_count": 3,\n'
        '    "short_answer_count": 2,\n'
        '    "total_score": 100,\n'
        '    "suggested_minutes": 35,\n'
        '    "mindmap_depth": 3\n'
        "  },\n"
        '  "focus_topics": ["重点概念1", "重点概念2"],\n'
        '  "custom_instructions": "给后续出题与讲义生成的具体教学与命题指令"\n'
        "}"
    )

    user_msg = (
        f"## 选定学习场景\n"
        f"- 场景: {preset.name} ({preset.badge})\n"
        f"- 场景可选资料: {items_desc}\n"
        f"- 用户当前已勾选资料 ID: {selected_items}\n"
        f"- 当前方案状态:\n{current_bp_json}\n\n"
        f"## 文档目录摘要\n{digest}\n\n"
        f"## 用户本轮补充需求\n{user_prompt.strip() or preset.sample_prompt}\n"
    )

    data, _ = await router.execute_json("requirement_negotiation", system_prompt, user_msg)
    if not isinstance(data, dict):
        raise RuntimeError("AI 未返回有效的 JSON 定制方案，请检查引擎配置后重试。")

    valid_ids = {c.chapter_id for c in document_ir.chapters}
    raw_sel = data.get("selected_chapter_ids") or base_bp.selected_chapter_ids
    sel_ids: List[str] = [cid for cid in raw_sel if cid in valid_ids]
    if not sel_ids:
        sel_ids = [c.chapter_id for c in document_ir.chapters]

    raw_deliv = dict(data.get("deliverables") or base_bp.deliverables.model_dump())
    raw_deliv["scenario_type"] = preset.scenario_type
    if base_bp.deliverables.selected_items:
        # Preserve user's explicit deliverable checkboxes unless negotiate specifically updates them reasonably
        valid_item_ids = {o.item_id for o in SCENARIO_ITEMS_MAP.get(preset.scenario_type, [])}
        returned_items = [x for x in (raw_deliv.get("selected_items") or []) if x in valid_item_ids]
        raw_deliv["selected_items"] = returned_items or list(base_bp.deliverables.selected_items)

    try:
        deliverables = sync_deliverable_flags_with_items(DeliverableConfig.model_validate(raw_deliv))
    except Exception:
        deliverables = sync_deliverable_flags_with_items(base_bp.deliverables)

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
        blueprint_title=str(data.get("blueprint_title") or f"{document_ir.filename} · {preset.name}"),
        scenario_type=preset.scenario_type,
        preset_id=preset.preset_id,
        preset_name=preset.name,
        parsed_intent_summary=str(
            data.get("parsed_intent_summary")
            or f"已按【{preset.name}】场景规划 {len(sel_ids)} 个章节的定制方案。"
        ),
        ai_feedback_message=str(
            data.get("ai_feedback_message")
            or "方案与参数已更新，请在下方核对后点击「确认方案并开始流式生成」。"
        ),
        target_difficulty=diff,  # type: ignore
        selected_chapter_ids=sel_ids,
        deliverables=deliverables,
        focus_topics=focus_topics,
        custom_instructions=str(data.get("custom_instructions") or user_prompt.strip()),
        confirmed=False,
    )


async def ai_fill_study_blueprint(
    document_ir: DocumentIR,
    preset_id: Optional[str],
    user_prompt: str,
    current_blueprint: Optional[StudyBlueprint],
    router: ModelRouter,
) -> StudyBlueprint:
    """AI smart-fill of optimal quiz counts, timing, score, style, focus topics & instructions."""
    preset = get_preset(
        preset_id or (current_blueprint.scenario_type if current_blueprint else "A_beginner")
    )
    base_bp = current_blueprint or build_default_blueprint_from_ir(document_ir, preset, user_prompt)
    selected_ch_ids = [
        cid for cid in (base_bp.selected_chapter_ids or [])
        if any(c.chapter_id == cid for c in document_ir.chapters)
    ] or [c.chapter_id for c in document_ir.chapters]
    selected_chapters = [c for c in document_ir.chapters if c.chapter_id in selected_ch_ids]
    selected_items = base_bp.deliverables.selected_items or preset.default_deliverables.selected_items

    total_chars = sum(c.char_count for c in selected_chapters)
    chap_summary = "\n".join(
        f"- {c.title} (P{c.start_page}-{c.end_page}, {c.char_count}字, 关键词: {', '.join(c.key_terms[:5])})"
        for c in selected_chapters
    )

    system_prompt = (
        "你是资深课程顾问与命题设计师。请根据用户选择的【使用场景】、勾选的【资料项】以及选中章节的篇幅与知识点密度，"
        "智能填写最合理的出题与学习参数。\n"
        "请只输出合法 JSON，格式如下：\n"
        "{\n"
        '  "target_difficulty": "beginner" | "intermediate" | "advanced" | "exam_sprint",\n'
        '  "notes_style": "guided_learning" | "concise_outline" | "deep_dive" | "in_class_recap",\n'
        '  "cheatsheet_density": "compact" | "comprehensive",\n'
        '  "mcq_count": 6,\n'
        '  "fill_blank_count": 3,\n'
        '  "short_answer_count": 2,\n'
        '  "total_score": 100,\n'
        '  "suggested_minutes": 40,\n'
        '  "mindmap_depth": 3,\n'
        '  "focus_topics": ["重点1", "重点2", "重点3"],\n'
        '  "custom_instructions": "一段针对本课程章节的精确出题与讲义指导语（100字以内）",\n'
        '  "reason": "一句话说明为什么推荐这组参数"\n'
        "}"
    )
    user_msg = (
        f"文档：{document_ir.filename}（选中 {len(selected_chapters)} 章，共 {total_chars} 字）\n"
        f"选定场景：{preset.name} (scenario_type={preset.scenario_type})\n"
        f"已勾选资料项：{selected_items}\n"
        f"章节详情：\n{chap_summary}\n"
        f"用户备注：{user_prompt.strip() or base_bp.custom_instructions or '无'}"
    )

    data, label = await router.execute_json("requirement_negotiation", system_prompt, user_msg)
    if not isinstance(data, dict):
        raise RuntimeError("AI 智能填参未返回合法 JSON，请重试。")

    def _clamp_int(val: object, lo: int, hi: int, default: int) -> int:
        try:
            return max(lo, min(hi, int(val)))  # type: ignore[arg-type]
        except Exception:
            return default

    mcq = _clamp_int(data.get("mcq_count"), 2, 20, base_bp.deliverables.mcq_count)
    fill = _clamp_int(data.get("fill_blank_count"), 1, 12, base_bp.deliverables.fill_blank_count)
    short = _clamp_int(data.get("short_answer_count"), 1, 8, base_bp.deliverables.short_answer_count)
    total_score = _clamp_int(data.get("total_score"), 30, 150, 100)
    minutes = _clamp_int(data.get("suggested_minutes"), 10, 120, 40)
    depth = _clamp_int(data.get("mindmap_depth"), 2, 5, base_bp.deliverables.mindmap_depth)

    diff = data.get("target_difficulty", preset.target_difficulty)
    if diff not in ("beginner", "intermediate", "advanced", "exam_sprint"):
        diff = preset.target_difficulty
    n_style = data.get("notes_style", base_bp.deliverables.notes_style)
    if n_style not in ("guided_learning", "concise_outline", "deep_dive", "in_class_recap"):
        n_style = base_bp.deliverables.notes_style
    cs_density = data.get("cheatsheet_density", base_bp.deliverables.cheatsheet_density)
    if cs_density not in ("compact", "comprehensive"):
        cs_density = base_bp.deliverables.cheatsheet_density

    updated_deliverables = sync_deliverable_flags_with_items(
        base_bp.deliverables.model_copy(
            update={
                "scenario_type": preset.scenario_type,
                "selected_items": selected_items,
                "notes_style": n_style,
                "cheatsheet_density": cs_density,
                "mcq_count": mcq,
                "fill_blank_count": fill,
                "short_answer_count": short,
                "total_score": total_score,
                "suggested_minutes": minutes,
                "mindmap_depth": depth,
            }
        )
    )
    topics = [str(x).strip() for x in (data.get("focus_topics") or []) if str(x).strip()][:10]
    reason = str(data.get("reason") or f"已由 {label} 结合 {len(selected_chapters)} 章约 {total_chars:,} 字内容智能规划最优参数")

    return base_bp.model_copy(
        update={
            "scenario_type": preset.scenario_type,
            "preset_id": preset.preset_id,
            "preset_name": preset.name,
            "target_difficulty": diff,
            "selected_chapter_ids": selected_ch_ids,
            "deliverables": updated_deliverables,
            "focus_topics": topics or base_bp.focus_topics,
            "custom_instructions": str(data.get("custom_instructions") or base_bp.custom_instructions),
            "parsed_intent_summary": f"AI 智能填参（{label}）：{mcq} 单选 + {fill} 填空 + {short} 简答（满分 {total_score} 分 / 建议 {minutes} 分钟）。",
            "ai_feedback_message": reason,
            "confirmed": False,
        }
    )
