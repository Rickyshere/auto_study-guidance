from __future__ import annotations

import asyncio
import json
import re
import uuid
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

from app.parsers.ocr_engine import probe_local_oxr_only
from app.parsers.pdf_parser import extract_key_terms
from app.router.routing_engine import ModelRouter
from app.schemas import (
    ChapterNode,
    DeliverableConfig,
    DocumentIR,
    ExamAgentStyleProfile,
    ExamBlindReviewResult,
    ExamDirectionType,
    ExamDistractorRecipeItem,
    ExamGeneratedQuestionItem,
    ExamPipelineMetadata,
    ExamQuestionBlueprintItem,
    ExamToneAndPersona,
    KnowledgeFlashcard,
    QuizPaper,
    QuizQuestion,
    RouterSettings,
    StudyBlueprint,
    StudyPackage,
)
from app.workflows.generator import extract_knowledge_flashcards, normalize_markdown_math

ExamProgressCallback = Optional[Callable[[Dict[str, Any]], Awaitable[None]]]

EXAM_AGENTS_DIR = Path(__file__).resolve().parent / "exam_agents"

SOUL_SPECS: List[Dict[str, str]] = [
    {
        "agent_id": "a",
        "filename": "soul_a.md",
        "name": "Agent A · 风格鉴赏师",
        "summary": "提取原卷“神韵”（语调、包装形式、题型配比、排版规范），并将口语化需求转为硬性全局约束。",
    },
    {
        "agent_id": "b",
        "filename": "soul_b.md",
        "name": "Agent B · 命题架构师",
        "summary": "拆解每道题的“知识考点 + 逻辑推导链 + 干扰项挖坑配方”，并指派 6 大变异策略。",
    },
    {
        "agent_id": "c",
        "filename": "soul_c.md",
        "name": "Agent C · 逆向命题专家",
        "summary": "并发生成具体变式题，强制遵循“先定答案与解析 -> 反推题干条件 -> 构造同构干扰项”顺序。",
    },
    {
        "agent_id": "d",
        "filename": "soul_d.md",
        "name": "Agent D · 盲测校验 Critic",
        "summary": "仅接收 question_type、stem、options 独立盲做验题；一致则通过，否则携 defect_report 打回重写。",
    },
]

SOUL_ORIGINAL_FILENAME = "soul_original_bank.md"
SOUL_KNOWLEDGE_NOTES_FILENAME = "soul_knowledge_notes.md"


def get_exam_agent_souls_payload() -> List[Dict[str, str]]:
    items: List[Dict[str, str]] = []
    for spec in SOUL_SPECS:
        path = EXAM_AGENTS_DIR / spec["filename"]
        content = path.read_text(encoding="utf-8") if path.is_file() else ""
        items.append({**spec, "content": content})
    return items


def _ensure_project_soul_files(project_dir: Path) -> Dict[str, Path]:
    """Copy bundled soul.md files into the workspace project directory so every task uploads explicit files."""
    target_dir = project_dir / "exam_agents"
    target_dir.mkdir(parents=True, exist_ok=True)
    paths: Dict[str, Path] = {}
    for name in (
        "soul_a.md",
        "soul_b.md",
        "soul_c.md",
        "soul_d.md",
        SOUL_ORIGINAL_FILENAME,
        SOUL_KNOWLEDGE_NOTES_FILENAME,
    ):
        src = EXAM_AGENTS_DIR / name
        dst = target_dir / name
        content = src.read_text(encoding="utf-8") if src.is_file() else ""
        if content:
            dst.write_text(content, encoding="utf-8")
        paths[name] = dst if dst.is_file() else src
    return paths


def _render_soul_template(template_text: str, variables: Dict[str, str]) -> str:
    rendered = template_text
    for key, val in variables.items():
        rendered = rendered.replace(f"{{{{{key}}}}}", val)
    return rendered


async def _emit(
    cb: ExamProgressCallback,
    stage: str,
    percent: int,
    message: str,
    agent_id: Optional[str] = None,
    soul_file: Optional[str] = None,
    detail: Optional[Dict[str, Any]] = None,
) -> None:
    if not cb:
        return
    payload: Dict[str, Any] = {
        "stage": stage,
        "percent": max(0, min(100, int(percent))),
        "message": message,
    }
    if agent_id:
        payload["agent_id"] = agent_id
    if soul_file:
        payload["soul_file"] = soul_file
    if detail:
        payload["detail"] = detail
    await cb(payload)


def _normalize_qtype(raw_type: str, has_options: bool) -> str:
    t = (raw_type or "").strip().lower()
    if any(k in t for k in ("fill", "填空")):
        return "fill_blank"
    if any(k in t for k in ("short", "简答", "论述", "计算", "证明", "分析", "实验", "综合")):
        return "short_answer" if not has_options else "mcq"
    if any(k in t for k in ("mcq", "选择", "单选", "多选", "判断")) or has_options:
        return "mcq"
    return "short_answer"


def _normalize_difficulty(raw_diff: str) -> str:
    d = (raw_diff or "").strip().lower()
    if any(k in d for k in ("easy", "基础", "偏易")):
        return "easy"
    if any(k in d for k in ("hard", "拔高", "选拔", "难题")):
        return "hard"
    return "medium"


def _difficulty_to_tier(diff: str) -> str:
    if diff == "easy":
        return "基础达标"
    if diff == "hard":
        return "拓展探究"
    return "能力提升"


def _format_options_list(options_obj: Any) -> List[str]:
    if not options_obj:
        return []
    result: List[str] = []
    if isinstance(options_obj, dict):
        ordered_keys = sorted(options_obj.keys(), key=lambda k: str(k).strip().upper())
        for k in ordered_keys:
            letter = str(k).strip().upper()[:1]
            val = normalize_markdown_math(str(options_obj[k] or "").strip())
            if val and not re.match(rf"^{re.escape(letter)}[.、:：\s]", val, re.IGNORECASE):
                result.append(f"{letter}. {val}")
            elif val:
                result.append(val)
        return result
    if isinstance(options_obj, list):
        for idx, raw in enumerate(options_obj):
            letter = chr(65 + idx)
            val = normalize_markdown_math(str(raw or "").strip())
            if val and not re.match(r"^[A-Ha-h][.、:：\s]", val):
                result.append(f"{letter}. {val}")
            elif val:
                result.append(val)
    return result


def _extract_choice_letters(raw_answer: str, options: Optional[Dict[str, str]]) -> str:
    ans = (raw_answer or "").strip()
    if not ans:
        return ""
    up = ans.upper()
    # Direct single/multi letters like "C", "AC", "A, C", "选C"
    cleaned = re.sub(r"^(?:答案[：:\s]*|选\s*|OPTIONS?\s*)", "", up).strip()
    if re.fullmatch(r"[A-H](?:[\s,、/和]*[A-H])*", cleaned):
        letters = sorted(set(re.findall(r"[A-H]", cleaned)))
        return "".join(letters)
    # Match leading letter pattern like "C. 钠离子通道..." or "C、..."
    lead = re.match(r"^\(?([A-H])\)?[.\s、:：)]", up)
    if lead:
        return lead.group(1)
    # Try matching against option text values if answer didn't explicitly name a letter
    if isinstance(options, dict):
        norm_ans = re.sub(r"[\s$.,;，。；：()（）]+", "", ans).lower()
        if norm_ans:
            matched_letters: List[str] = []
            for k, v in options.items():
                norm_v = re.sub(r"[\s$.,;，。；：()（）]+", "", str(v or "")).lower()
                if norm_v and (norm_ans == norm_v or norm_ans in norm_v or norm_v in norm_ans):
                    matched_letters.append(str(k).strip().upper()[:1])
            if matched_letters:
                return "".join(sorted(set(matched_letters)))
    found = re.findall(r"\b([A-H])\b", up)
    if found:
        return "".join(sorted(set(found)))
    return ""


