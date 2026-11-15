from __future__ import annotations

import re
import uuid
from typing import List, Optional

from app.schemas import (
    ChapterNode,
    DeliverableConfig,
    DocumentIR,
    PresetTemplate,
    QuizPaper,
    QuizQuestion,
    StudyBlueprint,
    difficulty_label,
)


def _extract_sentences_and_points(chapter: ChapterNode) -> List[str]:
    lines = []
    for raw in chapter.content_text.splitlines():
        clean = raw.strip().lstrip("-*•# ").strip()
        if not clean or clean.startswith("[第") or clean.startswith("| ---") or clean.startswith(">"):
            continue
        if len(clean) >= 12:
            lines.append(clean)
    return lines


def _extract_definitions(chapter: ChapterNode) -> List[tuple[str, str]]:
    defs: List[tuple[str, str]] = []
    for raw in chapter.content_text.splitlines():
        clean = raw.strip().lstrip("-*•# ").strip()
        if "：" in clean:
            k, v = clean.split("：", 1)
        elif ":" in clean and not clean.startswith("http"):
            k, v = clean.split(":", 1)
        else:
            continue
        k = k.strip(" *`[]")
        v = v.strip()
        if 2 <= len(k) <= 28 and len(v) >= 6 and not k.startswith("Slide"):
            defs.append((k, v))
    return defs


def _sanitize_mermaid_label(text: str) -> str:
    cleaned = re.sub(r"[\"'`()\[\]{}<>|;]", " ", text)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:42] or "知识点"


