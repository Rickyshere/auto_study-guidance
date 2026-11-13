from __future__ import annotations

import json
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
    assert len(data["harnesses"]) >= 4
    assert "gpu_vram" in data
    assert "ocr_engines" in data

    harnesses = {h.name: h for h in detect_installed_harnesses()}
    assert "claude" in harnesses
    assert "codex" in harnesses
    assert "dsh" in harnesses


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


def test_vram_ocr_dsh_and_ai_fill():
    vram_resp = client.get("/api/ocr/vram-detect")
    assert vram_resp.status_code == 200
    vram_data = vram_resp.json()
    assert "gpu_vram" in vram_data
    assert vram_data["gpu_vram"]["vram_tier"] in {"le_8gb", "gt_8_lt_48gb", "ge_48gb"}
    assert vram_data["gpu_vram"]["recommended_ocr_engine"]
    engine_ids = {item["engine_id"] for item in vram_data["ocr_engines"]}
    assert {"mineru_pipeline", "somark_free_api", "paddleocr", "mineru_full", "oxr_full", "rapidocr"} <= engine_ids

    dsh_resp = client.post("/api/harnesses/install", json={"cli_name": "dsh"})
    assert dsh_resp.status_code == 200
    dsh_data = dsh_resp.json()
    assert dsh_data["ok"] is True
    assert dsh_data["available"] is True

    # Streaming SSE install + uninstall + restore for DSH
    with client.stream(
        "POST",
        "/api/harnesses/install",
        json={"cli_name": "dsh", "action": "install", "stream": True},
    ) as stream_res:
        assert stream_res.status_code == 200
        body = "".join(stream_res.iter_text())
        events = [
            json.loads(line.replace("data:", "", 1).strip())
            for line in body.splitlines()
            if line.strip().startswith("data:")
        ]
        assert any(e.get("type") == "progress" for e in events)
        assert events[-1].get("type") == "complete"
        assert events[-1]["result"]["available"] is True

    uninst_resp = client.post("/api/harnesses/uninstall", json={"cli_name": "dsh"})
    assert uninst_resp.status_code == 200
    assert uninst_resp.json()["ok"] is True
    assert not Path(r"D:\auto_study_guidance\backend\.venv\Scripts\dsh.cmd").exists()

    # Restore project DSH shim after uninstall test
    restore_resp = client.post("/api/harnesses/install", json={"cli_name": "dsh"})
    assert restore_resp.status_code == 200
    assert restore_resp.json()["available"] is True

    # Streaming SSE for OCR setup (non-destructive cloud API target)
    with client.stream(
        "POST",
        "/api/ocr/setup",
        json={"engine_id": "somark_free_api", "action": "install_and_start", "stream": True},
    ) as ocr_stream:
        assert ocr_stream.status_code == 200
        ocr_body = "".join(ocr_stream.iter_text())
        ocr_events = [
            json.loads(line.replace("data:", "", 1).strip())
            for line in ocr_body.splitlines()
            if line.strip().startswith("data:")
        ]
        assert any(e.get("type") == "progress" for e in ocr_events)
        assert ocr_events[-1].get("type") == "complete"
        assert ocr_events[-1]["result"]["ok"] is True

    demo = client.post("/api/projects/demo")
    assert demo.status_code == 200
    pid = demo.json()["document_ir"]["project_id"]
    try:
        fill_resp = client.post(
            f"/api/projects/{pid}/ai-fill-params",
            json={
                "preset_id": "self_test_exam",
                "user_prompt": "重点考查第2章，适当增加选择题数量",
                "current_blueprint": demo.json()["blueprint"],
            },
        )
        assert fill_resp.status_code == 200
        bp = fill_resp.json()
        assert bp["deliverables"]["mcq_count"] >= 0
        assert bp["deliverables"]["fill_blank_count"] >= 0
        assert bp["deliverables"]["short_answer_count"] >= 0
        assert bp["ai_feedback_message"]
    finally:
        client.delete(f"/api/projects/{pid}")


