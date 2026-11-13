from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.schemas import HarnessConfig, HarnessStatusItem

WIN_NO_WINDOW = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
VENV_SCRIPTS = Path(r"D:\auto_study_guidance\backend\.venv\Scripts")
VENV_PYTHON = VENV_SCRIPTS / "python.exe"


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
    dsh_path = _find_cli(
        "dsh",
        [
            str(VENV_SCRIPTS / "dsh.cmd"),
            str(VENV_SCRIPTS / "dsh.exe"),
            str(home / ".local" / "bin" / "dsh.exe"),
            str(home / "AppData" / "Roaming" / "npm" / "dsh.cmd"),
        ],
    )
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
            name="dsh",
            available=dsh_path is not None,
            executable_path=dsh_path,
            description="DeepSeek Harness CLI (dsh · 兼容 DeepSeek Agent / API)",
            install_supported=True,
            install_command_hint="一键部署 DSH (DeepSeek Harness) 到虚拟环境并生成 dsh.cmd",
        ),
        HarnessStatusItem(
            name="claude",
            available=claude_path is not None,
            executable_path=claude_path,
            description="Claude Code CLI (claude -p --output-format text)",
            install_supported=True,
            install_command_hint="npm install -g @anthropic-ai/claude-code",
        ),
        HarnessStatusItem(
            name="codex",
            available=codex_path is not None,
            executable_path=codex_path,
            description="OpenAI Codex CLI (codex exec -)",
            install_supported=True,
            install_command_hint="npm install -g @openai/codex",
        ),
        HarnessStatusItem(
            name="gemini",
            available=gemini_path is not None,
            executable_path=gemini_path,
            description="Gemini CLI (gemini -p)",
            install_supported=True,
            install_command_hint="npm install -g @google/gemini-cli",
        ),
    ]


async def install_cli_harness(cli_name: str) -> Dict[str, Any]:
    """Silently install missing CLI Harness (dsh, claude, codex, gemini) without opening terminals."""
    cli = cli_name.strip().lower()
    if cli == "dsh":
        try:
            VENV_SCRIPTS.mkdir(parents=True, exist_ok=True)
            py_exe = str(VENV_PYTHON if VENV_PYTHON.exists() else Path(sys.executable))
            wrapper_cmd = VENV_SCRIPTS / "dsh.cmd"
            wrapper_cmd.write_text(
                f'@echo off\r\n"{py_exe}" "D:\\auto_study_guidance\\backend\\app\\router\\dsh_cli.py" %*\r\n',
                encoding="utf-8",
            )
            detected = {item.name: item for item in detect_installed_harnesses()}
            item = detected.get("dsh")
            return {
                "ok": bool(item and item.available),
                "cli_name": "dsh",
                "available": bool(item and item.available),
                "executable_path": item.executable_path if item else None,
                "message": "DeepSeek Harness (dsh) 一键安装完成，已在 .venv\\Scripts\\dsh.cmd 就绪。",
                "log": str(wrapper_cmd),
            }
        except Exception as exc:
            return {
                "ok": False,
                "cli_name": "dsh",
                "available": False,
                "executable_path": None,
                "message": f"DSH 安装失败: {exc}",
                "log": "",
            }

    npm_pkg_map = {
        "claude": "@anthropic-ai/claude-code",
        "codex": "@openai/codex",
        "gemini": "@google/gemini-cli",
    }
    pkg = npm_pkg_map.get(cli)
    if not pkg:
        return {
            "ok": False,
            "cli_name": cli,
            "available": False,
            "executable_path": None,
            "message": f"不支持一键安装未知 CLI: {cli}",
            "log": "",
        }

    npm_exe = shutil.which("npm.cmd") or shutil.which("npm")
    if not npm_exe:
        return {
            "ok": False,
            "cli_name": cli,
            "available": False,
            "executable_path": None,
            "message": f"本机未找到 npm，无法自动安装 {pkg}，请先安装 Node.js 或手动运行 npm install -g {pkg}。",
            "log": "",
        }

    proc = await asyncio.create_subprocess_exec(
        npm_exe,
        "install",
        "-g",
        pkg,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        creationflags=WIN_NO_WINDOW,
    )
    stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=300)
    out = (stdout or b"").decode("utf-8", errors="replace").strip()
    detected = {item.name: item for item in detect_installed_harnesses()}
    item = detected.get(cli)
    return {
        "ok": proc.returncode == 0 and bool(item and item.available),
        "cli_name": cli,
        "available": bool(item and item.available),
        "executable_path": item.executable_path if item else None,
        "message": (
            f"{cli} CLI 安装成功并已自动探测到可执行路径。"
            if item and item.available
            else f"{cli} CLI 安装未完成 (code={proc.returncode})，请检查日志。"
        ),
        "log": out[-1200:],
    }


async def run_cli_harness(
    system_prompt: str,
    user_prompt: str,
    harness_config: HarnessConfig,
) -> str:
    """Invoke a local CLI Agent Harness non-interactively and silently via stdin or temp file."""
    combined_prompt = f"[System Instructions]\n{system_prompt}\n\n[Task]\n{user_prompt}"
    detected = {item.name: item for item in detect_installed_harnesses()}
    preferred = harness_config.preferred_cli

    # Auto-pick an available CLI if preferred isn't installed
    if preferred != "custom" and not (detected.get(preferred) and detected[preferred].available):
        for candidate in ("dsh", "claude", "codex", "gemini"):
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
                creationflags=WIN_NO_WINDOW,
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
        raise RuntimeError(f"本机未检测到 {preferred} CLI 可执行文件，请在设置中点击“一键安装”")

    exe = item.executable_path
    if preferred == "claude":
        cmd = [exe, "-p", "--output-format", "text"]
    elif preferred == "codex":
        cmd = [exe, "exec", "--skip-git-repo-check", "-"]
    elif preferred == "dsh":
        cmd = [exe]
    else:  # gemini
        cmd = [exe]

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
        creationflags=WIN_NO_WINDOW,
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
