"""DSH (DeepSeek/OpenAI-compatible) lightweight CLI harness supporting text & stream-json NDJSON output."""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Iterator

import httpx


def _emit_ndjson(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _resolve_config() -> tuple[str, str, str]:
    api_key = (
        os.environ.get("DSH_API_KEY")
        or os.environ.get("DEEPSEEK_API_KEY")
        or os.environ.get("OPENAI_API_KEY")
        or ""
    ).strip()
    base_url = (
        os.environ.get("DSH_BASE_URL")
        or os.environ.get("DEEPSEEK_BASE_URL")
        or os.environ.get("OPENAI_BASE_URL")
        or "https://api.deepseek.com"
    ).strip().rstrip("/")
    model = (
        os.environ.get("DSH_MODEL")
        or os.environ.get("DEEPSEEK_MODEL")
        or os.environ.get("OPENAI_MODEL")
        or "deepseek-chat"
    ).strip()
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
    parser.add_argument("--model", default=None, help="Override model name")
    parser.add_argument("prompt_pos", nargs="*", help="Positional prompt")
    args = parser.parse_args(argv)

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
    body: dict = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": is_stream_json,
    }

    try:
        with httpx.Client(timeout=httpx.Timeout(180.0, connect=20.0)) as client:
            if is_stream_json:
                _emit_ndjson({"type": "init", "provider": "dsh", "model": model})
                chunks: list[str] = []
                total_chars = 0
                with client.stream("POST", url, headers=headers, json=body) as resp:
                    if resp.status_code >= 400:
                        err_body = resp.read().decode("utf-8", errors="replace")[:500]
                        _emit_ndjson(
                            {
                                "type": "error",
                                "is_error": True,
                                "status_code": resp.status_code,
                                "message": f"DSH HTTP {resp.status_code}: {err_body}",
                            }
                        )
                        return 1
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

            resp = client.post(url, headers=headers, json=body)
            if resp.status_code >= 400:
                sys.stderr.write(
                    f"DSH HTTP {resp.status_code}: {resp.text[:500]}\n"
                )
                return 1
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
