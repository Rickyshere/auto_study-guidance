"""DeepSeek Harness (DSH) CLI entry point used by `dsh` / `dsh.cmd`."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any, Dict

import httpx

SETTINGS_FILE = Path(r"D:\auto_study_guidance\backend\data\settings.json")


def _load_deepseek_credentials() -> Dict[str, str]:
    api_key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
    base_url = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1").strip()
    model = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat").strip()
    if SETTINGS_FILE.exists():
        try:
            raw: Dict[str, Any] = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
            cloud = raw.get("cloud_config", {})
            if not api_key and cloud.get("api_key"):
                api_key = str(cloud["api_key"]).strip()
            if "deepseek" in str(cloud.get("base_url", "")).lower():
                base_url = str(cloud["base_url"]).strip()
                if cloud.get("model"):
                    model = str(cloud["model"]).strip()
        except Exception:
            pass
    return {"api_key": api_key, "base_url": base_url.rstrip("/"), "model": model}


def main() -> int:
    prompt_text = sys.stdin.read().strip() if not sys.stdin.isatty() else " ".join(sys.argv[1:]).strip()
    if not prompt_text:
        print("dsh: empty prompt", file=sys.stderr)
        return 1

    creds = _load_deepseek_credentials()
    if not creds["api_key"]:
        print("dsh: DEEPSEEK_API_KEY not configured (请先设置 DEEPSEEK_API_KEY 或在云端 API 中填入 DeepSeek 密钥)", file=sys.stderr)
        return 2

    payload = {
        "model": creds["model"],
        "messages": [{"role": "user", "content": prompt_text}],
        "temperature": 0.4,
    }
    headers = {"Authorization": f"Bearer {creds['api_key']}", "Content-Type": "application/json"}
    try:
        with httpx.Client(timeout=180.0) as client:
            resp = client.post(f"{creds['base_url']}/chat/completions", json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            content = data["choices"][0]["message"]["content"]
            sys.stdout.write(content)
            return 0
    except Exception as exc:
        print(f"dsh error: {exc}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
