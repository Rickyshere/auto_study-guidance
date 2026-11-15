"""热更新：把一次「接收新版本」做完整——代码、依赖、前端产物、桌面外壳。

设计目标：用户点一次「热更新」，本地文件就应当全部是最新的，而不是只 pull 了代码、
还要自己记得跑 npm install / npm run build / build_exe.ps1。

三步之外还有一个现实约束：桌面外壳 `AutoStudyGuidance.exe` 正在运行时无法被覆盖，
所以它要么当场重建，要么排进「关窗后自动重建」队列，并在结果里如实说明。
"""

from __future__ import annotations

import asyncio
import json
import queue
import subprocess
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional, Tuple

WIN_NO_WINDOW = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
REPO_ROOT = Path(__file__).resolve().parents[3]
FRONTEND_DIR = REPO_ROOT / "frontend"
BACKEND_DIR = REPO_ROOT / "backend"
DESKTOP_DIR = REPO_ROOT / "desktop"
LOG_DIR = BACKEND_DIR / "data" / "logs"
VENV_PYTHON = BACKEND_DIR / ".venv" / "Scripts" / "python.exe"
REQUIREMENTS_FILE = BACKEND_DIR / "requirements.txt"
BUILD_EXE_SCRIPT = DESKTOP_DIR / "build_exe.ps1"
DESKTOP_EXE = REPO_ROOT / "AutoStudyGuidance.exe"
DESKTOP_SOURCE = DESKTOP_DIR / "AutoStudyGuidanceApp.cs"
FRONTEND_DIST = FRONTEND_DIR / "dist"

# 哪些源码文件变化后必须补做额外步骤，否则「更新完成」是假的
_CHANGE_TRIGGERS: Dict[str, Tuple[str, ...]] = {
    "pip": ("backend/requirements.txt",),
    "npm": ("frontend/package.json", "frontend/package-lock.json"),
    "exe": ("desktop/AutoStudyGuidanceApp.cs", "desktop/app_logo.ico"),
}

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


# ---------------------------------------------------------------- 安装形态探测


def _repo_available() -> bool:
    if not (REPO_ROOT / ".git").exists():
        return False
    rc, _, _ = _git("rev-parse", "--abbrev-ref", "HEAD", timeout=10)
    return rc == 0


def _offline_reason() -> str:
    if not (REPO_ROOT / ".git").exists():
        return (
            f"当前目录 {REPO_ROOT} 不是 Git 仓库（可能是下载的离线副本），"
            "无法从远端拉取更新，请重新下载最新安装包。"
        )
    return "当前目录无法读取 Git 版本信息，请检查 .git 是否完整。"


def _desktop_running() -> bool:
    if sys.platform != "win32":
        return False
    try:
        proc = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq AutoStudyGuidance.exe", "/NH"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=10,
            creationflags=WIN_NO_WINDOW,
        )
        return "AutoStudyGuidance.exe" in (proc.stdout or "")
    except Exception:
        return False


def _exe_outdated() -> bool:
    if not DESKTOP_EXE.exists():
        return DESKTOP_SOURCE.exists()
    if not DESKTOP_SOURCE.exists():
        return False
    return DESKTOP_EXE.stat().st_mtime < DESKTOP_SOURCE.stat().st_mtime


def _frontend_dist_stale() -> bool:
    index = FRONTEND_DIST / "index.html"
    if not index.exists():
        return True
    newest_src = 0.0
    for sub in ("src",):
        for path in (FRONTEND_DIR / sub).rglob("*"):
            if path.is_file():
                newest_src = max(newest_src, path.stat().st_mtime)
    for name in ("index.html", "package.json", "vite.config.ts"):
        candidate = FRONTEND_DIR / name
        if candidate.is_file():
            newest_src = max(newest_src, candidate.stat().st_mtime)
    return bool(newest_src and index.stat().st_mtime < newest_src)


def _diff_names(base_ref: str, target_ref: str) -> List[str]:
    rc, out, _ = _git("diff", "--name-only", base_ref, target_ref, timeout=30)
    if rc != 0 or not out:
        return []
    return [line.strip() for line in out.splitlines() if line.strip()]


def _classify_changes(changed: List[str]) -> Dict[str, bool]:
    lowered = [c.replace("\\", "/") for c in changed]
    return {
        kind: any(path in lowered for path in triggers)
        for kind, triggers in _CHANGE_TRIGGERS.items()
    }


# ---------------------------------------------------------------- status