class HeuristicStudyEngine:
    """Content-grounded local study synthesizer for offline preview or fallback."""

    @staticmethod
    def build_blueprint_from_ir(
        document_ir: DocumentIR,
        preset: PresetTemplate,
        user_prompt: str = "",
        current_blueprint: Optional[StudyBlueprint] = None,
    ) -> StudyBlueprint:
        chapters = document_ir.chapters
        all_ids = [c.chapter_id for c in chapters]
        selected_ids = (
            list(current_blueprint.selected_chapter_ids)
            if current_blueprint and current_blueprint.selected_chapter_ids
            else list(all_ids)
        )
        # Filter invalid IDs
        selected_ids = [cid for cid in selected_ids if cid in all_ids] or list(all_ids)

        deliverables = (
            current_blueprint.deliverables.model_copy()
            if current_blueprint and preset.preset_id == "custom"
            else preset.default_deliverables.model_copy()
        )
        difficulty = preset.target_difficulty

        prompt_lower = user_prompt.lower()
        # Parse chapter range hints from natural language
        mentioned_nums = [int(n) for n in re.findall(r"第\s*(\d+)\s*[章讲课节]", user_prompt)]
        if "前两章" in user_prompt or "前2章" in user_prompt:
            mentioned_nums = [1, 2]
        elif "前三章" in user_prompt or "前3章" in user_prompt:
            mentioned_nums = [1, 2, 3]
        if mentioned_nums:
            matched = [
                chapters[i - 1].chapter_id
                for i in mentioned_nums
                if 1 <= i <= len(chapters)
            ]
            if matched:
                selected_ids = matched

        # Parse quiz count hints
        mcq_m = re.search(r"(\d+)\s*道?\s*选择", user_prompt)
        if mcq_m:
            deliverables.mcq_count = max(1, min(30, int(mcq_m.group(1))))
        fill_m = re.search(r"(\d+)\s*道?\s*填空", user_prompt)
        if fill_m:
            deliverables.fill_blank_count = max(0, min(20, int(fill_m.group(1))))
        short_m = re.search(r"(\d+)\s*道?\s*(?:简答|计算|分析|应用)", user_prompt)
        if short_m:
            deliverables.short_answer_count = max(0, min(15, int(short_m.group(1))))

        if any(k in prompt_lower for k in ["基础", "零基础", "入门", "预习"]):
            difficulty = "beginner"
        elif any(k in prompt_lower for k in ["冲刺", "考前", "速记", "期末"]):
            difficulty = "exam_sprint"
        elif any(k in prompt_lower for k in ["拔高", "深度", "考研", "难题"]):
            difficulty = "advanced"

        focus_topics: List[str] = []
        for c in chapters:
            if c.chapter_id in selected_ids:
                for term in c.key_terms:
                    if term not in focus_topics:
                        focus_topics.append(term)
        focus_topics = focus_topics[:10]

        sel_titles = [c.title for c in chapters if c.chapter_id in selected_ids]
        intent_summary = (
            f"基于《{document_ir.filename}》（共 {document_ir.total_pages_or_slides} 页/张，"
            f"{len(chapters)} 个章节），采用【{preset.name}】模板，"
            f"针对 {len(selected_ids)} 个选中章节生成{deliverables.mcq_count}道选择、"
            f"{deliverables.fill_blank_count}道填空、{deliverables.short_answer_count}道简答题"
            + ("及导学精要笔记、速记表与知识图谱。" if deliverables.include_study_guide_notes else "。")
        )
        if user_prompt.strip():
            intent_summary += f" 已结合您的要求：“{user_prompt.strip()[:120]}”。"

        feedback = (
            f"已解析文档结构与您的定制需求，为您拟定 **《{document_ir.filename} · {preset.name}方案》**：\n"
            f"- **覆盖范围**：{', '.join(sel_titles[:4])}{' 等' if len(sel_titles) > 4 else ''}（共 {len(selected_ids)} 章）\n"
            f"- **目标定位**：{preset.description}\n"
            f"- **题库配置**：单选 {deliverables.mcq_count} 题 + 填空 {deliverables.fill_blank_count} 题 + 简答 {deliverables.short_answer_count} 题（总分 {deliverables.total_score} 分，建议 {deliverables.suggested_minutes} 分钟）\n"
            f"您可以在下方直接勾选调整章节、题量或重点标签，确认无误后点击 **“确认方案并开始生成”**。"
        )

        return StudyBlueprint(
            blueprint_id=current_blueprint.blueprint_id if current_blueprint else f"bp_{uuid.uuid4().hex[:8]}",
            blueprint_title=f"{document_ir.filename} - {preset.name}",
            preset_id=preset.preset_id,
            preset_name=preset.name,
            parsed_intent_summary=intent_summary,
            ai_feedback_message=feedback,
            target_difficulty=difficulty,
            selected_chapter_ids=selected_ids,
            deliverables=deliverables,
            focus_topics=focus_topics,
            custom_instructions=user_prompt.strip(),
            confirmed=False,
        )

    @staticmethod
    def generate_notes_from_ir(document_ir: DocumentIR, blueprint: StudyBlueprint) -> str:
        selected_chapters = [
            c for c in document_ir.chapters if c.chapter_id in blueprint.selected_chapter_ids
        ] or document_ir.chapters

        preset_id = blueprint.preset_id
        header_map = {
            "in_class_practice": "随堂核心要点速览",
            "sync_practice": "章节同步知识梳理与重难点导学",
            "self_test_exam": "考前核心考点复盘提纲",
            "self_study_guide": "自主预习导学案（自学案）",
            "exam_cheatsheet": "考前高密度核心讲义",
            "custom": "定制化学习精要笔记",
        }
        doc_heading = header_map.get(preset_id, "结构化学习笔记")

        lines: List[str] = [
            f"# {document_ir.filename} · {doc_heading}",
            "",
            f"> **生成模式**：`{blueprint.preset_name}` | **难度定位**：`{difficulty_label(blueprint.target_difficulty)}` | **覆盖章节**：{len(selected_chapters)} 章",
            "",
        ]
        if blueprint.focus_topics:
            lines.append(f"**核心关键词**：" + " · ".join(f"`{t}`" for t in blueprint.focus_topics))
            lines.append("")

        if preset_id == "self_study_guide":
            lines.extend([
                "## 一、学习目标与预习导航",
                "1. **知识目标**：准确理解各章节核心概念的定义、物理/逻辑含义及适用条件。",
                "2. **能力目标**：能够结合典型例题独立推导关键结论，区分易混概念。",
                "3. **预习建议**：先通读下方【知识图谱】建立宏观框架，再逐章完成【核心精讲】与【边学边练】。",
                "",
            ])

        for idx, ch in enumerate(selected_chapters, start=1):
            lines.append(f"## {idx}. {ch.title}（第 {ch.start_page}-{ch.end_page} 页/张）")
            lines.append("")
            if ch.key_terms:
                lines.append("**本节高频概念**：" + "、".join(f"**{t}**" for t in ch.key_terms[:6]))
                lines.append("")

            defs = _extract_definitions(ch)
            if defs:
                lines.append("### 核心概念与原理精讲")
                lines.append("")
                lines.append("| 核心概念 / 条目 | 原文精要解释 |")
                lines.append("| :--- | :--- |")
                for k, v in defs[:8]:
                    lines.append(f"| **{k}** | {v[:180]} |")
                lines.append("")

            points = _extract_sentences_and_points(ch)
            if points:
                lines.append("### 知识要点拆解")
                for p in points[:8]:
                    lines.append(f"- {p}")
                lines.append("")

            # 讲义不附教材原图：这里不再输出任何图片链接或配图清单。

            if preset_id in ("self_study_guide", "sync_practice") or blueprint.deliverables.notes_style == "guided_learning":
                ex_term = defs[0][0] if defs else (ch.key_terms[0] if ch.key_terms else ch.title)
                ex_desc = defs[0][1][:160] if defs else (points[0][:160] if points else ch.summary_preview[:160])
                lines.extend([
                    f"### 典型例题与深度解析（第 {idx} 章）",
                    "",
                    f"**【例题 {idx}.1｜概念剖析与原理应用】** 结合本节内容，请准确解释 **{ex_term}** 的核心定义、解决的关键问题及其前提条件。",
                    "",
                    f"> **【审题思路】** 先定位关键词“{ex_term}”在《{ch.title}》（第 {ch.start_page}-{ch.end_page} 页）中的原始定义，再从“作用机制”与“易混边界”两方面分点作答。",
                    f">",
                    f"> **【详细解答】** 根据原文：{ex_desc}。在实际应用与解题中，必须明确其输入/约束关系，切忌脱离上下文直接套用结论。",
                    f">",
                    f"> **【易错点拨】** 切勿将 **{ex_term}** 与同章相邻概念混淆；作答时建议先给定义，再补充适用场景或公式条件。",
                    "",
                    "### 易错点与思考提示",
                    f"- 请重点核对 **{ch.title}** 中各概念之间的因果关系与前提约束条件，切勿混淆相似术语。",
                    "",
                ])

        if preset_id == "self_study_guide" or blueprint.deliverables.notes_style == "guided_learning":
            lines.extend([
                "## 综合典型例题精讲与解题示范",
                "",
                "以下综合例题覆盖所选章节的高频考点与推导链路，已包含完整审题思路与分步解析（导出 PDF 时将同步完整排版）：",
                "",
            ])
            sample_chapters = selected_chapters[:4]
            for ex_idx, ch in enumerate(sample_chapters, start=1):
                c_defs = _extract_definitions(ch)
                c_pts = _extract_sentences_and_points(ch)
                k1 = c_defs[0][0] if c_defs else (ch.key_terms[0] if ch.key_terms else ch.title)
                v1 = c_defs[0][1][:150] if c_defs else (c_pts[0][:150] if c_pts else ch.summary_preview[:150])
                k2 = c_defs[1][0] if len(c_defs) > 1 else (ch.key_terms[1] if len(ch.key_terms) > 1 else "核心机制")
                lines.extend([
                    f"**【综合例 {ex_idx}｜{ch.title}（P{ch.start_page}-{ch.end_page}）】** 试辨析 **{k1}** 与 **{k2}** 的核心作用与内在联系，并说明考试/实践中的典型判别依据。",
                    "",
                    f"> **【题目分析】** 本题考查对《{ch.title}》核心概念的迁移理解，需紧扣教材定义而非死记术语名称。",
                    f">",
                    f"> **【规范解答】** ① **{k1}**：{v1}。② 与 **{k2}** 的配合关系：前者侧重核心变换/约束，后者负责协同提升整体性能或稳定训练过程，二者缺一不可。",
                    f">",
                    f"> **【易错提醒】** 解答对比题时常见失分点是只写优点不写局限/前提条件，请务必点明适用边界与原文出处（P{ch.start_page}-{ch.end_page}）。",
                    "",
                ])

        return "\n".join(lines).strip()

    @staticmethod
    def generate_cheatsheet_from_ir(document_ir: DocumentIR, blueprint: StudyBlueprint) -> str:
        selected_chapters = [
            c for c in document_ir.chapters if c.chapter_id in blueprint.selected_chapter_ids
        ] or document_ir.chapters

        lines: List[str] = [
            f"# ⚡ {document_ir.filename} · 考前速记表 (Cheat Sheet)",
            "",
            "| 章节范围 | 核心概念清单 | 关键要点速记 |",
            "| :--- | :--- | :--- |",
        ]
        for ch in selected_chapters:
            terms = " / ".join(ch.key_terms[:5]) or ch.title
            pts = _extract_sentences_and_points(ch)
            summary = pts[0][:100] if pts else ch.summary_preview[:100]
            lines.append(f"| **{ch.title}** (P{ch.start_page}-{ch.end_page}) | {terms} | {summary} |")

        lines.extend(["", "## 高频定义速查卡", ""])
        card_count = 0
        for ch in selected_chapters:
            for k, v in _extract_definitions(ch)[:4]:
                card_count += 1
                lines.append(f"- **`{k}`**：{v[:160]} *（出处：{ch.title}）*")
        if card_count == 0:
            for ch in selected_chapters:
                lines.append(f"- **`{ch.title}`**：{ch.summary_preview[:160]}")

        lines.extend([
            "",
            "## 考前检查清单 (Checklist)",
            "- [ ] 能不看资料复述以上核心概念的定义与区别",
            "- [ ] 掌握各章节关键图表/流程的输入输出关系",
            "- [ ] 完成配套自测题库并复盘全部错题",
        ])
        return "\n".join(lines).strip()

    @staticmethod
    def generate_quiz_from_ir(document_ir: DocumentIR, blueprint: StudyBlueprint) -> QuizPaper:
        selected_chapters = [
            c for c in document_ir.chapters if c.chapter_id in blueprint.selected_chapter_ids
        ] or document_ir.chapters

        d = blueprint.deliverables
        questions: List[QuizQuestion] = []

        # Collect definitions and factual statements across selected chapters
        pool_defs: List[tuple[ChapterNode, str, str]] = []
        pool_points: List[tuple[ChapterNode, str]] = []
        for ch in selected_chapters:
            for k, v in _extract_definitions(ch):
                pool_defs.append((ch, k, v))
            for pt in _extract_sentences_and_points(ch):
                pool_points.append((ch, pt))

        all_terms = [t for ch in selected_chapters for t in ch.key_terms] or ["核心机制", "基础模型", "系统架构", "关键参数"]
        tiers = ["基础达标", "能力提升", "拓展探究"]

        total_q = max(1, d.mcq_count + d.fill_blank_count + d.short_answer_count)
        mcq_score = max(2, round(d.total_score * 0.45 / max(1, d.mcq_count))) if d.mcq_count else 0
        fill_score = max(2, round(d.total_score * 0.25 / max(1, d.fill_blank_count))) if d.fill_blank_count else 0
        short_score = max(5, round(d.total_score * 0.30 / max(1, d.short_answer_count))) if d.short_answer_count else 0

        # 1. MCQs
        for i in range(d.mcq_count):
            ch = selected_chapters[i % len(selected_chapters)]
            if pool_defs:
                ch_d, term, desc = pool_defs[i % len(pool_defs)]
                ch = ch_d
                q_text = f"根据《{ch.title}》的内容，关于“{desc[:90]}”的描述，最准确对应的核心概念是哪一项？"
                correct = term
            else:
                term = ch.key_terms[i % len(ch.key_terms)] if ch.key_terms else ch.title
                pt = pool_points[i % len(pool_points)][1] if pool_points else ch.summary_preview
                q_text = f"在《{ch.title}》中，下列哪项表述准确反映了“{term}”的核心特征？\n（参考情境：{pt[:80]}）"
                correct = f"{term}的核心原理与适用边界"

            distractors = [t for t in all_terms if t != correct][:3]
            while len(distractors) < 3:
                distractors.append(f"非相关干扰概念 {len(distractors) + 1}")
            options_raw = [correct] + distractors[:3]
            # Deterministic rotation so correct answer isn't always A
            shift = i % 4
            rotated = options_raw[shift:] + options_raw[:shift]
            labels = ["A", "B", "C", "D"]
            options = [f"{labels[idx]}. {val}" for idx, val in enumerate(rotated)]
            ans_letter = labels[rotated.index(correct)]
            tier = tiers[min(2, i * 3 // max(1, d.mcq_count))]

            questions.append(
                QuizQuestion(
                    id=f"q_mcq_{i + 1}",
                    type="mcq",
                    difficulty="easy" if tier == "基础达标" else ("medium" if tier == "能力提升" else "hard"),
                    tier=tier,  # type: ignore
                    score=mcq_score,
                    question=q_text,
                    options=options,
                    answer=ans_letter,
                    explanation=f"正确答案是 {ans_letter}（{correct}）。依据 {ch.title}（第 {ch.start_page}-{ch.end_page} 页）原文要点定位。",
                    source_chapter=ch.title,
                    source_page=f"P{ch.start_page}-{ch.end_page}",
                )
            )

        # 2. Fill in the blank
        for i in range(d.fill_blank_count):
            ch = selected_chapters[i % len(selected_chapters)]
            if pool_defs:
                ch_d, term, desc = pool_defs[(i + 1) % len(pool_defs)]
                ch = ch_d
                q_text = f"在《{ch.title}》中，______ 是指：{desc[:110]}。"
                ans = term
            else:
                ans = ch.key_terms[0] if ch.key_terms else ch.title
                q_text = f"《{ch.title}》重点讨论的核心主题是 ______。"
            tier = "基础达标" if i == 0 else "能力提升"
            questions.append(
                QuizQuestion(
                    id=f"q_fill_{i + 1}",
                    type="fill_blank",
                    difficulty="medium",
                    tier=tier,  # type: ignore
                    score=fill_score,
                    question=q_text,
                    options=[],
                    answer=ans,
                    explanation=f"应填：{ans}。出自 {ch.title}（P{ch.start_page}-{ch.end_page}）。",
                    source_chapter=ch.title,
                    source_page=f"P{ch.start_page}-{ch.end_page}",
                )
            )

        # 3. Short answer
        for i in range(d.short_answer_count):
            ch = selected_chapters[i % len(selected_chapters)]
            pts = _extract_sentences_and_points(ch)
            key_pt = pts[0] if pts else ch.summary_preview
            terms_str = "、".join(ch.key_terms[:3]) or ch.title
            q_text = f"请结合《{ch.title}》的内容，简述【{terms_str}】的核心原理、关键步骤或实际应用场景。"
            ans = f"参考要点：\n1. 核心定位：{key_pt[:140]}\n2. 关键概念关联：{terms_str}\n3. 应用与注意事项：需结合原文第 {ch.start_page}-{ch.end_page} 页所述约束条件进行分析。"
            questions.append(
                QuizQuestion(
                    id=f"q_short_{i + 1}",
                    type="short_answer",
                    difficulty="hard" if i > 0 else "medium",
                    tier="拓展探究" if i > 0 else "能力提升",
                    score=short_score,
                    question=q_text,
                    options=[],
                    answer=ans,
                    explanation=f"评分标准：准确答出核心概念定义（40%）、逻辑流程或推导要点（40%）、结合场景或易错点辨析（20%）。出处：{ch.title}。",
                    source_chapter=ch.title,
                    source_page=f"P{ch.start_page}-{ch.end_page}",
                )
            )

        actual_total = sum(q.score for q in questions) or d.total_score
        return QuizPaper(
            title=f"{document_ir.filename} · {blueprint.preset_name}",
            mode=d.quiz_mode,
            total_score=actual_total,
            suggested_minutes=d.suggested_minutes,
            instructions=f"本卷共 {len(questions)} 题（单选 {d.mcq_count} 题、填空 {d.fill_blank_count} 题、简答 {d.short_answer_count} 题），建议用时 {d.suggested_minutes} 分钟。",
            questions=questions,
        )

    @staticmethod
    def generate_mindmap_from_ir(document_ir: DocumentIR, blueprint: StudyBlueprint) -> str:
        selected_chapters = [
            c for c in document_ir.chapters if c.chapter_id in blueprint.selected_chapter_ids
        ] or document_ir.chapters

        root_label = _sanitize_mermaid_label(document_ir.filename.rsplit(".", 1)[0])
        lines: List[str] = ["flowchart LR", f'  root["{root_label}"]']

        for c_idx, ch in enumerate(selected_chapters[:8], start=1):
            c_node = f"c{c_idx}"
            c_label = _sanitize_mermaid_label(ch.title)
            lines.append(f'  root --> {c_node}["{c_label}"]')
            terms = ch.key_terms[:4]
            if not terms:
                defs = _extract_definitions(ch)
                terms = [k for k, _ in defs[:3]]
            for t_idx, term in enumerate(terms, start=1):
                t_node = f"c{c_idx}_t{t_idx}"
                t_label = _sanitize_mermaid_label(term)
                lines.append(f'  {c_node} --> {t_node}["{t_label}"]')

        return "\n".join(lines)
