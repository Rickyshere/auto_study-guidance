from __future__ import annotations

import asyncio
from datetime import datetime
import json
import shutil
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import quote

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from app.config import (
    PROJECTS_DIR,
    get_project_dir,
    load_settings,
    redact_settings,
    resolve_safe_project_dir,
    save_settings,
)
from app.parsers import (
    SUPPORTED_EXAM_EXTENSIONS,
    SUPPORTED_EXTENSIONS,
    parse_uploaded_exam_file,
    parse_uploaded_file,
)
from app.parsers.ocr_engine import (
    detect_gpu_vram,
    get_ocr_engines_status,
    is_rapidocr_available,
    probe_local_oxr_only,
    resolve_effective_ocr_engine,
    setup_ocr_engine,
    stream_setup_ocr_engine,
)
from app.router import (
    ModelRouter,
    detect_free_ai_apps_and_magpie,
    detect_installed_harnesses,
    install_cli_harness,
    stream_manage_cli_harness,
    stream_setup_magpie_and_dsh,
    uninstall_cli_harness,
)
from app.schemas import (
    ChapterTextUpdate,
    CloudConfig,
    DocumentIR,
    ExamGenerateRequest,
    FreeAiAuthConfig,
    GenerateRequest,
    HandoutAnnotation,
    MicroTutorRequest,
    MicroTutorResponse,
    NegotiateRequest,
    OcrEngineType,
    PresetTemplate,
    ProjectDetailResponse,
    ProjectSummary,
    ProviderStatusResponse,
    QuickGenerateRequest,
    RouterSettings,
    StudyBlueprint,
    StudyPackage,
    VariantQuestionRequest,
)
from app.workflows import (
    PRESET_TEMPLATES,
    ai_fill_study_blueprint,
    build_default_blueprint_from_ir,
    create_demo_exam_paper_project,
    generate_exam_study_package,
    generate_study_package,
    generate_variant_question,
    get_exam_agent_souls_payload,
    get_preset,
    negotiate_study_blueprint,
)
from app.workflows.demo_project import create_demo_courseware_project
from app.parsers.pdf_parser import extract_key_terms
from app.workflows.generator import normalize_markdown_math, strip_document_images
from app.workflows.section_practice import (
    extract_note_sections,
    generate_section_practice,
    load_cache as load_section_practice_cache,
    notes_fingerprint,
    save_cache as save_section_practice_cache,
)
from app.workflows.annotations import (
    delete_annotation,
    load_annotations,
    upsert_annotation,
)
from app.workflows.micro_tutor import generate_micro_tutor_card
from app.workflows.pdf_exporter import (
    export_cheatsheet_pdf_bytes,
    export_quiz_pdf_bytes,
    export_study_guide_pdf_bytes,
)
from app.workflows.updater import (
    get_update_status,
    pull_and_apply_update_stream,
    record_push_webhook,
)

app = FastAPI(
    title="Auto Study Guidance API",
    description="智能课本/课件与试卷分析学习资料生成系统后端服务",
    version="1.3.0",
)

ALLOWED_ORIGINS = [
    "http://127.0.0.1:8000",
    "http://localhost:8000",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "Accept"],
)


def _safe_project_dir(project_id: str) -> Path:
    try:
        return resolve_safe_project_dir(project_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="非法项目 ID")


def _load_project_ir(project_id: str) -> DocumentIR:
    ir_path = _safe_project_dir(project_id) / "document_ir.json"
    if not ir_path.exists():
        raise HTTPException(status_code=404, detail=f"项目 {project_id} 不存在")
    return DocumentIR.model_validate_json(ir_path.read_text(encoding="utf-8"))


def _save_project_ir(doc_ir: DocumentIR) -> None:
    pdir = get_project_dir(doc_ir.project_id)
    (pdir / "document_ir.json").write_text(doc_ir.model_dump_json(indent=2), encoding="utf-8")


def _refresh_document_index(doc_ir: DocumentIR) -> None:
    """章节正文被人工订正后，重算字数/预览/关键术语与全文索引。

    exam_paper 的 `raw_exam_text` 是试卷生成链路真正读取的正文，必须跟着重建，
    否则用户改完文字、生成的卷子仍是旧文本。
    """
    for chapter in doc_ir.chapters:
        chapter.char_count = len(chapter.content_text)
        chapter.summary_preview = chapter.content_text[:180].replace("\n", " ")
        chapter.key_terms = extract_key_terms(chapter.content_text)
    if doc_ir.project_type == "exam_paper":
        doc_ir.raw_exam_text = "\n\n".join(
            f"[试卷第 {chapter.start_page} 页]\n{chapter.content_text}"
            for chapter in doc_ir.chapters
            if chapter.content_text.strip()
        ).strip()
        doc_ir.total_chars = len(doc_ir.raw_exam_text)
    else:
        doc_ir.total_chars = sum(chapter.char_count for chapter in doc_ir.chapters)


def _load_blueprint(project_id: str) -> Optional[StudyBlueprint]:
    bp_path = _safe_project_dir(project_id) / "blueprint.json"
    if bp_path.exists():
        return StudyBlueprint.model_validate_json(bp_path.read_text(encoding="utf-8"))
    return None


def _save_blueprint(project_id: str, blueprint: StudyBlueprint) -> None:
    pdir = get_project_dir(project_id)
    (pdir / "blueprint.json").write_text(blueprint.model_dump_json(indent=2), encoding="utf-8")


def _load_package(project_id: str) -> Optional[StudyPackage]:
    pkg_path = _safe_project_dir(project_id) / "study_package.json"
    if pkg_path.exists():
        pkg = StudyPackage.model_validate_json(pkg_path.read_text(encoding="utf-8"))
        return pkg.model_copy(
            update={
                # 讲义/速记不附教材原图：老项目在读盘时也一并清理内联截图链接。
                "study_notes_markdown": strip_document_images(
                    normalize_markdown_math(pkg.study_notes_markdown)
                ),
                "cheatsheet_markdown": strip_document_images(
                    normalize_markdown_math(pkg.cheatsheet_markdown)
                ),
            }
        )
    return None


def _save_package(project_id: str, package: StudyPackage) -> None:
    pdir = get_project_dir(project_id)
    (pdir / "study_package.json").write_text(package.model_dump_json(indent=2), encoding="utf-8")


@app.get("/api/health")
async def health_check() -> Dict[str, str]:
    from app.config import BASE_DIR

    return {"status": "ok", "workspace": str(BASE_DIR.parent)}


