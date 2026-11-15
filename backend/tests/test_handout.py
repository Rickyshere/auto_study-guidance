from __future__ import annotations

import asyncio

import shutil
from pathlib import Path

import pymupdf
import pytest

from app.schemas import (
    AnnotationAnchor,
    AnnotationMarginCard,
    AnnotationStyle,
    HandoutAnnotation,
    MicroTutorRequest,
    QuizPaper,
    StudyBlueprint,
    StudyPackage,
)
from app.workflows import annotations as ann_store
from app.workflows.micro_tutor import generate_micro_tutor_card
from app.workflows.pdf_exporter import export_study_guide_pdf_bytes

PROJ = "proj_handout_test"


def _mkdir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


@pytest.fixture(autouse=True)
def _cleanup():
    yield
    shutil.rmtree(Path("data") / "projects" / PROJ, ignore_errors=True)


def test_annotation_roundtrip() -> None:
    _mkdir(Path("data") / "projects" / PROJ)
    ann = HandoutAnnotation(
        annotation_id="note-1",
        anchor=AnnotationAnchor(
            block_id="blk-0003",
            start_offset=6,
            end_offset=18,
            exact_quote="表观 Vmax 不变",
        ),
        style=AnnotationStyle(type="HIGHLIGHT", color="AMBER_YELLOW"),
        margin_card=AnnotationMarginCard(
            is_pinned=True,
            card_title="竞争性抑制",
            ai_response_markdown="底物够多就能挤走占位者，Vmax 不变 Kn 变大。",
        ),
    )
    saved = ann_store.upsert_annotation(PROJ, ann)
    assert saved.project_id == PROJ

    items = ann_store.load_annotations(PROJ)
    assert len(items) == 1
    assert items[0].anchor.exact_quote == "表观 Vmax 不变"
    assert ann_store.pinned_annotations(PROJ)[0].margin_card.card_title == "竞争性抑制"

    # 同 id 再写一次是更新而不是新增
    ann_store.upsert_annotation(PROJ, ann.model_copy(update={"margin_card": ann.margin_card.model_copy(update={"user_custom_note": "期中必考"})}))
    assert len(ann_store.load_annotations(PROJ)) == 1

    assert ann_store.delete_annotation(PROJ, "note-1") is True
    assert ann_store.load_annotations(PROJ) == []


def test_micro_tutor_falls_back_without_model() -> None:
    class _NullRouter:
        async def execute_json(self, *args, **kwargs):
            return None, "heuristic"

    req = MicroTutorRequest(
        study_mode="C_sprint",
        action_type="MICRO_QUIZ",
        selected_focus="表观 Km 值增大",
        surrounding_context="竞争性抑制剂…",
        document_title="第04章",
    )
    res = asyncio.run(generate_micro_tutor_card(req, _NullRouter()))  # type: ignore[arg-type]
    assert res.fallback is True
    assert res.content_markdown.strip()
    assert res.micro_quiz and res.micro_quiz.get("answer") == "A"


def _package() -> StudyPackage:
    bp = StudyBlueprint(
        blueprint_id="bp",
        blueprint_title="讲义",
        parsed_intent_summary="x",
        ai_feedback_message="y",
    )
    return StudyPackage(
        project_id=PROJ,
        blueprint_used=bp,
        study_notes_markdown="## 一、核心概念\n\n竞争性抑制剂使 $K_m$ 增大而 $V_{max}$ 不变。\n\n## 二、典型例题\n\n略。\n",
        quiz_paper=QuizPaper(title="卷", mode="exam_paper", total_score=10, suggested_minutes=10),
    )


def test_cornell_export_embeds_pinned_notes() -> None:
    from app.schemas import ChapterNode, DocumentIR

    doc_ir = DocumentIR(
        project_id=PROJ,
        filename="第04章.pdf",
        file_type="pdf",
        total_pages_or_slides=1,
        total_chars=100,
        chapters=[ChapterNode(chapter_id="ch_1", title="ch", content_text="x")],
    )
    ann = HandoutAnnotation(
        annotation_id="note-2",
        anchor=AnnotationAnchor(block_id="blk-0001", exact_quote="竞争性抑制剂使 Km 增大"),
        style=AnnotationStyle(),
        margin_card=AnnotationMarginCard(
            is_pinned=True,
            card_title="康奈尔批注标题",
            ai_response_markdown="页边批注正文命中测试",
        ),
    )
    pdf = export_study_guide_pdf_bytes(doc_ir, _package(), notes_mode="cornell", annotations=[ann])
    with pymupdf.open(stream=pdf, filetype="pdf") as doc:
        text = "\n".join(page.get_text("text") for page in doc)
    assert "康奈尔批注标题" in text
    assert "页边批注正文命中测试" in text

    clean_pdf = export_study_guide_pdf_bytes(doc_ir, _package(), notes_mode="clean")
    with pymupdf.open(stream=clean_pdf, filetype="pdf") as doc:
        clean_text = "\n".join(page.get_text("text") for page in doc)
    assert "康奈尔批注标题" not in clean_text