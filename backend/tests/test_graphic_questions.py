# -*- coding: utf-8 -*-
"""End-to-end tests for Master Task Package v4.0 unified graphic questions,
5 visual engines, 5 original recipes, 3-level fallbacks, courseware + exam
4/5-agent pipelines, and A4/A3 PyMuPDF rasterized SVG PDF export.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, Dict, List, Tuple

import pymupdf

from app.router.fallback_provider import HeuristicStudyEngine
from app.schemas import (
    AssetItem,
    ChapterNode,
    DeliverableConfig,
    DocumentIR,
    PresetTemplate,
    QuizPaper,
    QuizQuestion,
    StudyBlueprint,
    StudyPackage,
)
from app.workflows.exam_paper_pipeline import (
    SOUL_VISUAL_FILENAME,
    _ensure_project_soul_files,
    _run_four_agent_similar_paper,
)
from app.workflows.generator import _parse_quiz_questions
from app.workflows.pdf_exporter import export_quiz_pdf_bytes, export_study_guide_pdf_bytes
from app.workflows.section_practice import _parse_questions as parse_section_questions
from app.workflows.visual_compiler import (
    build_recipe_figure_block,
    compile_echarts_to_svg,
    compile_figure_block_with_fallbacks,
    compile_mermaid_to_svg,
    compile_raw_svg,
    compile_reuse_crop,
    compile_smiles_to_svg,
)

# Minimal valid 1x1 PNG bytes for REUSE_CROP fixture
_TINY_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x02\x00\x00\x00\x02"
    b"\x08\x02\x00\x00\x00\xfd\xd4\x9as\x00\x00\x00\x14IDATx\x9cc\xf8\xcf\xc0"
    b"\x00\x00\x03\x01\x01\x00\x18\xdd\x8d\xb0\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _sample_doc_ir(project_dir: Path | None = None) -> DocumentIR:
    assets: List[AssetItem] = []
    if project_dir is not None:
        assets_dir = project_dir / "assets"
        assets_dir.mkdir(parents=True, exist_ok=True)
        (assets_dir / "fig_crop_1.png").write_bytes(_TINY_PNG)
        assets.append(
            AssetItem(
                asset_id="img_1",
                filename="fig_crop_1.png",
                url="/assets/fig_crop_1.png",
                page_or_slide=1,
                caption="教材细胞跨膜转运示意图",
            )
        )
    ch1 = ChapterNode(
        chapter_id="ch_1",
        title="第一章 酶促反应动力学与抑制机制",
        start_page=1,
        end_page=8,
        char_count=600,
        summary_preview="米氏方程、竞争性抑制与非竞争性抑制曲线分析。",
        content_text=(
            "酶促反应初速度 v 遵循米氏方程：v = Vmax * [S] / (Km + [S])。"
            "竞争性抑制剂与底物竞争结合酶活性中心，使表观 Km 增大而 Vmax 不变。"
            "非竞争性抑制剂结合调节位点，使 Vmax 降低而 Km 不变。"
            "负反馈调节通过终产物抑制上游限速酶维持稳态。"
        ),
        key_terms=["米氏方程", "竞争性抑制", "非竞争性抑制", "Km", "Vmax"],
    )
    ch2 = ChapterNode(
        chapter_id="ch_2",
        title="第二章 药物中间体与信号转导通路",
        start_page=9,
        end_page=16,
        char_count=500,
        summary_preview="多官能团有机分子结构鉴别与细胞内二级信使调控通路。",
        content_text=(
            "乙酰水杨酸类中间体同时含有羧基与酯基；配体激活受体后通过 G 蛋白调控效应酶活性。"
            "代谢稳态调节需明确促进(+)与抑制(-)节点以及正负反馈环路。"
        ),
        key_terms=["酯基", "酚羟基", "信号通路", "反馈环路"],
    )
    return DocumentIR(
        project_id="proj_graphic_test",
        filename="生物化学与分子药理.pdf",
        file_type="pdf",
        total_pages_or_slides=16,
        total_chars=1100,
        chapters=[ch1, ch2],
        all_assets=assets,
    )


def _sample_blueprint(scenario: str = "B_consolidate") -> StudyBlueprint:
    deliverables = DeliverableConfig(
        scenario_type=scenario,  # type: ignore[arg-type]
        mcq_count=4,
        fill_blank_count=1,
        short_answer_count=1,
        total_score=40,
        suggested_minutes=45,
    )
    return StudyBlueprint(
        blueprint_id="bp_graphic_test",
        blueprint_title="巩固提高与原创图题训练",
        scenario_type=scenario,  # type: ignore[arg-type]
        preset_id="b_consolidation",
        preset_name="巩固提高专练",
        parsed_intent_summary="巩固提高与原创图题训练",
        target_difficulty="intermediate",
        selected_chapter_ids=["ch_1", "ch_2"],
        deliverables=deliverables,
        focus_topics=["竞争性抑制", "米氏方程", "信号通路"],
        ai_feedback_message="已生成巩固提高与原创图题训练方案。",
        confirmed=True,
    )


def test_all_five_visual_engines_compile_cleanly(tmp_path: Path) -> None:
    # 1. ECharts JSON -> SVG
    echarts_opt = {
        "backgroundColor": "#FFFFFF",
        "xAxis": {"type": "value", "name": "[S]"},
        "yAxis": {"type": "value", "name": "v"},
        "series": [
            {"name": "a", "type": "line", "data": [[0, 0], [10, 50], [30, 75], [80, 89]]},
            {"name": "b", "type": "line", "data": [[0, 0], [10, 25], [30, 50], [80, 73]]},
        ],
    }
    svg_ec = compile_echarts_to_svg(json.dumps(echarts_opt))
    assert "<svg" in svg_ec and "</svg>" in svg_ec
    assert "a" in svg_ec and "b" in svg_ec

    # 2. SMILES -> SVG (single + valid Reaction SMILES)
    svg_sm = compile_smiles_to_svg("CC(=O)Oc1ccccc1C(=O)O")
    svg_rxn = compile_smiles_to_svg("CC(=O)O.CCO>O=S(=O)(O)O>CC(=O)OCC.O")
    assert "<svg" in svg_sm and "</svg>" in svg_sm
    assert "<svg" in svg_rxn and "</svg>" in svg_rxn

    # 3. Mermaid -> SVG
    svg_mm = compile_mermaid_to_svg("graph LR\nA([信号X]) --> B[受体Y]\nB -.-> C[【 过程① 】]\nclass C blankNode")
    assert "<svg" in svg_mm and "【 过程① 】" in svg_mm

    # 4. Raw SVG
    svg_raw = compile_raw_svg('<svg viewBox="0 0 200 120"><line x1="10" y1="60" x2="180" y2="60" stroke="#111827"/></svg>')
    assert svg_raw.startswith("<svg") and 'fill="#FFFFFF"' in svg_raw

    # 5. REUSE_CROP
    assets_dir = tmp_path / "assets"
    assets_dir.mkdir()
    (assets_dir / "crop_a.png").write_bytes(_TINY_PNG)
    data_url = compile_reuse_crop("crop_a.png", assets_dir=assets_dir)
    assert data_url.startswith("data:image/png;base64,")


def test_all_five_original_recipes_build_valid_blocks() -> None:
    recipes = [
        "ORIGINAL_DUAL_CURVE",
        "ORIGINAL_FOUR_OPTION_CHARTS",
        "ORIGINAL_PATHWAY_PUZZLE",
        "ORIGINAL_CHEM_SYNTHESIS",
        "ORIGINAL_SCHEMATIC_MODEL",
    ]
    for r in recipes:
        blk = build_recipe_figure_block(r, topic_hint="酶抑制动力学")
        if r == "ORIGINAL_FOUR_OPTION_CHARTS":
            assert blk.position == "OPTIONS_GRID"
            assert blk.sub_figures_compiled is not None
            assert set(blk.sub_figures_compiled.keys()) == {"A", "B", "C", "D"}
            for opt_svg in blk.sub_figures_compiled.values():
                assert "<svg" in opt_svg and "</svg>" in opt_svg
        else:
            assert blk.position == "BELOW_STEM"
            assert "<svg" in blk.compiled_svg_or_base64 and "</svg>" in blk.compiled_svg_or_base64


def test_three_level_self_healing_fallbacks(tmp_path: Path) -> None:
    assets_dir = tmp_path / "assets"
    assets_dir.mkdir()
    (assets_dir / "fallback_fig.png").write_bytes(_TINY_PNG)

    # Level 1: retry callback fixes malformed ECharts JSON
    calls = {"n": 0}

    def retry_ok(err: str) -> Dict[str, Any]:
        calls["n"] += 1
        assert err
        return {
            "render_engine": "ECHARTS",
            "figure_position": "BELOW_STEM",
            "figure_payload": json.dumps({
                "xAxis": {"name": "t"},
                "yAxis": {"name": "V"},
                "series": [{"name": "a", "type": "line", "data": [[0, 1], [5, 8], [10, 6]]}],
            }),
            "figure_caption": "图1 修复后曲线",
        }

    ok1, blk1, stem1 = compile_figure_block_with_fallbacks(
        stem="请分析曲线。",
        render_engine="ECHARTS",
        raw_payload="{not valid json",
        retry_callback=retry_ok,
    )
    assert ok1 and calls["n"] == 1 and blk1 is not None
    assert "<svg" in blk1.compiled_svg_or_base64

    # Level 2: fallback to REUSE_CROP when retry still fails and asset exists
    ok2, blk2, _ = compile_figure_block_with_fallbacks(
        stem="观察图示。",
        render_engine="ECHARTS",
        raw_payload="{broken",
        original_image_id="fallback_fig.png",
        assets_dir=assets_dir,
        retry_callback=lambda _e: {"render_engine": "ECHARTS", "figure_payload": "{still broken"},
    )
    assert ok2 and blk2 is not None
    assert blk2.render_engine == "REUSE_CROP"
    assert blk2.compiled_svg_or_base64.startswith("data:image/png;base64,")

    # Level 3: fallback to Markdown table when no image exists
    ok3, blk3, stem3 = compile_figure_block_with_fallbacks(
        stem="据此比较对照组与实验组差异。",
        render_engine="ECHARTS",
        raw_payload="{broken",
        original_graphic_modeling="实线a采样点(0,0), P1(10,50), (30,75)；虚线b对应P2(30,50)",
    )
    assert not ok3 and blk3 is None
    assert "| :---:" in stem3 and "50" in stem3 and "【图形关键观测数据表】" in stem3


def test_courseware_heuristic_and_parser_graphic_flow() -> None:
    doc_ir = _sample_doc_ir()
    bp = _sample_blueprint("B_consolidate")
    paper = HeuristicStudyEngine.generate_quiz_from_ir(doc_ir, bp)
    assert len(paper.questions) == 6
    # 离线启发式没有任何真实建模数据，绝不允许凭空给题目配图（"不需要图强行生图"）
    assert all(not q.has_figure and q.figure_block is None for q in paper.questions)
    # source_mode 仍然要正确标注，供排版与配额审计使用
    assert all(q.source_mode == "TEXTBOOK_MODE_B" for q in paper.questions)

    raw_items = [
        {
            "id": "q_svg",
            "type": "mcq",
            "is_original_question": True,
            "has_figure": True,
            "original_graphic_modeling": "曲线a: y=100x/(10+x); 曲线b: y=100x/(30+x); P1(10,50)",
            "figure_block": {
                "position": "BELOW_STEM",
                "visual_strategy": "ORIGINAL_SYNTHESIS",
                "original_recipe": "ORIGINAL_DUAL_CURVE",
                "render_engine": "ECHARTS",
                "raw_payload": json.dumps({
                    "xAxis": {"name": "[S]"},
                    "yAxis": {"name": "v"},
                    "series": [
                        {"name": "a", "type": "line", "data": [[0, 0], [10, 50], [40, 80]]},
                        {"name": "b", "type": "line", "data": [[0, 0], [10, 25], [40, 57]]},
                    ],
                }),
                "figure_caption": "图1 竞争性抑制对比曲线",
            },
            "question": "如图所示，加抑制剂后为虚线 $b$，正确的判断是（  ）",
            "options": ["A. 竞争性抑制", "B. 非竞争性抑制", "C. Vmax 减半", "D. 不可逆失活"],
            "answer": "A",
            "explanation": "【考点定位】酶动力学\n【详解与推导】Km增大，Vmax不变。\n【易错点拨】勿混淆Km与Vmax。",
        }
    ]
    parsed = _parse_quiz_questions(raw_items, "第一章", doc_ir=doc_ir, scenario_type="B_consolidate")
    assert len(parsed) == 1
    assert parsed[0].has_figure and parsed[0].figure_block is not None
    assert "<svg" in parsed[0].figure_block.compiled_svg_or_base64

    sec_parsed = parse_section_questions(raw_items, "第一章", doc_ir=doc_ir, scenario_type="C_sprint")
    assert sec_parsed[0].has_figure and sec_parsed[0].source_mode == "TEXTBOOK_MODE_C"


class _MockFiveAgentRouter:
    """Mock router covering Agent A, B, C, Agent 3.5, and Agent D blind multimodal review."""

    def __init__(self) -> None:
        self.d_prompts: List[str] = []
        self.c5_calls: int = 0
        self.d_visual_calls: Dict[int, int] = {}

    def check_cancelled(self) -> None:
        return None

    async def execute_json(self, stage: str, system_prompt: str, user_prompt: str) -> Tuple[Any, str]:
        if stage == "requirement_negotiation":
            return {
                "subject_and_level": "大学生物化学-期中选拔水平",
                "overall_difficulty": "中档偏上",
                "visual_density": "全卷包含35%~45%原创图题",
                "originality_requirement": "严禁换皮",
                "tone_and_persona": {"stem_style": "科研定量曲线导向", "phrasing_habits": ["下列叙述正确的是"], "option_length_style": "对称"},
                "formatting_rules": "LaTeX",
                "user_override_directives": ["包含原创曲线与四图选择题"],
            }, "mock-a"

        if stage == "notes_and_cheatsheet":
            return [
                {
                    "question_id": 1,
                    "target_question_type": "单选题",
                    "target_difficulty": "中档",
                    "knowledge_points": ["竞争性抑制"],
                    "original_skeleton": "曲线对照 -> Km右移",
                    "distractor_recipe": [{"item": "B", "trap_type": "混淆类型", "detail": "误判为非竞争性"}],
                    "assigned_strategies": ["ORIGINAL_SCENE_CREATE", "MODALITY_CONVERT"],
                    "generation_directive": "构建双曲线竞争性抑制题",
                    "has_figure": True,
                    "visual_blueprint": {
                        "visual_strategy": "ORIGINAL_SYNTHESIS",
                        "original_recipe": "ORIGINAL_DUAL_CURVE",
                        "figure_position": "BELOW_STEM",
                        "target_engine": "ECHARTS",
                        "visual_directive": "画实线a与虚线b双曲线并标注P1",
                    },
                },
                {
                    "question_id": 2,
                    "target_question_type": "单选题",
                    "target_difficulty": "拔高",
                    "knowledge_points": ["液泡体积变化曲线"],
                    "original_skeleton": "先质壁分离后自动复原",
                    "distractor_recipe": [{"item": "A", "trap_type": "未复原", "detail": "单调下降"}],
                    "assigned_strategies": ["MODALITY_CONVERT"],
                    "generation_directive": "一题四图辨析选择题",
                    "has_figure": True,
                    "visual_blueprint": {
                        "visual_strategy": "ORIGINAL_SYNTHESIS",
                        "original_recipe": "ORIGINAL_FOUR_OPTION_CHARTS",
                        "figure_position": "OPTIONS_GRID",
                        "target_engine": "ECHARTS",
                        "visual_directive": "分别给出A/B/C/D四条时间变化曲线",
                    },
                },
            ], "mock-b"

        if "Agent 3.5" in system_prompt or "layout_calculation" in user_prompt:
            self.c5_calls += 1
            if "ORIGINAL_FOUR_OPTION_CHARTS" in user_prompt or "甘油" in user_prompt or "液泡" in user_prompt:
                mk = lambda pts: json.dumps({"xAxis": {"name": "t"}, "yAxis": {"name": "V"}, "series": [{"name": "v", "type": "line", "data": pts}]})
                return {
                    "render_engine": "ECHARTS",
                    "figure_position": "OPTIONS_GRID",
                    "layout_calculation": "计算四条曲线采样点",
                    "figure_payload": None,
                    "sub_figures": {
                        "A": mk([[0, 10], [2, 8], [4, 5], [6, 3]]),
                        "B": mk([[0, 3], [2, 5], [4, 7], [6, 9]]),
                        "C": mk([[0, 10], [2, 4], [4, 6], [6, 9.5]]),
                        "D": mk([[0, 10], [2, 10], [4, 10], [6, 10]]),
                    },
                    "figure_caption": "图2 四种细胞体积变化曲线选项对比",
                }, "mock-c5"
            return {
                "render_engine": "ECHARTS",
                "figure_position": "BELOW_STEM",
                "layout_calculation": "P1(10,50) 与 P2(30,50)",
                "figure_payload": json.dumps({
                    "xAxis": {"name": "[S]"},
                    "yAxis": {"name": "v"},
                    "series": [
                        {"name": "a", "type": "line", "data": [[0, 0], [10, 50], [30, 75], [60, 86]], "markPoint": {"data": [{"name": "P1", "coord": [10, 50]}]}},
                        {"name": "b", "type": "line", "data": [[0, 0], [10, 25], [30, 50], [60, 67]]},
                    ],
                }),
                "sub_figures": None,
                "figure_caption": "图1 候选分子 X 酶促反应双曲线（a对照，b加X）",
            }, "mock-c5"

        if stage == "quiz_generation":
            if "液泡体积变化曲线" in user_prompt or "一题四图辨析选择题" in user_prompt:
                return {
                    "question_id": 2,
                    "is_original_question": True,
                    "question_type": "单选题",
                    "knowledge_tags": ["液泡体积变化曲线"],
                    "applied_strategies": ["MODALITY_CONVERT"],
                    "has_figure": True,
                    "reverse_design": "SECRET_REVERSE_DESIGN_Q2_C",
                    "original_graphic_modeling": "C先降后升回到初值；A单调下降",
                    "correct_answer": "C",
                    "detailed_analysis": "SECRET_ANALYSIS_Q2",
                    "stem": "将植物细胞置于甘油溶液中，液泡体积变化曲线最可能是（  ）",
                    "options": {"A": "见选项A图", "B": "见选项B图", "C": "见选项C图", "D": "见选项D图"},
                }, "mock-c"
            return {
                "question_id": 1,
                "is_original_question": True,
                "question_type": "单选题",
                "knowledge_tags": ["竞争性抑制"],
                "applied_strategies": ["ORIGINAL_SCENE_CREATE"],
                "has_figure": True,
                "reverse_design": "SECRET_REVERSE_DESIGN_Q1_A",
                "original_graphic_modeling": "实线a:100x/(10+x); 虚线b:100x/(30+x); P1(10,50)",
                "correct_answer": "A",
                "detailed_analysis": "SECRET_ANALYSIS_Q1",
                "stem": "如图所示，未加分子 X 为实线 $a$，加入 X 后为虚线 $b$，下列叙述正确的是（  ）",
                "options": {"A": "X 为竞争性抑制剂", "B": "Vmax 降为一半", "C": "无法解除抑制", "D": "Km 减小"},
            }, "mock-c"

        if stage == "global_quality_audit":
            self.d_prompts.append(user_prompt)
            if "甘油" in user_prompt:
                return {
                    "visual_observation": "四图选项中 C 先降后升",
                    "reasoning_process": "先失水后甘油进入复原",
                    "my_answer": "C",
                    "is_text_valid": True,
                    "is_visual_valid": True,
                    "is_valid": True,
                    "defect_report": None,
                    "visual_defect_report": None,
                }, "mock-d"
            cnt = self.d_visual_calls.get(1, 0) + 1
            self.d_visual_calls[1] = cnt
            if cnt == 1:
                # Visual defect only on attempt 1 -> triggers Agent 3.5 retry without rewriting Agent C text
                return {
                    "visual_observation": "实线a与虚线b清晰，但缺少P2文字说明",
                    "reasoning_process": "Vmax相同且Km增大",
                    "my_answer": "A",
                    "is_text_valid": True,
                    "is_visual_valid": False,
                    "is_valid": False,
                    "defect_report": None,
                    "visual_defect_report": "请补充半速点 P2 标注",
                }, "mock-d"
            return {
                "visual_observation": "实线a、虚线b、P1均清晰可读",
                "reasoning_process": "竞争性抑制Km增大Vmax不变",
                "my_answer": "A",
                "is_text_valid": True,
                "is_visual_valid": True,
                "is_valid": True,
                "defect_report": None,
                "visual_defect_report": None,
            }, "mock-d"

        return {}, "mock-other"


def test_exam_five_agent_pipeline_visual_and_blind_isolation(tmp_path: Path) -> None:
    doc_ir = _sample_doc_ir(tmp_path)
    soul_paths = _ensure_project_soul_files(tmp_path)
    assert SOUL_VISUAL_FILENAME in soul_paths and soul_paths[SOUL_VISUAL_FILENAME].is_file()

    router = _MockFiveAgentRouter()
    paper, metadata, _summary = asyncio.run(
        _run_four_agent_similar_paper(
            doc_ir=doc_ir,
            raw_exam_text="1. 酶竞争性抑制作用机理。2. 植物细胞在甘油溶液中的质壁分离与复原。",
            user_requirements="包含原创曲线与一题四图选择题",
            soul_paths=soul_paths,
            router=router,  # type: ignore[arg-type]
            progress_cb=None,
        )
    )
    assert SOUL_VISUAL_FILENAME in metadata.soul_files_uploaded
    assert len(paper.questions) == 2
    assert paper.questions[0].has_figure and paper.questions[0].figure_block is not None
    assert paper.questions[0].figure_block.position == "BELOW_STEM"
    assert "<svg" in paper.questions[0].figure_block.compiled_svg_or_base64

    assert paper.questions[1].has_figure and paper.questions[1].figure_block is not None
    assert paper.questions[1].figure_block.position == "OPTIONS_GRID"
    assert paper.questions[1].figure_block.sub_figures_compiled is not None
    assert len(paper.questions[1].figure_block.sub_figures_compiled) == 4

    # Q1 ran Agent 3.5 twice (attempt 1 + visual-only attempt 2) and Q2 ran once => >= 3
    assert router.c5_calls >= 3
    # Strictly verify Agent D blind isolation never sees SECRET reverse_design or detailed_analysis
    assert router.d_prompts
    for prompt in router.d_prompts:
        assert "SECRET_REVERSE_DESIGN" not in prompt
        assert "SECRET_ANALYSIS" not in prompt
        assert "主图" in prompt or "四图选项" in prompt


def test_pdf_export_rasterizes_below_stem_and_options_grid_a4_and_a3() -> None:
    doc_ir = _sample_doc_ir()
    bp = _sample_blueprint("B_consolidate")
    blk_stem = build_recipe_figure_block("ORIGINAL_DUAL_CURVE", topic_hint="米氏抑制曲线")
    blk_grid = build_recipe_figure_block("ORIGINAL_FOUR_OPTION_CHARTS", topic_hint="四图趋势鉴别")
    q1 = QuizQuestion(
        id="pdf_q1",
        type="mcq",
        difficulty="medium",
        tier="能力提升",
        score=5,
        is_original_question=True,
        source_mode="TEXTBOOK_MODE_B",
        has_figure=True,
        figure_block=blk_stem,
        question="如图实线 $a$ 与虚线 $b$ 所示，加入抑制剂后的判断正确的是（  ）",
        options=["A. 竞争性抑制", "B. 非竞争性抑制", "C. Vmax 减小", "D. Km 减小"],
        answer="A",
        explanation="【考点定位】米氏方程\n【详解与推导】Km 增大。",
        source_chapter="第一章",
        source_page="P3",
    )
    q2 = QuizQuestion(
        id="pdf_q2",
        type="mcq",
        difficulty="hard",
        tier="拓展探究",
        score=5,
        is_original_question=True,
        source_mode="TEXTBOOK_MODE_B",
        has_figure=True,
        figure_block=blk_grid,
        question="下列 A/B/C/D 四条曲线符合先降后升恢复趋势的是（  ）",
        options=["A. 见选项A图", "B. 见选项B图", "C. 见选项C图", "D. 见选项D图"],
        answer="C",
        explanation="【考点定位】动态平衡\n【详解与推导】先降低后回升。",
        source_chapter="第二章",
        source_page="P10",
    )
    quiz = QuizPaper(
        paper_id="graphic_pdf_test",
        title="含图原创双端导出测试卷",
        mode="in_class",
        total_score=10,
        suggested_minutes=20,
        instructions="姓名：__________  日期：__________  得分：__________",
        questions=[q1, q2],
    )
    pkg = StudyPackage(
        project_id="proj_graphic_test",
        blueprint_used=bp,
        study_notes_markdown="# 第一章 酶促反应动力学\n\n核心内容见讲义。\n",
        cheatsheet_markdown="# 速记\n\n- Km 与底物亲和力呈负相关。\n",
        quiz_paper=quiz,
    )

    for paper_sz in ("a4", "a3"):
        pdf_bytes = export_quiz_pdf_bytes(doc_ir, pkg, paper_size=paper_sz, include_answers=True)  # type: ignore[arg-type]
        assert pdf_bytes.startswith(b"%PDF")
        doc = pymupdf.open("pdf", pdf_bytes)
        assert len(doc) >= 1
        assert sum(len(page.get_images()) for page in doc) >= 5  # 1 main fig + 4 option figs rasterized cleanly
        full_txt = "\n".join(page.get_text() for page in doc)
        assert "<svg" not in full_txt

    guide_bytes = export_study_guide_pdf_bytes(
        doc_ir, pkg, paper_size="a4", include_answers=True
    )
    assert guide_bytes.startswith(b"%PDF")
    gdoc = pymupdf.open("pdf", guide_bytes)
    total_imgs = sum(len(page.get_images()) for page in gdoc)
    assert total_imgs >= 5