@app.get("/api/providers/status", response_model=ProviderStatusResponse)
async def get_providers_status() -> ProviderStatusResponse:
    settings = load_settings()
    harnesses = detect_installed_harnesses()
    magpie_info = detect_free_ai_apps_and_magpie(settings.free_ai_auth.magpie_gateway_url)
    gpu_vram = detect_gpu_vram(settings.ocr_config.vram_override_gb)
    ocr_engines = await get_ocr_engines_status(settings)
    ocr_summary = await resolve_effective_ocr_engine(settings)
    return ProviderStatusResponse(
        settings=redact_settings(settings),
        harnesses=harnesses,
        free_ai_apps=magpie_info["free_ai_apps"],
        magpie_available=magpie_info["magpie_available"],
        magpie_gateway_running=magpie_info["magpie_gateway_running"],
        magpie_models=magpie_info["magpie_models"],
        dsh_available=magpie_info["dsh_available"],
        rapidocr_available=is_rapidocr_available(),
        gpu_vram=gpu_vram,
        ocr_engines=ocr_engines,
        ocr_summary=ocr_summary,
    )


@app.get("/api/ocr/vram-detect")
async def detect_ocr_vram_tier(vram_override_gb: Optional[float] = None) -> Dict[str, Any]:
    settings = load_settings()
    effective_override = vram_override_gb if vram_override_gb is not None else settings.ocr_config.vram_override_gb
    gpu_vram = detect_gpu_vram(effective_override)
    ocr_engines = await get_ocr_engines_status(settings)
    ocr_summary = await resolve_effective_ocr_engine(settings)
    return {
        "gpu_vram": gpu_vram.model_dump(),
        "ocr_engines": [item.model_dump() for item in ocr_engines],
        "ocr_summary": ocr_summary,
    }


@app.get("/api/ocr/probe-oxr")
async def probe_oxr_status() -> Dict[str, Any]:
    """Read-only probe for local OXR availability; never downloads or installs anything."""
    settings = load_settings()
    return await probe_local_oxr_only(settings)


@app.get("/api/exam-agents/souls")
async def get_exam_agent_souls() -> Dict[str, Any]:
    return {"souls": get_exam_agent_souls_payload()}


@app.post("/api/ocr/setup")
async def setup_ocr_backend(payload: Dict[str, Any]) -> Any:
    engine_id = str(payload.get("engine_id") or "mineru_pipeline")
    action = str(payload.get("action") or "install_and_start")
    stream = bool(payload.get("stream", False))
    settings = load_settings()

    if stream:
        async def event_gen():
            try:
                async for evt in stream_setup_ocr_engine(engine_id, settings, action=action):  # type: ignore
                    yield f"data: {json.dumps(evt, ensure_ascii=False)}\n\n"
            except Exception as exc:
                yield f"data: {json.dumps({'type': 'error', 'percent': 100, 'stage': '执行异常', 'message': str(exc)}, ensure_ascii=False)}\n\n"

        return StreamingResponse(event_gen(), media_type="text/event-stream")

    return await setup_ocr_engine(engine_id, settings, action=action)  # type: ignore


@app.post("/api/harnesses/install")
async def install_harness_cli(payload: Dict[str, Any]) -> Any:
    cli_name = str(payload.get("cli_name") or "dsh")
    action = str(payload.get("action") or "install")
    stream = bool(payload.get("stream", False))

    if stream:
        async def event_gen():
            try:
                async for evt in stream_manage_cli_harness(cli_name, action=action):
                    yield f"data: {json.dumps(evt, ensure_ascii=False)}\n\n"
            except Exception as exc:
                yield f"data: {json.dumps({'type': 'error', 'percent': 100, 'stage': '执行异常', 'message': str(exc)}, ensure_ascii=False)}\n\n"

        return StreamingResponse(event_gen(), media_type="text/event-stream")

    return await install_cli_harness(cli_name, action=action)


@app.post("/api/harnesses/uninstall")
async def uninstall_harness_cli(payload: Dict[str, Any]) -> Any:
    cli_name = str(payload.get("cli_name") or "dsh")
    stream = bool(payload.get("stream", False))

    if stream:
        async def event_gen():
            try:
                async for evt in stream_manage_cli_harness(cli_name, action="uninstall"):
                    yield f"data: {json.dumps(evt, ensure_ascii=False)}\n\n"
            except Exception as exc:
                yield f"data: {json.dumps({'type': 'error', 'percent': 100, 'stage': '执行异常', 'message': str(exc)}, ensure_ascii=False)}\n\n"

        return StreamingResponse(event_gen(), media_type="text/event-stream")

    return await uninstall_cli_harness(cli_name)


@app.post("/api/harnesses/setup-magpie-dsh")
async def setup_magpie_and_dsh_endpoint(payload: Optional[Dict[str, Any]] = None) -> Any:
    settings = load_settings()
    gateway_url = str((payload or {}).get("gateway_url") or settings.free_ai_auth.magpie_gateway_url or "http://127.0.0.1:3425/v1")
    stream = bool((payload or {}).get("stream", True))

    if stream:
        async def event_gen():
            try:
                async for evt in stream_setup_magpie_and_dsh(gateway_url):
                    yield f"data: {json.dumps(evt, ensure_ascii=False)}\n\n"
            except Exception as exc:
                yield f"data: {json.dumps({'type': 'error', 'progress': 100, 'ok': False, 'message': str(exc)}, ensure_ascii=False)}\n\n"

        return StreamingResponse(event_gen(), media_type="text/event-stream")

    last_evt: Dict[str, Any] = {"ok": False, "message": "未执行任何步骤"}
    async for evt in stream_setup_magpie_and_dsh(gateway_url):
        last_evt = evt
    return last_evt


@app.post("/api/harnesses/authorize-free-ai", response_model=RouterSettings)
async def authorize_free_ai_proxy(payload: Dict[str, Any]) -> RouterSettings:
    settings = load_settings()
    authorized = bool(payload.get("authorized", True))
    cur = settings.free_ai_auth
    updated_auth = cur.model_copy(
        update={
            "authorized_use_local_ai": authorized,
            "authorized_at": datetime.now().isoformat() if authorized else None,
            "preferred_proxy_mode": str(payload.get("preferred_proxy_mode") or cur.preferred_proxy_mode),
            "selected_free_model": str(payload.get("selected_free_model") or cur.selected_free_model),
            "magpie_gateway_url": str(payload.get("magpie_gateway_url") or cur.magpie_gateway_url),
        }
    )
    updated = save_settings(settings.model_copy(update={"free_ai_auth": updated_auth}))
    return redact_settings(updated)


@app.post("/api/providers/settings", response_model=RouterSettings)
async def update_provider_settings(settings: RouterSettings) -> RouterSettings:
    return redact_settings(save_settings(settings))


