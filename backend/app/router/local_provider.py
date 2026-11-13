from __future__ import annotations

from typing import List, Optional, Tuple
import httpx

from app.schemas import LocalConfig


async def probe_ollama(ollama_url: str) -> Tuple[bool, List[str]]:
    try:
        async with httpx.AsyncClient(timeout=2.5) as client:
            resp = await client.get(f"{ollama_url.rstrip('/')}/api/tags")
            if resp.status_code == 200:
                models = [m.get("name", "") for m in resp.json().get("models", []) if m.get("name")]
                return True, models
    except Exception:
        pass
    return False, []


async def probe_lmstudio(lmstudio_url: str) -> Tuple[bool, List[str]]:
    try:
        async with httpx.AsyncClient(timeout=2.5) as client:
            resp = await client.get(f"{lmstudio_url.rstrip('/')}/v1/models")
            if resp.status_code == 200:
                models = [m.get("id", "") for m in resp.json().get("data", []) if m.get("id")]
                return True, models
    except Exception:
        pass
    return False, []


async def call_local_llm(
    system_prompt: str,
    user_prompt: str,
    config: LocalConfig,
    model_override: Optional[str] = None,
) -> str:
    model = model_override or config.model
    if config.engine == "ollama":
        url = f"{config.ollama_url.rstrip('/')}/v1/chat/completions"
    else:
        url = f"{config.lmstudio_url.rstrip('/')}/v1/chat/completions"

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.3,
    }
    async with httpx.AsyncClient(timeout=180.0) as client:
        resp = await client.post(url, json=payload)
        if resp.status_code >= 400:
            raise RuntimeError(f"本地模型服务错误 {resp.status_code}: {resp.text[:300]}")
        data = resp.json()
        return data["choices"][0]["message"]["content"].strip()
