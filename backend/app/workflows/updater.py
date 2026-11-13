from __future__ import annotations

import asyncio
import json
import subprocess
import sys
import threading
import queue
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional, Tuple

WIN_NO_WINDOW = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
REPO_ROOT = Path(__file__).resolve().parents[3]
FRONTEND_DIR = REPO_ROOT / "frontend"

_last_checked_at: Optional[str] = None
_last_push_notice_at: Optional[str] = None


def _run_cmd_silent(
    args: List[str], cwd: Path = REPO_ROOT, timeout: int = 30
) -> Tuple[int, str, str]:
    """Run git or build command silently without creating console windows on Windows."""
    try:
        proc = subprocess.run(
            args,
            cwd=str(cwd),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            creationflags=WIN_NO_WINDOW,
        )
        return proc.returncode, proc.stdout.strip(), proc.stderr.strip()
    except subprocess.TimeoutExpired:
        return -1, "", f"命令执行超时 ({timeout}s)"
    except Exception as exc:
        return -1, "", str(exc)


def _git(*args: str, timeout: int = 25) -> Tuple[int, str, str]:
    return _run_cmd_silent(["git", *args], cwd=REPO_ROOT, timeout=timeout)


def _parse_commits(log_output: str) -> List[Dict[str, str]]:
    commits: List[Dict[str, str]] = []
    for line in log_output.splitlines():
        parts = line.split("\x1f")
        if len(parts) >= 4:
            commits.append(
                {
                    "hash": parts[0].strip(),
                    "message": parts[1].strip(),
                    "date": parts[2].strip(),
                    "author": parts[3].strip(),
                }
            )
    return commits


def get_update_status(fetch: bool = False) -> Dict[str, Any]:
    """Inspect local git HEAD vs origin/<branch>, optionally fetching from origin first."""
    global _last_checked_at
    fetch_error: Optional[str] = None

    _, branch, _ = _git("rev-parse", "--abbrev-ref", "HEAD")
    branch = branch or "main"

    if fetch:
        rc, _, err = _git("fetch", "origin", branch, timeout=25)
        if rc != 0:
            fetch_error = err or "无法连接远端仓库 origin"
        _last_checked_at = datetime.now(timezone.utc).isoformat()

    _, local_hash, _ = _git("rev-parse", "--short", "HEAD")
    _, local_msg, _ = _git("log", "-1", "--pretty=%s", "HEAD")
    _, local_date, _ = _git("log", "-1", "--pretty=%ci", "HEAD")
    _, remote_url, _ = _git("remote", "get-url", "origin")

    remote_ref = f"origin/{branch}"
    rc_rem, remote_hash, _ = _git("rev-parse", "--short", remote_ref)
    if rc_rem != 0:
        remote_hash = ""
        remote_msg = ""
        behind_count = 0
        ahead_count = 0
        incoming: List[Dict[str, str]] = []
    else:
        _, remote_msg, _ = _git("log", "-1", "--pretty=%s", remote_ref)
        rc_cnt, counts, _ = _git("rev-list", "--left-right", "--count", f"HEAD...{remote_ref}")
        ahead_count = 0
        behind_count = 0
        if rc_cnt == 0 and counts:
            parts = counts.split()
            if len(parts) == 2:
                try:
                    ahead_count = int(parts[0])
                    behind_count = int(parts[1])
                except ValueError:
                    pass
        _, incoming_raw, _ = _git(
            "log",
            f"HEAD..{remote_ref}",
            "--pretty=%h\x1f%s\x1f%ci\x1f%an",
            "-n",
            "15",
        )
        incoming = _parse_commits(incoming_raw)

    _, dirty_raw, _ = _git("status", "--porcelain")
    dirty_files = [ln for ln in dirty_raw.splitlines() if ln.strip()]

    return {
        "repo_available": bool(local_hash),
        "branch": branch,
        "remote_url": remote_url,
        "local_commit": local_hash,
        "local_message": local_msg,
        "local_date": local_date,
        "remote_commit": remote_hash,
        "remote_message": remote_msg,
        "behind_count": behind_count,
        "ahead_count": ahead_count,
        "has_update": behind_count > 0,
        "incoming_commits": incoming,
        "dirty_count": len(dirty_files),
        "checked_at": _last_checked_at,
        "push_notice_at": _last_push_notice_at,
        "fetch_error": fetch_error,
    }


def record_push_webhook() -> Dict[str, Any]:
    """Record a webhook/push ping and immediately fetch origin so clients see incoming commits."""
    global _last_push_notice_at
    _last_push_notice_at = datetime.now(timezone.utc).isoformat()
    return get_update_status(fetch=True)