def _normalize_text_for_match(val: str) -> str:
    s = (val or "").strip().lower()
    s = s.replace("$", "").replace("\\(", "").replace("\\)", "")
    s = re.sub(r"[\s，。；：、“”‘’\"'`（）()【】\[\]]+", "", s)
    return s


def _blind_answers_match(
    question_type: str,
    options: Optional[Dict[str, str]],
    expected_answer: str,
    blind_answer: str,
) -> bool:
    if not (blind_answer or "").strip() or not (expected_answer or "").strip():
        return False

    has_options = isinstance(options, dict) and len(options) > 0
    qtype = _normalize_qtype(question_type, has_options)

    if qtype == "mcq" or has_options:
        exp_letters = _extract_choice_letters(expected_answer, options)
        got_letters = _extract_choice_letters(blind_answer, options)
        if exp_letters and got_letters:
            return exp_letters == got_letters
        return _normalize_text_for_match(expected_answer) == _normalize_text_for_match(blind_answer)

    norm_exp = _normalize_text_for_match(expected_answer)
    norm_got = _normalize_text_for_match(blind_answer)
    if not norm_exp or not norm_got:
        return False
    if norm_exp == norm_got or norm_exp in norm_got or norm_got in norm_exp:
        return True

    # For numerical / multi-step subjective answers, check numeric agreement + keyword overlap
    exp_nums = re.findall(r"-?\d+(?:\.\d+)?", expected_answer)
    got_nums = re.findall(r"-?\d+(?:\.\d+)?", blind_answer)
    if exp_nums and set(exp_nums).issubset(set(got_nums)):
        return True

    if qtype == "short_answer":
        exp_tokens = {w for w in re.findall(r"[A-Za-z0-9_]{2,}|[\u4e00-\u9fff]{2,4}", expected_answer)}
        if exp_tokens:
            hit = sum(1 for tok in exp_tokens if tok.lower() in blind_answer.lower())
            if hit / len(exp_tokens) >= 0.45:
                return True
    return False


async def create_demo_exam_paper_project(settings: RouterSettings) -> DocumentIR:
    """Create a rich realistic sample exam project after probing local/cloud OXR availability."""
    probe = await probe_local_oxr_only(settings)
    project_id = f"exam_demo_{uuid.uuid4().hex[:6]}"
    raw_exam_text = """# 《大学生理学与生物物理》期中真题样卷（满分 100 分，考试时间 90 分钟）

一、单项选择题（每题 10 分，共 40 分）

1. 某 32 岁女性患者因急性腹泻导致严重高钾血症（血钾浓度 $[K^+]_o$ 由 4.0 mmol/L 升至 7.5 mmol/L）。已知细胞内液 $[K^+]_i = 140\\text{ mmol/L}$，膜电位遵循 Nernst 平衡趋势（$E_K \\approx 61.5 \\lg\\frac{[K^+]_o}{[K^+]_i}\\text{ mV}$）。下列关于其心肌细胞静息电位及钠通道状态变化的叙述，正确的是：
A. 静息电位绝对值增大（超极化），钠通道激活阈值升高
B. 静息电位绝对值减小（去极化），快钠通道发生部分失活导致兴奋性先升后降
C. 静息电位不变，因 $Na^+-K^+$ 泵活性代偿性增强完全抵消离子梯度变化
D. 静息电位转为正值，钙离子内流速率成比例增加

2. 在神经-肌接头兴奋传递实验中，向浴槽中加入河豚毒素（TTX）后，电刺激运动神经纤维干，下列哪项指标将首先完全消失？
A. 肌细胞膜对 $\\text{Cl}^-$ 的被动通透性
B. 终板膜乙酰胆碱受体的离子通道构象活性
C. 运动神经轴突末梢动作电位传播
D. 终板膜微终板电位（MEPP）的自发量子释放

3. 已知某酶促反应遵循 Michaelis-Menten 动力学，底物初始浓度 $[S] = 4 K_m$。若加入某可逆抑制剂后表观米氏常数 $K_m^{app}$ 增至原 $K_m$ 的 3 倍，而最大反应速率 $V_{\\max}$ 保持不变，此时反应速率 $v$ 占无抑制剂时速率 $v_0$ 的百分比约为：
A. 57.1%
B. 71.4%
C. 80.0%
D. 42.9%

4. 某肺功能检测仪测得健康受试者潮气量 $V_T = 500\\text{ mL}$，呼吸频率 $f = 14\\text{ 次/分}$，解剖无效腔 $V_D = 150\\text{ mL}$。若受试者改为浅快呼吸（$V_T = 250\\text{ mL}$，$f = 28\\text{ 次/分}$），则其肺泡通气量与肺通气量分别如何变化？
A. 肺泡通气量不变，肺通气量减半
B. 肺通气量不变，肺泡通气量显著下降至 $2800\\text{ mL/min}$
C. 两者均上升约 40%，动脉血 $\\text{PaCO}_2$ 明显下降
D. 肺通气量加倍，肺泡通气量不变

二、填空题（共 20 分）

5. 根据 Frank-Starling 机制，心室肌在适宜前负荷范围内，随着心肌初长度增加，横桥结合数增多，肌钙蛋白对 $\\text{Ca}^{2+}$ 的亲和力________，从而使搏出量显著增加。

三、简答与实验分析题（共 40 分）

6. 某研究团队在离体大鼠主动脉环张力测定实验中发现：给予乙酰胆碱（ACh）后血管显著舒张；但使用机械方法刮除血管内皮细胞后，ACh 不仅不能引起舒张，反而诱发轻度收缩。请从内皮依赖性舒张因子（EDRF / NO）及血管平滑肌 $\\text{M}$ 受体双通路角度解释该实验现象，并说明如何设计对照实验验证一氧化氮合酶（NOS）的作用。
""".strip()

    chap = ChapterNode(
        chapter_id="exam_p1",
        title="全卷文本层（OXR 提取 · 共 6 题）",
        start_page=1,
        end_page=2,
        char_count=len(raw_exam_text),
        summary_preview=raw_exam_text[:180].replace("\n", " "),
        content_text=raw_exam_text,
        assets=[],
        key_terms=extract_key_terms(raw_exam_text),
    )

    return DocumentIR(
        project_id=project_id,
        project_type="exam_paper",
        filename="大学生理学与生物物理_期中真题示例卷.pdf",
        file_type="exam_pdf",
        total_pages_or_slides=2,
        total_chars=len(raw_exam_text),
        ocr_applied=True,
        oxr_engine_used=str(probe["selected_engine"]),
        oxr_probe_summary=str(probe["summary"]),
        raw_exam_text=raw_exam_text,
        chapters=[chap],
        all_assets=[],
    )


