from __future__ import annotations

import uuid
from typing import Dict, List
from app.schemas import DeliverableConfig, DeliverableItemOption, DocumentIR, PresetTemplate, StudyBlueprint

SCENARIO_ITEMS_MAP: Dict[str, List[DeliverableItemOption]] = {
    "A_beginner": [
        DeliverableItemOption(
            item_id="detailed_study_guide",
            label="详细自学案（附带例题）",
            description="零基础导学：前置概念类比、公式定理精讲、4道分级典型例题与详尽思路拆解",
            export_formats=["PDF 可打印", "Markdown"],
        ),
        DeliverableItemOption(
            item_id="sync_homework",
            label="同步练习（作业）",
            description="按知识点循序渐进的课后巩固训练，覆盖基础概念辨析与典型计算练习",
            export_formats=["在线卡片答题", "A4/A3 PDF 可打印", "Markdown"],
        ),
        DeliverableItemOption(
            item_id="unit_test_paper",
            label="单元检测卷",
            description="检验本单元学习掌握度的标准化阶段测评卷（含完整评分细则与答案解析）",
            export_formats=["在线卡片答题", "A4/A3 PDF 可打印", "Markdown"],
        ),
        DeliverableItemOption(
            item_id="cheatsheet",
            label="考前速记（知识点和公式）",
            description="系统梳理的核心定义、重要公式及其适用前提双栏速查表",
            export_formats=["PDF 可打印", "Markdown"],
        ),
        DeliverableItemOption(
            item_id="mindmap",
            label="MindMap 知识图谱",
            description="直观呈现概念依赖与章节知识骨架的可视化思维导图",
            export_formats=["SVG / PNG 导出", "Mermaid 源码"],
        ),
    ],
    "B_consolidate": [
        DeliverableItemOption(
            item_id="chapter_consolidation_paper",
            label="分章节巩固卷",
            description="逐章精准扫雷、易混概念对比与中档能力提升训练",
            export_formats=["在线卡片答题", "A4/A3 PDF 可打印", "Markdown"],
        ),
        DeliverableItemOption(
            item_id="comprehensive_test_paper",
            label="综合检测卷",
            description="跨章节知识点串联、综合推理与压轴难度模拟检测卷",
            export_formats=["在线卡片答题", "A4/A3 PDF 可打印", "Markdown"],
        ),
        DeliverableItemOption(
            item_id="cheatsheet",
            label="核心知识点速记",
            description="高频混淆点对照表、典型推导套路与易错条件提醒",
            export_formats=["PDF 可打印", "Markdown"],
        ),
        DeliverableItemOption(
            item_id="mindmap",
            label="MindMap 知识图谱",
            description="跨章节串联的重点脉络与因果关系导图",
            export_formats=["SVG / PNG 导出", "Mermaid 源码"],
        ),
    ],
    "C_sprint": [
        DeliverableItemOption(
            item_id="key_knowledge_extraction",
            label="重要知识提取",
            description="高密度浓缩核心高频考点、必背结论定理、高频母题套路与考场得分清单",
            export_formats=["PDF 可打印", "Markdown"],
        ),
        DeliverableItemOption(
            item_id="cheatsheet",
            label="考前速记",
            description="考前最后一遍过眼的公式卡、边界条件与常见失分陷阱汇总",
            export_formats=["PDF 可打印", "Markdown"],
        ),
        DeliverableItemOption(
            item_id="cram_exam_paper",
            label="佛教卷（考前冲刺突击卷）",
            description="专为考前抱佛脚命制：押题命中高频大题与核心客观题，快速抢分闭环",
            export_formats=["在线卡片答题", "A4/A3 PDF 可打印", "Markdown"],
        ),
    ],
}


