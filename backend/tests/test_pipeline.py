from __future__ import annotations

import shutil
from pathlib import Path

import fitz
import pytest
from docx import Document as DocxDocument
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw
from pptx import Presentation

from app.main import app
from app.router.harness_provider import detect_installed_harnesses


client = TestClient(app)


def _create_sample_pptx(path: Path) -> None:
    img_path = path.parent / "sample_diagram.png"
    img = Image.new("RGB", (320, 180), color=(235, 244, 255))
    draw = ImageDraw.Draw(img)
    draw.rectangle([20, 20, 300, 160], outline=(30, 64, 175), width=3)
    draw.text((40, 80), "HTTP Request -> Response", fill=(15, 23, 42))
    img.save(img_path)

    prs = Presentation()
    s1 = prs.slides.add_slide(prs.slide_layouts[1])
    s1.shapes.title.text = "第1章 计算机网络体系结构"
    tf1 = s1.placeholders[1].text_frame
    tf1.text = "OSI七层模型：物理层、数据链路层、网络层、传输层、会话层、表示层、应用层。"
    p2 = tf1.add_paragraph()
    p2.text = "TCP/IP四层模型：网络接口层、网际层、运输层、应用层。"
    s1.notes_slide.notes_text_frame.text = "重点区分OSI与TCP/IP的对应关系。"
    s1.shapes.add_picture(str(img_path), left=1000000, top=3200000, width=3000000)

    s2 = prs.slides.add_slide(prs.slide_layouts[1])
    s2.shapes.title.text = "第2章 传输层协议 TCP 与 UDP"
    tf2 = s2.placeholders[1].text_frame
    tf2.text = "TCP协议：面向连接、可靠传输、三次握手建立连接、四次挥手释放连接。"
    p3 = tf2.add_paragraph()
    p3.text = "UDP协议：无连接、尽最大努力交付、首部开销小、适合音视频实时通信。"
    prs.save(str(path))


def _create_sample_pdf(path: Path) -> None:
    doc = fitz.open()
    p1 = doc.new_page()
    p1.insert_text((72, 72), "Chapter 1 Linear Algebra Foundations\nMatrix Multiplication: C = A * B.\nEigenvalues: A v = lambda v.", fontsize=12)
    p2 = doc.new_page()
    p2.insert_text((72, 72), "Chapter 2 Singular Value Decomposition\nSVD decomposes matrix M = U Sigma V^T for dimensionality reduction.", fontsize=12)
    doc.set_toc([[1, "Chapter 1 Linear Algebra Foundations", 1], [1, "Chapter 2 Singular Value Decomposition", 2]])
    doc.save(str(path))
    doc.close()


def _create_sample_docx(path: Path) -> None:
    doc = DocxDocument()
    doc.add_heading("第一章 操作系统进程管理", level=1)
    doc.add_paragraph("进程：程序的一次动态执行过程，是系统进行资源分配和调度的基本单位。")
    doc.add_heading("第二章 内存管理与虚拟内存", level=1)
    doc.add_paragraph("分页存储管理：将逻辑地址空间划分为固定大小的页，通过页表映射到物理块。")
    doc.save(str(path))


def test_health_and_providers():
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"

    status_resp = client.get("/api/providers/status")
    assert status_resp.status_code == 200
    data = status_resp.json()
    assert len(data["harnesses"]) >= 3

    harnesses = {h.name: h for h in detect_installed_harnesses()}
    assert "claude" in harnesses
    assert "codex" in harnesses


def test_presets_list():
    resp = client.get("/api/presets")
    assert resp.status_code == 200
    presets = resp.json()
    ids = {p["preset_id"] for p in presets}
    assert {"in_class_practice", "sync_practice", "self_test_exam", "self_study_guide", "exam_cheatsheet", "custom"} <= ids