def _build_exam_blueprint(
    doc_ir: DocumentIR,
    direction: ExamDirectionType,
    user_requirements: str,
    questions_count: int = 6,
) -> StudyBlueprint:
    dir_labels = {
        "original_to_bank": "原卷转在线题库与解析",
        "similar_paper": "同风格变式新卷（A/B/C/D 四子 Agent）",
        "both": "原卷在线题库 + 同风格变式新卷双套生成",
    }
    return StudyBlueprint(
        blueprint_id=f"bp_exam_{uuid.uuid4().hex[:8]}",
        blueprint_title=f"{Path(doc_ir.filename).stem} · {dir_labels.get(direction, '试卷智能工作台')}",
        scenario_type="B_consolidate",
        preset_id=f"exam_{direction}",
        preset_name=dir_labels.get(direction, "试卷分析与变式命题"),
        parsed_intent_summary=(
            f"OXR 识别引擎：{doc_ir.oxr_engine_used or 'somark_free_api'}；生成方向：{dir_labels.get(direction)}；"
            f"定制需求：{user_requirements.strip() or '严格复刻原卷风格、难度梯度与设错逻辑'}"
        ),
        ai_feedback_message=doc_ir.oxr_probe_summary or "已完成 OXR 文本层提取。",
        target_difficulty="intermediate",
        selected_chapter_ids=[c.chapter_id for c in doc_ir.chapters] or ["exam_p1"],
        deliverables=DeliverableConfig(
            scenario_type="B_consolidate",
            selected_items=["comprehensive_test_paper"],
            include_study_guide_notes=True,
            include_cheatsheet=False,
            include_quiz=True,
            include_mindmap=False,
            quiz_mode="exam_paper",
            mcq_count=questions_count,
            fill_blank_count=0,
            short_answer_count=0,
            total_score=100,
            suggested_minutes=90,
        ),
        focus_topics=[],
        custom_instructions=user_requirements,
        confirmed=True,
    )


async def _run_original_exam_to_bank(
    doc_ir: DocumentIR,
    raw_exam_text: str,
    user_requirements: str,
    soul_path: Path,
    router: ModelRouter,
    progress_cb: ExamProgressCallback,
    start_pct: int = 10,
    end_pct: int = 45,
) -> Tuple[QuizPaper, str]:
    await _emit(
        progress_cb,
        stage="original_bank",
        agent_id="orig",
        soul_file=soul_path.name,
        percent=start_pct,
        message=f"正在上传 {soul_path.name} 与原卷文本层，构建原卷在线题库与深度解析...",
    )
    template = soul_path.read_text(encoding="utf-8") if soul_path.is_file() else ""
    prompt = _render_soul_template(
        template,
        {
            "raw_exam_text": raw_exam_text[:28000],
            "user_requirements": user_requirements.strip() or "无额外要求，忠实还原原卷并补全详细解析",
        },
    )

    data, label = await router.execute_json(
        "quiz_generation",
        "你是高精准原卷题库结构化主编，请严格按任务书（soul_original_bank.md 渲染版）规范输出合法 JSON 对象。",
        prompt,
    )
    if not isinstance(data, dict):
        raise RuntimeError(f"{label} 未返回有效的原卷题库 JSON 对象")

    raw_qs = data.get("questions") or []
    questions: List[QuizQuestion] = []
    for idx, q in enumerate(raw_qs, start=1):
        if not isinstance(q, dict):
            continue
        opts = _format_options_list(q.get("options"))
        qtype = _normalize_qtype(str(q.get("type") or ""), len(opts) > 0)
        diff = _normalize_difficulty(str(q.get("difficulty") or "medium"))
        tier = str(q.get("tier") or _difficulty_to_tier(diff))
        if tier not in ("基础达标", "能力提升", "拓展探究"):
            tier = _difficulty_to_tier(diff)
        tags = [str(t).strip() for t in (q.get("knowledge_tags") or []) if str(t).strip()]
        questions.append(
            QuizQuestion(
                id=str(q.get("id") or f"orig_{idx}"),
                type=qtype,  # type: ignore[arg-type]
                difficulty=diff,  # type: ignore[arg-type]
                tier=tier,  # type: ignore[arg-type]
                score=max(1, int(q.get("score") or 5)),
                question=normalize_markdown_math(str(q.get("question") or "").strip()),
                options=opts if qtype == "mcq" else [],
                answer=normalize_markdown_math(str(q.get("answer") or "").strip()),
                explanation=normalize_markdown_math(str(q.get("explanation") or "").strip()),
                source_chapter=tags[0] if tags else "原卷考点",
                source_page=str(q.get("source_page") or f"原卷第 {idx} 题"),
                knowledge_tags=tags,
            )
        )

    total_score = sum(q.score for q in questions) or int(data.get("total_score") or 100)
    paper = QuizPaper(
        paper_id="original_exam_bank",
        deliverable_type="original_exam_bank",
        title=str(data.get("paper_title") or f"{Path(doc_ir.filename).stem} · 原卷在线题库与解析"),
        mode="exam_paper",
        total_score=total_score,
        suggested_minutes=max(15, int(data.get("suggested_minutes") or 90)),
        instructions=str(data.get("instructions") or "本卷为 OXR 提取后生成的原卷在线互动题库与深度解析。"),
        questions=questions,
    )

    await _emit(
        progress_cb,
        stage="original_bank",
        agent_id="orig",
        soul_file=soul_path.name,
        percent=end_pct,
        message=f"✓ 原卷在线题库构建完成：已提取并解析 {len(questions)} 道原卷真题（通道 {label}）。",
    )
    return paper, label


def _coerce_style_profile(raw: Any, user_requirements: str) -> ExamAgentStyleProfile:
    if not isinstance(raw, dict):
        return ExamAgentStyleProfile(
            subject_and_level="学科综合评估测试",
            overall_difficulty="标准中档",
            tone_and_persona=ExamToneAndPersona(
                stem_style="题干表述严谨规范，结合核心概念与情境推理",
                phrasing_habits=["下列说法正确的是", "据此推导下列结论最合理的是"],
                option_length_style="四个选项结构对称、具有高区分度",
            ),
            formatting_rules="公式采用标准 LaTeX ($...$ / $$...$$)，图表采用 Markdown 表格",
            user_override_directives=[user_requirements.strip() or "严格保持原卷题型与难度分布"],
        )
    tone_raw = raw.get("tone_and_persona") if isinstance(raw.get("tone_and_persona"), dict) else {}
    return ExamAgentStyleProfile(
        subject_and_level=str(raw.get("subject_and_level") or "学科测试"),
        overall_difficulty=str(raw.get("overall_difficulty") or "标准中档"),
        tone_and_persona=ExamToneAndPersona(
            stem_style=str(tone_raw.get("stem_style") or ""),
            phrasing_habits=[str(x) for x in (tone_raw.get("phrasing_habits") or []) if str(x).strip()],
            option_length_style=str(tone_raw.get("option_length_style") or ""),
        ),
        formatting_rules=str(raw.get("formatting_rules") or ""),
        user_override_directives=[
            str(x) for x in (raw.get("user_override_directives") or []) if str(x).strip()
        ] or [user_requirements.strip() or "严格保持原卷题型与难度分布"],
    )


def _coerce_blueprints(raw: Any) -> List[ExamQuestionBlueprintItem]:
    raw_list: List[Any] = []
    if isinstance(raw, list):
        raw_list = raw
    elif isinstance(raw, dict):
        for key in ("blueprints", "questions", "items", "data"):
            if isinstance(raw.get(key), list):
                raw_list = raw[key]
                break
        if not raw_list and "question_id" in raw:
            raw_list = [raw]

    blueprints: List[ExamQuestionBlueprintItem] = []
    for idx, item in enumerate(raw_list, start=1):
        if not isinstance(item, dict):
            continue
        qid = int(item.get("question_id") or idx)
        recipes: List[ExamDistractorRecipeItem] = []
        for rec in item.get("distractor_recipe") or []:
            if isinstance(rec, dict):
                recipes.append(
                    ExamDistractorRecipeItem(
                        item=str(rec.get("item") or ""),
                        trap_type=str(rec.get("trap_type") or ""),
                        detail=str(rec.get("detail") or ""),
                    )
                )
        blueprints.append(
            ExamQuestionBlueprintItem(
                question_id=qid,
                target_question_type=str(item.get("target_question_type") or "单选题"),
                target_difficulty=str(item.get("target_difficulty") or "中档"),
                knowledge_points=[str(x) for x in (item.get("knowledge_points") or []) if str(x).strip()],
                original_skeleton=str(item.get("original_skeleton") or ""),
                distractor_recipe=recipes,
                assigned_strategies=[str(x) for x in (item.get("assigned_strategies") or []) if str(x).strip()]
                or ["CONTEXT_SHIFT", "TRAP_CLONE"],
                generation_directive=str(item.get("generation_directive") or ""),
            )
        )
    return blueprints


