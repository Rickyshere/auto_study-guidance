from __future__ import annotations

import asyncio
import os
import queue
import shlex
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional

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


async def _stream_harness_cmd(
    cmd: List[str],
    state: Dict[str, Any],
    start_pct: int,
    end_pct: int,
    stage_label: str,
    timeout: int = 300,
) -> AsyncIterator[Dict[str, Any]]:
    proc = subprocess.Popen(
        cmd,
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
        "message": f"正在执行: {' '.join(cmd)}",
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
            state["output"] = "\n".join(lines)[-1500:]
            return

        try:
            item = await asyncio.to_thread(q.get, True, min(1.0, remaining))
            if item is None:
                break
            lines.append(item)
            pct = min(float(end_pct - 2), pct + 2.2)
            yield {
                "type": "progress",
                "percent": int(round(pct)),
                "stage": stage_label,
                "message": item[:95],
                "log_line": item,
            }
        except queue.Empty:
            elapsed = int(time.monotonic() - started_at)
            pct = min(float(end_pct - 3), pct + 1.0)
            yield {
                "type": "progress",
                "percent": int(round(pct)),
                "stage": stage_label,
                "message": f"{stage_label}进行中... (已耗时 {elapsed}s)",
                "log_line": "",
            }

    rc = await asyncio.to_thread(proc.wait)
    state["returncode"] = rc if rc is not None else 0
    state["output"] = "\n".join(lines)[-1500:]


async def stream_manage_cli_harness(
    cli_name: str,
    action: str = "install",
) -> AsyncIterator[Dict[str, Any]]:
    """Stream real-time progress for silent CLI Harness install or uninstall."""
    cli = cli_name.strip().lower()
    act = "uninstall" if action == "uninstall" else "install"

    yield {
        "type": "progress",
        "percent": 10,
        "stage": "1/3 环境检测",
        "message": f"正在检测 {cli.upper()} CLI 环境与可执行路径...",
        "log_line": f"[init] cli={cli} action={act}",
    }

    if cli == "dsh":
        wrapper_cmd = VENV_SCRIPTS / "dsh.cmd"
        wrapper_exe = VENV_SCRIPTS / "dsh.exe"
        if act == "uninstall":
            yield {
                "type": "progress",
                "percent": 35,
                "stage": "2/3 移除 DSH 启动器",
                "message": "正在清理 .venv\\Scripts\\dsh.cmd ...",
                "log_line": f"[uninstall] removing {wrapper_cmd}",
            }
            try:
                wrapper_cmd.unlink(missing_ok=True)
                wrapper_exe.unlink(missing_ok=True)
            except Exception as exc:
                msg = f"DSH 卸载失败: {exc}"
                yield {
                    "type": "complete",
                    "percent": 100,
                    "stage": "失败",
                    "message": msg,
                    "result": {
                        "ok": False,
                        "cli_name": "dsh",
                        "available": True,
                        "executable_path": str(wrapper_cmd),
                        "message": msg,
                        "log": str(exc),
                    },
                }
                return

            yield {
                "type": "progress",
                "percent": 82,
                "stage": "3/3 校验卸载状态",
                "message": "正在重新扫描本机 CLI 列表...",
                "log_line": "[verify] checking installed harnesses...",
            }
            detected = {item.name: item for item in detect_installed_harnesses()}
            item = detected.get("dsh")
            still_avail = bool(item and item.available)
            msg = (
                "DeepSeek Harness (dsh) 已一键卸载完成。"
                if not still_avail
                else f"已移除项目内 dsh.cmd，但检测到系统全局路径仍存在: {item.executable_path if item else ''}"
            )
            yield {
                "type": "complete",
                "percent": 100,
                "stage": "卸载完成",
                "message": msg,
                "result": {
                    "ok": True,
                    "cli_name": "dsh",
                    "available": still_avail,
                    "executable_path": item.executable_path if item else None,
                    "message": msg,
                    "log": f"Removed {wrapper_cmd}",
                },
            }
            return

        # DSH install
        try:
            VENV_SCRIPTS.mkdir(parents=True, exist_ok=True)
            py_exe = str(VENV_PYTHON if VENV_PYTHON.exists() else Path(sys.executable))
            yield {
                "type": "progress",
                "percent": 55,
                "stage": "2/3 部署 DSH CLI 启动器",
                "message": "正在写入 .venv\\Scripts\\dsh.cmd 入口...",
                "log_line": f"[install] writing {wrapper_cmd}",
            }
            wrapper_cmd.write_text(
                f'@echo off\r\n"{py_exe}" "D:\\auto_study_guidance\\backend\\app\\router\\dsh_cli.py" %*\r\n',
                encoding="utf-8",
            )
            yield {
                "type": "progress",
                "percent": 88,
                "stage": "3/3 校验安装状态",
                "message": "正在验证 dsh.cmd 可执行性与配置...",
                "log_line": f"[verify] {wrapper_cmd} created",
            }
            detected = {item.name: item for item in detect_installed_harnesses()}
            item = detected.get("dsh")
            avail = bool(item and item.available)
            msg = "DeepSeek Harness (dsh) 一键安装完成，已在 .venv\\Scripts\\dsh.cmd 就绪。"
            yield {
                "type": "complete",
                "percent": 100,
                "stage": "安装完成",
                "message": msg,
                "result": {
                    "ok": avail,
                    "cli_name": "dsh",
                    "available": avail,
                    "executable_path": item.executable_path if item else None,
                    "message": msg,
                    "log": str(wrapper_cmd),
                },
            }
            return
        except Exception as exc:
            msg = f"DSH 安装失败: {exc}"
            yield {
                "type": "complete",
                "percent": 100,
                "stage": "失败",
                "message": msg,
                "result": {
                    "ok": False,
                    "cli_name": "dsh",
                    "available": False,
                    "executable_path": None,
                    "message": msg,
                    "log": "",
                },
            }
            return

    npm_pkg_map = {
        "claude": "@anthropic-ai/claude-code",
        "codex": "@openai/codex",
        "gemini": "@google/gemini-cli",
    }
    pkg = npm_pkg_map.get(cli)
    if not pkg:
        msg = f"不支持一键管理未知 CLI: {cli}"
        yield {
            "type": "complete",
            "percent": 100,
            "stage": "失败",
            "message": msg,
            "result": {
                "ok": False,
                "cli_name": cli,
                "available": False,
                "executable_path": None,
                "message": msg,
                "log": "",
            },
        }
        return

    npm_exe = shutil.which("npm.cmd") or shutil.which("npm")
    if not npm_exe:
        msg = f"本机未找到 npm，无法自动{('卸载' if act == 'uninstall' else '安装')} {pkg}，请先安装 Node.js 或手动运行 npm {act} -g {pkg}。"
        yield {
            "type": "complete",
            "percent": 100,
            "stage": "失败",
            "message": msg,
            "result": {
                "ok": False,
                "cli_name": cli,
                "available": False,
                "executable_path": None,
                "message": msg,
                "log": "",
            },
        }
        return

    state: Dict[str, Any] = {"returncode": 0, "output": ""}
    stage_label = f"2/3 {'卸载' if act == 'uninstall' else '下载并全局安装'} {pkg}"
    async for evt in _stream_harness_cmd(
        [npm_exe, "uninstall" if act == "uninstall" else "install", "-g", pkg],
        state=state,
        start_pct=18,
        end_pct=88,
        stage_label=stage_label,
        timeout=300,
    ):
        yield evt

    yield {
        "type": "progress",
        "percent": 94,
        "stage": "3/3 校验 CLI 状态",
        "message": f"正在重新探测 {cli} 可执行路径...",
        "log_line": f"[verify] probing {cli}...",
    }
    detected = {item.name: item for item in detect_installed_harnesses()}
    item = detected.get(cli)
    avail = bool(item and item.available)
    if act == "uninstall":
        ok = state["returncode"] == 0 and not avail
        msg = f"{cli} CLI 已一键卸载完成。" if not avail else f"{cli} CLI 卸载未完全移除 (code={state['returncode']})，请检查日志。"
        done_stage = "卸载完成" if ok else "卸载结束"
    else:
        ok = state["returncode"] == 0 and avail
        msg = f"{cli} CLI 安装成功并已自动探测到可执行路径。" if avail else f"{cli} CLI 安装未完成 (code={state['returncode']})，请检查日志。"
        done_stage = "安装完成" if ok else "安装失败"

    yield {
        "type": "complete",
        "percent": 100,
        "stage": done_stage,
        "message": msg,
        "result": {
            "ok": ok,
            "cli_name": cli,
            "available": avail,
            "executable_path": item.executable_path if item else None,
            "message": msg,
            "log": state["output"][-1200:],
        },
    }


async def install_cli_harness(cli_name: str, action: str = "install") -> Dict[str, Any]:
    """Silently install or uninstall CLI Harness (dsh, claude, codex, gemini) without opening terminals."""
    final_res: Optional[Dict[str, Any]] = None
    async for evt in stream_manage_cli_harness(cli_name, action=action):
        if evt.get("type") == "complete":
            final_res = evt.get("result")
    return final_res or {
        "ok": False,
        "cli_name": cli_name,
        "available": False,
        "executable_path": None,
        "message": "CLI 操作未返回结果",
        "log": "",
    }


async def uninstall_cli_harness(cli_name: str) -> Dict[str, Any]:
    return await install_cli_harness(cli_name, action="uninstall")


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
        raw_tokens = shlex.split(tmpl, posix=(sys.platform != "win32"))
        if not raw_tokens:
            raise RuntimeError("自定义 CLI 命令模板无效")
        tokens = [t.strip("\"'") if sys.platform == "win32" else t for t in raw_tokens]
        first_bin = Path(tokens[0]).name.lower()
        if first_bin in {"cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh", "pwsh.exe", "sh", "bash"} and os.environ.get("ASG_ALLOW_CUSTOM_SHELL") != "1":
            raise RuntimeError("出于安全限制，自定义 CLI 模板禁止直接调用系统 Shell 解释器")
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".txt", encoding="utf-8", delete=False
        ) as tf:
            tf.write(combined_prompt)
            tmp_path = tf.name
        try:
            cmd_args = [tok.replace("{prompt_file}", tmp_path) for tok in tokens]
            res = await asyncio.to_thread(
                subprocess.run,
                cmd_args,
                shell=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=env,
                creationflags=WIN_NO_WINDOW,
                timeout=harness_config.timeout_seconds,
                check=False,
            )
            out_text = (res.stdout or b"").decode("utf-8", errors="replace").strip()
            if res.returncode != 0 and not out_text:
                raise RuntimeError((res.stderr or b"").decode("utf-8", errors="replace"))
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

    res = await asyncio.to_thread(
        subprocess.run,
        cmd,
        input=combined_prompt.encode("utf-8"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        creationflags=WIN_NO_WINDOW,
        timeout=harness_config.timeout_seconds,
        check=False,
    )

    out_text = (res.stdout or b"").decode("utf-8", errors="replace").strip()
    err_text = (res.stderr or b"").decode("utf-8", errors="replace").strip()
    if res.returncode != 0 and not out_text:
        raise RuntimeError(f"{preferred} CLI 执行失败 (code={res.returncode}): {err_text[:400]}")
    if not out_text:
        raise RuntimeError(f"{preferred} CLI 未返回输出内容: {err_text[:200]}")
    return out_text
