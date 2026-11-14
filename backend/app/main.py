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
from app.parsers import SUPPORTED_EXTENSIONS, parse_uploaded_file
from app.parsers.ocr_engine import (
    detect_gpu_vram,
    get_ocr_engines_status,
    is_rapidocr_available,
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
    CloudConfig,
    DocumentIR,
    FreeAiAuthConfig,
    GenerateRequest,
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
    generate_study_package,
    generate_variant_question,
    get_preset,
    negotiate_study_blueprint,
)
from app.workflows.demo_project import create_demo_courseware_project
from app.workflows.generator import normalize_markdown_math
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
    description="智能课本/课件学习资料生成系统后端服务",
    version="1.0.0",
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
                "study_notes_markdown": normalize_markdown_math(pkg.study_notes_markdown),
                "cheatsheet_markdown": normalize_markdown_math(pkg.cheatsheet_markdown),
            }
        )
    return None


def _save_package(project_id: str, package: StudyPackage) -> None:
    pdir = get_project_dir(project_id)
    (pdir / "study_package.json").write_text(package.model_dump_json(indent=2), encoding="utf-8")


@app.get("/api/health")
async def health_check() -> Dict[str, str]:
    return {"status": "ok", "workspace": r"D:\auto_study_guidance"}


@app.get("/api/providers/status", response_model=ProviderStatusResponse)
async def get_providers_status() -> ProviderStatusResponse:
    settings = load_settings()
    harnesses = detect_installed_harnesses()
    magpie_info = detect_free_ai_apps_and_magpie(settings.free_ai_auth.magpie_gateway_url)
    gpu_vram = detect_gpu_vram(settings.ocr_config.vram_override_gb)
    ocr_engines = await get_ocr_engines_status(settings)
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
    )


@app.get("/api/ocr/vram-detect")
async def detect_ocr_vram_tier(vram_override_gb: Optional[float] = None) -> Dict[str, Any]:
    settings = load_settings()
    effective_override = vram_override_gb if vram_override_gb is not None else settings.ocr_config.vram_override_gb
    gpu_vram = detect_gpu_vram(effective_override)
    ocr_engines = await get_ocr_engines_status(settings)
    return {
        "gpu_vram": gpu_vram.model_dump(),
        "ocr_engines": [item.model_dump() for item in ocr_engines],
    }


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
                    filename=ir.filename,
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
        )
        suffix = f"_{size.upper()}印刷讲义与知识提取.pdf"

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
    return _build_pdf_export_response(project_id, doc_type, paper_size, include_answers, inline=False, paper_id=paper_id)


@app.get("/api/system/update-status")
async def system_update_status(fetch: bool = Query(False)) -> Dict[str, Any]:
    return await asyncio.to_thread(get_update_status, fetch)


@app.post("/api/system/pull-update")
async def system_pull_update(payload: Optional[Dict[str, Any]] = None) -> Any:
    body = payload or {}
    rebuild_frontend = bool(body.get("rebuild_frontend", True))
    stream = bool(body.get("stream", True))
    if stream:
        return StreamingResponse(
            pull_and_apply_update_stream(rebuild_frontend=rebuild_frontend),
            media_type="text/event-stream",
        )
    last_result: Dict[str, Any] = {"ok": False}
    async for chunk in pull_and_apply_update_stream(rebuild_frontend=rebuild_frontend):
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