async def _run_four_agent_similar_paper(
    doc_ir: DocumentIR,
    raw_exam_text: str,
    user_requirements: str,
    soul_paths: Dict[str, Path],
    router: ModelRouter,
    progress_cb: ExamProgressCallback,
    base_pct: int = 8,
    end_pct: int = 96,
) -> Tuple[QuizPaper, ExamPipelineMetadata, str]:
    req_text = user_requirements.strip() or "若无额外定制需求，请严格复刻原卷风格、题型结构、难度梯度与设错艺术。"
    span = max(20, end_pct - base_pct)
    pct_a_start = base_pct
    pct_a_done = base_pct + int(span * 0.16)
    pct_b_done = base_pct + int(span * 0.34)
    pct_cd_end = base_pct + int(span * 0.94)

    soul_a_path = soul_paths["soul_a.md"]
    soul_b_path = soul_paths["soul_b.md"]
    soul_c_path = soul_paths["soul_c.md"]
    soul_d_path = soul_paths["soul_d.md"]

    # ==================== AGENT A: 风格鉴赏师 (Style Profile) ====================
    await _emit(
        progress_cb,
        stage="agent_a",
        agent_id="a",
        soul_file="soul_a.md",
        percent=pct_a_start,
        message="【Agent A · 风格鉴赏师】正在随任务上传 soul_a.md 与原卷文本层，提炼命题风格指纹...",
    )
    soul_a_tpl = soul_a_path.read_text(encoding="utf-8")
    prompt_a = _render_soul_template(
        soul_a_tpl,
        {
            "raw_exam_text": raw_exam_text[:28000],
            "user_requirements": req_text,
        },
    )
    raw_a, label_a = await router.execute_json(
        "requirement_negotiation",
        "你是 Agent A 风格鉴赏师，请严格按任务书（soul_a.md 渲染版）要求输出合法 JSON 对象。",
        prompt_a,
    )
    style_profile = _coerce_style_profile(raw_a, user_requirements)
    style_json_str = style_profile.model_dump_json(indent=2)
    await _emit(
        progress_cb,
        stage="agent_a",
        agent_id="a",
        soul_file="soul_a.md",
        percent=pct_a_done,
        message=(
            f"✓ 【Agent A】完成风格提取：{style_profile.subject_and_level} · "
            f"{style_profile.overall_difficulty}（{label_a}）"
        ),
        detail={"style_profile": style_profile.model_dump()},
    )

    router.check_cancelled()

    # ==================== AGENT B: 命题架构师 (3D Deconstruction & Strategies) ====================
    await _emit(
        progress_cb,
        stage="agent_b",
        agent_id="b",
        soul_file="soul_b.md",
        percent=pct_a_done + 2,
        message="【Agent B · 命题架构师】正在随任务上传 soul_b.md，三维解构原卷试题并分配 6 大变异策略...",
    )
    soul_b_tpl = soul_b_path.read_text(encoding="utf-8")
    prompt_b = _render_soul_template(
        soul_b_tpl,
        {
            "raw_exam_text": raw_exam_text[:28000],
            "user_requirements": req_text,
        },
    )
    raw_b, label_b = await router.execute_json(
        "notes_and_cheatsheet",
        "你是 Agent B 命题架构师，请严格按任务书（soul_b.md 渲染版）要求输出合法 JSON 数组。",
        prompt_b,
    )
    blueprints = _coerce_blueprints(raw_b)
    if not blueprints:
        raise RuntimeError(f"Agent B ({label_b}) 未从原卷中解构出有效的单题蓝图数组")

    await _emit(
        progress_cb,
        stage="agent_b",
        agent_id="b",
        soul_file="soul_b.md",
        percent=pct_b_done,
        message=f"✓ 【Agent B】完成 {len(blueprints)} 道原卷题目的三维解构与变异蓝图指派（{label_b}），即将启动 Agent C ⇄ Agent D 并发命题与盲测闭环...",
        detail={"blueprint_count": len(blueprints)},
    )

    router.check_cancelled()

    # ==================== AGENT C (全卷先命制完成) -> AGENT D (全卷独立盲测与按需打回重写) ====================
    soul_c_tpl = soul_c_path.read_text(encoding="utf-8")
    soul_d_tpl = soul_d_path.read_text(encoding="utf-8")
    sem = asyncio.Semaphore(3)
    progress_lock = asyncio.Lock()
    total_bp = len(blueprints)

    cd_span = max(6, pct_cd_end - pct_b_done)
    pct_c1_done = pct_b_done + int(cd_span * 0.45)
    pct_d1_done = pct_b_done + int(cd_span * 0.82)

    current_items: Dict[int, ExamGeneratedQuestionItem] = {}
    reviews_by_idx: Dict[int, List[ExamBlindReviewResult]] = {i: [] for i in range(total_bp)}
    defects_by_idx: Dict[int, Optional[str]] = {i: None for i in range(total_bp)}
    pending_indices: List[int] = list(range(total_bp))

    max_attempts = 3
    for attempt in range(1, max_attempts + 1):
        if not pending_indices:
            break
        router.check_cancelled()
        batch_indices = list(pending_indices)
        batch_total = len(batch_indices)

        if attempt == 1:
            c_start_pct, c_end_pct = pct_b_done, pct_c1_done
            d_start_pct, d_end_pct = pct_c1_done, pct_d1_done
        else:
            rem_span = max(2, pct_cd_end - pct_d1_done)
            rounds_total = max(1, max_attempts - 1)
            r_start = pct_d1_done + int(rem_span * ((attempt - 2) / rounds_total))
            r_end = pct_d1_done + int(rem_span * ((attempt - 1) / rounds_total))
            r_mid = r_start + max(1, int((r_end - r_start) * 0.5))
            c_start_pct, c_end_pct = r_start, r_mid
            d_start_pct, d_end_pct = r_mid, r_end

        # ---------- Phase C: 全卷初稿 / 批量重写 ----------
        await _emit(
            progress_cb,
            stage="agent_c",
            agent_id="c",
            soul_file="soul_c.md",
            percent=c_start_pct,
            message=(
                f"【Agent C · 逆向命题】已随任务上传 soul_c.md，正在命制全卷 {total_bp} 道试题初稿..."
                if attempt == 1
                else f"【Agent C · 逆向命题】正在对盲测未通过的 {batch_total} 道试题执行第 {attempt} 轮靶向重写..."
            ),
            detail={"attempt": attempt, "status": "generating" if attempt == 1 else "retry"},
        )

        c_done = 0

        async def run_agent_c_one(idx: int) -> bool:
            nonlocal c_done
            bp = blueprints[idx]
            async with sem:
                router.check_cancelled()
                prompt_c = _render_soul_template(
                    soul_c_tpl,
                    {
                        "style_profile": style_json_str,
                        "question_blueprint": bp.model_dump_json(indent=2),
                        "defect_report": defects_by_idx[idx] or "null",
                        "question_id": str(bp.question_id),
                    },
                )
                raw_c, _label_c = await router.execute_json(
                    "quiz_generation",
                    "你是 Agent C 逆向命题专家，必须严格遵循任务书（soul_c.md 渲染版）的 Execution Steps 顺序输出合法 JSON。",
                    prompt_c,
                )
                if not isinstance(raw_c, dict):
                    defects_by_idx[idx] = (
                        f"Agent C 第 {attempt} 轮输出不是合法单题 JSON 对象，请严格按 Output Format 重写。"
                    )
                    async with progress_lock:
                        c_done += 1
                    return False

                raw_options = raw_c.get("options")
                norm_opts_dict: Optional[Dict[str, str]] = None
                if isinstance(raw_options, dict) and raw_options:
                    norm_opts_dict = {
                        str(k).strip().upper()[:1]: normalize_markdown_math(str(v or "").strip())
                        for k, v in raw_options.items()
                        if str(v or "").strip()
                    }
                elif isinstance(raw_options, list) and raw_options:
                    norm_opts_dict = {
                        chr(65 + i): normalize_markdown_math(
                            re.sub(r"^[A-Ha-h][.、:：\s]+", "", str(v or "").strip())
                        )
                        for i, v in enumerate(raw_options)
                        if str(v or "").strip()
                    }

                c_item = ExamGeneratedQuestionItem(
                    question_id=int(raw_c.get("question_id") or bp.question_id),
                    question_type=str(raw_c.get("question_type") or bp.target_question_type or "单选题"),
                    knowledge_tags=[
                        str(x) for x in (raw_c.get("knowledge_tags") or bp.knowledge_points) if str(x).strip()
                    ],
                    applied_strategies=[
                        str(x) for x in (raw_c.get("applied_strategies") or bp.assigned_strategies) if str(x).strip()
                    ],
                    reverse_design=normalize_markdown_math(str(raw_c.get("reverse_design") or "").strip()),
                    correct_answer=normalize_markdown_math(str(raw_c.get("correct_answer") or "").strip()),
                    detailed_analysis=normalize_markdown_math(str(raw_c.get("detailed_analysis") or "").strip()),
                    stem=normalize_markdown_math(str(raw_c.get("stem") or "").strip()),
                    options=norm_opts_dict,
                )
                current_items[idx] = c_item

                async with progress_lock:
                    c_done += 1
                    cur_pct = c_start_pct + int((c_end_pct - c_start_pct) * (c_done / max(1, batch_total)))
                    await _emit(
                        progress_cb,
                        stage="agent_c",
                        agent_id="c",
                        soul_file="soul_c.md",
                        percent=cur_pct,
                        message=(
                            f"【Agent C · 逆向命题】第 {bp.question_id} 题初稿命制完成（全卷命制进度 {c_done}/{batch_total}）"
                            if attempt == 1
                            else f"【Agent C · 逆向命题】第 {bp.question_id} 题第 {attempt} 轮重写完成（重写进度 {c_done}/{batch_total}）"
                        ),
                        detail={"question_id": bp.question_id, "attempt": attempt, "status": "generating"},
                    )
                return True

        c_results = await asyncio.gather(*(run_agent_c_one(idx) for idx in batch_indices))
        router.check_cancelled()

        await _emit(
            progress_cb,
            stage="agent_c",
            agent_id="c",
            soul_file="soul_c.md",
            percent=c_end_pct,
            message=(
                f"✓ 【Agent C】全卷 {total_bp} 道试题初稿命制全部完成，移交 Agent D 启动全卷盲测..."
                if attempt == 1
                else f"✓ 【Agent C】第 {attempt} 轮 {batch_total} 道试题重写完成，移交 Agent D 复测..."
            ),
            detail={"attempt": attempt, "status": "done"},
        )

        # ---------- Phase D: 全卷统一盲测（严格隐去标准答案与解析） ----------
        await _emit(
            progress_cb,
            stage="agent_d",
            agent_id="d",
            soul_file="soul_d.md",
            percent=d_start_pct,
            message=(
                f"【Agent D · 盲测 Critic】已上传 soul_d.md（隐去标准答案与解析），开始对全卷 {total_bp} 道试题执行独立盲测..."
                if attempt == 1
                else f"【Agent D · 盲测 Critic】正在对重写后的 {batch_total} 道试题执行第 {attempt} 轮独立盲测..."
            ),
            detail={"attempt": attempt, "status": "blind_testing"},
        )

        d_done = 0

        async def run_agent_d_one(idx: int, drafted_ok: bool) -> bool:
            nonlocal d_done
            bp = blueprints[idx]
            if not drafted_ok or idx not in current_items:
                review_item = ExamBlindReviewResult(
                    question_id=bp.question_id,
                    attempt=attempt,
                    reasoning_process="Agent C 本轮未输出合法单题 JSON",
                    my_answer="",
                    expected_answer="",
                    is_valid=False,
                    passed=False,
                    defect_report=defects_by_idx[idx] or "Agent C 输出格式异常，待重写。",
                )
                reviews_by_idx[idx].append(review_item)
                async with progress_lock:
                    d_done += 1
                    cur_pct = d_start_pct + int((d_end_pct - d_start_pct) * (d_done / max(1, batch_total)))
                    await _emit(
                        progress_cb,
                        stage="agent_d",
                        agent_id="d",
                        soul_file="soul_d.md",
                        percent=cur_pct,
                        message=(
                            f"🔄 第 {bp.question_id} 题第 {attempt} 轮盲测未通过，已生成 defect_report 待打回重写（盲测进度 {d_done}/{batch_total}）"
                            if attempt < max_attempts
                            else f"⚠️ 第 {bp.question_id} 题已完成 {max_attempts} 轮盲测校验并收录（盲测进度 {d_done}/{batch_total}）"
                        ),
                        detail={
                            "question_id": bp.question_id,
                            "attempt": attempt,
                            "status": "retry" if attempt < max_attempts else "reviewed_fallback",
                        },
                    )
                return False

            c_item = current_items[idx]
            async with sem:
                router.check_cancelled()
                # STRICT BLIND ISOLATION: ONLY question_type, stem, options are sent to Agent D!
                # correct_answer, detailed_analysis, and reverse_design are NEVER sent to Agent D.
                blind_options_str = (
                    json.dumps(c_item.options, ensure_ascii=False, indent=2) if c_item.options else "null"
                )
                prompt_d = _render_soul_template(
                    soul_d_tpl,
                    {
                        "question_type": c_item.question_type,
                        "stem": c_item.stem,
                        "options": blind_options_str,
                    },
                )
                raw_d, _label_d = await router.execute_json(
                    "global_quality_audit",
                    "你是 Agent D 盲测审题专家，仅依据题干与选项独立推导答案并严格按任务书（soul_d.md 渲染版）输出 JSON。",
                    prompt_d,
                )

                if not isinstance(raw_d, dict):
                    defects_by_idx[idx] = "Agent D 盲测解析失败，视为待重构题目，触发 Agent C 重写。"
                    review_item = ExamBlindReviewResult(
                        question_id=bp.question_id,
                        attempt=attempt,
                        reasoning_process="Agent D 输出格式非合法 JSON",
                        my_answer="",
                        expected_answer=c_item.correct_answer,
                        is_valid=False,
                        passed=False,
                        defect_report=defects_by_idx[idx],
                    )
                    reviews_by_idx[idx].append(review_item)
                    passed = False
                else:
                    is_valid = bool(raw_d.get("is_valid", False))
                    my_answer = normalize_markdown_math(str(raw_d.get("my_answer") or "").strip())
                    reasoning = normalize_markdown_math(str(raw_d.get("reasoning_process") or "").strip())
                    raw_defect = raw_d.get("defect_report")
                    defect_str = str(raw_defect).strip() if raw_defect not in (None, "", "null", "None") else ""

                    matched = _blind_answers_match(
                        c_item.question_type, c_item.options, c_item.correct_answer, my_answer
                    )
                    passed = is_valid and matched

                    combined_defect: Optional[str] = None
                    if not passed:
                        reasons: List[str] = []
                        if not is_valid:
                            reasons.append(defect_str or "盲测审题指出题干存在逻辑或条件缺陷 (is_valid=false)")
                        if not matched:
                            reasons.append(
                                f"盲测答案不一致：命题预设答案为「{c_item.correct_answer}」，但 Agent D 独立盲算得出「{my_answer or '无解'}」。"
                            )
                        if reasoning:
                            reasons.append(f"盲测独立推导过程摘要：{reasoning[:260]}")
                        combined_defect = "；".join(reasons)
                    defects_by_idx[idx] = combined_defect

                    review_item = ExamBlindReviewResult(
                        question_id=bp.question_id,
                        attempt=attempt,
                        reasoning_process=reasoning,
                        my_answer=my_answer,
                        expected_answer=c_item.correct_answer,
                        is_valid=is_valid,
                        passed=passed,
                        defect_report=combined_defect,
                    )
                    reviews_by_idx[idx].append(review_item)

                async with progress_lock:
                    d_done += 1
                    cur_pct = d_start_pct + int((d_end_pct - d_start_pct) * (d_done / max(1, batch_total)))
                    if passed:
                        await _emit(
                            progress_cb,
                            stage="agent_d",
                            agent_id="d",
                            soul_file="soul_d.md",
                            percent=cur_pct,
                            message=f"✅ 第 {bp.question_id} 题盲测校验通过（第 {attempt} 轮盲测进度 {d_done}/{batch_total}）",
                            detail={"question_id": bp.question_id, "attempt": attempt, "status": "passed"},
                        )
                    elif attempt < max_attempts:
                        await _emit(
                            progress_cb,
                            stage="agent_d",
                            agent_id="d",
                            soul_file="soul_d.md",
                            percent=cur_pct,
                            message=f"🔄 第 {bp.question_id} 题第 {attempt} 轮盲测未通过，已生成 defect_report 待打回重写（盲测进度 {d_done}/{batch_total}）",
                            detail={"question_id": bp.question_id, "attempt": attempt, "status": "retry"},
                        )
                    else:
                        await _emit(
                            progress_cb,
                            stage="agent_d",
                            agent_id="d",
                            soul_file="soul_d.md",
                            percent=cur_pct,
                            message=f"⚠️ 第 {bp.question_id} 题已完成 {max_attempts} 轮盲测校验并收录（盲测进度 {d_done}/{batch_total}）",
                            detail={"question_id": bp.question_id, "attempt": max_attempts, "status": "reviewed_fallback"},
                        )
                return passed

        d_passed_flags = await asyncio.gather(
            *(run_agent_d_one(idx, ok) for idx, ok in zip(batch_indices, c_results))
        )
        pending_indices = [idx for idx, ok in zip(batch_indices, d_passed_flags) if not ok]

    results: List[Tuple[ExamGeneratedQuestionItem, List[ExamBlindReviewResult]]] = []
    for idx, bp in enumerate(blueprints):
        item = current_items.get(idx)
        if item is None:
            item = ExamGeneratedQuestionItem(
                question_id=bp.question_id,
                question_type=bp.target_question_type,
                knowledge_tags=bp.knowledge_points,
                applied_strategies=bp.assigned_strategies,
                reverse_design="重试生成未返回合法 JSON",
                correct_answer="见解析",
                detailed_analysis=defects_by_idx[idx] or "请结合原卷考点手动复核本题。",
                stem=f"围绕考点【{'、'.join(bp.knowledge_points) or '核心考点'}】的综合变式题：{bp.generation_directive}",
                options=None,
            )
        results.append((item, reviews_by_idx[idx]))

    generated_items: List[ExamGeneratedQuestionItem] = []
    all_reviews: List[ExamBlindReviewResult] = []
    quiz_questions: List[QuizQuestion] = []

    for bp, (c_item, q_reviews) in zip(blueprints, results):
        generated_items.append(c_item)
        all_reviews.extend(q_reviews)
        final_rev = q_reviews[-1] if q_reviews else None
        opts_list = _format_options_list(c_item.options)
        qtype = _normalize_qtype(c_item.question_type, len(opts_list) > 0)
        diff = _normalize_difficulty(bp.target_difficulty)
        tier = _difficulty_to_tier(diff)
        score = 10 if qtype == "short_answer" else 5

        if final_rev and final_rev.passed:
            review_note = f"✅ Agent D 第 {final_rev.attempt} 轮独立盲测校验通过"
        elif final_rev:
            review_note = f"⚠️ 历经 {final_rev.attempt} 轮 Agent C⇄D 盲测对抗校准"
        else:
            review_note = "已完成逆向命题与风格校验"

        quiz_questions.append(
            QuizQuestion(
                id=f"sim_{c_item.question_id}",
                type=qtype,  # type: ignore[arg-type]
                difficulty=diff,  # type: ignore[arg-type]
                tier=tier,  # type: ignore[arg-type]
                score=score,
                question=c_item.stem,
                options=opts_list if qtype == "mcq" else [],
                answer=c_item.correct_answer,
                explanation=c_item.detailed_analysis,
                source_chapter=c_item.knowledge_tags[0] if c_item.knowledge_tags else "风格变式命题",
                source_page=f"对应原卷第 {bp.question_id} 题",
                knowledge_tags=c_item.knowledge_tags,
                applied_strategies=c_item.applied_strategies,
                reverse_design=c_item.reverse_design,
                blind_review_summary=review_note,
            )
        )

    total_score = sum(q.score for q in quiz_questions) or 100
    similar_paper = QuizPaper(
        paper_id="similar_style_paper",
        deliverable_type="similar_style_paper",
        title=f"{Path(doc_ir.filename).stem} · 同风格高保真变式新卷",
        mode="exam_paper",
        total_score=total_score,
        suggested_minutes=90,
        instructions=(
            f"命题学科/学段：{style_profile.subject_and_level} ｜ 难度基调：{style_profile.overall_difficulty} ｜ "
            f"已由 A/B/C/D 四子 Agent 完成风格抽取、逆向命题与盲测校验。"
        ),
        questions=quiz_questions,
    )

    passed_count = sum(1 for item_revs in [r for _, r in results] if item_revs and item_revs[-1].passed)
    summary_md = _format_exam_knowledge_notes_markdown(
        doc_ir=doc_ir,
        user_requirements=req_text,
        style_profile=style_profile,
        blueprints=blueprints,
        generated_items=generated_items,
        all_reviews=all_reviews,
        passed_count=passed_count,
        primary_paper=similar_paper,
    )

    metadata = ExamPipelineMetadata(
        direction="similar_paper",
        user_requirements=req_text,
        oxr_engine_used=doc_ir.oxr_engine_used,
        oxr_probe_summary=doc_ir.oxr_probe_summary,
        soul_files_uploaded=["soul_a.md", "soul_b.md", "soul_c.md", "soul_d.md"],
        style_profile=style_profile,
        question_blueprints=blueprints,
        generated_items=generated_items,
        blind_reviews=all_reviews,
    )

    await _emit(
        progress_cb,
        stage="finalize",
        agent_id="d",
        soul_file="soul_d.md",
        percent=end_pct,
        message=f"🎉 四子 Agent 同风格新卷组卷完成！共 {len(quiz_questions)} 题（一次/重写盲测通过 {passed_count}/{len(quiz_questions)} 题）",
    )
    return similar_paper, metadata, summary_md