def test_math_normalization_study_guide_examples_and_pdf_exports():
    from app.workflows.generator import normalize_markdown_math

    raw_sample = (
        r"| 模块 | 公式 | 提示 |" + "\n"
        r"|---|---|---|" + "\n"
        r"| 感知机 | \(h^{(l)}=\sigma(W^{(l)}h^{(l-1)}+b^{(l)})\) | \(\eta\) 学习率 |" + "\n"
        r"| L2 | \(L_{\text{total}}=L+\lambda\|W\|^2\) | 范数 |" + "\n"
        r"| 裸公式 | (\frac{\partial L}{\partial W}=1) | 完成 |" + "\n"
        r"\[H_{out}=\left\lfloor\frac{H-K+2P}{S}\right\rfloor+1\]"
    )
    norm = normalize_markdown_math(raw_sample)
    assert r"\(" not in norm
    assert r"\[" not in norm
    assert "$h^{(l)}=\\sigma(W^{(l)}h^{(l-1)}+b^{(l)})$" in norm
    assert r"\parallel W\parallel ^2" in norm
    assert "$\\frac{\\partial L}{\\partial W}=1$" in norm
    assert "$$" in norm

    demo = client.post("/api/projects/demo")
    assert demo.status_code == 200
    pid = demo.json()["document_ir"]["project_id"]
    try:
        from app.router.fallback_provider import HeuristicStudyEngine
        from app.schemas import DocumentIR, StudyBlueprint, StudyPackage

        doc_ir = DocumentIR.model_validate(demo.json()["document_ir"])
        bp = StudyBlueprint.model_validate(demo.json()["blueprint"])
        heuristic_notes = HeuristicStudyEngine.generate_notes_from_ir(doc_ir, bp)
        assert "典型例题" in heuristic_notes
        assert "综合典型例题精讲" in heuristic_notes

        # Generate offline deterministic package via heuristic settings to avoid external network flakiness in unit test
        quiz_paper = HeuristicStudyEngine.generate_quiz_from_ir(doc_ir, bp)
        cheatsheet = HeuristicStudyEngine.generate_cheatsheet_from_ir(doc_ir, bp)
        mindmap = HeuristicStudyEngine.generate_mindmap_from_ir(doc_ir, bp)
        pkg = StudyPackage(
            project_id=pid,
            blueprint_used=bp.model_copy(update={"confirmed": True}),
            routing_trace={"notes_and_cheatsheet": "heuristic"},
            study_notes_markdown=heuristic_notes,
            cheatsheet_markdown=cheatsheet,
            quiz_paper=quiz_paper,
            mindmap_mermaid=mindmap,
        )
        from app.main import _save_package

        _save_package(pid, pkg)

        # 1. Quiz A4 PDF with answers
        a4_res = client.post(
            f"/api/projects/{pid}/export-pdf",
            json={"doc_type": "quiz", "paper_size": "a4", "include_answers": True},
        )
        assert a4_res.status_code == 200
        assert a4_res.headers["content-type"].startswith("application/pdf")
        doc_a4 = fitz.open("pdf", a4_res.content)
        assert len(doc_a4) >= 2
        assert abs(doc_a4[0].rect.width - 595) < 5
        a4_text = "\n".join(p.get_text() for p in doc_a4)
        assert "单项选择题" in a4_text
        assert "参考答案与教材溯源解析" in a4_text
        doc_a4.close()

        # 2. Quiz A3 two-column sealed PDF with answers
        a3_res = client.get(
            f"/api/projects/{pid}/export-pdf?doc_type=quiz&paper_size=a3&include_answers=true"
        )
        assert a3_res.status_code == 200
        doc_a3 = fitz.open("pdf", a3_res.content)
        assert len(doc_a3) >= 2
        assert abs(doc_a3[0].rect.width - 1191) < 5
        assert abs(doc_a3[0].rect.height - 842) < 5
        a3_text = "\n".join(p.get_text() for p in doc_a3)
        assert "第 1 栏" in a3_text
        assert "参考答案与教材溯源解析" in a3_text
        doc_a3.close()

        # 3. Self-study guide PDF (A4 printable booklet with examples & solutions)
        guide_res = client.post(
            f"/api/projects/{pid}/export-pdf",
            json={"doc_type": "study_guide", "paper_size": "a4", "include_answers": True},
        )
        assert guide_res.status_code == 200
        doc_g = fitz.open("pdf", guide_res.content)
        assert len(doc_g) >= 2
        guide_text = "\n".join(p.get_text() for p in doc_g)
        assert "正式印刷版自主导学讲义" in guide_text
        assert "典型例题" in guide_text
        assert "配套典型例题演练与完整解析" in guide_text
        doc_g.close()
    finally:
        client.delete(f"/api/projects/{pid}")


