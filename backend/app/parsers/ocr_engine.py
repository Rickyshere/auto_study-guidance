from __future__ import annotations

import asyncio
import base64
import importlib.util
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx

from app.schemas import (
    GpuVramInfo,
    OcrEngineStatusItem,
    OcrEngineType,
    RouterSettings,
    VramTier,
)

WIN_NO_WINDOW = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
TOOLS_DIR = Path(r"D:\auto_study_guidance\backend\tools")
OXR_REPO_DIR = TOOLS_DIR / "oxr"
VENV_PYTHON = Path(r"D:\auto_study_guidance\backend\.venv\Scripts\python.exe")

try:
    from rapidocr_onnxruntime import RapidOCR  # type: ignore

    _rapid_ocr_engine: Optional[RapidOCR] = RapidOCR()
    RAPIDOCR_AVAILABLE = True
except Exception:
    _rapid_ocr_engine = None
    RAPIDOCR_AVAILABLE = False


def is_rapidocr_available() -> bool:
    return RAPIDOCR_AVAILABLE


def _classify_vram(effective_gb: float, gpu_name: str, detected_gb: float) -> GpuVramInfo:
    if effective_gb >= 48.0:
        tier: VramTier = "ge_48gb"
        rec: OcrEngineType = "oxr_full"
        reason = (
            f"检测到/指定显存 {effective_gb:.1f} GB (≥ 48 GB)，推荐全量本地部署 SoMark OXR "
            "(https://github.com/SoMarkAI/OXR/)，也可切换 MinerU 2 或开放 API。"
        )
    elif effective_gb > 8.0:
        tier = "gt_8_lt_48gb"
        rec = "mineru_full"
        reason = (
            f"检测到/指定显存 {effective_gb:.1f} GB (8–48 GB 区间)，推荐 MinerU 2 全量本地部署，"
            "同时保留 Pipeline 无 vLLM 版、SoMark Free-OXR 开放 API 与 PaddleOCR 作为备选。"
        )
    else:
        tier = "le_8gb"
        rec = "mineru_pipeline"
        reason = (
            f"检测到/指定显存 {effective_gb:.1f} GB (≤ 8 GB)，推荐 MinerU 2 Pipeline 后端"
            "（不依赖 vLLM，支持一键下载安装启动）或直接使用 SoMark Free-OXR 开放 API；"
            "若速度不达预期可切换 PaddleOCR。"
        )
    return GpuVramInfo(
        gpu_name=gpu_name,
        detected_vram_gb=round(detected_gb, 2),
        effective_vram_gb=round(effective_gb, 2),
        vram_tier=tier,
        recommended_ocr_engine=rec,
        recommendation_reason=reason,
    )