def _collect_exam_knowledge_hints(
    doc_ir: DocumentIR,
    *,
    blueprints: Optional[List[ExamQuestionBlueprintItem]] = None,
    papers: Optional[List[Optional[QuizPaper]]] = None,
) -> List[str]:
    """Extract deduplicated core topic names from blueprints, paper tags, and document terms."""
    seen_norm: set[str] = set()
    topics: List[str] = []

    def _add(raw_topic: str) -> None:
        t = re.sub(r"\s+", " ", (raw_topic or "").strip())
        if not t or len(t) < 2:
            return
        key = re.sub(r"[\s_\-，,。.；;:：]+", "", t).lower()
        if key in seen_norm:
            return
        seen_norm.add(key)
        topics.append(t)

    for bp in blueprints or []:
        for kp in bp.knowledge_points:
            _add(kp)
    for paper in papers or []:
        if not paper:
            continue
        for q in paper.questions:
            for tag in q.knowledge_tags:
                _add(tag)
            if not q.knowledge_tags and q.source_chapter:
                _add(q.source_chapter)
    for ch in doc_ir.chapters:
        for term in ch.key_terms[:12]:
            _add(term)

    return topics[:24]


def _format_exam_knowledge_notes_markdown(
    doc_ir: DocumentIR,
    user_requirements: str,
    *,
    style_profile: Optional[ExamAgentStyleProfile] = None,
    blueprints: Optional[List[ExamQuestionBlueprintItem]] = None,
    generated_items: Optional[List[ExamGeneratedQuestionItem]] = None,
    all_reviews: Optional[List[ExamBlindReviewResult]] = None,
    passed_count: int = 0,
    primary_paper: Optional[QuizPaper] = None,
    original_paper: Optional[QuizPaper] = None,
) -> str:
    """Fallback thematic knowledge guide organized by subject topics (without exposing internal agent traces)."""
    topics = _collect_exam_knowledge_hints(
        doc_ir,
        blueprints=blueprints,
        papers=[original_paper, primary_paper],
    )
    lines: List[str] = [
        f"# 试卷核心知识点提取与深度精讲 · 《{Path(doc_ir.filename).stem}》",
        "",
    ]
    if style_profile:
        lines.extend([
            "## 一、学科定位与核心知识框架",
            f"- **学科与考查层次**：{style_profile.subject_and_level}",
            f"- **整体难度基调**：{style_profile.overall_difficulty}",
        ])
        if user_requirements.strip():
            lines.append(f"- **专项强化方向**：{user_requirements.strip()}")
        lines.append("")

    if topics:
        lines.extend([
            "## 二、核心知识专题与机理要点梳理",
            "| 核心知识专题 | 重点掌握维度 | 典型考法定位 |",
            "| --- | --- | --- |",
        ])
        for tp in topics[:12]:
            clean_tp = tp.replace("|", "｜")
            lines.append(f"| {clean_tp} | 概念本质、核心公式/机制及适用边界 | 机理辨析 / 条件推导 |")
        lines.append("")

    # Group conceptual points cleanly by knowledge topic rather than printing Agent A/B/C/D dumps
    topic_details: Dict[str, List[str]] = {}
    for q in ((original_paper.questions if original_paper else None) or (primary_paper.questions if primary_paper else None) or []):
        topic_name = q.knowledge_tags[0] if q.knowledge_tags else (q.source_chapter or "核心专题")
        exp_clean = re.sub(r"\s+", " ", (q.explanation or "").strip())
        if exp_clean:
            topic_details.setdefault(topic_name, []).append(exp_clean)

    for idx, (t_name, notes_list) in enumerate(topic_details.items(), start=1):
        lines.append(f"### 专题 {idx}：{t_name}")
        for note in notes_list[:2]:
            lines.append(f"- **【原理与思路精讲】**：{note}")
        lines.append("")

    if not topic_details and blueprints:
        for idx, bp in enumerate(blueprints, start=1):
            t_name = "、".join(bp.knowledge_points) or f"核心专题 {idx}"
            lines.append(f"### 专题 {idx}：{t_name}")
            if bp.original_skeleton:
                lines.append(f"- **【核心推导主线】**：{bp.original_skeleton}")
            lines.append("")

    return "\n".join(lines).strip()