@app.post("/api/providers/test")
async def test_provider_connection(payload: Dict[str, Any]) -> Dict[str, Any]:
    provider = payload.get("provider", "harness")
    if provider not in ("harness", "cloud"):
        provider = "harness"
    settings = load_settings()

    if isinstance(payload.get("cloud_config"), dict):
        raw_cloud = dict(payload["cloud_config"])
        if not raw_cloud.get("api_key") or "****" in str(raw_cloud.get("api_key", "")):
            raw_cloud["api_key"] = settings.cloud_config.api_key
        settings = settings.model_copy(update={"cloud_config": CloudConfig.model_validate(raw_cloud)})

    if isinstance(payload.get("free_ai_auth"), dict):
        raw_auth = dict(payload["free_ai_auth"])
        settings = settings.model_copy(update={"free_ai_auth": FreeAiAuthConfig.model_validate(raw_auth)})

    test_settings = settings.model_copy(update={"routing_mode": "single", "active_provider": provider, "enable_fallback": False})
    router = ModelRouter(test_settings)
    try:
        text, label = await router.execute_text(
            "requirement_negotiation",
            "你是连通性测试助手。",
            "请简短回复：连接成功。",
        )
        return {
            "ok": True,
            "provider": provider,
            "label": label,
            "sample_response": (text or "连接成功")[:120],
        }
    except Exception as exc:
        return {"ok": False, "provider": provider, "error": str(exc)}


@app.get("/api/presets", response_model=List[PresetTemplate])
async def list_presets() -> List[PresetTemplate]:
    return PRESET_TEMPLATES


@app.get("/api/projects", response_model=List[ProjectSummary])
async def list_projects() -> List[ProjectSummary]:
    items: List[ProjectSummary] = []
    if not PROJECTS_DIR.exists():
        return items
    for pdir in PROJECTS_DIR.iterdir():
        if not pdir.is_dir():
            continue
        ir_path = pdir / "document_ir.json"
        if not ir_path.exists():
            continue
        try:
            ir = DocumentIR.model_validate_json(ir_path.read_text(encoding="utf-8"))
            items.append(
                ProjectSummary(
                    project_id=ir.project_id,
                    project_type=ir.project_type,
                    filename=ir.filename,
                    workspace_title=ir.workspace_title,
                    file_type=ir.file_type,
                    created_at=ir.created_at,
                    total_pages_or_slides=ir.total_pages_or_slides,
                    chapter_count=len(ir.chapters),
                    has_blueprint=(pdir / "blueprint.json").exists(),
                    has_package=(pdir / "study_package.json").exists(),
                )
            )
        except Exception:
            continue
    items.sort(key=lambda x: x.created_at, reverse=True)
    return items


@app.post("/api/projects/upload", response_model=ProjectDetailResponse)
async def upload_document(
    file: UploadFile = File(...),
    default_preset_id: str = Form("A_beginner"),
) -> ProjectDetailResponse:
    if not file.filename:
        raise HTTPException(status_code=400, detail="文件名不能为空")
    suffix = Path(file.filename).suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件格式 {suffix}，支持: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
        )

    project_id = f"proj_{uuid.uuid4().hex[:8]}"
    pdir = get_project_dir(project_id)
    assets_dir = pdir / "assets"
    safe_name = Path(file.filename).name
    dest_path = pdir / safe_name
    content = await file.read()
    dest_path.write_bytes(content)

    settings = load_settings()
    try:
        doc_ir = await parse_uploaded_file(dest_path, project_id, assets_dir, settings)
    except Exception as exc:
        shutil.rmtree(pdir, ignore_errors=True)
        raise HTTPException(status_code=422, detail=f"文档解析失败: {exc}")

    _save_project_ir(doc_ir)
    preset = get_preset(default_preset_id)
    blueprint = build_default_blueprint_from_ir(doc_ir, preset)
    _save_blueprint(project_id, blueprint)
    return ProjectDetailResponse(document_ir=doc_ir, blueprint=blueprint, study_package=None)


@app.post("/api/projects/upload-stream")
async def upload_document_stream(
    file: UploadFile = File(...),
    default_preset_id: str = Form("A_beginner"),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="文件名不能为空")
    suffix = Path(file.filename).suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件格式 {suffix}，支持: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
        )

    project_id = f"proj_{uuid.uuid4().hex[:8]}"
    pdir = get_project_dir(project_id)
    assets_dir = pdir / "assets"
    safe_name = Path(file.filename).name
    dest_path = pdir / safe_name
    content = await file.read()
    dest_path.write_bytes(content)
    settings = load_settings()
    preset = get_preset(default_preset_id)

    async def event_stream():
        queue: asyncio.Queue[str] = asyncio.Queue()

        async def on_ocr_progress(percent: int, stage: str, message: str):
            payload = json.dumps(
                {"type": "progress", "percent": percent, "stage": stage, "message": message},
                ensure_ascii=False,
            )
            await queue.put(f"data: {payload}\n\n")

        async def runner():
            try:
                await on_ocr_progress(3, "upload_saved", f"文件《{safe_name}》已接收（{len(content) // 1024} KB），正在启动 OCR 引擎...")
                doc_ir = await parse_uploaded_file(
                    dest_path, project_id, assets_dir, settings, progress_cb=on_ocr_progress
                )
                _save_project_ir(doc_ir)
                blueprint = build_default_blueprint_from_ir(doc_ir, preset)
                _save_blueprint(project_id, blueprint)
                detail = ProjectDetailResponse(document_ir=doc_ir, blueprint=blueprint, study_package=None)
                done_payload = json.dumps(
                    {"type": "complete", "percent": 100, "detail": detail.model_dump()},
                    ensure_ascii=False,
                )
                await queue.put(f"data: {done_payload}\n\n")
            except Exception as exc:
                shutil.rmtree(pdir, ignore_errors=True)
                err_payload = json.dumps({"type": "error", "message": f"OCR 与解析失败: {exc}"}, ensure_ascii=False)
                await queue.put(f"data: {err_payload}\n\n")
            finally:
                await queue.put("__END__")

        task = asyncio.create_task(runner())
        try:
            while True:
                item = await queue.get()
                if item == "__END__":
                    break
                yield item
            await task
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/api/projects/demo", response_model=ProjectDetailResponse)
async def load_demo_project() -> ProjectDetailResponse:
    settings = load_settings()
    doc_ir = await create_demo_courseware_project(settings)
    # 示例资料是内置的，本来就不需要用户核对，直接标成已确认
    doc_ir.ocr_confirmed = True
    _save_project_ir(doc_ir)
    preset = get_preset("A_beginner")
    blueprint = build_default_blueprint_from_ir(doc_ir, preset)
    _save_blueprint(doc_ir.project_id, blueprint)
    return ProjectDetailResponse(document_ir=doc_ir, blueprint=blueprint, study_package=None)


