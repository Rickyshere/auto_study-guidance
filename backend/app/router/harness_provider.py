from __future__ import annotations

import asyncio
import os
import shutil
import tempfile
from pathlib import Path
from typing import List, Optional

from app.schemas import HarnessConfig, HarnessStatusItem


def _find_cli(name: str, extra_paths: List[str]) -> Optional[str]:
    found = shutil.which(name)
    if found:
        return found
    for p in extra_paths:
        expanded = Path(os.path.expandvars(os.path.expanduser(p)))
        if expanded.exists():
            return str(expanded)
    return None


def detect_installed_harnesses() -> List[HarnessStatusItem]:
    home = Path.home()
    claude_path = _find_cli(
        "claude",
        [
            str(home / ".local" / "bin" / "claude.exe"),
            str(home / ".local" / "bin" / "claude"),
        ],
    )
    codex_path = _find_cli(
        "codex",
        [
            str(home / "AppData" / "Local" / "Programs" / "OpenAI" / "Codex" / "bin" / "codex.exe"),
            str(home / "AppData" / "Roaming" / "npm" / "codex.cmd"),
        ],
    )
    gemini_path = _find_cli(
        "gemini",
        [
            str(home / "AppData" / "Roaming" / "npm" / "gemini.cmd"),
            str(home / ".local" / "bin" / "gemini.exe"),
        ],
    )
    return [
        HarnessStatusItem(
            name="claude",
            available=claude_path is not None,
            executable_path=claude_path,
            description="Claude Code CLI (claude -p --output-format text)",
        ),
        HarnessStatusItem(
            name="codex",
            available=codex_path is not None,
            executable_path=codex_path,
            description="OpenAI Codex CLI (codex exec -)",
        ),
        HarnessStatusItem(
            name="gemini",
            available=gemini_path is not None,
            executable_path=gemini_path,
            description="Gemini CLI (gemini -p)",
        ),
    ]


async def run_cli_harness(
    system_prompt: str,
    user_prompt: str,
    harness_config: HarnessConfig,
) -> str:
    """Invoke a local CLI Agent Harness non-interactively via stdin or temp file."""
    combined_prompt = f"[System Instructions]\n{system_prompt}\n\n[Task]\n{user_prompt}"
    detected = {item.name: item for item in detect_installed_harnesses()}
    preferred = harness_config.preferred_cli

    # Auto-pick an available CLI if preferred isn't installed
    if preferred != "custom" and not (detected.get(preferred) and detected[preferred].available):
        for candidate in ("claude", "codex", "gemini"):
            if detected.get(candidate) and detected[candidate].available:
                preferred = candidate  # type: ignore
                break

    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}

    if preferred == "custom":
        tmpl = harness_config.custom_command_template.strip()
        if not tmpl:
            raise RuntimeError("未配置自定义 CLI 命令模板")
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".txt", encoding="utf-8", delete=False
        ) as tf:
            tf.write(combined_prompt)
            tmp_path = tf.name
        try:
            cmd_str = tmpl.replace("{prompt_file}", f'"{tmp_path}"')
            proc = await asyncio.create_subprocess_shell(
                cmd_str,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=harness_config.timeout_seconds
            )
            out_text = stdout.decode("utf-8", errors="replace").strip()
            if proc.returncode != 0 and not out_text:
                raise RuntimeError(stderr.decode("utf-8", errors="replace"))
            return out_text
        finally:
            try:
                Path(tmp_path).unlink(missing_ok=True)
            except Exception:
                pass

    item = detected.get(preferred)
    if not item or not item.available or not item.executable_path:
        raise RuntimeError(f"本机未检测到 {preferred} CLI 可执行文件")

    exe = item.executable_path
    if preferred == "claude":
        # Pass prompt via stdin with `-p` to avoid Windows cmd length limits
        cmd = [exe, "-p", "--output-format", "text"]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(input=combined_prompt.encode("utf-8")),
            timeout=harness_config.timeout_seconds,
        )
    elif preferred == "codex":
        cmd = [exe, "exec", "--skip-git-repo-check", "-"]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(input=combined_prompt.encode("utf-8")),
            timeout=harness_config.timeout_seconds,
        )
    else:  # gemini
        cmd = [exe]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(input=combined_prompt.encode("utf-8")),
            timeout=harness_config.timeout_seconds,
        )

    out_text = stdout.decode("utf-8", errors="replace").strip()
    err_text = stderr.decode("utf-8", errors="replace").strip()
    if proc.returncode != 0 and not out_text:
        raise RuntimeError(f"{preferred} CLI 执行失败 (code={proc.returncode}): {err_text[:400]}")
    if not out_text:
        raise RuntimeError(f"{preferred} CLI 未返回输出内容: {err_text[:200]}")
    return out_text