async def pull_and_apply_update_stream(rebuild_frontend: bool = True) -> AsyncIterator[str]:
    """Fetch + pull latest remote push commits and optionally rebuild frontend bundle via SSE."""
    q: queue.Queue[Optional[Dict[str, Any]]] = queue.Queue()

    def emit(
        evt_type: str,
        percent: int,
        stage: str,
        message: str,
        log_line: str = "",
        result: Any = None,
    ) -> None:
        payload: Dict[str, Any] = {
            "type": evt_type,
            "percent": percent,
            "stage": stage,
            "message": message,
        }
        if log_line:
            payload["log_line"] = log_line
        if result is not None:
            payload["result"] = result
        q.put(payload)

    def worker() -> None:
        try:
            _, branch, _ = _git("rev-parse", "--abbrev-ref", "HEAD")
            branch = branch or "main"

            emit("progress", 15, "拉取远端索引", f"正在从 origin/{branch} 检查最新 Push...", f"$ git fetch origin {branch}")
            rc, out, err = _git("fetch", "origin", branch, timeout=35)
            if out or err:
                emit("progress", 25, "远端索引完成", "远端索引已同步", out or err)
            if rc != 0:
                status_now = get_update_status(fetch=False)
                emit(
                    "complete",
                    100,
                    "连接失败",
                    f"拉取远端失败：{err or '请检查网络与 Git 凭据'}",
                    err,
                    result={"ok": False, "message": err or "git fetch 失败", "status": status_now},
                )
                return

            status_pre = get_update_status(fetch=False)
            if status_pre.get("behind_count", 0) == 0:
                emit(
                    "complete",
                    100,
                    "✓ 已是最新版本",
                    f"当前本地 ({status_pre.get('local_commit')}) 已同步最新远端代码，无需更新。",
                    "Already up to date.",
                    result={"ok": True, "updated": False, "message": "当前已是最新版本", "status": status_pre},
                )
                return

            emit(
                "progress",
                45,
                "应用最新 Push",
                f"发现 {status_pre['behind_count']} 条新提交，正在合并更新...",
                f"$ git pull --rebase --autostash origin {branch}",
            )
            rc_pull, out_pull, err_pull = _git(
                "pull", "--rebase", "--autostash", "origin", branch, timeout=60
            )
            log_pull = "\n".join(x for x in (out_pull, err_pull) if x)
            if rc_pull != 0:
                status_fail = get_update_status(fetch=False)
                emit(
                    "complete",
                    100,
                    "合并冲突或失败",
                    f"接收 Push 失败：{err_pull or out_pull}",
                    log_pull,
                    result={"ok": False, "message": err_pull or out_pull or "git pull 失败", "status": status_fail},
                )
                return

            if log_pull:
                emit("progress", 65, "代码已更新", "远端代码已合并至本地工作区", log_pull)

            if rebuild_frontend and (FRONTEND_DIR / "package.json").exists():
                emit(
                    "progress",
                    76,
                    "重建前端静态产物",
                    "正在静默编译最新前端资源以热更新桌面端/8000端口服务...",
                    "$ npm run build",
                )
                npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"
                rc_build, out_build, err_build = _run_cmd_silent(
                    [npm_cmd, "run", "build"], cwd=FRONTEND_DIR, timeout=180
                )
                if rc_build != 0:
                    emit(
                        "progress",
                        92,
                        "前端构建提示",
                        "代码已拉取成功，但前端自动构建未完成（可手动 npm run build）",
                        err_build or out_build,
                    )
                else:
                    emit("progress", 94, "前端构建完成", "最新前端 bundle 已就绪", "vite build completed")

            final_status = get_update_status(fetch=False)
            emit(
                "complete",
                100,
                "✓ 已接收新版本 Push",
                f"已成功同步到最新提交 {final_status.get('local_commit')}（{final_status.get('local_message')}）",
                "Update applied cleanly.",
                result={
                    "ok": True,
                    "updated": True,
                    "message": f"已更新至 {final_status.get('local_commit')}",
                    "status": final_status,
                },
            )
        except Exception as exc:
            emit(
                "complete",
                100,
                "更新异常",
                f"更新异常：{exc}",
                str(exc),
                result={"ok": False, "message": str(exc)},
            )
        finally:
            q.put(None)

    threading.Thread(target=worker, daemon=True).start()
    while True:
        try:
            item = q.get_nowait()
        except queue.Empty:
            await asyncio.sleep(0.08)
            continue
        if item is None:
            break
        yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"