def detect_gpu_vram(vram_override_gb: Optional[float] = None) -> GpuVramInfo:
    """Silently probe GPU name & VRAM (GB) via nvidia-smi or Windows WMI without popping terminals."""
    gpu_name = "未检测到独立 GPU (使用 CPU / 轻量默认配置)"
    detected_gb = 0.0

    # 1. Try nvidia-smi first
    nvidia_smi = shutil.which("nvidia-smi")
    if nvidia_smi:
        try:
            out = subprocess.check_output(
                [nvidia_smi, "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
                stderr=subprocess.DEVNULL,
                creationflags=WIN_NO_WINDOW,
                timeout=4,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            best_mb = 0.0
            best_name = ""
            for line in out.strip().splitlines():
                parts = [p.strip() for p in line.split(",")]
                if len(parts) >= 2:
                    try:
                        mb = float(parts[1])
                        if mb >= best_mb:
                            best_mb = mb
                            best_name = parts[0]
                    except ValueError:
                        continue
            if best_mb > 0:
                gpu_name = best_name or "NVIDIA GPU"
                detected_gb = best_mb / 1024.0
        except Exception:
            pass

    # 2. Fallback to Windows CimInstance silently if nvidia-smi found nothing
    if detected_gb <= 0 and sys.platform == "win32":
        try:
            ps_cmd = (
                "Get-CimInstance Win32_VideoController | "
                "Select-Object Name,AdapterRAM | ConvertTo-Json -Compress"
            )
            out = subprocess.check_output(
                ["powershell", "-NoProfile", "-Command", ps_cmd],
                stderr=subprocess.DEVNULL,
                creationflags=WIN_NO_WINDOW,
                timeout=5,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            import json

            raw = json.loads(out) if out.strip() else []
            items = raw if isinstance(raw, list) else [raw]
            best_bytes = 0
            for item in items:
                if not isinstance(item, dict):
                    continue
                ram = int(item.get("AdapterRAM") or 0)
                if ram > best_bytes:
                    best_bytes = ram
                    gpu_name = str(item.get("Name") or gpu_name)
            if best_bytes > 0:
                detected_gb = best_bytes / (1024.0**3)
        except Exception:
            pass

    effective_gb = vram_override_gb if vram_override_gb is not None else detected_gb
    return _classify_vram(effective_gb, gpu_name, detected_gb)


def _has_python_pkg(pkg_name: str) -> bool:
    return importlib.util.find_spec(pkg_name) is not None


async def _probe_http_alive(url: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=1.5) as client:
            resp = await client.get(url.rstrip("/"))
            return resp.status_code < 500
    except Exception:
        return False


async def get_ocr_engines_status(settings: RouterSettings) -> List[OcrEngineStatusItem]:
    mineru_installed = _has_python_pkg("mineru") or _has_python_pkg("magic_pdf") or shutil.which("mineru") is not None
    paddle_installed = _has_python_pkg("paddleocr")
    oxr_installed = OXR_REPO_DIR.exists() or _has_python_pkg("oxr")

    mineru_running, oxr_running = await asyncio.gather(
        _probe_http_alive(settings.ocr_config.mineru_service_url),
        _probe_http_alive(settings.ocr_config.oxr_service_url),
    )

    return [
        OcrEngineStatusItem(
            engine_id="mineru_pipeline",
            name="MinerU 2 Pipeline 后端 (无 vLLM)",
            tier_badge="推荐 ≤ 8GB 显存",
            installed=mineru_installed,
            running=mineru_running,
            supports_one_click_setup=True,
            description="轻量 Pipeline 管线实现，不依赖 vLLM；提供下载·安装·启动一条龙服务。",
            repo_or_api_url="https://github.com/opendatalab/MinerU",
        ),
        OcrEngineStatusItem(
            engine_id="somark_free_api",
            name="SoMark Free-OXR 开放 API",
            tier_badge="≤ 8GB 零显存零部署",
            installed=True,
            running=True,
            supports_one_click_setup=False,
            description="直连 https://free-oxr.somark.ai/api/v1 进行高精度版面分析与公式识别。",
            repo_or_api_url="https://free-oxr.somark.ai/api/v1",
        ),
        OcrEngineStatusItem(
            engine_id="paddleocr",
            name="PaddleOCR (飞桨极速备选)",
            tier_badge="备选 · 速度不达预期时切换",
            installed=paddle_installed,
            running=paddle_installed,
            supports_one_click_setup=True,
            description="CPU/低显存友好，当 MinerU Pipeline 或开放 API 速度不达预期时快速接管。",
            repo_or_api_url="https://github.com/PaddlePaddle/PaddleOCR",
        ),
        OcrEngineStatusItem(
            engine_id="mineru_full",
            name="MinerU 2 全量本地部署",
            tier_badge="推荐 8GB < 显存 < 48GB",
            installed=mineru_installed,
            running=mineru_running,
            supports_one_click_setup=True,
            description="完整 VLM + 版面分析本地服务，一键下载安装并静默拉起。",
            repo_or_api_url="https://github.com/opendatalab/MinerU",
        ),
        OcrEngineStatusItem(
            engine_id="oxr_full",
            name="SoMark OXR 全量本地部署",
            tier_badge="推荐 ≥ 48GB 显存",
            installed=oxr_installed,
            running=oxr_running,
            supports_one_click_setup=True,
            description="大显存满血本地部署 SoMarkAI/OXR，支持复杂理工教材整页高精度重构。",
            repo_or_api_url="https://github.com/SoMarkAI/OXR/",
        ),
        OcrEngineStatusItem(
            engine_id="rapidocr",
            name="内置 RapidOCR (ONNX 保底)",
            tier_badge="内置即时可用",
            installed=RAPIDOCR_AVAILABLE,
            running=RAPIDOCR_AVAILABLE,
            supports_one_click_setup=False,
            description="内置 ONNXRuntime 轻量文字提取，作为最终自动保底。",
            repo_or_api_url="",
        ),
    ]


async def _run_silent_cmd(cmd: List[str], cwd: Optional[Path] = None, timeout: int = 300) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=str(cwd) if cwd else None,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        creationflags=WIN_NO_WINDOW,
    )
    stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    out = (stdout or b"").decode("utf-8", errors="replace").strip()
    return proc.returncode or 0, out


async def _start_silent_bg(cmd: List[str], cwd: Optional[Path] = None) -> int:
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=str(cwd) if cwd else None,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
        creationflags=WIN_NO_WINDOW,
    )
    return proc.pid


async def setup_ocr_engine(
    engine_id: OcrEngineType,
    settings: RouterSettings,
    action: str = "install_and_start",
) -> Dict[str, Any]:
    """One-click download, install, and silently start the requested OCR engine."""
    py_exe = str(VENV_PYTHON if VENV_PYTHON.exists() else Path(sys.executable))
    logs: List[str] = []

    if engine_id == "somark_free_api":
        return {
            "ok": True,
            "engine_id": engine_id,
            "installed": True,
            "running": True,
            "message": f"SoMark Free-OXR 开放 API 无需本地安装，地址：{settings.ocr_config.somark_api_base_url}",
            "log": "",
        }

    if engine_id in ("mineru_pipeline", "mineru_full"):
        pkg = "mineru[pipeline]" if engine_id == "mineru_pipeline" else "mineru[all]"
        installed = _has_python_pkg("mineru") or _has_python_pkg("magic_pdf")
        if not installed or action in ("install", "install_and_start"):
            code, out = await _run_silent_cmd([py_exe, "-m", "pip", "install", "-U", pkg], timeout=600)
            logs.append(out[-1200:])
            if code != 0:
                return {
                    "ok": False,
                    "engine_id": engine_id,
                    "installed": _has_python_pkg("mineru") or _has_python_pkg("magic_pdf"),
                    "running": False,
                    "message": f"{pkg} 安装返回错误码 {code}，可切换 Free-OXR 开放 API 或 PaddleOCR。",
                    "log": "\n".join(logs),
                }

        # Try starting MinerU local API silently if binary exists
        mineru_api_exe = shutil.which("mineru-api") or str(Path(py_exe).with_name("mineru-api.exe"))
        running = await _probe_http_alive(settings.ocr_config.mineru_service_url)
        if not running and Path(mineru_api_exe).exists():
            backend_mode = "pipeline" if engine_id == "mineru_pipeline" else "hybrid-auto-engine"
            await _start_silent_bg(
                [mineru_api_exe, "--host", "127.0.0.1", "--port", "8010", "--backend", backend_mode]
            )
            await asyncio.sleep(1.5)
            running = await _probe_http_alive(settings.ocr_config.mineru_service_url)
            logs.append(f"已静默拉起 {mineru_api_exe} ({backend_mode})")

        now_installed = _has_python_pkg("mineru") or _has_python_pkg("magic_pdf") or shutil.which("mineru") is not None
        return {
            "ok": now_installed,
            "engine_id": engine_id,
            "installed": now_installed,
            "running": running,
            "message": (
                f"{'MinerU 2 Pipeline (无vLLM)' if engine_id == 'mineru_pipeline' else 'MinerU 2 全量本地'} "
                f"已就绪{'并已静默启动服务' if running else '（解析时按需静默调用）'}。"
            ),
            "log": "\n".join(logs),
        }

    if engine_id == "paddleocr":
        code, out = await _run_silent_cmd(
            [py_exe, "-m", "pip", "install", "-U", "paddleocr", "paddlepaddle"],
            timeout=600,
        )
        logs.append(out[-1200:])
        installed = _has_python_pkg("paddleocr")
        return {
            "ok": code == 0 and installed,
            "engine_id": engine_id,
            "installed": installed,
            "running": installed,
            "message": "PaddleOCR 安装完成，已可作为极速 OCR 备选。" if installed else "PaddleOCR 安装未完成，请检查日志。",
            "log": "\n".join(logs),
        }

    if engine_id == "oxr_full":
        TOOLS_DIR.mkdir(parents=True, exist_ok=True)
        git_exe = shutil.which("git")
        if not OXR_REPO_DIR.exists():
            if not git_exe:
                return {
                    "ok": False,
                    "engine_id": engine_id,
                    "installed": False,
                    "running": False,
                    "message": "未检测到 git，无法自动克隆 https://github.com/SoMarkAI/OXR/ 。",
                    "log": "",
                }
            code, out = await _run_silent_cmd(
                [git_exe, "clone", "--depth", "1", "https://github.com/SoMarkAI/OXR.git", str(OXR_REPO_DIR)],
                timeout=300,
            )
            logs.append(out[-1000:])
            if code != 0:
                return {
                    "ok": False,
                    "engine_id": engine_id,
                    "installed": False,
                    "running": False,
                    "message": "克隆 OXR 仓库失败，请检查网络连通性。",
                    "log": "\n".join(logs),
                }

        req_file = OXR_REPO_DIR / "requirements.txt"
        if req_file.exists():
            code, out = await _run_silent_cmd(
                [py_exe, "-m", "pip", "install", "-r", str(req_file)],
                cwd=OXR_REPO_DIR,
                timeout=600,
            )
            logs.append(out[-1000:])

        oxr_installed = OXR_REPO_DIR.exists()
        return {
            "ok": oxr_installed,
            "engine_id": engine_id,
            "installed": oxr_installed,
            "running": await _probe_http_alive(settings.ocr_config.oxr_service_url),
            "message": "SoMark OXR 全量仓库已部署至 backend/tools/oxr。" if oxr_installed else "OXR 部署失败。",
            "log": "\n".join(logs),
        }

    return {
        "ok": True,
        "engine_id": engine_id,
        "installed": True,
        "running": True,
        "message": f"引擎 {engine_id} 已就绪。",
        "log": "",
    }


def extract_text_from_image_local(image_path: Path) -> str:
    """Run local RapidOCR if installed; returns empty string if unavailable."""
    if not RAPIDOCR_AVAILABLE or _rapid_ocr_engine is None:
        return ""
    try:
        result, _ = _rapid_ocr_engine(str(image_path))
        if not result:
            return ""
        lines = [item[1] for item in result if len(item) >= 2 and item[1]]
        return "\n".join(lines).strip()
    except Exception:
        return ""


async def _extract_with_somark_free_api(image_path: Path, settings: RouterSettings) -> str:
    base_url = settings.ocr_config.somark_api_base_url.rstrip("/")
    headers: Dict[str, str] = {}
    if settings.ocr_config.somark_api_key:
        headers["Authorization"] = f"Bearer {settings.ocr_config.somark_api_key}"
    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            with image_path.open("rb") as f:
                files = {"file": (image_path.name, f, "image/png")}
                for ep in (f"{base_url}/ocr", f"{base_url}/parse", base_url):
                    resp = await client.post(ep, files=files, headers=headers)
                    if resp.status_code == 200:
                        data = resp.json()
                        if isinstance(data, dict):
                            txt = data.get("markdown") or data.get("text") or data.get("content") or ""
                            if not txt and isinstance(data.get("data"), dict):
                                txt = data["data"].get("markdown") or data["data"].get("text") or ""
                            if txt:
                                return str(txt).strip()
    except Exception:
        pass
    return ""


async def _extract_with_paddleocr(image_path: Path) -> str:
    if not _has_python_pkg("paddleocr"):
        return ""
    try:
        def _run() -> str:
            from paddleocr import PaddleOCR  # type: ignore

            ocr = PaddleOCR(use_angle_cls=True, lang="ch", show_log=False)
            res = ocr.ocr(str(image_path), cls=True)
            lines: List[str] = []
            for block in res or []:
                for item in block or []:
                    if len(item) >= 2 and isinstance(item[1], (list, tuple)):
                        lines.append(str(item[1][0]))
            return "\n".join(lines).strip()

        return await asyncio.to_thread(_run)
    except Exception:
        return ""


async def _extract_with_http_service(image_path: Path, service_url: str) -> str:
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            with image_path.open("rb") as f:
                files = {"files": (image_path.name, f, "image/png")}
                resp = await client.post(f"{service_url.rstrip('/')}/file_parse", files=files)
                if resp.status_code == 200:
                    data = resp.json()
                    if isinstance(data, dict):
                        return str(data.get("md_content") or data.get("markdown") or data.get("text") or "").strip()
    except Exception:
        pass
    return ""


async def extract_text_from_image_vision(
    image_path: Path, settings: RouterSettings
) -> str:
    """Resolve effective OCR engine from VRAM tier or explicit selection, with graceful fallback."""
    engine = settings.ocr_config.active_engine
    if engine == "auto_recommend":
        vram = detect_gpu_vram(settings.ocr_config.vram_override_gb)
        engine = vram.recommended_ocr_engine

    if engine == "somark_free_api":
        txt = await _extract_with_somark_free_api(image_path, settings)
        if txt:
            return txt
    elif engine == "paddleocr":
        txt = await _extract_with_paddleocr(image_path)
        if txt:
            return txt
    elif engine in ("mineru_pipeline", "mineru_full"):
        txt = await _extract_with_http_service(image_path, settings.ocr_config.mineru_service_url)
        if txt:
            return txt
    elif engine == "oxr_full":
        txt = await _extract_with_http_service(image_path, settings.ocr_config.oxr_service_url)
        if txt:
            return txt

    # Universal fallbacks: local PaddleOCR / RapidOCR -> VLM
    local_text = extract_text_from_image_local(image_path)
    if local_text:
        return local_text

    stage_cfg = settings.stage_mapping.get("vision_ocr")
    provider = (
        stage_cfg.provider
        if settings.routing_mode == "smart_stage" and stage_cfg
        else settings.active_provider
    )
    if provider == "cloud" and settings.cloud_config.api_key:
        return await _call_openai_vision(
            image_path=image_path,
            base_url=settings.cloud_config.base_url,
            api_key=settings.cloud_config.api_key,
            model=settings.cloud_config.vision_model or settings.cloud_config.model,
        )
    if provider == "local":
        base_url = (
            f"{settings.local_config.ollama_url.rstrip('/')}/v1"
            if settings.local_config.engine == "ollama"
            else f"{settings.local_config.lmstudio_url.rstrip('/')}/v1"
        )
        return await _call_openai_vision(
            image_path=image_path,
            base_url=base_url,
            api_key="local",
            model=settings.local_config.vision_model or settings.local_config.model,
        )
    return ""


async def _call_openai_vision(
    image_path: Path, base_url: str, api_key: str, model: str
) -> str:
    mime = "image/png"
    suffix = image_path.suffix.lower()
    if suffix in (".jpg", ".jpeg"):
        mime = "image/jpeg"
    elif suffix == ".webp":
        mime = "image/webp"

    b64 = base64.b64encode(image_path.read_bytes()).decode("ascii")
    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "请准确提取这张教材或课件图片中的所有文字、公式（使用LaTeX表示）和图表关键信息，保持结构清晰。",
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime};base64,{b64}"},
                    },
                ],
            }
        ],
        "max_tokens": 1500,
    }
    headers = {"Authorization": f"Bearer {api_key}"}
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{base_url.rstrip('/')}/chat/completions",
                json=payload,
                headers=headers,
            )
            if resp.status_code == 200:
                data = resp.json()
                return data["choices"][0]["message"]["content"].strip()
    except Exception:
        pass
    return ""