def get_update_status(fetch: bool = False) -> Dict[str, Any]:
    """Inspect local git HEAD vs origin/<branch>, optionally fetching from origin first."""
    global _last_checked_at
    fetch_error: Optional[str] = None
    repo_ok = _repo_available()

    if not repo_ok:
        return {
            "repo_available": False,
            "can_hot_update": False,
            "offline_reason": _offline_reason(),
            "install_root": str(REPO_ROOT),
            "branch": "",
            "remote_url": "",
            "local_commit": "",
            "local_message": "",
            "local_date": "",
            "remote_commit": "",
            "remote_message": "",
            "behind_count": 0,
            "ahead_count": 0,
            "has_update": False,
            "incoming_commits": [],
            "dirty_count": 0,
            "checked_at": _last_checked_at,
            "push_notice_at": _last_push_notice_at,
            "fetch_error": None,
            "artifacts_stale": _frontend_dist_stale() or _exe_outdated(),
        }

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

    pending_deps: List[str] = []
    if remote_hash:
        change_flags = _classify_changes(_diff_names("HEAD", remote_ref))
        pending_deps = [kind for kind, hit in change_flags.items() if hit]

    return {
        "repo_available": True,
        "can_hot_update": True,
        "offline_reason": "",
        "install_root": str(REPO_ROOT),
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
        "artifacts_stale": _frontend_dist_stale() or _exe_outdated(),
        "pending_deps": pending_deps,
    }


def record_push_webhook() -> Dict[str, Any]:
    """Record a webhook/push ping and immediately fetch origin so clients see incoming commits."""
    global _last_push_notice_at
    _last_push_notice_at = datetime.now(timezone.utc).isoformat()
    return get_update_status(fetch=True)


# ---------------------------------------------------------------- 补做步骤


def _install_python_deps() -> Tuple[bool, str]:
    python_exe = str(VENV_PYTHON if VENV_PYTHON.exists() else Path(sys.executable))
    rc, out, err = _run_cmd_silent(
        [python_exe, "-m", "pip", "install", "-r", str(REQUIREMENTS_FILE)],
        cwd=BACKEND_DIR,
        timeout=600,
    )
    detail = (out or err or "").strip().splitlines()
    tail = detail[-1] if detail else ""
    return rc == 0, f"{'完成' if rc == 0 else '失败'}: {tail[:160]}"


def _install_node_deps() -> Tuple[bool, str]:
    npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"
    rc, out, err = _run_cmd_silent([npm_cmd, "install"], cwd=FRONTEND_DIR, timeout=900)
    detail = (out or err or "").strip().splitlines()
    tail = detail[-1] if detail else ""
    return rc == 0, f"{'完成' if rc == 0 else '失败'}: {tail[:160]}"


def _build_frontend() -> Tuple[bool, str]:
    npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"
    rc, out, err = _run_cmd_silent([npm_cmd, "run", "build"], cwd=FRONTEND_DIR, timeout=600)
    if rc == 0:
        return True, "前端 bundle 已重建"
    detail = (err or out or "").strip().splitlines()
    tail = detail[-1] if detail else ""
    return False, f"构建失败: {tail[:200]}"


def _run_build_exe() -> Tuple[bool, str]:
    if not BUILD_EXE_SCRIPT.is_file():
        return False, f"未找到 {BUILD_EXE_SCRIPT.name}"
    powershell = "powershell.exe"
    rc, out, err = _run_cmd_silent(
        [
            powershell,
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(BUILD_EXE_SCRIPT),
        ],
        cwd=REPO_ROOT,
        timeout=600,
    )
    detail = (out or err or "").strip().splitlines()
    tail = detail[-1] if detail else ""
    if rc == 0 and DESKTOP_EXE.exists():
        return True, "桌面外壳已重建"
    return False, f"外壳重建失败: {tail[:200]}"


