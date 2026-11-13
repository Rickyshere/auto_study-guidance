from __future__ import annotations

import asyncio
import json
import shutil
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse

from app.config import PROJECTS_DIR, get_project_dir, load_settings, save_settings
from app.parsers import SUPPORTED_EXTENSIONS, parse_uploaded_file
from app.parsers.ocr_engine import (
    detect_gpu_vram,
    get_ocr_engines_status,
    is_rapidocr_available,
    setup_ocr_engine,
)
from app.router import (
    ModelRouter,
    detect_installed_harnesses,
    install_cli_harness,
    probe_lmstudio,
    probe_ollama,
)
from app.router.fallback_provider import HeuristicStudyEngine
from app.schemas import (
    DocumentIR,
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
)
from app.workflows import (
    PRESET_TEMPLATES,
    generate_study_package,
    get_preset,
    negotiate_study_blueprint,
)
from app.workflows.demo_project import create_demo_courseware_project

app = FastAPI(
    title="Auto Study Guidance API",
    description="智能课本/课件学习资料生成系统后端服务",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _load_project_ir(project_id: str) -> DocumentIR:
    ir_path = PROJECTS_DIR / project_id / "document_ir.json"
    if not ir_path.exists():
        raise HTTPException(status_code=404, detail=f"项目 {project_id} 不存在")
    return DocumentIR.model_validate_json(ir_path.read_text(encoding="utf-8"))


def _save_project_ir(doc_ir: DocumentIR) -> None:
    pdir = get_project_dir(doc_ir.project_id)
    (pdir / "document_ir.json").write_text(doc_ir.model_dump_json(indent=2), encoding="utf-8")


def _load_blueprint(project_id: str) -> Optional[StudyBlueprint]:
    bp_path = PROJECTS_DIR / project_id / "blueprint.json"
    if bp_path.exists():
        return StudyBlueprint.model_validate_json(bp_path.read_text(encoding="utf-8"))
    return None


def _save_blueprint(project_id: str, blueprint: StudyBlueprint) -> None:
    pdir = get_project_dir(project_id)
    (pdir / "blueprint.json").write_text(blueprint.model_dump_json(indent=2), encoding="utf-8")


def _load_package(project_id: str) -> Optional[StudyPackage]:
    pkg_path = PROJECTS_DIR / project_id / "study_package.json"
    if pkg_path.exists():
        return StudyPackage.model_validate_json(pkg_path.read_text(encoding="utf-8"))
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
    ollama_ok, ollama_models = await probe_ollama(settings.local_config.ollama_url)
    lms_ok, lms_models = await probe_lmstudio(settings.local_config.lmstudio_url)
    gpu_vram = detect_gpu_vram(settings.ocr_config.vram_override_gb)
    ocr_engines = await get_ocr_engines_status(settings)
    return ProviderStatusResponse(
        settings=settings,
        harnesses=harnesses,
        ollama_available=ollama_ok,
        ollama_models=ollama_models,
        lmstudio_available=lms_ok,
        lmstudio_models=lms_models,
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
async def setup_ocr_backend(payload: Dict[str, Any]) -> Dict[str, Any]:
    engine_id = str(payload.get("engine_id") or "mineru_pipeline")
    action = str(payload.get("action") or "install_and_start")
    settings = load_settings()
    return await setup_ocr_engine(engine_id, settings, action=action)  # type: ignore


@app.post("/api/harnesses/install")
async def install_harness_cli(payload: Dict[str, Any]) -> Dict[str, Any]:
    cli_name = str(payload.get("cli_name") or "dsh")
    return await install_cli_harness(cli_name)


@app.post("/api/providers/settings", response_model=RouterSettings)
async def update_provider_settings(settings: RouterSettings) -> RouterSettings:
    return save_settings(settings)


@app.post("/api/providers/test")
async def test_provider_connection(payload: Dict[str, Any]) -> Dict[str, Any]:
    provider = payload.get("provider", "heuristic")
    settings = load_settings()
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
            "sample_response": (text or "内置规则引擎就绪")[:120],
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
    default_preset_id: str = Form("self_study_guide"),
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
    blueprint = HeuristicStudyEngine.build_blueprint_from_ir(doc_ir, preset)
    _save_blueprint(project_id, blueprint)
    return ProjectDetailResponse(document_ir=doc_ir, blueprint=blueprint, study_package=None)


@app.post("/api/projects/demo", response_model=ProjectDetailResponse)
async def load_demo_project() -> ProjectDetailResponse:
    settings = load_settings()
    doc_ir = await create_demo_courseware_project(settings)
    _save_project_ir(doc_ir)
    preset = get_preset("self_study_guide")
    blueprint = HeuristicStudyEngine.build_blueprint_from_ir(doc_ir, preset)
    _save_blueprint(doc_ir.project_id, blueprint)
    return ProjectDetailResponse(document_ir=doc_ir, blueprint=blueprint, study_package=None)


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
    pdir = PROJECTS_DIR / project_id
    if not pdir.exists():
        raise HTTPException(status_code=404, detail="项目不存在")
    shutil.rmtree(pdir, ignore_errors=True)
    return {"status": "deleted", "project_id": project_id}


@app.get("/api/projects/{project_id}/assets/{filename}")
async def get_project_asset(project_id: str, filename: str) -> FileResponse:
    asset_path = PROJECTS_DIR / project_id / "assets" / Path(filename).name
    if not asset_path.exists():
        raise HTTPException(status_code=404, detail="图片资源不存在")
    return FileResponse(asset_path)


@app.post("/api/projects/{project_id}/negotiate", response_model=StudyBlueprint)
async def negotiate_requirements(project_id: str, req: NegotiateRequest) -> StudyBlueprint:
    doc_ir = _load_project_ir(project_id)
    settings = load_settings()
    router = ModelRouter(settings)
    current_bp = req.current_blueprint or _load_blueprint(project_id)
    blueprint = await negotiate_study_blueprint(
        document_ir=doc_ir,
        preset_id=req.preset_id,
        user_prompt=req.user_prompt,
        current_blueprint=current_bp,
        router=router,
    )
    _save_blueprint(project_id, blueprint)
    return blueprint


@app.post("/api/projects/{project_id}/ai-fill-params", response_model=StudyBlueprint)
async def ai_fill_blueprint_params(project_id: str, req: NegotiateRequest) -> StudyBlueprint:
    """One-click AI calculation of optimal question counts, timing, score, and focus topics."""
    doc_ir = _load_project_ir(project_id)
    current_bp = req.current_blueprint or _load_blueprint(project_id)
    preset = get_preset(req.preset_id or (current_bp.preset_id if current_bp else "self_study_guide"))

    sel_ids = (
        current_bp.selected_chapter_ids
        if current_bp and current_bp.selected_chapter_ids
        else [c.chapter_id for c in doc_ir.chapters]
    )
    sel_chapters = [c for c in doc_ir.chapters if c.chapter_id in sel_ids] or doc_ir.chapters
    chap_count = max(1, len(sel_chapters))
    total_chars = sum(c.char_count for c in sel_chapters)
    density_scale = min(1.8, max(0.8, total_chars / 3500.0))

    mcq = max(3, min(18, round((3 * chap_count) * density_scale)))
    fill_blank = max(2, min(12, round((1.5 * chap_count) * density_scale)))
    short_ans = max(1, min(8, round(chap_count * density_scale)))

    if preset.preset_id == "in_class_practice":
        mcq, fill_blank, short_ans = min(8, max(4, chap_count * 2)), min(4, chap_count), 1
        minutes, total_score = 15, 50
    elif preset.preset_id == "exam_cheatsheet":
        mcq, fill_blank, short_ans = 3, 2, 1
        minutes, total_score = 15, 40
    elif preset.preset_id == "self_test_exam":
        mcq, fill_blank, short_ans = max(8, mcq), max(4, fill_blank), max(2, short_ans)
        minutes, total_score = 60, 100
    else:
        minutes = min(90, max(20, mcq * 2 + fill_blank * 3 + short_ans * 8))
        total_score = mcq * 5 + fill_blank * 5 + short_ans * 10

    focus_topics: List[str] = []
    for ch in sel_chapters:
        focus_topics.extend(ch.key_terms[:3])
    focus_topics = list(dict.fromkeys(focus_topics))[:10]

    base_bp = current_bp or HeuristicStudyEngine.build_blueprint_from_ir(doc_ir, preset)
    updated_deliverables = base_bp.deliverables.model_copy(
        update={
            "mcq_count": mcq,
            "fill_blank_count": fill_blank,
            "short_answer_count": short_ans,
            "suggested_minutes": minutes,
            "total_score": total_score,
        }
    )
    updated_bp = base_bp.model_copy(
        update={
            "deliverables": updated_deliverables,
            "focus_topics": focus_topics or base_bp.focus_topics,
            "parsed_intent_summary": (
                f"AI 已结合已选 {chap_count} 个章节（约 {total_chars:,} 字）智能填充题量："
                f"{mcq} 单选 + {fill_blank} 填空 + {short_ans} 简答（共 {total_score} 分 / {minutes} 分钟）。"
            ),
            "ai_feedback_message": (
                f"已根据文档信息密度自动填好题量与考核重点（单选 {mcq} / 填空 {fill_blank} / 简答 {short_ans}），"
                "您也可以继续手动微调具体数字。"
            ),
        }
    )
    _save_blueprint(project_id, updated_bp)
    return updated_bp


@app.post("/api/projects/{project_id}/generate")
async def generate_materials(project_id: str, req: GenerateRequest):
    doc_ir = _load_project_ir(project_id)
    settings = load_settings()
    router = ModelRouter(settings)
    _save_blueprint(project_id, req.blueprint)

    if not req.stream:
        package = await generate_study_package(doc_ir, req.blueprint, router)
        _save_package(project_id, package)
        return package

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
                _save_package(project_id, package)
                done_payload = json.dumps(
                    {"type": "complete", "package": package.model_dump()},
                    ensure_ascii=False,
                )
                await queue.put(f"data: {done_payload}\n\n")
            except Exception as exc:
                err_payload = json.dumps(
                    {"type": "error", "message": str(exc)}, ensure_ascii=False
                )
                await queue.put(f"data: {err_payload}\n\n")
            finally:
                await queue.put("__END__")

        task = asyncio.create_task(runner())
        while True:
            item = await queue.get()
            if item == "__END__":
                break
            yield item
        await task

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/api/projects/{project_id}/quick-generate", response_model=StudyPackage)
async def quick_generate_from_preset(project_id: str, req: QuickGenerateRequest) -> StudyPackage:
    doc_ir = _load_project_ir(project_id)
    preset = get_preset(req.preset_id)
    settings = load_settings()
    router = ModelRouter(settings)

    blueprint = HeuristicStudyEngine.build_blueprint_from_ir(
        doc_ir, preset, user_prompt=req.user_prompt
    )
    if req.selected_chapter_ids:
        valid_ids = {c.chapter_id for c in doc_ir.chapters}
        filtered = [cid for cid in req.selected_chapter_ids if cid in valid_ids]
        if filtered:
            blueprint.selected_chapter_ids = filtered
    blueprint.confirmed = True
    _save_blueprint(project_id, blueprint)

    package = await generate_study_package(doc_ir, blueprint, router)
    _save_package(project_id, package)
    return package