@app.post("/api/projects/demo-stream")
async def load_demo_project_stream():
    settings = load_settings()

    async def event_stream():
        try:
            yield f"data: {json.dumps({'type': 'progress', 'percent': 15, 'stage': 'ocr_init', 'message': '正在装载示例课件：第1-3章 梯度下降与反向传播（含公式图片）...'}, ensure_ascii=False)}\n\n"
            await asyncio.sleep(0.18)
            yield f"data: {json.dumps({'type': 'progress', 'percent': 48, 'stage': 'ocr_vision', 'message': '正在识别课件公式图片并校验 LaTeX 块...'}, ensure_ascii=False)}\n\n"
            doc_ir = await create_demo_courseware_project(settings)
            doc_ir.ocr_confirmed = True
            _save_project_ir(doc_ir)
            yield f"data: {json.dumps({'type': 'progress', 'percent': 86, 'stage': 'ocr_done', 'message': f'已提取 {len(doc_ir.chapters)} 个章节与核心关键词，正在生成目录大纲...'}, ensure_ascii=False)}\n\n"
            await asyncio.sleep(0.12)
            preset = get_preset("A_beginner")
            blueprint = build_default_blueprint_from_ir(doc_ir, preset)
            _save_blueprint(doc_ir.project_id, blueprint)
            detail = ProjectDetailResponse(document_ir=doc_ir, blueprint=blueprint, study_package=None)
            yield f"data: {json.dumps({'type': 'complete', 'percent': 100, 'detail': detail.model_dump()}, ensure_ascii=False)}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/api/projects/upload-exam-stream")