def _schedule_deferred_exe_rebuild() -> Tuple[bool, str]:
    """Desktop exe 被自身占用时无法覆盖：排一个等待进程退出的后台重建任务。"""
    if not BUILD_EXE_SCRIPT.is_file():
        return False, f"未找到 {BUILD_EXE_SCRIPT.name}"
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_file = LOG_DIR / "update_build.log"
    script = (
        f"$ErrorActionPreference='Stop';"
        f"try {{ Wait-Process -Name 'AutoStudyGuidance' -Timeout 3600 -ErrorAction SilentlyContinue }} catch {{}};"
        f"Start-Sleep -Seconds 2;"
        f"& '{BUILD_EXE_SCRIPT}' *>> '{log_file}';"
    )
    try:
        subprocess.Popen(
            ["powershell.exe", "-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-Command", script],
            cwd=str(REPO_ROOT),
            creationflags=WIN_NO_WINDOW,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return True, "外壳正在被占用：已排队，关闭程序窗口后会自动重建（日志在 data/logs/update_build.log）"
    except Exception as exc:
        return False, f"无法排队重建外壳: {exc}"


# ---------------------------------------------------------------- 主流程


async def pull_and_apply_update_stream(
    rebuild_frontend: bool = True,
    install_deps: bool = True,
    rebuild_desktop: bool = True,
) -> AsyncIterator[str]:
    """Fetch + pull, then补齐「让本地文件真正是最新的」所需的全部步骤。"""
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
        steps: List[Dict[str, Any]] = []

        def step(name: str, ok: bool, detail: str) -> None:
            steps.append({"name": name, "ok": ok, "detail": detail})

        try:
            # ---- 0. 安装形态：离线副本不能热更新，必须说清楚
            if not _repo_available():
                status_now = get_update_status(fetch=False)
                emit(
                    "complete",
                    100,
                    "无法热更新",
                    _offline_reason(),
                    "",
                    result={
                        "ok": False,
                        "updated": False,
                        "message": _offline_reason(),
                        "status": status_now,
                        "steps": [],
                    },
                )
                return

            _, branch, _ = _git("rev-parse", "--abbrev-ref", "HEAD")
            branch = branch or "main"

            emit("progress", 12, "拉取远端索引", f"正在从 origin/{branch} 检查最新 Push...", f"$ git fetch origin {branch}")
            rc, out, err = _git("fetch", "origin", branch, timeout=35)
            if out or err:
                emit("progress", 22, "远端索引完成", "远端索引已同步", out or err)
            if rc != 0:
                status_now = get_update_status(fetch=False)
                emit(
                    "complete",
                    100,
                    "连接失败",
                    f"拉取远端失败：{err or '请检查网络与 Git 凭据'}",
                    err,
                    result={"ok": False, "updated": False, "message": err or "git fetch 失败", "status": status_now, "steps": steps},
                )
                return

            status_pre = get_update_status(fetch=False)
            behind = int(status_pre.get("behind_count", 0) or 0)

            # ---- 1. 代码：有更新才 pull
            if behind > 0:
                changed = _diff_names("HEAD", f"origin/{branch}")
                flags = _classify_changes(changed)
                emit(
                    "progress",
                    34,
                    "应用最新 Push",
                    f"发现 {behind} 条新提交，正在合并更新...",
                    f"$ git pull --rebase --autostash origin {branch}",
                )
                rc_pull, out_pull, err_pull = _git(
                    "pull", "--rebase", "--autostash", "origin", branch, timeout=120
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
                        result={
                            "ok": False,
                            "updated": False,
                            "message": err_pull or out_pull or "git pull 失败",
                            "status": status_fail,
                            "steps": steps,
                        },
                    )
                    return
                step("拉取代码", True, f"已合并 {behind} 条提交")
                if log_pull:
                    emit("progress", 46, "代码已更新", "远端代码已合并至本地工作区", log_pull)
            else:
                flags = {"pip": False, "npm": False, "exe": False}
                emit(
                    "progress",
                    34,
                    "代码已是最新",
                    "本地提交与远端一致，继续检查依赖与构建产物是否齐全...",
                    "Already up to date.",
                )
                step("拉取代码", True, "本地已是远端最新提交")

            # ---- 2. 依赖：requirements / package-lock 变化时补装，否则新代码可能 import 失败
            pip_hit = flags["pip"] or (status_pre.get("pending_deps") and "pip" in status_pre["pending_deps"])
            npm_hit = flags["npm"] or (status_pre.get("pending_deps") and "npm" in status_pre["pending_deps"])

            if pip_hit:
                if install_deps:
                    emit("progress", 56, "安装后端依赖", "requirements.txt 有变化，正在安装 Python 依赖...", "$ pip install -r backend/requirements.txt")
                    ok, detail = _install_python_deps()
                    step("后端依赖", ok, detail)
                    emit("progress", 62, "后端依赖" + ("安装完成" if ok else "安装失败"), detail)
                    if not ok:
                        emit(
                            "complete",
                            100,
                            "依赖安装失败",
                            f"代码已更新，但后端依赖安装失败：{detail}",
                            "",
                            result={
                                "ok": False,
                                "updated": True,
                                "message": "代码已更新，但后端依赖安装失败，请手动执行 pip install -r backend/requirements.txt",
                                "status": get_update_status(fetch=False),
                                "steps": steps,
                            },
                        )
                        return
                else:
                    step("后端依赖", False, "本次跳过（requirements.txt 有变化，下次启动可能报模块缺失）")

            if npm_hit:
                if install_deps:
                    emit("progress", 66, "安装前端依赖", "package.json/lock 有变化，正在安装 Node 依赖...", "$ npm install")
                    ok, detail = _install_node_deps()
                    step("前端依赖", ok, detail)
                    emit("progress", 70, "前端依赖" + ("安装完成" if ok else "安装失败"), detail)
                    if not ok:
                        emit(
                            "complete",
                            100,
                            "依赖安装失败",
                            f"代码已更新，但前端依赖安装失败：{detail}",
                            "",
                            result={
                                "ok": False,
                                "updated": True,
                                "message": "代码已更新，但前端依赖安装失败，请手动执行 npm install",
                                "status": get_update_status(fetch=False),
                                "steps": steps,
                            },
                        )
                        return
                else:
                    step("前端依赖", False, "本次跳过（package-lock.json 有变化，前端可能构建失败）")

            # ---- 3. 前端产物：dist 不在版本库内，必须重建
            dist_stale = _frontend_dist_stale()
            if rebuild_frontend and (FRONTEND_DIR / "package.json").exists() and (behind > 0 or dist_stale):
                emit(
                    "progress",
                    76,
                    "重建前端静态产物",
                    "正在静默编译最新前端资源，使 8000 端口与桌面端立即生效...",
                    "$ npm run build",
                )
                ok, detail = _build_frontend()
                step("前端构建", ok, detail)
                emit("progress", 84, "前端构建" + ("完成" if ok else "失败"), detail)
                if not ok:
                    emit(
                        "complete",
                        100,
                        "前端构建失败",
                        f"代码已更新，但前端构建失败：{detail}",
                        "",
                        result={
                            "ok": False,
                            "updated": True,
                            "message": "代码已更新，但前端构建失败，请手动执行 npm run build",
                            "status": get_update_status(fetch=False),
                            "steps": steps,
                        },
                    )
                    return
            elif rebuild_frontend:
                step("前端构建", True, "产物已是最新，跳过重建")

            # ---- 4. 桌面外壳：exe 不在版本库内，也要重建，否则窗口还是旧标题/旧壳
            exe_state = "skipped"
            if rebuild_desktop:
                exe_changed = flags["exe"] or (status_pre.get("pending_deps") and "exe" in status_pre["pending_deps"])
                if exe_changed or _exe_outdated() or behind > 0:
                    emit("progress", 90, "重建桌面外壳", "正在重新编译 AutoStudyGuidance.exe...", "$ build_exe.ps1")
                    if _desktop_running():
                        ok, detail = _schedule_deferred_exe_rebuild()
                        exe_state = "deferred" if ok else "failed"
                        step("桌面外壳", ok, detail)
                        emit("progress", 95, "外壳待重建" if ok else "外壳重建失败", detail)
                    else:
                        ok, detail = _run_build_exe()
                        exe_state = "done" if ok else "failed"
                        step("桌面外壳", ok, detail)
                        emit("progress", 95, "外壳重建" + ("完成" if ok else "失败"), detail)
                else:
                    step("桌面外壳", True, "已是最新，跳过重建")
            else:
                step("桌面外壳", False, "本次跳过")

            # ---- 5. 收尾
            final_status = get_update_status(fetch=False)
            failed_steps = [s for s in steps if not s["ok"]]
            degraded = bool(failed_steps)
            if not degraded:
                headline = "✓ 已完整更新到最新版本"
            elif failed_steps and all(s["name"] == "桌面外壳" and exe_state == "deferred" for s in failed_steps):
                headline = "✓ 代码与产物已更新，外壳待关闭程序后自动重建"
            else:
                headline = "⚠ 更新已完成，但有步骤需要处理"

            needs_restart = behind > 0 or bool(pip_hit)
            tail_note = " 请刷新页面；桌面版需重启程序加载新后端。" if needs_restart else " 刷新页面即可。"

            emit(
                "complete",
                100,
                headline,
                f"已同步到 {final_status.get('local_commit') or '-'}（{final_status.get('local_message') or ''}）。{tail_note}",
                "Update applied.",
                result={
                    "ok": not degraded,
                    "updated": behind > 0,
                    "message": f"{headline}。{tail_note.strip()}",
                    "status": final_status,
                    "steps": steps,
                    "needs_restart": needs_restart,
                    "exe_rebuild": exe_state,
                },
            )
        except Exception as exc:
            emit(
                "complete",
                100,
                "更新异常",
                f"更新异常：{exc}",
                str(exc),
                result={"ok": False, "updated": False, "message": str(exc), "steps": steps},
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
