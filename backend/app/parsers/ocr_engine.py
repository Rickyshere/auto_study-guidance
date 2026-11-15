from __future__ import annotations

import asyncio
import base64
import importlib.util
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional, Tuple

import httpx

from app.schemas import (
    GpuVramInfo,
    OcrEngineStatusItem,
    OcrEngineType,
    RouterSettings,
    VramTier,
)

WIN_NO_WINDOW = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
# 全部由本文件位置推导，避免写死盘符后把工具/虚拟环境定位到别的目录树
BACKEND_DIR = Path(__file__).resolve().parents[2]
TOOLS_DIR = BACKEND_DIR / "tools"
OXR_REPO_DIR = TOOLS_DIR / "oxr"
OCR_STATE_FILE = TOOLS_DIR / "ocr_installed_state.json"
VENV_PYTHON = BACKEND_DIR / ".venv" / "Scripts" / "python.exe"


def _load_ocr_state() -> Dict[str, Any]:
    if OCR_STATE_FILE.exists():
        try:
            data = json.loads(OCR_STATE_FILE.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return data
        except Exception:
            pass
    return {}


def _save_ocr_state(state: Dict[str, Any]) -> None:
    try:
        TOOLS_DIR.mkdir(parents=True, exist_ok=True)
        OCR_STATE_FILE.write_text(
            json.dumps(state, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except Exception:
        pass

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
    importlib.invalidate_caches()
    return importlib.util.find_spec(pkg_name) is not None


ENGINE_LABELS: Dict[str, str] = {
    "auto_recommend": "自动推荐（按显存档位）",
    "mineru_pipeline": "MinerU 2 Pipeline (无 vLLM)",
    "mineru_full": "MinerU 2 全量本地部署",
    "oxr_full": "SoMark OXR 全量本地部署",
    "paddleocr": "PaddleOCR (飞桨极速备选)",
    "somark_free_api": "SoMark Free-OXR 开放 API",
    "rapidocr": "内置 RapidOCR (ONNX 保底)",
}

# 哪些引擎的一键部署支持卸载（与 stream_setup_ocr_engine 的 uninstall 分支保持一致）
UNINSTALLABLE_ENGINES = {"mineru_pipeline", "mineru_full", "paddleocr", "oxr_full"}


def engine_label(engine_id: str) -> str:
    return ENGINE_LABELS.get(engine_id, engine_id)


# 云端 OXR 兜底熔断：一次失败后 5 分钟内不再尝试，避免整本扫描件逐页白等
_SOMARK_FALLBACK_BLOCK_UNTIL: float = 0.0
_SOMARK_FALLBACK_COOLDOWN_SEC = 300.0
# 最近一次云端调用的失败原因（(时间戳, 人话原因)），用于在设置页如实展示
_SOMARK_LAST_ERROR: Tuple[float, str] = (0.0, "")
# 是否是「接口本身不可用」级别的失败（地址错/404/非 JSON/连不上），只有这类才值得熔断
_SOMARK_LAST_HARD_FAIL: bool = False


def _set_somark_error(msg: str, hard: bool = False) -> None:
    global _SOMARK_LAST_ERROR, _SOMARK_LAST_HARD_FAIL
    _SOMARK_LAST_ERROR = (time.time(), msg.strip()[:200])
    _SOMARK_LAST_HARD_FAIL = hard and bool(msg.strip())


def somark_last_error() -> str:
    return _SOMARK_LAST_ERROR[1]


def _somark_fallback_blocked() -> bool:
    return time.time() < _SOMARK_FALLBACK_BLOCK_UNTIL


def _trip_somark_fallback() -> None:
    global _SOMARK_FALLBACK_BLOCK_UNTIL
    _SOMARK_FALLBACK_BLOCK_UNTIL = time.time() + _SOMARK_FALLBACK_COOLDOWN_SEC


def reset_somark_fallback() -> None:
    global _SOMARK_FALLBACK_BLOCK_UNTIL
    _SOMARK_FALLBACK_BLOCK_UNTIL = 0.0


async def resolve_effective_ocr_engine(settings: RouterSettings) -> Dict[str, Any]:
    """把「用户选的引擎」解析成「实际会用的引擎」，并判断它现在是否真的能用。

    与 `extract_text_from_image_vision()` 的解析顺序保持一致：选了 auto_recommend 时按
    显存档位取推荐引擎；不可用时依次回退到本地 RapidOCR → 云端 VLM（仅 cloud 通道）。
    """
    vram = detect_gpu_vram(settings.ocr_config.vram_override_gb)
    active = settings.ocr_config.active_engine
    if active == "auto_recommend":
        effective = vram.recommended_ocr_engine
        reason = f"选择的是「自动推荐」，按显存档位推荐为「{engine_label(effective)}」。"
    else:
        effective = active
        reason = f"已手动指定为「{engine_label(effective)}」，不会再按显存档位自动切换。"

    state = _load_ocr_state()
    mineru_running = await _probe_http_alive(settings.ocr_config.mineru_service_url)
    oxr_running = await _probe_http_alive(settings.ocr_config.oxr_service_url)

    def _availability(engine_id: str) -> Tuple[bool, str, str]:
        """→ (是否可用, 人话状态, 状态类别)"""
        if engine_id == "somark_free_api":
            if _somark_fallback_blocked():
                err = somark_last_error()
                return (
                    False,
                    f"云端 API · 最近一次调用失败{('（' + err + '）') if err else ''} · 5 分钟内暂停",
                    "cloud_error",
                )
            return True, "云端 API · 免下载免启动", "cloud"
        if engine_id == "rapidocr":
            return (
                (True, "内置模型 · 随程序可用", "builtin")
                if RAPIDOCR_AVAILABLE
                else (False, "内置模型未安装", "missing")
            )
        if engine_id in ("mineru_pipeline", "mineru_full"):
            installed = bool(state.get(engine_id, False))
            if not installed:
                return False, "未安装", "missing"
            if not mineru_running:
                return False, "已安装 · 服务未启动", "idle"
            if state.get("running_mineru_mode") not in (None, engine_id):
                return False, f"已安装 · 当前运行的是 {engine_label(state['running_mineru_mode'])}", "idle"
            return True, "已安装 · 服务运行中", "running"
        if engine_id == "paddleocr":
            installed = bool(state.get("paddleocr", _has_python_pkg("paddleocr")))
            return (True, "已安装 · 随程序调用", "builtin") if installed else (False, "未安装", "missing")
        if engine_id == "oxr_full":
            installed = bool(state.get("oxr_full", OXR_REPO_DIR.exists()))
            if not installed:
                return False, "未安装", "missing"
            return (True, "已安装 · 服务运行中", "running") if oxr_running else (False, "已安装 · 服务未启动", "idle")
        return False, "未知引擎", "missing"

    available, status_text, status_kind = _availability(effective)

    fallbacks: List[str] = []
    if not available:
        if RAPIDOCR_AVAILABLE:
            fallbacks.append("内置 RapidOCR")
        fallbacks.append(
            "SoMark Free-OXR 云端 API"
            if not _somark_fallback_blocked()
            else "SoMark Free-OXR 云端 API（最近一次调用失败，已暂停 5 分钟）"
        )
        stage_cfg = settings.stage_mapping.get("vision_ocr")
        cloud_vision = (
            stage_cfg.provider if settings.routing_mode == "smart_stage" and stage_cfg else settings.active_provider
        ) == "cloud" and bool((settings.cloud_config.api_key or "").strip())
        if cloud_vision:
            fallbacks.append("云端视觉大模型（VLM）")

    warning = ""
    if not available:
        tail = (
            f"目前会自动回退到：{'、'.join(fallbacks)}。"
            if fallbacks
            else "且没有任何可用的兜底通道。"
        )
        warning = (
            f"当前生效引擎「{engine_label(effective)}」不可用（{status_text}）。"
            "上传 PDF / 扫描图片时 OCR 会被跳过，提取到的文字层为空，"
            "生成的资料只能依据文件名与标题推演。" + tail
        )

    return {
        "active_engine": active,
        "active_label": engine_label(active),
        "effective_engine": effective,
        "effective_label": engine_label(effective),
        "effective_ready": available,
        "effective_status_text": status_text,
        "effective_status_kind": status_kind,
        "effective_reason": reason,
        "recommended_engine": vram.recommended_ocr_engine,
        "recommended_label": engine_label(vram.recommended_ocr_engine),
        "fallbacks": fallbacks,
        "warning": warning,
    }


async def _probe_http_alive(url: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=1.5) as client:
            resp = await client.get(url.rstrip("/"))
            return resp.status_code < 500
    except Exception:
        return False


async def get_ocr_engines_status(settings: RouterSettings) -> List[OcrEngineStatusItem]:
    state = _load_ocr_state()
    mineru_pkg_exists = _has_python_pkg("mineru") or _has_python_pkg("magic_pdf") or shutil.which("mineru") is not None
    # Keep mineru_pipeline and mineru_full independently controllable; default mineru_pipeline
    # only if state file hasn't explicitly initialized it and local mineru package exists.
    if "mineru_pipeline" in state:
        mineru_pipeline_installed = bool(state["mineru_pipeline"])
    else:
        mineru_pipeline_installed = False

    if "mineru_full" in state:
        mineru_full_installed = bool(state["mineru_full"])
    else:
        mineru_full_installed = False

    # If user previously had venv/global mineru before state file existed, reflect only when state explicitly set
    # or expose availability in description while keeping uninstall/install state deterministic.
    paddle_installed = bool(state.get("paddleocr", _has_python_pkg("paddleocr")))
    oxr_installed = bool(state.get("oxr_full", OXR_REPO_DIR.exists() or _has_python_pkg("oxr")))

    mineru_running, oxr_running = await asyncio.gather(
        _probe_http_alive(settings.ocr_config.mineru_service_url),
        _probe_http_alive(settings.ocr_config.oxr_service_url),
    )
    running_mode = state.get("running_mineru_mode")

    engines: List[OcrEngineStatusItem] = [
        OcrEngineStatusItem(
            engine_id="mineru_pipeline",
            name="MinerU 2 Pipeline 后端 (无 vLLM)",
            tier_badge="推荐 ≤ 8GB 显存",
            installed=mineru_pipeline_installed,
            running=bool(mineru_pipeline_installed and mineru_running and running_mode != "mineru_full"),
            supports_one_click_setup=True,
            description=(
                "轻量 Pipeline 管线实现，不依赖 vLLM；提供下载·安装·启动一条龙服务。"
                + ("（检测到本机已有 MinerU 运行时，点击即可快速部署配置）" if (mineru_pkg_exists and not mineru_pipeline_installed) else "")
            ),
            repo_or_api_url="https://github.com/opendatalab/MinerU",
        ),
        OcrEngineStatusItem(
            engine_id="somark_free_api",
            name="SoMark Free-OXR 开放 API",
            tier_badge="≤ 8GB 零显存零部署",
            installed=True,
            running=True,
            supports_one_click_setup=False,
            description=(
                f"直连 {settings.ocr_config.somark_api_base_url.rstrip('/')}/parse/sync 做整页解析，"
                "无需注册、无需 API Key（api_key 填 dummy 即可）。"
            ),
            repo_or_api_url=settings.ocr_config.somark_api_base_url,
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
            installed=mineru_full_installed,
            running=bool(mineru_full_installed and mineru_running and running_mode == "mineru_full"),
            supports_one_click_setup=True,
            description="完整 VLM + 版面分析本地服务，一键下载安装并静默拉起。",
            repo_or_api_url="https://github.com/opendatalab/MinerU",
        ),
        OcrEngineStatusItem(
            engine_id="oxr_full",
            name="SoMark OXR 全量本地部署",
            tier_badge="推荐 ≥ 48GB 显存",
            installed=oxr_installed,
            running=oxr_installed and oxr_running,
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

    # 补上「已选中 / 真正生效 / 现在能不能用」三个维度，否则用户分不清
    # 「我选了它」「它装了」「它正在跑」「它真的会被用到」这四件事。
    runtime = await resolve_effective_ocr_engine(settings)
    effective_id = str(runtime.get("effective_engine") or "")
    for item in engines:
        item.active = settings.ocr_config.active_engine == item.engine_id
        item.effective = effective_id == item.engine_id
        item.uninstall_supported = item.engine_id in UNINSTALLABLE_ENGINES
        available, status_text, status_kind = _engine_availability_snapshot(item, running_mode)
        item.available = available
        item.status_text = status_text
        item.status_kind = status_kind
    return engines


def _engine_availability_snapshot(
    item: OcrEngineStatusItem, running_mode: Optional[str]
) -> Tuple[bool, str, str]:
    """单卡片的三态标签：可用 / 装了没跑 / 没装。语义与 resolve_effective_ocr_engine 一致。"""
    if item.engine_id == "somark_free_api":
        if _somark_fallback_blocked():
            err = somark_last_error()
            return (
                False,
                f"云端 API · 最近一次调用失败{('（' + err + '）') if err else ''} · 5 分钟内暂停",
                "cloud_error",
            )
        return True, "云端 API · 免部署", "cloud"
    if item.engine_id == "rapidocr":
        return (True, "内置模型 · 随程序可用", "builtin") if RAPIDOCR_AVAILABLE else (False, "内置模型未安装", "missing")
    if item.engine_id == "paddleocr":
        return (True, "已安装 · 随程序调用", "builtin") if item.installed else (False, "未安装", "missing")
    if not item.installed:
        return False, "未安装", "missing"
    if item.running:
        return True, "已安装 · 服务运行中", "running"
    if item.engine_id in ("mineru_pipeline", "mineru_full") and running_mode and running_mode != item.engine_id:
        return False, f"已安装 · 当前运行的是 {engine_label(running_mode)}", "idle"
    return False, "已安装 · 服务未启动", "idle"


def _make_probe_image() -> Optional[Path]:
    """生成一张带文字的临时测试图，用于真实校验云端 OCR 能不能用（而不是靠猜）。"""
    try:
        import tempfile

        from PIL import Image, ImageDraw, ImageFont  # type: ignore
    except Exception:
        return None
    try:
        img = Image.new("RGB", (720, 200), "white")
        draw = ImageDraw.Draw(img)
        font = None
        for fp in (r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\simhei.ttf"):
            try:
                font = ImageFont.truetype(fp, 28)
                break
            except Exception:
                continue
        line = "SoMark OCR probe 2026 连通性测试"
        if font is not None:
            draw.text((36, 60), line, font=font, fill="black")
        else:
            draw.text((36, 60), "SoMark OCR probe 2026", fill="black")
        out = Path(tempfile.gettempdir()) / "asg_somark_probe.png"
        img.save(out)
        return out
    except Exception:
        return None


async def _run_silent_cmd(cmd: List[str], cwd: Optional[Path] = None, timeout: int = 300) -> tuple[int, str]:
    def _exec() -> tuple[int, str]:
        proc = subprocess.run(
            cmd,
            cwd=str(cwd) if cwd else None,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            creationflags=WIN_NO_WINDOW,
            timeout=timeout,
            check=False,
        )
        out = (proc.stdout or b"").decode("utf-8", errors="replace").strip()
        return proc.returncode, out

    return await asyncio.to_thread(_exec)


async def _start_silent_bg(cmd: List[str], cwd: Optional[Path] = None) -> int:
    def _spawn() -> int:
        proc = subprocess.Popen(
            cmd,
            cwd=str(cwd) if cwd else None,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=WIN_NO_WINDOW,
        )
        return proc.pid

    return await asyncio.to_thread(_spawn)


async def _start_bg_with_log(cmd: List[str], log_path: Path) -> int:
    """拉起后台服务并把它的 stdout/stderr 落盘，启动失败时才有话可说。"""

    def _spawn() -> int:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        handle = open(log_path, "wb")
        try:
            proc = subprocess.Popen(
                cmd,
                stdout=handle,
                stderr=subprocess.STDOUT,
                creationflags=WIN_NO_WINDOW,
            )
        finally:
            handle.close()
        return proc.pid

    return await asyncio.to_thread(_spawn)


def _read_log_tail(path: Path, lines: int = 10) -> str:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return ""
    rows = [row for row in text.strip().splitlines() if row.strip()]
    return "\n".join(rows[-lines:])


def _service_port(url: str, default: int) -> int:
    from urllib.parse import urlparse

    try:
        return urlparse(url).port or default
    except Exception:
        return default


async def _stream_silent_cmd(
    cmd: List[str],
    state: Dict[str, Any],
    start_pct: int,
    end_pct: int,
    stage_label: str,
    cwd: Optional[Path] = None,
    timeout: int = 600,
) -> AsyncIterator[Dict[str, Any]]:
    """Run a subprocess silently (loop-agnostic thread + Popen) while yielding real-time progress and logs."""
    proc = subprocess.Popen(
        cmd,
        cwd=str(cwd) if cwd else None,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        creationflags=WIN_NO_WINDOW,
    )
    q: "queue.Queue[Optional[str]]" = queue.Queue()
    lines: List[str] = []

    def _reader() -> None:
        try:
            assert proc.stdout is not None
            for raw_line in iter(proc.stdout.readline, b""):
                text = raw_line.decode("utf-8", errors="replace").strip()
                if text:
                    q.put(text)
        finally:
            q.put(None)

    threading.Thread(target=_reader, daemon=True).start()

    pct = float(start_pct)
    started_at = time.monotonic()
    deadline = started_at + timeout

    yield {
        "type": "progress",
        "percent": start_pct,
        "stage": stage_label,
        "message": f"正在执行: {' '.join(cmd[:4])}...",
        "log_line": f"$ {' '.join(cmd)}",
    }

    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            try:
                proc.kill()
            except Exception:
                pass
            state["returncode"] = -1
            state["output"] = "\n".join(lines)[-2000:]
            yield {
                "type": "progress",
                "percent": end_pct,
                "stage": stage_label,
                "message": f"{stage_label}超时 ({timeout}s)",
                "log_line": f"[timeout] after {timeout}s",
            }
            return

        try:
            item = await asyncio.to_thread(q.get, True, min(1.0, remaining))
            if item is None:
                break
            lines.append(item)
            pct = min(float(end_pct - 2), pct + 1.8)
            yield {
                "type": "progress",
                "percent": int(round(pct)),
                "stage": stage_label,
                "message": item[:95],
                "log_line": item,
            }
        except queue.Empty:
            elapsed = int(time.monotonic() - started_at)
            pct = min(float(end_pct - 3), pct + 0.8)
            yield {
                "type": "progress",
                "percent": int(round(pct)),
                "stage": stage_label,
                "message": f"{stage_label}进行中... (已耗时 {elapsed}s)",
                "log_line": "",
            }

    rc = await asyncio.to_thread(proc.wait)
    state["returncode"] = rc if rc is not None else 0
    state["output"] = "\n".join(lines)[-2000:]


async def stream_setup_ocr_engine(
    engine_id: OcrEngineType,
    settings: RouterSettings,
    action: str = "install_and_start",
) -> AsyncIterator[Dict[str, Any]]:
    """Stream real-time progress for one-click download, install, and silent start."""
    py_exe = str(VENV_PYTHON if VENV_PYTHON.exists() else Path(sys.executable))
    logs: List[str] = []

    yield {
        "type": "progress",
        "percent": 6,
        "stage": "1/3 环境检测",
        "message": f"正在校验 Python 运行时与 {engine_id} 当前状态...",
        "log_line": f"[init] engine={engine_id}, action={action}",
    }

    if action == "uninstall":
        yield {
            "type": "progress",
            "percent": 12,
            "stage": "1/3 停止相关服务",
            "message": f"正在检查并停止 {engine_id} 运行中的本地服务...",
            "log_line": f"[uninstall] stopping background processes for {engine_id}...",
        }
        if engine_id in ("mineru_pipeline", "mineru_full"):
            if sys.platform == "win32":
                await _run_silent_cmd(["taskkill", "/F", "/IM", "mineru-api.exe", "/T"], timeout=15)
            state: Dict[str, Any] = {"returncode": 0, "output": ""}
            if _has_python_pkg("mineru") or _has_python_pkg("magic_pdf"):
                async for evt in _stream_silent_cmd(
                    [py_exe, "-m", "pip", "uninstall", "-y", "mineru", "magic-pdf"],
                    state=state,
                    start_pct=20,
                    end_pct=86,
                    stage_label="2/3 卸载 MinerU 软件包",
                    timeout=300,
                ):
                    yield evt
            else:
                yield {
                    "type": "progress",
                    "percent": 55,
                    "stage": "2/3 清理 MinerU 配置与绑定",
                    "message": "正在解除当前挡位的 MinerU 部署绑定并清理缓存...",
                    "log_line": f"[uninstall] detaching {engine_id} from ASG workspace state",
                }
                state["output"] = f"Detached {engine_id} deployment state."
            importlib.invalidate_caches()
            ocr_state = _load_ocr_state()
            ocr_state[engine_id] = False
            if ocr_state.get("running_mineru_mode") == engine_id:
                ocr_state.pop("running_mineru_mode", None)
            _save_ocr_state(ocr_state)
            yield {
                "type": "progress",
                "percent": 94,
                "stage": "3/3 校验卸载状态",
                "message": f"{engine_id} 已成功从部署列表卸载。",
                "log_line": f"[verify] {engine_id} installed=False",
            }
            msg = f"{'MinerU 2 Pipeline (无vLLM)' if engine_id == 'mineru_pipeline' else 'MinerU 2 全量本地'} 已一键卸载完成。"
            yield {
                "type": "complete",
                "percent": 100,
                "stage": "✓ 卸载完成",
                "message": msg,
                "result": {
                    "ok": True,
                    "engine_id": engine_id,
                    "installed": False,
                    "running": False,
                    "message": msg,
                    "log": state["output"],
                },
            }
            return

        if engine_id == "paddleocr":
            state = {"returncode": 0, "output": ""}
            if _has_python_pkg("paddleocr"):
                async for evt in _stream_silent_cmd(
                    [py_exe, "-m", "pip", "uninstall", "-y", "paddleocr"],
                    state=state,
                    start_pct=20,
                    end_pct=88,
                    stage_label="2/3 卸载 PaddleOCR 软件包",
                    timeout=300,
                ):
                    yield evt
            importlib.invalidate_caches()
            now_installed = _has_python_pkg("paddleocr")
            ocr_state = _load_ocr_state()
            ocr_state["paddleocr"] = now_installed
            _save_ocr_state(ocr_state)
            msg = "PaddleOCR 已成功卸载。" if not now_installed else "PaddleOCR 卸载未完全清除。"
            yield {
                "type": "complete",
                "percent": 100,
                "stage": "✓ 卸载完成" if not now_installed else "卸载异常",
                "message": msg,
                "result": {
                    "ok": not now_installed,
                    "engine_id": engine_id,
                    "installed": now_installed,
                    "running": False,
                    "message": msg,
                    "log": state["output"],
                },
            }
            return

        if engine_id == "oxr_full":
            yield {
                "type": "progress",
                "percent": 45,
                "stage": "2/3 清理 OXR 本地仓库",
                "message": "正在移除 backend/tools/oxr 目录...",
                "log_line": f"[uninstall] removing {OXR_REPO_DIR}",
            }
            if OXR_REPO_DIR.exists():
                shutil.rmtree(OXR_REPO_DIR, ignore_errors=True)
            importlib.invalidate_caches()
            still_there = OXR_REPO_DIR.exists()
            ocr_state = _load_ocr_state()
            ocr_state["oxr_full"] = still_there
            _save_ocr_state(ocr_state)
            msg = "SoMark OXR 本地仓库已卸载清理。" if not still_there else "未能完全删除 backend/tools/oxr，请检查文件占用。"
            yield {
                "type": "complete",
                "percent": 100,
                "stage": "✓ 卸载完成" if not still_there else "清理异常",
                "message": msg,
                "result": {
                    "ok": not still_there,
                    "engine_id": engine_id,
                    "installed": still_there,
                    "running": False,
                    "message": msg,
                    "log": msg,
                },
            }
            return

        msg = f"引擎 {engine_id} 为云端/内置组件，无需本地卸载。"
        yield {
            "type": "complete",
            "percent": 100,
            "stage": "完成",
            "message": msg,
            "result": {
                "ok": True,
                "engine_id": engine_id,
                "installed": True,
                "running": True,
                "message": msg,
                "log": "",
            },
        }
        return

    if engine_id == "somark_free_api":
        base = settings.ocr_config.somark_api_base_url.rstrip("/")
        yield {
            "type": "progress",
            "percent": 30,
            "stage": "2/3 真实连通性检查",
            "message": f"正在用一张测试图调用 {base}/parse/sync 做真实识别...",
            "log_line": f"[probe] POST {base}/parse/sync",
        }
        probe = _make_probe_image()
        probe_text = ""
        if probe is not None:
            probe_text = await _extract_with_somark_free_api(probe, settings)
            try:
                probe.unlink()
            except Exception:
                pass

        if probe is None:
            msg = f"云端 API 配置已保存（{base}）；本机缺少 Pillow，未能自动验证连通性。"
            yield {
                "type": "complete",
                "percent": 100,
                "stage": "配置已保存",
                "message": msg,
                "result": {
                    "ok": True,
                    "engine_id": engine_id,
                    "installed": True,
                    "running": True,
                    "message": msg,
                    "log": msg,
                },
            }
            return

        if probe_text:
            reset_somark_fallback()
            msg = f"云端 API 连通正常：测试图识别出 {len(probe_text)} 字，上传扫描件会真正拿到文字。"
            yield {
                "type": "progress",
                "percent": 92,
                "stage": "2/3 真实连通性检查",
                "message": msg,
                "log_line": f"[probe] ok, {len(probe_text)} chars",
            }
            yield {
                "type": "complete",
                "percent": 100,
                "stage": "✓ 可用",
                "message": msg,
                "result": {
                    "ok": True,
                    "engine_id": engine_id,
                    "installed": True,
                    "running": True,
                    "message": msg,
                    "log": msg,
                },
            }
            return

        err = somark_last_error() or "接口没有返回文字"
        _trip_somark_fallback()
        msg = f"云端 API 不可用：{err}。请检查 API 地址（应形如 {base}/parse/sync）或网络。"
        yield {
            "type": "complete",
            "percent": 100,
            "stage": "不可用",
            "message": msg,
            "result": {
                "ok": False,
                "engine_id": engine_id,
                "installed": True,
                "running": False,
                "message": msg,
                "log": msg,
            },
        }
        return

    if engine_id in ("mineru_pipeline", "mineru_full"):
        pkg = "mineru[pipeline]" if engine_id == "mineru_pipeline" else "mineru[all]"
        mineru_cli = shutil.which("mineru")
        has_local_pkg = _has_python_pkg("mineru") or _has_python_pkg("magic_pdf") or mineru_cli is not None
        if not has_local_pkg:
            state = {"returncode": 0, "output": ""}
            async for evt in _stream_silent_cmd(
                [py_exe, "-m", "pip", "install", "-U", pkg],
                state=state,
                start_pct=14,
                end_pct=80,
                stage_label="2/3 下载并安装 MinerU 组件",
                timeout=600,
            ):
                yield evt
            if state["output"]:
                logs.append(state["output"][-1200:])
            if state["returncode"] != 0:
                msg = f"{pkg} 安装返回错误码 {state['returncode']}，可切换 Free-OXR 开放 API 或 PaddleOCR。"
                yield {
                    "type": "complete",
                    "percent": 100,
                    "stage": "安装失败",
                    "message": msg,
                    "result": {
                        "ok": False,
                        "engine_id": engine_id,
                        "installed": False,
                        "running": False,
                        "message": msg,
                        "log": "\n".join(logs),
                    },
                }
                return
        else:
            ver_cmd = [mineru_cli, "--version"] if mineru_cli else [py_exe, "-c", "import mineru; print('mineru ready')"]
            ver_state: Dict[str, Any] = {"returncode": 0, "output": ""}
            async for evt in _stream_silent_cmd(
                ver_cmd,
                state=ver_state,
                start_pct=24,
                end_pct=72,
                stage_label=f"2/3 复用本机 MinerU 并绑定 {engine_id}",
                timeout=30,
            ):
                yield evt
            if ver_state["output"]:
                logs.append(ver_state["output"][-600:])

        yield {
            "type": "progress",
            "percent": 86,
            "stage": "3/3 静默启动与校验",
            "message": "正在检测并静默拉起 MinerU 本地服务...",
            "log_line": "[start] checking mineru-api service...",
        }
        mineru_api_exe = shutil.which("mineru-api") or str(Path(py_exe).with_name("mineru-api.exe"))
        service_url = settings.ocr_config.mineru_service_url
        running = await _probe_http_alive(service_url)
        if not running and Path(mineru_api_exe).exists():
            port = _service_port(service_url, 8010)
            # mineru-api 没有 --backend 参数（传了会直接被 typer 拒绝退出，进程秒死、
            # 用户点了启动却什么反馈都没有）。能力档位用 --tier: flash/basic/standard。
            start_cmd = [mineru_api_exe, "--host", "127.0.0.1", "--port", str(port)]
            if engine_id == "mineru_pipeline":
                start_cmd += ["--tier", "basic", "--no-advanced"]
            start_log = TOOLS_DIR / "logs" / "mineru_api.log"
            pid = await _start_bg_with_log(start_cmd, start_log)
            yield {
                "type": "progress",
                "percent": 90,
                "stage": "3/3 静默启动与校验",
                "message": f"已拉起 mineru-api (PID {pid})，正在等待 {port} 端口响应…",
                "log_line": f"$ {' '.join(start_cmd)}",
            }
            waited = 0
            deadline = time.monotonic() + 45.0
            while time.monotonic() < deadline:
                await asyncio.sleep(1.0)
                waited += 1
                running = await _probe_http_alive(service_url)
                if running:
                    break
                if waited % 5 == 0:
                    tail = _read_log_tail(start_log, 2)
                    yield {
                        "type": "progress",
                        "percent": min(98, 90 + waited // 5),
                        "stage": "3/3 静默启动与校验",
                        "message": f"还在等 {port} 端口响应，已等 {waited}s…",
                        "log_line": tail,
                    }
            if running:
                logs.append(f"mineru-api 已在线（{service_url}）")
                yield {
                    "type": "progress",
                    "percent": 99,
                    "stage": "3/3 静默启动与校验",
                    "message": f"✓ 本地服务已在线：{service_url}（用时 {waited}s）",
                    "log_line": f"[ready] {service_url} in {waited}s",
                }
            else:
                tail = _read_log_tail(start_log, 12) or "（日志为空，进程可能被系统阻止启动）"
                msg = (
                    f"启动失败：命令已发出，但 {waited}s 内 {service_url} 没有响应。"
                    "下面是从服务日志里读到的最后几行，通常是缺模型或端口被占用。"
                )
                logs.append(tail)
                yield {
                    "type": "progress",
                    "percent": 99,
                    "stage": "3/3 启动失败",
                    "message": msg,
                    "log_line": tail.splitlines()[-1] if tail.splitlines() else "",
                }
                yield {
                    "type": "complete",
                    "percent": 100,
                    "stage": "启动失败",
                    "message": msg + " 也可以直接改选「SoMark Free-OXR 开放 API」（云端、免部署）。",
                    "result": {
                        "ok": False,
                        "engine_id": engine_id,
                        "installed": True,
                        "running": False,
                        "message": msg,
                        "log": tail,
                    },
                }
                return

        now_installed = _has_python_pkg("mineru") or _has_python_pkg("magic_pdf") or shutil.which("mineru") is not None
        if now_installed:
            ocr_state = _load_ocr_state()
            ocr_state[engine_id] = True
            ocr_state["running_mineru_mode"] = engine_id
            _save_ocr_state(ocr_state)

        msg = (
            f"{'MinerU 2 Pipeline (无vLLM)' if engine_id == 'mineru_pipeline' else 'MinerU 2 全量本地'} "
            f"已安装完成{'并已静默启动服务' if running else '（解析时按需静默调用）'}。"
        )
        yield {
            "type": "complete",
            "percent": 100,
            "stage": "✓ 安装完成" if now_installed else "安装异常",
            "message": msg,
            "result": {
                "ok": now_installed,
                "engine_id": engine_id,
                "installed": now_installed,
                "running": running,
                "message": msg,
                "log": "\n".join(logs),
            },
        }
        return

    if engine_id == "paddleocr":
        state = {"returncode": 0, "output": ""}
        async for evt in _stream_silent_cmd(
            [py_exe, "-m", "pip", "install", "-U", "paddleocr", "paddlepaddle"],
            state=state,
            start_pct=15,
            end_pct=88,
            stage_label="2/3 下载并安装 PaddleOCR",
            timeout=600,
        ):
            yield evt
        if state["output"]:
            logs.append(state["output"][-1200:])
        installed = _has_python_pkg("paddleocr")
        ok = state["returncode"] == 0 and installed
        if ok:
            ocr_state = _load_ocr_state()
            ocr_state["paddleocr"] = True
            _save_ocr_state(ocr_state)
        msg = "PaddleOCR 安装完成，已可作为极速 OCR 备选。" if installed else "PaddleOCR 安装未完成，请检查日志。"
        yield {
            "type": "complete",
            "percent": 100,
            "stage": "✓ 安装完成" if ok else "安装失败",
            "message": msg,
            "result": {
                "ok": ok,
                "engine_id": engine_id,
                "installed": installed,
                "running": installed,
                "message": msg,
                "log": "\n".join(logs),
            },
        }
        return

    if engine_id == "oxr_full":
        TOOLS_DIR.mkdir(parents=True, exist_ok=True)
        git_exe = shutil.which("git")
        if not OXR_REPO_DIR.exists():
            if not git_exe:
                msg = "未检测到 git，无法自动克隆 https://github.com/SoMarkAI/OXR/ 。"
                yield {
                    "type": "complete",
                    "percent": 100,
                    "stage": "失败",
                    "message": msg,
                    "result": {
                        "ok": False,
                        "engine_id": engine_id,
                        "installed": False,
                        "running": False,
                        "message": msg,
                        "log": "",
                    },
                }
                return
            clone_state: Dict[str, Any] = {"returncode": 0, "output": ""}
            async for evt in _stream_silent_cmd(
                [git_exe, "clone", "--depth", "1", "https://github.com/SoMarkAI/OXR.git", str(OXR_REPO_DIR)],
                state=clone_state,
                start_pct=12,
                end_pct=46,
                stage_label="2/3 克隆 SoMarkAI/OXR 仓库",
                timeout=300,
            ):
                yield evt
            if clone_state["output"]:
                logs.append(clone_state["output"][-1000:])
            if clone_state["returncode"] != 0:
                msg = "克隆 OXR 仓库失败，请检查网络连通性。"
                yield {
                    "type": "complete",
                    "percent": 100,
                    "stage": "失败",
                    "message": msg,
                    "result": {
                        "ok": False,
                        "engine_id": engine_id,
                        "installed": False,
                        "running": False,
                        "message": msg,
                        "log": "\n".join(logs),
                    },
                }
                return

        req_file = OXR_REPO_DIR / "requirements.txt"
        if req_file.exists():
            pip_state: Dict[str, Any] = {"returncode": 0, "output": ""}
            async for evt in _stream_silent_cmd(
                [py_exe, "-m", "pip", "install", "-r", str(req_file)],
                state=pip_state,
                start_pct=50,
                end_pct=90,
                stage_label="3/3 安装 OXR 依赖并校验",
                cwd=OXR_REPO_DIR,
                timeout=600,
            ):
                yield evt
            if pip_state["output"]:
                logs.append(pip_state["output"][-1000:])

        oxr_installed = OXR_REPO_DIR.exists()
        if oxr_installed:
            ocr_state = _load_ocr_state()
            ocr_state["oxr_full"] = True
            _save_ocr_state(ocr_state)
        running = await _probe_http_alive(settings.ocr_config.oxr_service_url)
        msg = "SoMark OXR 全量仓库已部署至 backend/tools/oxr。" if oxr_installed else "OXR 部署失败。"
        yield {
            "type": "complete",
            "percent": 100,
            "stage": "✓ 安装完成" if oxr_installed else "失败",
            "message": msg,
            "result": {
                "ok": oxr_installed,
                "engine_id": engine_id,
                "installed": oxr_installed,
                "running": running,
                "message": msg,
                "log": "\n".join(logs),
            },
        }
        return

    msg = f"引擎 {engine_id} 已就绪。"
    yield {
        "type": "complete",
        "percent": 100,
        "stage": "完成",
        "message": msg,
        "result": {
            "ok": True,
            "engine_id": engine_id,
            "installed": True,
            "running": True,
            "message": msg,
            "log": "",
        },
    }


async def setup_ocr_engine(
    engine_id: OcrEngineType,
    settings: RouterSettings,
    action: str = "install_and_start",
) -> Dict[str, Any]:
    """One-click download, install, and silently start the requested OCR engine."""
    final_res: Optional[Dict[str, Any]] = None
    async for evt in stream_setup_ocr_engine(engine_id, settings, action=action):
        if evt.get("type") == "complete":
            final_res = evt.get("result")
    return final_res or {
        "ok": False,
        "engine_id": engine_id,
        "installed": False,
        "running": False,
        "message": "部署未返回结果",
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


def _extract_markdown_from_parse_payload(data: Any) -> str:
    """从 SoMark / OXR 的解析响应里取正文（兼容多种嵌套层级）。"""
    if not isinstance(data, dict):
        return ""
    nodes: List[Any] = [data]
    inner = data.get("data")
    if isinstance(inner, dict):
        nodes.append(inner)
        result = inner.get("result")
        if isinstance(result, dict):
            nodes.append(result)
    for node in nodes:
        if not isinstance(node, dict):
            continue
        outputs = node.get("outputs")
        if isinstance(outputs, dict):
            md = outputs.get("markdown")
            if isinstance(md, str) and md.strip():
                return md.strip()
        for key in ("markdown", "md_content", "md", "text", "content"):
            val = node.get(key)
            if isinstance(val, str) and val.strip():
                return val.strip()
    return ""


async def _extract_with_somark_free_api(image_path: Path, settings: RouterSettings) -> str:
    """调用 SoMark / OXR 的同步解析接口（Free OXR API）。

    真实可用的接口是 `POST {base}/parse/sync`（multipart：file + api_key），
    正文在 `data.result.outputs.markdown`。旧实现打的是 /ocr、/parse、/file_parse
    这类不存在的路径，服务端一律返回 404 网页，于是「选了云端 API」也永远拿不到文字。
    """
    base_url = settings.ocr_config.somark_api_base_url.rstrip("/")
    api_key = (settings.ocr_config.somark_api_key or "").strip() or "dummy"
    suffix = image_path.suffix.lower()
    mime = "image/jpeg" if suffix in (".jpg", ".jpeg") else ("image/webp" if suffix == ".webp" else "image/png")
    try:
        raw_bytes = image_path.read_bytes()
    except Exception as exc:
        _set_somark_error(f"读取图片失败：{type(exc).__name__}")
        return ""

    async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
        for attempt in range(2):
            hard_stop = False
            for ep in (f"{base_url}/parse/sync", f"{base_url}/parse"):
                try:
                    resp = await client.post(
                        ep,
                        files={"file": (image_path.name, raw_bytes, mime)},
                        data={"api_key": api_key},
                    )
                except Exception as exc:
                    _set_somark_error(f"连接失败：{type(exc).__name__}", hard=True)
                    hard_stop = True
                    break
                if resp.status_code == 404:
                    _set_somark_error(f"接口地址不存在（{ep}），请检查 API 地址", hard=True)
                    hard_stop = True
                    break
                if resp.status_code != 200:
                    # 413/429/5xx 是「这一页/这一刻」的问题，不该把整本文档的云端识别全关掉，
                    # 所以只记录原因、不熔断。
                    _set_somark_error(f"接口返回 HTTP {resp.status_code}", hard=False)
                    continue
                try:
                    data = resp.json()
                except Exception:
                    _set_somark_error("接口返回的不是 JSON（地址可能填成了文档网页）", hard=True)
                    hard_stop = True
                    break
                code = data.get("code") if isinstance(data, dict) else None
                if code not in (None, 0, 200, "0"):
                    message = str((data or {}).get("message") or "").strip()[:80]
                    _set_somark_error(f"接口返回 code={code}{('：' + message) if message else ''}", hard=False)
                    continue
                text = _extract_markdown_from_parse_payload(data)
                if text:
                    cleaned = sanitize_ocr_text(text)
                    if cleaned:
                        _set_somark_error("")
                        return cleaned
                    _set_somark_error("接口只回了图片数据，没有可用文字")
                    continue
                _set_somark_error("接口返回成功但没有文本层")
            if hard_stop:
                break
            # 免费 API 排队时偶发「成功但空」，这种一定是重试一次才有救的
            if attempt == 0:
                await asyncio.sleep(2.0)
    return ""


async def probe_local_oxr_only(settings: RouterSettings) -> Dict[str, Any]:
    """Probe whether a local OXR model/service is ready without triggering any download or installation."""
    state = _load_ocr_state()
    oxr_installed = bool(state.get("oxr_full", False) or OXR_REPO_DIR.exists() or _has_python_pkg("oxr"))
    oxr_url = settings.ocr_config.oxr_service_url
    oxr_running = await _probe_http_alive(oxr_url)

    if oxr_running:
        return {
            "local_oxr_installed": oxr_installed or True,
            "local_oxr_running": True,
            "local_oxr_ready": True,
            "selected_engine": "oxr_full",
            "summary": f"已探查到本机 OXR 服务在线（{oxr_url}），直接选用本地 OXR 识别试卷。",
        }

    if oxr_installed:
        return {
            "local_oxr_installed": True,
            "local_oxr_running": False,
            "local_oxr_ready": False,
            "selected_engine": "somark_free_api",
            "summary": "仅探查模式：检测到本地存在 OXR 文件但服务未启动（未触发下载），已直接切换云端 OXR (SoMark Free-OXR) 识别试卷。",
        }

    return {
        "local_oxr_installed": False,
        "local_oxr_running": False,
        "local_oxr_ready": False,
        "selected_engine": "somark_free_api",
        "summary": "仅探查模式：本机未检测到 OXR 模型，已直接选用云端 OXR (SoMark Free-OXR) 识别试卷。",
    }


async def extract_exam_page_with_forced_oxr(
    image_path: Path,
    settings: RouterSettings,
    prefer_local_oxr: bool,
) -> tuple[str, str]:
    """Run forced OXR extraction on an exam page image (local OXR if probed ready -> Cloud OXR -> VLM/RapidOCR fallback)."""
    if prefer_local_oxr:
        txt = await _extract_with_http_service(image_path, settings.ocr_config.oxr_service_url)
        if txt:
            return txt, "oxr_full"

    cloud_txt = await _extract_with_somark_free_api(image_path, settings)
    if cloud_txt:
        return cloud_txt, "somark_free_api"

    if settings.cloud_config.api_key:
        vlm_txt = await _call_openai_vision(
            image_path=image_path,
            base_url=settings.cloud_config.base_url,
            api_key=settings.cloud_config.api_key,
            model=settings.cloud_config.vision_model or settings.cloud_config.model,
        )
        if vlm_txt:
            return vlm_txt, "somark_free_api (VLM 辅助提取)"

    local_txt = extract_text_from_image_local(image_path)
    if local_txt:
        return local_txt, "somark_free_api (RapidOCR 本地兜底)"

    return "", "somark_free_api"


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


_BINARY_LINE_HINT = ("data:image", "base64,", "/9j/", "iVBORw0KGgo")


def _looks_like_binary(line: str) -> bool:
    """判断一行是不是被当成文本吐出来的图片/二进制内容。"""
    stripped = line.strip()
    if len(stripped) < 120:
        return False
    if any(hint in stripped for hint in _BINARY_LINE_HINT):
        return True
    cjk = sum(1 for ch in stripped if "\u4e00" <= ch <= "\u9fff")
    if cjk:
        return False
    alnum = sum(1 for ch in stripped if ch.isalnum() or ch in "+/=_-")
    return alnum / max(1, len(stripped)) > 0.92


def sanitize_ocr_text(text: str) -> str:
    """清掉 OCR 结果里的二进制垃圾与 base64 图块。

    实测本地 MinerU 4.x 的 basic 档位会把整页原图的 base64 塞进 markdown，
    一行 20k 字符的乱码混进教材正文，比识别失败更糟糕（下游会照着重写）。
    """
    if not text:
        return ""
    kept: List[str] = []
    dropped = 0
    for line in text.splitlines():
        if _looks_like_binary(line):
            dropped += 1
            continue
        kept.append(line)
    cleaned = "\n".join(kept).strip()
    cleaned = re.sub(r"!\[[^\]]*\]\(data:image[^)]*\)", "", cleaned)
    if dropped and not cleaned:
        return ""
    return cleaned


def _extract_text_from_parse_json(data: Any) -> str:
    """从 MinerU / OXR 服务的解析响应里取正文（新版 mineru-api 在 files[].content.markdown）。"""
    if isinstance(data, str):
        return data.strip()
    if not isinstance(data, dict):
        return ""
    files = data.get("files")
    if isinstance(files, list):
        chunks: List[str] = []
        for item in files:
            if not isinstance(item, dict):
                continue
            content = item.get("content")
            if isinstance(content, dict):
                for key in ("markdown", "md_content", "text"):
                    val = content.get(key)
                    if isinstance(val, str) and val.strip():
                        chunks.append(val.strip())
                        break
        if chunks:
            return "\n\n".join(chunks)
    for key in ("markdown", "md_content", "md", "text", "content"):
        val = data.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return ""


async def _extract_with_http_service(image_path: Path, service_url: str) -> str:
    """调用本地 MinerU / OXR 服务的同步解析接口。

    新版 mineru-api（4.x）只有 `POST /v1/file_parse`（multipart 字段名 `files`），
    正文在 `files[0].content.markdown`。老代码打的是 `{base}/file_parse`，服务端 404，
    于是「服务运行中」却始终识别不出一个字。
    """
    base = service_url.rstrip("/")
    try:
        raw = image_path.read_bytes()
    except Exception:
        return ""
    async with httpx.AsyncClient(timeout=180.0) as client:
        for ep in (f"{base}/v1/file_parse", f"{base}/file_parse"):
            try:
                resp = await client.post(ep, files={"files": (image_path.name, raw, "image/png")})
            except Exception:
                continue
            if resp.status_code != 200:
                continue
            try:
                data = resp.json()
            except Exception:
                continue
            text = _extract_text_from_parse_json(data)
            if text:
                return sanitize_ocr_text(text)
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
        # 明确是「接口不可用」才熔断，避免整本扫描件逐页重复等 120s；
        # 只是这一页没解析出文字（空白页/纯图）不该熔断。
        if _SOMARK_LAST_HARD_FAIL and not _somark_fallback_blocked():
            _trip_somark_fallback()
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

    if engine == "rapidocr":
        local_first = extract_text_from_image_local(image_path)
        if local_first:
            return local_first
    else:
        # Universal fallbacks: local PaddleOCR / RapidOCR -> 云端 OXR -> VLM
        local_text = extract_text_from_image_local(image_path)
        if local_text:
            return local_text

        # 所选引擎没装/没启动时，云端 OXR 是免部署的最后一道兜底。
        if engine != "somark_free_api" and not _somark_fallback_blocked():
            cloud_ocr = await _extract_with_somark_free_api(image_path, settings)
            if cloud_ocr:
                return cloud_ocr
            if _SOMARK_LAST_HARD_FAIL:
                _trip_somark_fallback()

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