async def upload_exam_stream(file: UploadFile = File(...)):
    """Upload an exam paper and extract text layer via forced OXR probing (local probe only -> Cloud OXR)."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="试卷文件名不能为空")
    suffix = Path(file.filename).suffix.lower()
    if suffix not in SUPPORTED_EXAM_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"试卷暂不支持格式 {suffix}，支持: {', '.join(sorted(SUPPORTED_EXAM_EXTENSIONS))}",
        )

    project_id = f"exam_{uuid.uuid4().hex[:8]}"
    pdir = get_project_dir(project_id)
    assets_dir = pdir / "assets"
    safe_name = Path(file.filename).name
    dest_path = pdir / safe_name
    content = await file.read()
    dest_path.write_bytes(content)
    settings = load_settings()

    async def event_stream():
        queue: asyncio.Queue[str] = asyncio.Queue()

        async def on_oxr_progress(percent: int, stage: str, message: str):
            payload = json.dumps(
                {"type": "progress", "percent": percent, "stage": stage, "message": message},
                ensure_ascii=False,
            )
            await queue.put(f"data: {payload}\n\n")

        async def runner():
            try:
                await on_oxr_progress(2, "oxr_probe", f"试卷《{safe_name}》已接收（{len(content) // 1024} KB），正在探查本地 OXR 状态...")
                doc_ir = await parse_uploaded_exam_file(
                    dest_path, project_id, assets_dir, settings, progress_cb=on_oxr_progress
                )
                _save_project_ir(doc_ir)
                preset = get_preset("B_consolidate")
                blueprint = build_default_blueprint_from_ir(doc_ir, preset)
                _save_blueprint(project_id, blueprint)
                detail = ProjectDetailResponse(document_ir=doc_ir, blueprint=blueprint, study_package=None)
                done_payload = json.dumps(
                    {"type": "complete", "percent": 100, "detail": detail.model_dump()},
                    ensure_ascii=False,
                )
                await queue.put(f"data: {done_payload}\n\n")
            except Exception as exc:
                shutil.rmtree(pdir, ignore_errors=True)
                err_payload = json.dumps({"type": "error", "message": f"试卷 OXR 提取失败: {exc}"}, ensure_ascii=False)
                await queue.put(f"data: {err_payload}\n\n")
            finally:
                await queue.put("__END__")

        task = asyncio.create_task(runner())
        try:
            while True:
                item = await queue.get()
                if item == "__END__":
                    break
                yield item
            await task
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/api/projects/demo-exam-stream")
async def load_demo_exam_stream():
    """Load built-in physiology/biophysics sample exam paper after running read-only OXR probe."""
    settings = load_settings()

    async def event_stream():
        try:
            yield f"data: {json.dumps({'type': 'progress', 'percent': 12, 'stage': 'oxr_probe', 'message': '正在探查本地 OXR 服务状态（仅探查不下载）...'}, ensure_ascii=False)}\n\n"
            await asyncio.sleep(0.14)
            doc_ir = await create_demo_exam_paper_project(settings)
            doc_ir.ocr_confirmed = True
            _save_project_ir(doc_ir)
            yield f"data: {json.dumps({'type': 'progress', 'percent': 65, 'stage': 'oxr_scanning', 'message': doc_ir.oxr_probe_summary}, ensure_ascii=False)}\n\n"
            await asyncio.sleep(0.14)
            preset = get_preset("B_consolidate")
            blueprint = build_default_blueprint_from_ir(doc_ir, preset)
            _save_blueprint(doc_ir.project_id, blueprint)
            detail = ProjectDetailResponse(document_ir=doc_ir, blueprint=blueprint, study_package=None)
            yield f"data: {json.dumps({'type': 'complete', 'percent': 100, 'detail': detail.model_dump()}, ensure_ascii=False)}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.get("/api/projects/{project_id}", response_model=ProjectDetailResponse)
async def get_project_detail(project_id: str) -> ProjectDetailResponse:
    doc_ir = _load_project_ir(project_id)
    return ProjectDetailResponse(
        document_ir=doc_ir,
        blueprint=_load_blueprint(project_id),
        study_package=_load_package(project_id),
    )


@app.delete("/api/projects/{project_id}")
async def delete_project(project_id: str) -> Dict[str, str]:
    pdir = _safe_project_dir(project_id)
    if not pdir.exists():
        raise HTTPException(status_code=404, detail="项目不存在")
    shutil.rmtree(pdir, ignore_errors=True)
    return {"status": "deleted", "project_id": project_id}


@app.post("/api/projects/{project_id}/rename")
async def rename_project(project_id: str, payload: Dict[str, Any]) -> Dict[str, str]:
    """Rename a workspace (display name only; the uploaded file keeps its own name)."""
    title = str(payload.get("title") or "").strip()
    if len(title) > 60:
        raise HTTPException(status_code=400, detail="工作区名称最长 60 个字符")
    doc_ir = _load_project_ir(project_id)
    updated = doc_ir.model_copy(update={"workspace_title": title})
    _save_project_ir(updated)
    return {
        "status": "renamed",
        "project_id": project_id,
        "workspace_title": title,
        "display_name": title or doc_ir.filename,
    }


@app.patch("/api/projects/{project_id}/document/chapters/{chapter_id}", response_model=DocumentIR)
async def update_chapter_text(project_id: str, chapter_id: str, payload: ChapterTextUpdate) -> DocumentIR:
    """在「识别结果确认」里订正某一节正文（OCR 把公式/中英文认错时的人工修补口）。"""
    doc_ir = _load_project_ir(project_id)
    target = next((c for c in doc_ir.chapters if c.chapter_id == chapter_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail=f"章节 {chapter_id} 不存在")
    target.content_text = (payload.content_text or "").replace("\r\n", "\n").strip()
    # 正文变了就必须重新确认，否则「我确认过的」和实际用于生成的文字对不上。
    doc_ir.ocr_confirmed = False
    doc_ir.ocr_confirmed_at = None
    _refresh_document_index(doc_ir)
    _save_project_ir(doc_ir)
    return doc_ir


@app.post("/api/projects/{project_id}/document/confirm", response_model=DocumentIR)
async def confirm_document_ocr(project_id: str) -> DocumentIR:
    """用户核对完 OCR 结果，确认无误后才允许继续生成资料。"""
    doc_ir = _load_project_ir(project_id)
    doc_ir.ocr_confirmed = True
    doc_ir.ocr_confirmed_at = datetime.now().isoformat(timespec="seconds")
    _save_project_ir(doc_ir)
    return doc_ir


@app.post("/api/projects/{project_id}/reparse")
async def reparse_project(project_id: str) -> Any:
    """重新识别已上传的原文件（换好 OCR 引擎后，不用重新上传整本书）。

    会清掉旧的章节切分与识别结果，从头按当前引擎重新跑一遍，并重置「已确认」状态。
    """
    doc_ir = _load_project_ir(project_id)
    pdir = _safe_project_dir(project_id)
    meta_files = {"document_ir.json", "blueprint.json", "study_package.json", "section_practice.json"}
    source = None
    for candidate in pdir.iterdir():
        if candidate.is_file() and candidate.name not in meta_files and not candidate.name.startswith("."):
            if candidate.suffix.lower() in SUPPORTED_EXTENSIONS | SUPPORTED_EXAM_EXTENSIONS:
                source = candidate
                break
    if source is None:
        raise HTTPException(status_code=404, detail="找不到原始上传文件，无法重新识别")

    settings = load_settings()

    async def event_stream():
        queue: asyncio.Queue[str] = asyncio.Queue()

        async def on_progress(percent: int, stage: str, message: str):
            payload = json.dumps(
                {"type": "progress", "percent": percent, "stage": stage, "message": message},
                ensure_ascii=False,
            )
            await queue.put(f"data: {payload}\n\n")

        async def runner():
            try:
                assets_dir = pdir / "assets"
                assets_dir.mkdir(parents=True, exist_ok=True)
                fresh = await parse_uploaded_file(source, project_id, assets_dir, settings, progress_cb=on_progress)
                fresh.workspace_title = doc_ir.workspace_title
                fresh.project_type = doc_ir.project_type
                _save_project_ir(fresh)
                blueprint = build_default_blueprint_from_ir(fresh, get_preset("A_beginner"))
                _save_blueprint(project_id, blueprint)
                detail = ProjectDetailResponse(document_ir=fresh, blueprint=blueprint, study_package=None)
                payload = json.dumps(
                    {
                        "type": "complete",
                        "percent": 100,
                        "message": (
                            f"重新识别完成：{len(fresh.chapters)} 段、{fresh.total_chars:,} 字"
                            f"（{fresh.ocr_pages_ok}/{fresh.ocr_pages_total or fresh.total_pages_or_slides} 页成功）"
                        ),
                        "detail": detail.model_dump(),
                    },
                    ensure_ascii=False,
                )
                await queue.put(f"data: {payload}\n\n")
            except Exception as exc:
                err = json.dumps({"type": "error", "message": f"重新识别失败: {exc}"}, ensure_ascii=False)
                await queue.put(f"data: {err}\n\n")
            finally:
                await queue.put("__END__")

        task = asyncio.create_task(runner())
        try:
            while True:
                item = await queue.get()
                if item == "__END__":
                    break
                yield item
            await task
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.get("/api/projects/{project_id}/annotations")
async def list_handout_annotations(project_id: str) -> Dict[str, Any]:
    """讲义页边批注（含已钉住的康奈尔批注）列表。"""
    _load_project_ir(project_id)
    return {"items": [row.model_dump() for row in load_annotations(project_id)]}


@app.post("/api/projects/{project_id}/annotations", response_model=HandoutAnnotation)
async def save_handout_annotation(project_id: str, payload: HandoutAnnotation) -> HandoutAnnotation:
    """新增或更新一条划词高亮/页边批注。"""
    _load_project_ir(project_id)
    return upsert_annotation(project_id, payload)


@app.delete("/api/projects/{project_id}/annotations/{annotation_id}")
async def remove_handout_annotation(project_id: str, annotation_id: str) -> Dict[str, Any]:
    _load_project_ir(project_id)
    return {"deleted": delete_annotation(project_id, annotation_id), "annotation_id": annotation_id}


@app.post("/api/projects/{project_id}/micro-tutor", response_model=MicroTutorResponse)
async def micro_tutor_card(project_id: str, payload: MicroTutorRequest) -> MicroTutorResponse:
    """Agent 5 伴读微导师：把划词/点图焦点变成一张页边批注卡。"""
    doc_ir = _load_project_ir(project_id)
    settings = load_settings()
    router = ModelRouter(settings)
    req = payload
    if not req.document_title:
        req = req.model_copy(update={"document_title": doc_ir.workspace_title or doc_ir.filename})
    return await generate_micro_tutor_card(req, router)


@app.delete("/api/projects/{project_id}/package")
async def revoke_project_package(project_id: str) -> Dict[str, Any]:
    """Revoke Stage 2 study package and unlock Stage 1 blueprint refinement."""
    _load_project_ir(project_id)
    pdir = _safe_project_dir(project_id)
    pkg_path = pdir / "study_package.json"
    if pkg_path.exists():
        pkg_path.unlink(missing_ok=True)
    bp = _load_blueprint(project_id)
    if bp is not None:
        bp = bp.model_copy(update={"confirmed": False})
        _save_blueprint(project_id, bp)
    return {"status": "revoked", "project_id": project_id, "blueprint": bp}


@app.get("/api/projects/{project_id}/assets/{filename}")
async def get_project_asset(project_id: str, filename: str) -> FileResponse:
    asset_path = _safe_project_dir(project_id) / "assets" / Path(filename).name
    if not asset_path.exists():
        raise HTTPException(status_code=404, detail="图片资源不存在")
    return FileResponse(asset_path)


@app.post("/api/projects/{project_id}/negotiate", response_model=StudyBlueprint)
async def negotiate_requirements(project_id: str, req: NegotiateRequest) -> StudyBlueprint:
    doc_ir = _load_project_ir(project_id)
    settings = load_settings()
    router = ModelRouter(settings)
    current_bp = req.current_blueprint or _load_blueprint(project_id)
    try:
        blueprint = await negotiate_study_blueprint(
            document_ir=doc_ir,
            preset_id=req.preset_id,
            user_prompt=req.user_prompt,
            current_blueprint=current_bp,
            router=router,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    _save_blueprint(project_id, blueprint)
    return blueprint


@app.post("/api/projects/{project_id}/ai-fill-params", response_model=StudyBlueprint)
async def ai_fill_blueprint_params(project_id: str, req: NegotiateRequest) -> StudyBlueprint:
    """AI calculation of optimal question counts, timing, score, and focus topics for A/B/C scenario."""
    doc_ir = _load_project_ir(project_id)
    settings = load_settings()
    router = ModelRouter(settings)
    current_bp = req.current_blueprint or _load_blueprint(project_id)
    try:
        updated_bp = await ai_fill_study_blueprint(
            document_ir=doc_ir,
            preset_id=req.preset_id,
            user_prompt=req.user_prompt,
            current_blueprint=current_bp,
            router=router,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    _save_blueprint(project_id, updated_bp)
    return updated_bp


@app.post("/api/projects/{project_id}/section-practice")
async def create_section_practice(project_id: str, payload: Dict[str, Any]) -> Any:
    """按讲义小节生成/取出分节练习（同一节同一份讲义只生成一次，结果落盘缓存）。"""
    package = _load_package(project_id)
    if package is None:
        raise HTTPException(status_code=404, detail="该项目尚未生成讲义，请先完成生成")
    notes = package.study_notes_markdown or ""
    sections = extract_note_sections(notes)
    if not sections:
        raise HTTPException(status_code=400, detail="当前讲义没有可切分的小节，无法生成分节练习")

    section_id = str(payload.get("section_id") or "").strip()
    section = next((s for s in sections if s["section_id"] == section_id), None)
    if section is None:
        raise HTTPException(status_code=404, detail=f"未找到小节 {section_id}")

    fingerprint = notes_fingerprint(notes)
    project_dir = _safe_project_dir(project_id)
    cached = load_section_practice_cache(project_dir, fingerprint)
    if section_id in cached:
        return {"paper": cached[section_id], "cached": True}

    blueprint = _load_blueprint(project_id) or package.blueprint_used
    doc_ir = _load_project_ir(project_id)
    settings = load_settings()
    router = ModelRouter(settings)
    try:
        paper = await generate_section_practice(
            section=section,
            blueprint=blueprint,
            document_ir=doc_ir,
            total_sections=len(sections),
            router=router,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    cached[section_id] = json.loads(paper.model_dump_json())
    save_section_practice_cache(project_dir, fingerprint, cached)
    return {"paper": cached[section_id], "cached": False}


@app.get("/api/projects/{project_id}/sections")
async def list_note_sections(project_id: str) -> Dict[str, Any]:
    """讲义小节列表 + 每节是否已经有分节练习缓存（供前端「分节练习」导航使用）。"""
    package = _load_package(project_id)
    if package is None:
        raise HTTPException(status_code=404, detail="该项目尚未生成讲义")
    notes = package.study_notes_markdown or ""
    fingerprint = notes_fingerprint(notes)
    sections = extract_note_sections(notes)
    cached = load_section_practice_cache(_safe_project_dir(project_id), fingerprint)
    return {
        "notes_fingerprint": fingerprint,
        "sections": [
            {
                "section_id": s["section_id"],
                "title": s["title"],
                "level": s["level"],
                "char_count": s["char_count"],
                "has_practice": s["section_id"] in cached,
            }
            for s in sections
        ],
    }


@app.post("/api/projects/{project_id}/variant-question")
async def create_variant_question(project_id: str, req: VariantQuestionRequest) -> Dict[str, Any]:
    """Generate one fresh variant question targeting the same knowledge point as an existing quiz item."""
    doc_ir = _load_project_ir(project_id)
    settings = load_settings()
    router = ModelRouter(settings)
    try:
        new_q = await generate_variant_question(
            document_ir=doc_ir,
            source_question=req.source_question,
            selected_chapter_ids=req.selected_chapter_ids,
            router=router,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    package = _load_package(project_id)
    if package is not None and package.quiz_paper is not None:
        updated_qs = [*package.quiz_paper.questions, new_q]
        updated_paper = package.quiz_paper.model_copy(
            update={
                "questions": updated_qs,
                "total_score": sum(q.score for q in updated_qs),
            }
        )
        _save_package(project_id, package.model_copy(update={"quiz_paper": updated_paper}))
    return {"question": new_q.model_dump()}


from app.router.harness_provider import HarnessCancelToken

_ACTIVE_GENERATIONS: dict[str, tuple[HarnessCancelToken, asyncio.Task | None]] = {}


def _cancel_active_generation(project_id: str) -> bool:
    entry = _ACTIVE_GENERATIONS.get(project_id)
    if not entry:
        return False
    token, task = entry
    token.cancel()
    if task is not None and not task.done():
        task.cancel()
    return True


@app.post("/api/projects/{project_id}/cancel")
async def cancel_generation(project_id: str):
    cancelled = _cancel_active_generation(project_id)
    return {"status": "cancelled" if cancelled else "idle", "project_id": project_id}


@app.post("/api/projects/{project_id}/generate")
async def generate_materials(project_id: str, req: GenerateRequest):
    doc_ir = _load_project_ir(project_id)
    settings = load_settings()
    _cancel_active_generation(project_id)
    cancel_token = HarnessCancelToken()
    router = ModelRouter(settings, cancel_token=cancel_token)
    _save_blueprint(project_id, req.blueprint)

    if not req.stream:
        task = asyncio.current_task()
        _ACTIVE_GENERATIONS[project_id] = (cancel_token, task)
        try:
            package = await generate_study_package(doc_ir, req.blueprint, router)
            cancel_token.raise_if_cancelled()
            _save_package(project_id, package)
            return package
        except asyncio.CancelledError:
            cancel_token.cancel()
            raise HTTPException(status_code=499, detail="生成任务已取消")
        finally:
            cur = _ACTIVE_GENERATIONS.get(project_id)
            if cur and cur[0] is cancel_token:
                _ACTIVE_GENERATIONS.pop(project_id, None)

    async def event_stream():
        queue: asyncio.Queue[str] = asyncio.Queue()

        async def on_progress(stage: str, percent: int, message: str):
            payload = json.dumps(
                {"type": "progress", "stage": stage, "percent": percent, "message": message},
                ensure_ascii=False,
            )
            await queue.put(f"data: {payload}\n\n")

        async def runner():
            try:
                package = await generate_study_package(
                    doc_ir, req.blueprint, router, progress_cb=on_progress
                )
                cancel_token.raise_if_cancelled()
                _save_package(project_id, package)
                done_payload = json.dumps(
                    {"type": "complete", "package": package.model_dump()},
                    ensure_ascii=False,
                )
                await queue.put(f"data: {done_payload}\n\n")
            except asyncio.CancelledError:
                cancel_token.cancel()
                cancel_payload = json.dumps(
                    {"type": "cancelled", "message": "生成任务已取消，后台子进程已终止"},
                    ensure_ascii=False,
                )
                await queue.put(f"data: {cancel_payload}\n\n")
            except Exception as exc:
                err_payload = json.dumps(
                    {"type": "error", "message": str(exc)}, ensure_ascii=False
                )
                await queue.put(f"data: {err_payload}\n\n")
            finally:
                cur = _ACTIVE_GENERATIONS.get(project_id)
                if cur and cur[0] is cancel_token:
                    _ACTIVE_GENERATIONS.pop(project_id, None)
                await queue.put("__END__")

        task = asyncio.create_task(runner())
        _ACTIVE_GENERATIONS[project_id] = (cancel_token, task)
        try:
            while True:
                item = await queue.get()
                if item == "__END__":
                    break
                yield item
            await task
        finally:
            if not task.done():
                cancel_token.cancel()
                task.cancel()
                try:
                    await task
                except BaseException:
                    pass
            cur = _ACTIVE_GENERATIONS.get(project_id)
            if cur and cur[0] is cancel_token:
                _ACTIVE_GENERATIONS.pop(project_id, None)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/api/projects/{project_id}/generate-exam")
async def generate_exam_materials(project_id: str, req: ExamGenerateRequest):
    """Execute Exam Paper Direction 1 (original_to_bank), Direction 2 (similar_paper via A/B/C/D), or Direction 3 (both)."""
    doc_ir = _load_project_ir(project_id)
    pdir = _safe_project_dir(project_id)
    if req.raw_exam_text_override and req.raw_exam_text_override.strip() != (doc_ir.raw_exam_text or "").strip():
        doc_ir = doc_ir.model_copy(
            update={
                "raw_exam_text": req.raw_exam_text_override.strip(),
                "total_chars": len(req.raw_exam_text_override.strip()),
            }
        )
        _save_project_ir(doc_ir)

    settings = load_settings()
    _cancel_active_generation(project_id)
    cancel_token = HarnessCancelToken()
    router = ModelRouter(settings, cancel_token=cancel_token)

    if not req.stream:
        task = asyncio.current_task()
        _ACTIVE_GENERATIONS[project_id] = (cancel_token, task)
        try:
            package = await generate_exam_study_package(
                doc_ir=doc_ir,
                direction=req.direction,
                user_requirements=req.user_requirements,
                project_dir=pdir,
                router=router,
                raw_exam_text_override=req.raw_exam_text_override,
            )
            cancel_token.raise_if_cancelled()
            _save_blueprint(project_id, package.blueprint_used)
            _save_package(project_id, package)
            return package
        except asyncio.CancelledError:
            cancel_token.cancel()
            raise HTTPException(status_code=499, detail="试卷生成任务已取消")
        finally:
            cur = _ACTIVE_GENERATIONS.get(project_id)
            if cur and cur[0] is cancel_token:
                _ACTIVE_GENERATIONS.pop(project_id, None)

    async def event_stream():
        queue: asyncio.Queue[str] = asyncio.Queue()

        async def on_exam_progress(evt: Dict[str, Any]):
            payload = json.dumps({"type": "progress", **evt}, ensure_ascii=False)
            await queue.put(f"data: {payload}\n\n")

        async def runner():
            try:
                package = await generate_exam_study_package(
                    doc_ir=doc_ir,
                    direction=req.direction,
                    user_requirements=req.user_requirements,
                    project_dir=pdir,
                    router=router,
                    raw_exam_text_override=req.raw_exam_text_override,
                    progress_cb=on_exam_progress,
                )
                cancel_token.raise_if_cancelled()
                _save_blueprint(project_id, package.blueprint_used)
                _save_package(project_id, package)
                done_payload = json.dumps(
                    {"type": "complete", "percent": 100, "package": package.model_dump()},
                    ensure_ascii=False,
                )
                await queue.put(f"data: {done_payload}\n\n")
            except asyncio.CancelledError:
                cancel_token.cancel()
                cancel_payload = json.dumps(
                    {"type": "cancelled", "message": "试卷生成任务已取消，后台 Agent 子进程已终止"},
                    ensure_ascii=False,
                )
                await queue.put(f"data: {cancel_payload}\n\n")
            except Exception as exc:
                err_payload = json.dumps({"type": "error", "message": str(exc)}, ensure_ascii=False)
                await queue.put(f"data: {err_payload}\n\n")
            finally:
                cur = _ACTIVE_GENERATIONS.get(project_id)
                if cur and cur[0] is cancel_token:
                    _ACTIVE_GENERATIONS.pop(project_id, None)
                await queue.put("__END__")

        task = asyncio.create_task(runner())
        _ACTIVE_GENERATIONS[project_id] = (cancel_token, task)
        try:
            while True:
                item = await queue.get()
                if item == "__END__":
                    break
                yield item
            await task
        finally:
            if not task.done():
                cancel_token.cancel()
                task.cancel()
                try:
                    await task
                except BaseException:
                    pass
            cur = _ACTIVE_GENERATIONS.get(project_id)
            if cur and cur[0] is cancel_token:
                _ACTIVE_GENERATIONS.pop(project_id, None)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/api/projects/{project_id}/quick-generate", response_model=StudyPackage)
async def quick_generate_from_preset(project_id: str, req: QuickGenerateRequest) -> StudyPackage:
    doc_ir = _load_project_ir(project_id)
    preset = get_preset(req.preset_id)
    settings = load_settings()
    _cancel_active_generation(project_id)
    cancel_token = HarnessCancelToken()
    router = ModelRouter(settings, cancel_token=cancel_token)

    blueprint = build_default_blueprint_from_ir(
        doc_ir, preset, user_prompt=req.user_prompt
    )
    if req.selected_chapter_ids:
        valid_ids = {c.chapter_id for c in doc_ir.chapters}
        filtered = [cid for cid in req.selected_chapter_ids if cid in valid_ids]
        if filtered:
            blueprint.selected_chapter_ids = filtered
    blueprint.confirmed = True
    _save_blueprint(project_id, blueprint)

    task = asyncio.current_task()
    _ACTIVE_GENERATIONS[project_id] = (cancel_token, task)
    try:
        package = await generate_study_package(doc_ir, blueprint, router)
        cancel_token.raise_if_cancelled()
        _save_package(project_id, package)
        return package
    except asyncio.CancelledError:
        cancel_token.cancel()
        raise HTTPException(status_code=499, detail="生成任务已取消")
    finally:
        cur = _ACTIVE_GENERATIONS.get(project_id)
        if cur and cur[0] is cancel_token:
            _ACTIVE_GENERATIONS.pop(project_id, None)


def _build_pdf_export_response(
    project_id: str,
    doc_type: str,
    paper_size: str,
    include_answers: bool,
    inline: bool = False,
    paper_id: Optional[str] = None,
    notes_mode: str = "clean",
) -> Response:
    doc_ir = _load_project_ir(project_id)
    package = _load_package(project_id)
    if not package:
        raise HTTPException(status_code=404, detail="该项目尚未生成学习资料包，请先完成生成")

    size = "a3" if paper_size.lower() == "a3" else "a4"
    assets_dir = _safe_project_dir(project_id) / "assets"
    base_name = Path(doc_ir.filename).stem

    if doc_type == "quiz":
        all_papers = [package.quiz_paper, *(package.extra_quiz_papers or [])]
        selected_paper = package.quiz_paper
        if paper_id:
            for p in all_papers:
                if p.paper_id == paper_id or p.deliverable_type == paper_id:
                    selected_paper = p
                    break
        if not selected_paper.questions:
            raise HTTPException(status_code=400, detail="当前所选试卷未生成题库试题")
        pdf_bytes = export_quiz_pdf_bytes(
            doc_ir,
            package,
            paper_size=size,  # type: ignore[arg-type]
            include_answers=include_answers,
            assets_dir=assets_dir,
            quiz_override=selected_paper,
        )
        paper_suffix = f"_{selected_paper.deliverable_type}" if selected_paper.deliverable_type not in ("quiz", "none") else ""
        suffix = f"{paper_suffix}_{size.upper()}{'双栏密封线试卷' if size == 'a3' else '标准试卷'}{'_含答案解析' if include_answers else ''}.pdf"
    elif doc_type == "cheatsheet":
        pdf_bytes = export_cheatsheet_pdf_bytes(
            doc_ir,
            package,
            paper_size=size,  # type: ignore[arg-type]
            assets_dir=assets_dir,
        )
        suffix = f"_{size.upper()}考前速记表.pdf"
    else:
        pdf_bytes = export_study_guide_pdf_bytes(
            doc_ir,
            package,
            paper_size=size,  # type: ignore[arg-type]
            include_answers=include_answers,
            assets_dir=assets_dir,
            notes_mode="cornell" if notes_mode == "cornell" else "clean",  # type: ignore[arg-type]
            annotations=load_annotations(project_id) if notes_mode == "cornell" else None,
        )
        suffix = f"_{size.upper()}印刷讲义与知识提取{'_带页边批注' if notes_mode == 'cornell' else ''}.pdf"

    filename = f"{base_name}{suffix}"
    encoded_name = quote(filename)
    disp_kind = "inline" if inline else "attachment"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"{disp_kind}; filename=\"export.pdf\"; filename*=UTF-8''{encoded_name}"
        },
    )


@app.get("/api/projects/{project_id}/export-pdf")
async def export_project_pdf_get(
    project_id: str,
    doc_type: str = Query("quiz"),
    paper_size: str = Query("a4"),
    include_answers: bool = Query(True),
    inline: bool = Query(True),
    paper_id: Optional[str] = Query(None),
) -> Response:
    return _build_pdf_export_response(project_id, doc_type, paper_size, include_answers, inline=inline, paper_id=paper_id)


@app.post("/api/projects/{project_id}/export-pdf")
async def export_project_pdf_post(project_id: str, payload: Dict[str, Any]) -> Response:
    doc_type = str(payload.get("doc_type") or "quiz")
    paper_size = str(payload.get("paper_size") or "a4")
    include_answers = bool(payload.get("include_answers", True))
    paper_id = payload.get("paper_id")
    notes_mode = str(payload.get("notes_mode") or "clean")
    return _build_pdf_export_response(
        project_id, doc_type, paper_size, include_answers, inline=False, paper_id=paper_id, notes_mode=notes_mode
    )


@app.get("/api/system/update-status")
async def system_update_status(fetch: bool = Query(False)) -> Dict[str, Any]:
    return await asyncio.to_thread(get_update_status, fetch)


@app.post("/api/system/pull-update")
async def system_pull_update(payload: Optional[Dict[str, Any]] = None) -> Any:
    body = payload or {}
    rebuild_frontend = bool(body.get("rebuild_frontend", True))
    install_deps = bool(body.get("install_deps", True))
    rebuild_desktop = bool(body.get("rebuild_desktop", True))
    stream = bool(body.get("stream", True))
    if stream:
        return StreamingResponse(
            pull_and_apply_update_stream(
                rebuild_frontend=rebuild_frontend,
                install_deps=install_deps,
                rebuild_desktop=rebuild_desktop,
            ),
            media_type="text/event-stream",
        )
    last_result: Dict[str, Any] = {"ok": False}
    async for chunk in pull_and_apply_update_stream(
        rebuild_frontend=rebuild_frontend,
        install_deps=install_deps,
        rebuild_desktop=rebuild_desktop,
    ):
        if chunk.startswith("data:"):
            try:
                evt = json.loads(chunk.replace("data:", "", 1).strip())
                if evt.get("type") == "complete" and isinstance(evt.get("result"), dict):
                    last_result = evt["result"]
            except Exception:
                pass
    return last_result


@app.post("/api/system/webhook/push")
async def system_webhook_push() -> Dict[str, Any]:
    """Webhook endpoint to notify this instance immediately when a remote Push lands."""
    return await asyncio.to_thread(record_push_webhook)


# Serve built frontend bundle on single port (8000) for standalone desktop EXE & production use
FRONTEND_DIST_DIR = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if FRONTEND_DIST_DIR.exists() and (FRONTEND_DIST_DIR / "index.html").exists():
    assets_sub = FRONTEND_DIST_DIR / "assets"

    @app.get("/assets/{asset_name:path}")
    async def serve_frontend_asset(asset_name: str) -> Response:
        safe_name = Path(asset_name).name
        if not safe_name or not assets_sub.exists():
            raise HTTPException(status_code=404, detail="Asset not found")
        exact = assets_sub / safe_name
        if exact.is_file():
            return FileResponse(exact)
        # Fallback for stale hashed chunk names when an open tab references an older build hash
        if "-" in safe_name and "." in safe_name:
            stem, ext = safe_name.rsplit(".", 1)
            prefix = stem.rsplit("-", 1)[0]
            matches = sorted(assets_sub.glob(f"{prefix}-*.{ext}"))
            if matches and matches[0].is_file():
                return FileResponse(matches[0])
        raise HTTPException(status_code=404, detail="Asset not found")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str) -> FileResponse:
        if full_path.startswith("api/") or full_path.startswith("assets/"):
            raise HTTPException(status_code=404, detail="Resource not found")
        candidate = FRONTEND_DIST_DIR / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST_DIR / "index.html")