PRESET_TEMPLATES: List[PresetTemplate] = [
    PresetTemplate(
        preset_id="A_beginner",
        scenario_type="A_beginner",
        name="A · 入门 / 零基础学习",
        badge="导学打底 · 讲练同步 · 单元过关",
        description="面向首次接触或零基础预习/自学：系统构建前置直觉、配齐例题精讲、同步作业与单元检测，打牢基础。",
        icon="book-open",
        target_difficulty="beginner",
        default_deliverables=DeliverableConfig(
            scenario_type="A_beginner",
            selected_items=[
                "detailed_study_guide",
                "sync_homework",
                "unit_test_paper",
                "cheatsheet",
                "mindmap",
            ],
            include_study_guide_notes=True,
            notes_style="guided_learning",
            include_cheatsheet=True,
            cheatsheet_density="comprehensive",
            include_quiz=True,
            quiz_mode="sync_layered",
            mcq_count=6,
            fill_blank_count=3,
            short_answer_count=2,
            total_score=100,
            suggested_minutes=35,
            include_mindmap=True,
            mindmap_depth=3,
        ),
        sample_prompt="我是零基础入门学习这批资料，希望详细自学案通俗讲透底层原理并带典型例题，同步练习循序渐进，单元检测卷重点检验基本功。",
        pedagogical_focus=["零基础通俗导学", "典型例题分步拆解", "同步作业+单元检测闭环"],
        available_items=SCENARIO_ITEMS_MAP["A_beginner"],
    ),
    PresetTemplate(
        preset_id="B_consolidate",
        scenario_type="B_consolidate",
        name="B · 巩固提高",
        badge="分章拔高 · 综合串联 · 思维构建",
        description="面向已经学过基础内容、需要查漏补缺与拔高训练的阶段：按章节逐个击破盲区，再进行跨章节综合卷演练。",
        icon="layers",
        target_difficulty="intermediate",
        default_deliverables=DeliverableConfig(
            scenario_type="B_consolidate",
            selected_items=[
                "chapter_consolidation_paper",
                "comprehensive_test_paper",
                "cheatsheet",
                "mindmap",
            ],
            include_study_guide_notes=False,
            notes_style="concise_outline",
            include_cheatsheet=True,
            cheatsheet_density="compact",
            include_quiz=True,
            quiz_mode="sync_layered",
            mcq_count=8,
            fill_blank_count=4,
            short_answer_count=3,
            total_score=100,
            suggested_minutes=50,
            include_mindmap=True,
            mindmap_depth=3,
        ),
        sample_prompt="我已掌握基本概念，希望分章节巩固卷专攻易错细节与推导变形，综合检测卷加强跨章节串联和中等偏上区分度。",
        pedagogical_focus=["分章精准排雷", "跨章综合串联", "易混概念深度辨析"],
        available_items=SCENARIO_ITEMS_MAP["B_consolidate"],
    ),
    PresetTemplate(
        preset_id="C_sprint",
        scenario_type="C_sprint",
        name="C · 考前冲刺（抱佛脚）",
        badge="高密度浓缩 · 必考点提取 · 佛教突击卷",
        description="面向考前时间紧迫的突击抢分场景：剥离冗余推导，直击高频核心考点、考前速记表与考前佛教突击卷。",
        icon="flame",
        target_difficulty="exam_sprint",
        default_deliverables=DeliverableConfig(
            scenario_type="C_sprint",
            selected_items=[
                "key_knowledge_extraction",
                "cheatsheet",
                "cram_exam_paper",
            ],
            include_study_guide_notes=True,
            notes_style="deep_dive",
            include_cheatsheet=True,
            cheatsheet_density="comprehensive",
            include_quiz=True,
            quiz_mode="exam_paper",
            mcq_count=8,
            fill_blank_count=4,
            short_answer_count=3,
            total_score=100,
            suggested_minutes=45,
            include_mindmap=False,
            mindmap_depth=2,
        ),
        sample_prompt="即将考试时间非常紧，只保留核心高频考点、必背公式套路和抢分高频题，出题直击历年常考陷阱与标准得分点。",
        pedagogical_focus=["高频考点精准提取", "考前速记必背清单", "佛教突击抢分卷"],
        available_items=SCENARIO_ITEMS_MAP["C_sprint"],
    ),
]

PRESET_MAP: Dict[str, PresetTemplate] = {p.preset_id: p for p in PRESET_TEMPLATES}

_LEGACY_PRESET_ALIAS: Dict[str, str] = {
    "self_study_guide": "A_beginner",
    "in_class_practice": "A_beginner",
    "sync_practice": "B_consolidate",
    "self_test_exam": "B_consolidate",
    "exam_cheatsheet": "C_sprint",
    "custom": "A_beginner",
}


def get_preset(preset_id: str | None) -> PresetTemplate:
    pid = (preset_id or "A_beginner").strip()
    if pid in PRESET_MAP:
        return PRESET_MAP[pid]
    mapped = _LEGACY_PRESET_ALIAS.get(pid)
    if mapped and mapped in PRESET_MAP:
        return PRESET_MAP[mapped]
    return PRESET_MAP["A_beginner"]


def sync_deliverable_flags_with_items(deliverables: DeliverableConfig) -> DeliverableConfig:
    """Keep boolean include_* fields strictly aligned with scenario_type & selected_items."""
    items = set(deliverables.selected_items or [])
    if not items:
        preset = get_preset(deliverables.scenario_type)
        items = set(preset.default_deliverables.selected_items)

    has_notes = bool(items & {"detailed_study_guide", "key_knowledge_extraction"})
    has_cs = "cheatsheet" in items
    has_mm = "mindmap" in items
    has_quiz = bool(
        items
        & {
            "sync_homework",
            "unit_test_paper",
            "chapter_consolidation_paper",
            "comprehensive_test_paper",
            "cram_exam_paper",
        }
    )
    return deliverables.model_copy(
        update={
            "selected_items": [opt.item_id for opt in SCENARIO_ITEMS_MAP.get(deliverables.scenario_type, []) if opt.item_id in items] or list(items),
            "include_study_guide_notes": has_notes,
            "include_cheatsheet": has_cs,
            "include_mindmap": has_mm,
            "include_quiz": has_quiz,
        }
    )


def build_default_blueprint_from_ir(
    document_ir: DocumentIR,
    preset: PresetTemplate,
    user_prompt: str = "",
) -> StudyBlueprint:
    sel_ids = [c.chapter_id for c in document_ir.chapters]
    focus_topics: List[str] = []
    for ch in document_ir.chapters:
        focus_topics.extend(ch.key_terms[:3])
    focus_topics = list(dict.fromkeys(focus_topics))[:10]
    deliverables = sync_deliverable_flags_with_items(preset.default_deliverables.model_copy())
    return StudyBlueprint(
        blueprint_id=f"bp_{uuid.uuid4().hex[:8]}",
        blueprint_title=f"{document_ir.filename} · {preset.name}",
        scenario_type=preset.scenario_type,
        preset_id=preset.preset_id,
        preset_name=preset.name,
        parsed_intent_summary=(
            f"已选中场景【{preset.name}】，包含 {len(sel_ids)} 个章节与 {len(deliverables.selected_items)} 项可导出资料。"
        ),
        ai_feedback_message=(
            f"请确认场景（A/B/C）、勾选需要生成的资料项及出题参数；可点击「AI 智能填写参数」自动评估最优题量，确认无误后再开始流式生成。"
        ),
        target_difficulty=preset.target_difficulty,
        selected_chapter_ids=sel_ids,
        deliverables=deliverables,
        focus_topics=focus_topics or [document_ir.filename],
        custom_instructions=user_prompt.strip() or preset.sample_prompt,
        confirmed=False,
    )