def _strip_outer_markdown_fence(text: str) -> str:
    s = (text or "").strip()
    m = re.fullmatch(r"```(?:markdown|md)?\s*([\s\S]*?)\s*```", s, re.IGNORECASE)
    return m.group(1).strip() if m else s


async def _run_exam_knowledge_notes_generation(
    doc_ir: DocumentIR,
    raw_exam_text: str,
    user_requirements: str,
    soul_path: Path,
    router: ModelRouter,
    *,
    style_profile: Optional[ExamAgentStyleProfile] = None,
    blueprints: Optional[List[ExamQuestionBlueprintItem]] = None,
    primary_paper: Optional[QuizPaper] = None,
    original_paper: Optional[QuizPaper] = None,
    progress_cb: ExamProgressCallback = None,
    start_pct: int = 84,
    end_pct: int = 97,
) -> Tuple[str, Optional[str]]:
    """Run a dedicated AI knowledge-extraction & teaching guide pass from the exam paper."""
    topics = _collect_exam_knowledge_hints(
        doc_ir,
        blueprints=blueprints,
        papers=[original_paper, primary_paper],
    )
    hint_lines: List[str] = []
    if style_profile:
        hint_lines.append(f"- 学科与学段：{style_profile.subject_and_level}（{style_profile.overall_difficulty}）")
    if topics:
        hint_lines.append("- 已识别需全部覆盖的核心考点：" + "、".join(topics))
    if not hint_lines:
        hint_lines.append("- 请直接从原卷全部试题中提取所有考查知识点并合并归纳成知识专题。")

    execute_text_fn = getattr(router, "execute_text", None)
    if callable(execute_text_fn) and soul_path.is_file():
        await _emit(
            progress_cb,
            stage="knowledge_notes",
            soul_file=soul_path.name,
            percent=start_pct,
            message="正在深入提取试卷底层知识体系并编写《知识点提取与深度精讲》专题讲义...",
        )
        template = soul_path.read_text(encoding="utf-8")
        prompt = _render_soul_template(
            template,
            {
                "raw_exam_text": raw_exam_text[:28000],
                "knowledge_points_hint": "\n".join(hint_lines),
                "user_requirements": user_requirements.strip() or "围绕试卷全部考点进行深度原理剖析、公式推导与易混对比",
            },
        )
        try:
            raw_md, label = await execute_text_fn(
                "notes_and_cheatsheet",
                (
                    "你是资深学科主讲教授。请严格遵循随任务附带的 soul_knowledge_notes.md，"
                    "直接输出面向学生的专题化《试卷核心知识点提取与深度精讲》Markdown 讲义。"
                    "严禁罗列命题流水账、严禁提及任何 Agent 名称或按题号抄答案。"
                ),
                prompt,
            )
            cleaned = _strip_outer_markdown_fence(raw_md or "")
            if len(cleaned) >= 120:
                await _emit(
                    progress_cb,
                    stage="knowledge_notes",
                    soul_file=soul_path.name,
                    percent=end_pct,
                    message=f"✓ 《知识点提取与深度精讲》专题讲义编写完成（通道 {label}）。",
                )
                return cleaned, label
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await _emit(
                progress_cb,
                stage="knowledge_notes",
                soul_file=soul_path.name,
                percent=end_pct,
                message=f"⚠️ 专题讲义独立提炼通道异常 ({str(exc)[:60]})，已切换为专题归纳兜底模式。",
            )

    fallback_md = _format_exam_knowledge_notes_markdown(
        doc_ir=doc_ir,
        user_requirements=user_requirements,
        style_profile=style_profile,
        blueprints=blueprints,
        primary_paper=primary_paper,
        original_paper=original_paper,
    )
    return fallback_md, None


