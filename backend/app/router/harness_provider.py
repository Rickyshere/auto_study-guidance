from __future__ import annotations

import asyncio
import json
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
from typing import Any, AsyncIterator, Callable, Dict, List, Optional, Set

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


class HarnessCancelToken:
    """Thread-safe cancellation token that kills active CLI subprocess trees on cancel."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.cancelled: bool = False
        self.cancel_event = threading.Event()
        self._processes: Set[subprocess.Popen] = set()

    def register(self, proc: subprocess.Popen) -> None:
        kill_now = False
        with self._lock:
            if self.cancelled:
                kill_now = True
            else:
                self._processes.add(proc)
        if kill_now:
            _kill_process_tree(proc)

    def unregister(self, proc: subprocess.Popen) -> None:
        with self._lock:
            self._processes.discard(proc)

    def cancel(self) -> None:
        with self._lock:
            if self.cancelled:
                procs = list(self._processes)
            else:
                self.cancelled = True
                self.cancel_event.set()
                procs = list(self._processes)
        for proc in procs:
            _kill_process_tree(proc)

    def raise_if_cancelled(self) -> None:
        if self.cancelled:
            raise asyncio.CancelledError("任务已被用户取消")


def _kill_process_tree(proc: Optional[subprocess.Popen]) -> None:
    if proc is None:
        return
    try:
        if proc.poll() is not None:
            return
    except Exception:
        pass

    pid = getattr(proc, "pid", None)
    if sys.platform == "win32" and pid:
        try:
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(pid)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=WIN_NO_WINDOW,
                timeout=5,
                check=False,
            )
        except Exception:
            pass
    try:
        proc.kill()
    except Exception:
        pass
    try:
        proc.wait(timeout=2)
    except Exception:
        pass


def _extract_claude_text(msg_obj: Any) -> str:
    if isinstance(msg_obj, str):
        return msg_obj
    if isinstance(msg_obj, dict):
        content = msg_obj.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts: List[str] = []
            for block in content:
                if isinstance(block, dict):
                    if block.get("type") == "text" and block.get("text"):
                        parts.append(str(block["text"]))
                    elif isinstance(block.get("text"), str):
                        parts.append(block["text"])
            return "".join(parts)
    return ""


def _parse_stream_json_line(line: str, cli_name: str) -> Dict[str, Any]:
    """Parse one NDJSON line emitted by dsh / claude / codex / gemini stream-json mode."""
    stripped = line.strip()
    if not stripped:
        return {"is_json": False, "event_type": "empty", "text": "", "status": "", "error": ""}

    if not stripped.startswith("{"):
        return {
            "is_json": False,
            "event_type": "raw",
            "text": line,
            "status": "",
            "error": "",
        }

    try:
        obj = json.loads(stripped)
    except json.JSONDecodeError:
        return {
            "is_json": False,
            "event_type": "raw",
            "text": line,
            "status": "",
            "error": "",
        }

    if not isinstance(obj, dict):
        return {"is_json": False, "event_type": "raw", "text": line, "status": "", "error": ""}

    ev_type = str(obj.get("type") or "").lower()
    subtype = str(obj.get("subtype") or "").lower()
    status_val = str(obj.get("status") or "").lower()
    is_error = bool(obj.get("is_error")) or ev_type == "error" or subtype == "error" or status_val == "error"

    if ev_type == "turn.failed":
        is_error = True

    if is_error:
        err_obj = obj.get("error")
        err_msg = ""
        if isinstance(err_obj, dict):
            err_msg = str(err_obj.get("message") or err_obj)
        elif isinstance(err_obj, str):
            err_msg = err_obj
        err_msg = err_msg or str(obj.get("message") or obj.get("result") or stripped)
        return {
            "is_json": True,
            "event_type": "error",
            "text": "",
            "status": f"{cli_name} 错误: {err_msg[:100]}",
            "error": err_msg,
        }

    # Init events across CLIs
    if ev_type in {"init", "thread.started", "turn.started"} or (
        ev_type == "system" and subtype == "init"
    ):
        model_name = obj.get("model") or ""
        suffix = f" ({model_name})" if model_name else ""
        return {
            "is_json": True,
            "event_type": "init",
            "text": "",
            "status": f"{cli_name} 会话已建立{suffix}",
            "error": "",
        }

    # Final result event (dsh / claude / gemini)
    if ev_type == "result":
        res_text = obj.get("result")
        if res_text is None:
            res_text = obj.get("response") or obj.get("text") or ""
        return {
            "is_json": True,
            "event_type": "result",
            "text": str(res_text),
            "status": f"{cli_name} 返回完整结果",
            "error": "",
        }

    # Codex item events
    if ev_type in {"item.completed", "item.updated"}:
        item = obj.get("item") if isinstance(obj.get("item"), dict) else {}
        item_type = str(item.get("type") or "").lower()
        item_text = str(item.get("text") or "")
        if item_type == "agent_message" and item_text:
            return {
                "is_json": True,
                "event_type": "result" if ev_type == "item.completed" else "status",
                "text": item_text if ev_type == "item.completed" else "",
                "status": f"{cli_name} 正在生成回复 ({len(item_text)} 字)"
                if item_text
                else f"{cli_name} 处理条目",
                "error": "",
            }
        if item_type == "reasoning":
            return {
                "is_json": True,
                "event_type": "status",
                "text": "",
                "status": f"{cli_name} 正在深度推理...",
                "error": "",
            }
        return {
            "is_json": True,
            "event_type": "status",
            "text": "",
            "status": f"{cli_name} 执行步骤: {item_type or ev_type}",
            "error": "",
        }

    # Gemini message event
    if ev_type == "message" and str(obj.get("role") or "").lower() == "assistant":
        content = str(obj.get("content") or "")
        return {
            "is_json": True,
            "event_type": "delta" if obj.get("delta") else "snapshot",
            "text": content,
            "status": "",
            "error": "",
        }

    # Claude / DSH assistant or content_block_delta
    if ev_type == "assistant":
        delta = obj.get("delta")
        if isinstance(delta, str) and delta:
            return {
                "is_json": True,
                "event_type": "delta",
                "text": delta,
                "status": "",
                "error": "",
            }
        msg_text = _extract_claude_text(obj.get("message") or obj)
        if msg_text:
            return {
                "is_json": True,
                "event_type": "snapshot",
                "text": msg_text,
                "status": "",
                "error": "",
            }

    if ev_type == "content_block_delta":
        delta_obj = obj.get("delta")
        if isinstance(delta_obj, dict) and delta_obj.get("text"):
            return {
                "is_json": True,
                "event_type": "delta",
                "text": str(delta_obj["text"]),
                "status": "",
                "error": "",
            }

    return {
        "is_json": True,
        "event_type": "status",
        "text": "",
        "status": f"{cli_name} 状态事件: {ev_type or 'running'}",
        "error": "",
    }


async def _emit_status(status_cb: Optional[Callable[[str], Any]], text: str) -> None:
    if not status_cb or not text:
        return
    res = status_cb(text)
    if asyncio.iscoroutine(res) or hasattr(res, "__await__"):
        await res


def _build_cli_command(
    preferred: str,
    exe: str,
    custom_tokens: Optional[List[str]] = None,
) -> tuple[List[str], bool]:
    """Build subprocess argv and whether stream-json output parsing is expected."""
    if preferred == "claude":
        return [exe, "-p", "--verbose", "--output-format", "stream-json"], True
    if preferred == "codex":
        return [exe, "exec", "--json", "--skip-git-repo-check", "-"], True
    if preferred == "dsh":
        return [exe, "--output-format", "stream-json", "--verbose"], True
    if preferred == "gemini":
        return [exe, "--output-format", "stream-json"], True
    if custom_tokens is not None:
        return custom_tokens, False
    return [exe], False


async def _run_cli_attempt(
    cmd: List[str],
    cli_label: str,
    stdin_payload: Optional[str],
    env: Dict[str, str],
    timeout_seconds: int,
    expect_stream_json: bool,
    cancel_token: Optional[HarnessCancelToken],
    status_cb: Optional[Callable[[str], Any]],
) -> str:
    if cancel_token:
        cancel_token.raise_if_cancelled()

    await _emit_status(status_cb, f"启动 {cli_label} 子进程...")

    proc = subprocess.Popen(
        cmd,
        shell=False,
        stdin=subprocess.PIPE if stdin_payload is not None else subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        creationflags=WIN_NO_WINDOW,
        bufsize=0,
    )

    if cancel_token:
        cancel_token.register(proc)

    line_queue: queue.Queue[tuple[str, Optional[str]]] = queue.Queue()

    def _feed_stdin() -> None:
        if proc.stdin is None or stdin_payload is None:
            return
        try:
            proc.stdin.write(stdin_payload.encode("utf-8"))
            proc.stdin.flush()
        except Exception:
            pass
        finally:
            try:
                proc.stdin.close()
            except Exception:
                pass

    def _read_stream(stream: Any, tag: str) -> None:
        try:
            if stream is None:
                return
            for raw_bytes in iter(stream.readline, b""):
                line_queue.put((tag, raw_bytes.decode("utf-8", errors="replace")))
        except Exception:
            pass
        finally:
            try:
                if stream is not None:
                    stream.close()
            except Exception:
                pass
            line_queue.put((f"{tag}_eof", None))

    if stdin_payload is not None:
        threading.Thread(target=_feed_stdin, daemon=True).start()
    threading.Thread(target=_read_stream, args=(proc.stdout, "stdout"), daemon=True).start()
    threading.Thread(target=_read_stream, args=(proc.stderr, "stderr"), daemon=True).start()

    delta_chunks: List[str] = []
    snapshot_text: Optional[str] = None
    final_result_text: Optional[str] = None
    raw_stdout_lines: List[str] = []
    stderr_lines: List[str] = []
    stream_errors: List[str] = []
    eof_count = 0
    total_stream_chars = 0
    last_delta_notify = 0.0
    deadline = time.monotonic() + max(5, timeout_seconds)

    try:
        while eof_count < 2:
            if cancel_token and cancel_token.cancelled:
                _kill_process_tree(proc)
                raise asyncio.CancelledError("任务已被用户取消")

            if time.monotonic() > deadline:
                _kill_process_tree(proc)
                raise TimeoutError(f"{cli_label} CLI 执行超时 ({timeout_seconds}s)")

            drained = False
            while True:
                try:
                    tag, content = line_queue.get_nowait()
                except queue.Empty:
                    break
                drained = True

                if tag in ("stdout_eof", "stderr_eof"):
                    eof_count += 1
                    continue

                if tag == "stderr" and content is not None:
                    err_s = content.strip()
                    if err_s:
                        stderr_lines.append(err_s)
                        if len(stderr_lines) <= 3 or "error" in err_s.lower():
                            await _emit_status(status_cb, f"{cli_label} [stderr] {err_s[:100]}")
                    continue

                if tag == "stdout" and content is not None:
                    parsed = _parse_stream_json_line(content, cli_label)
                    ev_type = parsed["event_type"]
                    if not parsed["is_json"]:
                        if ev_type == "raw":
                            raw_stdout_lines.append(content.rstrip("\r\n"))
                            total_stream_chars += len(content.strip())
                            now = time.monotonic()
                            if (not expect_stream_json) and (now - last_delta_notify >= 0.4):
                                last_delta_notify = now
                                await _emit_status(
                                    status_cb,
                                    f"{cli_label} 输出中 ({total_stream_chars} 字)...",
                                )
                        continue

                    if ev_type == "error":
                        stream_errors.append(parsed["error"] or parsed["status"])
                        await _emit_status(status_cb, parsed["status"])
                    elif ev_type == "init":
                        await _emit_status(status_cb, parsed["status"])
                    elif ev_type == "status":
                        await _emit_status(status_cb, parsed["status"])
                    elif ev_type == "delta":
                        delta_chunks.append(parsed["text"])
                        total_stream_chars += len(parsed["text"])
                        now = time.monotonic()
                        if now - last_delta_notify >= 0.35:
                            last_delta_notify = now
                            preview = "".join(delta_chunks)[-48:].replace("\n", " ").strip()
                            await _emit_status(
                                status_cb,
                                f"{cli_label} 流式生成中 ({total_stream_chars} 字): {preview}",
                            )
                    elif ev_type == "snapshot":
                        snapshot_text = parsed["text"]
                        total_stream_chars = max(total_stream_chars, len(snapshot_text))
                        now = time.monotonic()
                        if now - last_delta_notify >= 0.35:
                            last_delta_notify = now
                            await _emit_status(
                                status_cb,
                                f"{cli_label} 已接收 {len(snapshot_text)} 字...",
                            )
                    elif ev_type == "result":
                        final_result_text = parsed["text"]
                        await _emit_status(status_cb, parsed["status"])

            if eof_count >= 2:
                break
            await asyncio.sleep(0.02 if drained else 0.05)

        if cancel_token and cancel_token.cancelled:
            _kill_process_tree(proc)
            raise asyncio.CancelledError("任务已被用户取消")

        try:
            returncode = await asyncio.to_thread(proc.wait, 5)
        except subprocess.TimeoutExpired:
            _kill_process_tree(proc)
            raise TimeoutError(f"{cli_label} CLI 进程收尾超时")
    finally:
        if cancel_token:
            cancel_token.unregister(proc)

    if cancel_token:
        cancel_token.raise_if_cancelled()

    if stream_errors:
        raise RuntimeError(
            f"{cli_label} stream-json 报错 (code={returncode}): {'; '.join(stream_errors)[:400]}"
        )

    if returncode != 0:
        err_detail = "\n".join(stderr_lines[-5:]).strip() or "\n".join(raw_stdout_lines[-5:]).strip()
        raise RuntimeError(
            f"{cli_label} CLI 非零退出 (code={returncode}): {err_detail[:400]}"
        )

    out_text = (
        final_result_text
        if final_result_text is not None and final_result_text.strip()
        else (
            "".join(delta_chunks)
            if delta_chunks
            else (snapshot_text if snapshot_text is not None else "\n".join(raw_stdout_lines))
        )
    ).strip()

    if not out_text:
        err_detail = "\n".join(stderr_lines[-3:]).strip()
        raise RuntimeError(f"{cli_label} CLI 未返回有效输出内容: {err_detail[:200]}")

    return out_text


async def run_cli_harness(
    system_prompt: str,
    user_prompt: str,
    harness_config: HarnessConfig,
    cancel_token: Optional[HarnessCancelToken] = None,
    status_cb: Optional[Callable[[str], Any]] = None,
) -> str:
    """Invoke a local CLI Agent Harness with stream-json progress, cancellation, strict exit validation, and auto-retry."""
    if cancel_token:
        cancel_token.raise_if_cancelled()

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
    max_retries = max(0, int(getattr(harness_config, "max_retries", 2)))
    total_attempts = 1 + max_retries

    tmp_path: Optional[str] = None
    stdin_payload: Optional[str] = combined_prompt
    expect_stream_json = True

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
        cmd_args = [tok.replace("{prompt_file}", tmp_path) for tok in tokens]
        cmd, expect_stream_json = _build_cli_command("custom", cmd_args[0], custom_tokens=cmd_args)
        stdin_payload = None
    else:
        item = detected.get(preferred)
        if not item or not item.available or not item.executable_path:
            raise RuntimeError(f"本机未检测到 {preferred} CLI 可执行文件，请在设置中点击“一键安装”")
        cmd, expect_stream_json = _build_cli_command(preferred, item.executable_path)

    try:
        last_exc: Optional[Exception] = None
        for attempt in range(1, total_attempts + 1):
            if cancel_token:
                cancel_token.raise_if_cancelled()
            try:
                return await _run_cli_attempt(
                    cmd=cmd,
                    cli_label=preferred,
                    stdin_payload=stdin_payload,
                    env=env,
                    timeout_seconds=harness_config.timeout_seconds,
                    expect_stream_json=expect_stream_json,
                    cancel_token=cancel_token,
                    status_cb=status_cb,
                )
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                last_exc = exc
                if attempt >= total_attempts:
                    raise
                delay = min(1.5 * attempt, 4.0)
                await _emit_status(
                    status_cb,
                    f"{preferred} 第 {attempt}/{total_attempts} 次失败 ({str(exc)[:80]})，{delay:.1f}s 后重试...",
                )
                step_deadline = time.monotonic() + delay
                while time.monotonic() < step_deadline:
                    if cancel_token and cancel_token.cancelled:
                        cancel_token.raise_if_cancelled()
                    await asyncio.sleep(0.1)
        assert last_exc is not None
        raise last_exc
    finally:
        if tmp_path:
            try:
                Path(tmp_path).unlink(missing_ok=True)
            except Exception:
                pass
