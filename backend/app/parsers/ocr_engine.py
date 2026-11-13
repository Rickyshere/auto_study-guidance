from __future__ import annotations

import base64
from pathlib import Path
from typing import Optional

from app.schemas import RouterSettings

try:
    from rapidocr_onnxruntime import RapidOCR  # type: ignore

    _rapid_ocr_engine: Optional[RapidOCR] = RapidOCR()
    RAPIDOCR_AVAILABLE = True
except Exception:
    _rapid_ocr_engine = None
    RAPIDOCR_AVAILABLE = False


def is_rapidocr_available() -> bool:
    return RAPIDOCR_AVAILABLE


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


async def extract_text_from_image_vision(
    image_path: Path, settings: RouterSettings
) -> str:
    """Fallback to local RapidOCR first, then optional Cloud/Local VLM when configured."""
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
    import httpx

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