def test_security_api_key_redaction_and_path_traversal():
    from app.config import DATA_DIR, SETTINGS_FILE, load_settings

    had_file = SETTINGS_FILE.exists()
    backup_text = SETTINGS_FILE.read_text(encoding="utf-8") if had_file else ""
    try:
        current = load_settings()
        secret = "sk-testsecretkey1234567890"
        updated = current.model_copy(
            update={
                "cloud_config": current.cloud_config.model_copy(update={"api_key": secret}),
            }
        )
        post_res = client.post("/api/providers/settings", json=updated.model_dump())
        assert post_res.status_code == 200
        returned_key = post_res.json()["cloud_config"]["api_key"]
        assert "****" in returned_key
        assert secret not in returned_key

        status_res = client.get("/api/providers/status")
        assert status_res.status_code == 200
        status_settings = status_res.json()["settings"]
        assert status_settings["cloud_config"]["api_key"] == "sk-t****7890"
        assert secret not in json.dumps(status_settings)

        # Round-tripping the masked settings must preserve the real secret on disk
        roundtrip_res = client.post("/api/providers/settings", json=status_settings)
        assert roundtrip_res.status_code == 200
        assert load_settings().cloud_config.api_key == secret

        # Path traversal guards
        assert client.get("/api/projects/..%5Cdata").status_code in {400, 404}
        assert client.delete("/api/projects/..%5Cdata").status_code in {400, 404}
        assert DATA_DIR.exists()
    finally:
        if had_file:
            SETTINGS_FILE.write_text(backup_text, encoding="utf-8")
        elif SETTINGS_FILE.exists():
            SETTINGS_FILE.unlink(missing_ok=True)


def test_global_quality_audit_activation_rule():
    from app.router.routing_engine import ModelRouter
    from app.schemas import ProviderSelection, RouterSettings

    # 1. Pure heuristic mode -> global_quality_audit MUST be disabled
    s_heur = RouterSettings(routing_mode="single", active_provider="heuristic", enable_quality_audit=True)
    r_heur = ModelRouter(s_heur)
    assert r_heur.is_non_heuristic_active() is False
    assert r_heur.resolve_quality_audit_provider() is None

    # 2. Smart stage with all generation stages set to heuristic -> disabled even if global_quality_audit is harness
    s_smart_heur = RouterSettings(
        routing_mode="smart_stage",
        active_provider="heuristic",
        enable_quality_audit=True,
        stage_mapping={
            "vision_ocr": ProviderSelection(provider="heuristic"),
            "requirement_negotiation": ProviderSelection(provider="heuristic"),
            "notes_and_cheatsheet": ProviderSelection(provider="heuristic"),
            "quiz_generation": ProviderSelection(provider="heuristic"),
            "mindmap_generation": ProviderSelection(provider="heuristic"),
            "global_quality_audit": ProviderSelection(provider="heuristic"),
        },
    )
    r_smart_heur = ModelRouter(s_smart_heur)
    assert r_smart_heur.is_non_heuristic_active() is False
    assert r_smart_heur.resolve_quality_audit_provider() is None

    # 3. Non-heuristic single provider (e.g. cloud / harness / local) -> enabled when switch is True, disabled when False
    s_cloud = RouterSettings(routing_mode="single", active_provider="cloud", enable_quality_audit=True)
    r_cloud = ModelRouter(s_cloud)
    assert r_cloud.is_non_heuristic_active() is True
    resolved = r_cloud.resolve_quality_audit_provider()
    assert resolved is not None and resolved.provider == "cloud"

    s_cloud_off = s_cloud.model_copy(update={"enable_quality_audit": False})
    assert ModelRouter(s_cloud_off).resolve_quality_audit_provider() is None