async def generate_exam_study_package(
    doc_ir: DocumentIR,
    direction: ExamDirectionType,
    user_requirements: str,
    project_dir: Path,
    router: ModelRouter,
    raw_exam_text_override: Optional[str] = None,
    progress_cb: ExamProgressCallback = None,
) -> StudyPackage:
    """Execute Direction 1 (original_to_bank), Direction 2 (similar_paper via A/B/C/D), or Direction 3 (both)."""
    raw_text = (raw_exam_text_override or doc_ir.raw_exam_text or "").strip()
    if not raw_text:
        raw_text = "\n\n".join(c.content_text for c in doc_ir.chapters if c.content_text.strip()).strip()
    if not raw_text:
        raise ValueError("当前试卷尚未提取到有效文本内容，请重新执行 OXR 识别或补充文本。")

    soul_paths = _ensure_project_soul_files(project_dir)

    await _emit(
        progress_cb,
        stage="init",
        percent=4,
        message=f"已装载试卷文本层（{len(raw_text):,} 字）及对应 Agent soul.md 任务文件，开始调度...",
    )

    orig_paper: Optional[QuizPaper] = None
    similar_paper: Optional[QuizPaper] = None
    metadata: Optional[ExamPipelineMetadata] = None
    soul_files_uploaded: List[str] = []

    if direction == "original_to_bank":
        soul_files_uploaded = [SOUL_ORIGINAL_FILENAME]
        orig_paper, _orig_label = await _run_original_exam_to_bank(
            doc_ir, raw_text, user_requirements, soul_paths[SOUL_ORIGINAL_FILENAME], router, progress_cb, 8, 76
        )
        metadata = ExamPipelineMetadata(
            direction="original_to_bank",
            user_requirements=user_requirements,
            oxr_engine_used=doc_ir.oxr_engine_used,
            oxr_probe_summary=doc_ir.oxr_probe_summary,
            soul_files_uploaded=soul_files_uploaded,
        )
        main_paper = orig_paper
        extra_papers: List[QuizPaper] = []

    elif direction == "similar_paper":
        soul_files_uploaded = ["soul_a.md", "soul_b.md", "soul_c.md", "soul_d.md"]
        similar_paper, metadata, _ = await _run_four_agent_similar_paper(
            doc_ir, raw_text, user_requirements, soul_paths, router, progress_cb, 8, 80
        )
        main_paper = similar_paper
        extra_papers = []

    else:  # direction == "both"
        soul_files_uploaded = [SOUL_ORIGINAL_FILENAME, "soul_a.md", "soul_b.md", "soul_c.md", "soul_d.md"]
        orig_paper, _orig_label = await _run_original_exam_to_bank(
            doc_ir, raw_text, user_requirements, soul_paths[SOUL_ORIGINAL_FILENAME], router, progress_cb, 8, 28
        )
        router.check_cancelled()
        similar_paper, metadata, _ = await _run_four_agent_similar_paper(
            doc_ir, raw_text, user_requirements, soul_paths, router, progress_cb, 30, 82
        )
        metadata = metadata.model_copy(
            update={
                "direction": "both",
                "soul_files_uploaded": soul_files_uploaded,
            }
        )
        main_paper = similar_paper
        extra_papers = [orig_paper]

    router.check_cancelled()
    notes_md, notes_label = await _run_exam_knowledge_notes_generation(
        doc_ir,
        raw_text,
        user_requirements,
        soul_paths[SOUL_KNOWLEDGE_NOTES_FILENAME],
        router,
        style_profile=metadata.style_profile if metadata else None,
        blueprints=metadata.question_blueprints if metadata else None,
        primary_paper=main_paper,
        original_paper=orig_paper,
        progress_cb=progress_cb,
        start_pct=84,
        end_pct=97,
    )
    if notes_label and metadata:
        soul_files_uploaded.append(SOUL_KNOWLEDGE_NOTES_FILENAME)
        metadata = metadata.model_copy(update={"soul_files_uploaded": soul_files_uploaded})

    blueprint_used = _build_exam_blueprint(
        doc_ir, direction, user_requirements, questions_count=len(main_paper.questions)
    )
    flashcards = _build_exam_knowledge_flashcards(doc_ir, metadata, main_paper)

    await _emit(
        progress_cb,
        stage="done",
        percent=100,
        message="🎉 试卷生成流程全部完成，正在进入在线题库与打印工作台...",
    )

    return StudyPackage(
        project_id=doc_ir.project_id,
        blueprint_used=blueprint_used,
        routing_trace=router.routing_trace,
        quality_audit_report=metadata.oxr_probe_summary if metadata else "",
        study_notes_markdown=normalize_markdown_math(notes_md),
        cheatsheet_markdown="",
        quiz_paper=main_paper,
        extra_quiz_papers=extra_papers,
        flashcards=flashcards,
        mindmap_mermaid="",
        exam_pipeline_metadata=metadata,
    )