def test_pptx_upload_negotiate_confirm_generate(tmp_path: Path):
    pptx_file = tmp_path / "network_slides.pptx"
    _create_sample_pptx(pptx_file)

    with pptx_file.open("rb") as f:
        up = client.post(
            "/api/projects/upload",
            files={"file": ("network_slides.pptx", f, "application/vnd.openxmlformats-officedocument.presentationml.presentation")},
            data={"default_preset_id": "self_study_guide"},
        )
    assert up.status_code == 200
    detail = up.json()
    project_id = detail["document_ir"]["project_id"]
    assert detail["document_ir"]["file_type"] == "pptx"
    assert len(detail["document_ir"]["chapters"]) >= 1
    assert len(detail["document_ir"]["all_assets"]) >= 1

    try:
        # Stage 1: Negotiate with custom requirements + preset "self_test_exam"
        neg = client.post(
            f"/api/projects/{project_id}/negotiate",
            json={
                "preset_id": "self_test_exam",
                "user_prompt": "重点考察第1章，出5道选择题和2道简答题，满分100分",
                "current_blueprint": detail["blueprint"],
            },
        )
        assert neg.status_code == 200
        bp = neg.json()
        assert bp["preset_id"] == "self_test_exam"
        assert bp["deliverables"]["mcq_count"] == 5
        assert bp["deliverables"]["short_answer_count"] == 2
        assert bp["ai_feedback_message"]

        # Stage 2: Confirm blueprint and generate package
        gen = client.post(
            f"/api/projects/{project_id}/generate",
            json={"blueprint": bp, "stream": False},
        )
        assert gen.status_code == 200
        pkg = gen.json()
        assert pkg["blueprint_used"]["confirmed"] is True
        assert "TCP" in pkg["study_notes_markdown"] or "网络" in pkg["study_notes_markdown"]
        assert pkg["cheatsheet_markdown"]
        assert len(pkg["quiz_paper"]["questions"]) == 5 + bp["deliverables"]["fill_blank_count"] + 2
        assert "flowchart" in pkg["mindmap_mermaid"]

        # Quick generate with "in_class_practice" (随堂练习) & "sync_practice" (同步练习)
        for pid in ("in_class_practice", "sync_practice"):
            qgen = client.post(
                f"/api/projects/{project_id}/quick-generate",
                json={"preset_id": pid, "stream": False},
            )
            assert qgen.status_code == 200
            qpkg = qgen.json()
            assert qpkg["blueprint_used"]["preset_id"] == pid
            assert len(qpkg["quiz_paper"]["questions"]) >= 5
    finally:
        client.delete(f"/api/projects/{project_id}")


def test_pdf_and_docx_parsing(tmp_path: Path):
    pdf_file = tmp_path / "linear_algebra.pdf"
    _create_sample_pdf(pdf_file)
    with pdf_file.open("rb") as f:
        up_pdf = client.post(
            "/api/projects/upload",
            files={"file": ("linear_algebra.pdf", f, "application/pdf")},
        )
    assert up_pdf.status_code == 200
    pdf_ir = up_pdf.json()["document_ir"]
    assert len(pdf_ir["chapters"]) == 2
    client.delete(f"/api/projects/{pdf_ir['project_id']}")

    docx_file = tmp_path / "os_notes.docx"
    _create_sample_docx(docx_file)
    with docx_file.open("rb") as f:
        up_docx = client.post(
            "/api/projects/upload",
            files={"file": ("os_notes.docx", f, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
        )
    assert up_docx.status_code == 200
    docx_ir = up_docx.json()["document_ir"]
    assert len(docx_ir["chapters"]) == 2
    client.delete(f"/api/projects/{docx_ir['project_id']}")


def test_demo_project_lifecycle():
    resp = client.post("/api/projects/demo")
    assert resp.status_code == 200
    detail = resp.json()
    pid = detail["document_ir"]["project_id"]
    try:
        assert len(detail["document_ir"]["chapters"]) == 4
        assert len(detail["document_ir"]["all_assets"]) >= 1
        qgen = client.post(
            f"/api/projects/{pid}/quick-generate",
            json={"preset_id": "self_study_guide", "stream": False},
        )
        assert qgen.status_code == 200
        assert "Transformer" in qgen.json()["study_notes_markdown"]
    finally:
        client.delete(f"/api/projects/{pid}")
