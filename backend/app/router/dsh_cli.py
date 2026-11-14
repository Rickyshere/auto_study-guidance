"""DSH (DeepSeek/OpenAI-compatible) lightweight CLI harness supporting text & stream-json NDJSON output."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Dict, Iterator

import httpx


def _emit_ndjson(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _read_dsh_env_file() -> Dict[str, str]:
    env_map: Dict[str, str] = {}
    env_path = Path.home() / ".dsh" / ".env"
    if not env_path.exists():
        return env_map
    try:
        for line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            k, v = stripped.split("=", 1)
            env_map[k.strip()] = v.strip().strip('"').strip("'")
    except Exception:
        pass
    return env_map


def _is_magpie_alive(base_url: str) -> bool:
    check_url = f"{base_url.rstrip('/')}/models"
    try:
        with httpx.Client(timeout=0.8) as client:
            resp = client.get(check_url)
            return resp.status_code < 500
    except Exception:
        return False


def _resolve_config() -> tuple[str, str, str]:
    dsh_env = _read_dsh_env_file()
    explicit_key = (
        os.environ.get("DSH_API_KEY")
        or os.environ.get("DEEPSEEK_API_KEY")
        or os.environ.get("OPENAI_API_KEY")
        or ""
    ).strip()
    explicit_url = (
        os.environ.get("DSH_BASE_URL")
        or os.environ.get("DEEPSEEK_BASE_URL")
        or os.environ.get("OPENAI_BASE_URL")
        or ""
    ).strip().rstrip("/")
    explicit_model = (
        os.environ.get("DSH_MODEL")
        or os.environ.get("DEEPSEEK_MODEL")
        or os.environ.get("OPENAI_MODEL")
        or ""
    ).strip()

    magpie_url = (dsh_env.get("MAGPIE_BASE_URL") or "http://127.0.0.1:3425/v1").strip().rstrip("/")
    magpie_key = (dsh_env.get("MAGPIE_GATEWAY_KEY") or "magpie").strip()

    if not explicit_url and not explicit_key and _is_magpie_alive(magpie_url):
        return magpie_key, magpie_url, explicit_model or "qoder-cn/fast"

    if explicit_url and "127.0.0.1:3425" in explicit_url:
        return explicit_key or magpie_key, explicit_url, explicit_model or "qoder-cn/fast"

    api_key = explicit_key or dsh_env.get("DEEPSEEK_API_KEY", "") or dsh_env.get("OPENAI_API_KEY", "")
    base_url = explicit_url or "https://api.deepseek.com"
    model = explicit_model or ("qoder-cn/fast" if "127.0.0.1:3425" in base_url else "deepseek-chat")
    return api_key, base_url, model


def _build_endpoint(base_url: str) -> str:
    if base_url.endswith("/chat/completions"):
        return base_url
    if base_url.endswith("/v1"):
        return f"{base_url}/chat/completions"
    return f"{base_url}/v1/chat/completions"


def _iter_sse_deltas(resp: httpx.Response) -> Iterator[str]:
    for raw_line in resp.iter_lines():
        line = raw_line.strip()
        if not line or not line.startswith("data:"):
            continue
        data_str = line[5:].strip()
        if data_str == "[DONE]":
            break
        try:
            event = json.loads(data_str)
        except json.JSONDecodeError:
            continue
        choices = event.get("choices") or []
        if not choices:
            continue
        delta_obj = choices[0].get("delta") or {}
        content = delta_obj.get("content")
        if content:
            yield str(content)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="DSH CLI harness")
    parser.add_argument(
        "-p", "--prompt", dest="prompt_flag", default=None, help="Prompt string"
    )
    parser.add_argument(
        "--output-format",
        choices=["text", "stream-json"],
        default="text",
        help="Output format",
    )
    parser.add_argument("--verbose", action="store_true", help="Verbose streaming")
    parser.add_argument("--profile", default=None, help="Optional compatibility profile flag")
    parser.add_argument("--model", default=None, help="Override model name")
    parser.add_argument("--soul-file", dest="soul_file", default=None, help="Optional path to agent soul.md file")
    parser.add_argument("prompt_pos", nargs="*", help="Positional prompt")
    args = parser.parse_args(argv)

    soul_path_str = (args.soul_file or os.environ.get("DSH_SOUL_FILE") or "").strip()
    soul_content = ""
    soul_filename = ""
    if soul_path_str:
        sp = Path(soul_path_str)
        if sp.is_file():
            soul_content = sp.read_text(encoding="utf-8", errors="replace").strip()
            soul_filename = sp.name

    prompt = args.prompt_flag
    if not prompt and args.prompt_pos:
        prompt = " ".join(args.prompt_pos)
    if not prompt and not sys.stdin.isatty():
        prompt = sys.stdin.read()
    prompt = (prompt or "").strip()

    is_stream_json = args.output_format == "stream-json"
    if not prompt:
        msg = "Empty prompt provided to dsh CLI."
        if is_stream_json:
            _emit_ndjson({"type": "error", "is_error": True, "message": msg})
        else:
            sys.stderr.write(msg + "\n")
        return 1

    api_key, base_url, default_model = _resolve_config()
    model = (args.model or default_model).strip()
    if not api_key:
        msg = "Missing API key (DSH_API_KEY / DEEPSEEK_API_KEY / OPENAI_API_KEY)."
        if is_stream_json:
            _emit_ndjson({"type": "error", "is_error": True, "message": msg})
        else:
            sys.stderr.write(msg + "\n")
        return 1

    url = _build_endpoint(base_url)
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    candidate_models = [model]
    if "127.0.0.1:3425" in url and model != "qoder-cn/fast":
        candidate_models.append("qoder-cn/fast")
    fallback_statuses = {404, 405, 502, 503}

    try:
        with httpx.Client(timeout=httpx.Timeout(180.0, connect=20.0)) as client:
            for idx, active_model in enumerate(candidate_models):
                has_fallback = idx + 1 < len(candidate_models)
                messages_payload = []
                if soul_content:
                    messages_payload.append(
                        {
                            "role": "system",
                            "content": f"[Uploaded Soul File: {soul_filename}]\n{soul_content}",
                        }
                    )
                messages_payload.append({"role": "user", "content": prompt})
                req_body: dict = {
                    "model": active_model,
                    "messages": messages_payload,
                    "stream": is_stream_json,
                }
                if is_stream_json:
                    chunks: list[str] = []
                    total_chars = 0
                    retry_fallback = False
                    with client.stream("POST", url, headers=headers, json=req_body) as resp:
                        if resp.status_code >= 400:
                            err_body = resp.read().decode("utf-8", errors="replace")[:500]
                            if resp.status_code in fallback_statuses and has_fallback:
                                retry_fallback = True
                            else:
                                _emit_ndjson(
                                    {
                                        "type": "error",
                                        "is_error": True,
                                        "status_code": resp.status_code,
                                        "message": f"DSH HTTP {resp.status_code}: {err_body}",
                                    }
                                )
                                return 1
                        else:
                            model = active_model
                            _emit_ndjson({"type": "init", "provider": "dsh", "model": model})
                            for delta in _iter_sse_deltas(resp):
                                chunks.append(delta)
                                total_chars += len(delta)
                                _emit_ndjson(
                                    {
                                        "type": "assistant",
                                        "delta": delta,
                                        "accumulated_chars": total_chars,
                                    }
                                )
                    if retry_fallback:
                        continue

                    full_text = "".join(chunks).strip()
                    if not full_text:
                        _emit_ndjson(
                            {
                                "type": "error",
                                "is_error": True,
                                "message": "DSH stream completed with empty response.",
                            }
                        )
                        return 1
                    _emit_ndjson(
                        {
                            "type": "result",
                            "subtype": "success",
                            "is_error": False,
                            "result": full_text,
                        }
                    )
                    return 0

                resp = client.post(url, headers=headers, json=req_body)
                if resp.status_code >= 400:
                    if resp.status_code in fallback_statuses and has_fallback:
                        continue
                    sys.stderr.write(
                        f"DSH HTTP {resp.status_code}: {resp.text[:500]}\n"
                    )
                    return 1
                model = active_model
                data = resp.json()
                text = (
                    ((data.get("choices") or [{}])[0].get("message") or {}).get("content")
                    or ""
                ).strip()
                if not text:
                    sys.stderr.write("DSH returned an empty response.\n")
                    return 1
                sys.stdout.write(text + "\n")
                sys.stdout.flush()
                return 0
    except Exception as exc:
        msg = f"DSH CLI request error: {exc}"
        if is_stream_json:
            _emit_ndjson({"type": "error", "is_error": True, "message": msg})
        else:
            sys.stderr.write(msg + "\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