def _build_exam_knowledge_flashcards(
    doc_ir: DocumentIR,
    metadata: Optional[ExamPipelineMetadata],
    main_paper: QuizPaper,
) -> List[KnowledgeFlashcard]:
    """Generate dedicated knowledge-point & trap-mechanism flashcards from exam blueprints and tags."""
    cards: List[KnowledgeFlashcard] = []
    seen_kp: set[str] = set()

    if metadata and metadata.question_blueprints:
        for bp in metadata.question_blueprints:
            kp_label = " / ".join([k.strip() for k in bp.knowledge_points if k.strip()]) or f"原卷第 {bp.question_id} 题考点"
            norm_k = re.sub(r"\s+", "", kp_label).lower()[:48]
            if norm_k in seen_kp:
                continue
            seen_kp.add(norm_k)

            trap_lines: List[str] = []
            for r in bp.distractor_recipe:
                if r.trap_type or r.detail:
                    trap_lines.append(f"- **{r.trap_type or '干扰陷阱'}**：{r.detail}".strip())
            exp_parts: List[str] = []
            if bp.generation_directive:
                exp_parts.append(f"**命题与思维切入要点：** {bp.generation_directive}")
            if trap_lines:
                exp_parts.append("**常见干扰陷阱与避坑提示：**\n" + "\n".join(trap_lines))

            cards.append(
                KnowledgeFlashcard(
                    id=f"kf_exam_{bp.question_id}",
                    category="高频考点与避坑",
                    front=normalize_markdown_math(
                        f"**【核心考点回忆】** 请阐述「{kp_label}」的核心推导机制，并指出该考点常见的命题设错陷阱。"
                    ),
                    answer=normalize_markdown_math(
                        bp.original_skeleton or f"围绕「{kp_label}」构建正向因果链路"
                    ),
                    explanation=normalize_markdown_math("\n\n".join(exp_parts)),
                    source=f"Agent B 解构 · 原卷第 {bp.question_id} 题考点",
                )
            )

    if len(cards) < 6:
        extra = extract_knowledge_flashcards(doc_ir, "", "", main_paper, max_cards=18 - len(cards))
        for item in extra:
            cards.append(
                KnowledgeFlashcard(
                    id=f"kf_sup_{len(cards) + 1}",
                    category=item.category,
                    front=item.front,
                    answer=item.answer,
                    explanation=item.explanation,
                    source=item.source,
                )
            )

    return cards[:18]
