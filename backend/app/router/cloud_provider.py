from __future__ import annotations

from typing import Optional
import httpx

from app.schemas import CloudConfig


async def call_cloud_llm(
    system_prompt: str,
    user_prompt: str,
    config: CloudConfig,
    model_override: Optional[str] = None,
) -> str:
    if not config.api_key.strip():
        raise RuntimeError("云端 API Key 未配置")

    model = model_override or config.model

    if config.api_format == "anthropic":
        url = f"{config.base_url.rstrip('/')}/v1/messages"
        if config.base_url.rstrip("/").endswith("/v1"):
            url = f"{config.base_url.rstrip('/')}/messages"
        headers = {
            "x-api-key": config.api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        payload = {
            "model": model,
            "max_tokens": 4096,
            "system": system_prompt,
            "messages": [{"role": "user", "content": user_prompt}],
        }
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
            if resp.status_code >= 400:
                raise RuntimeError(f"Anthropic API 错误 {resp.status_code}: {resp.text[:300]}")
            data = resp.json()
            blocks = data.get("content", [])
            return "\n".join(b.get("text", "") for b in blocks if b.get("type") == "text").strip()

    # OpenAI compatible
    base = config.base_url.rstrip("/")
    url = f"{base}/chat/completions"
    headers = {
        "Authorization": f"Bearer {config.api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.3,
    }
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(url, json=payload, headers=headers)
        if resp.status_code >= 400:
            raise RuntimeError(f"Cloud API 错误 {resp.status_code}: {resp.text[:300]}")
        data = resp.json()
        return data["choices"][0]["message"]["content"].strip()
