"""热更新契约测试：离线副本必须明确报错，依赖/产物变化必须触发补做步骤。"""

from __future__ import annotations

import asyncio
import json

import pytest


def test_repo_status_reports_hot_update_capability():
    from app.workflows import updater

    status = updater.get_update_status(fetch=False)
    assert status["repo_available"] is True
    assert status["can_hot_update"] is True
    assert status["offline_reason"] == ""
    assert isinstance(status["artifacts_stale"], bool)
    assert isinstance(status["pending_deps"], list)
    assert status["install_root"]


def test_offline_copy_is_reported_honestly(tmp_path, monkeypatch):
    from app.workflows import updater

    monkeypatch.setattr(updater, "REPO_ROOT", tmp_path)
    status = updater.get_update_status(fetch=False)

    assert status["repo_available"] is False
    assert status["can_hot_update"] is False
    # 关键：不能再谎报"已是最新版本"，必须给出可执行的原因
    assert "不是 Git 仓库" in status["offline_reason"]
    assert status["has_update"] is False
    assert status["behind_count"] == 0


def test_change_classification_triggers_extra_steps():
    from app.workflows import updater

    flags = updater._classify_changes(
        [
            "backend/requirements.txt",
            "frontend/package-lock.json",
            "desktop/AutoStudyGuidanceApp.cs",
        ]
    )
    assert flags == {"pip": True, "npm": True, "exe": True}

    # 纯代码改动不应触发依赖安装
    assert updater._classify_changes(["backend/app/main.py", "frontend/src/App.tsx"]) == {
        "pip": False,
        "npm": False,
        "exe": False,
    }


def test_pull_update_stream_refuses_offline_copy(tmp_path, monkeypatch):
    from app.workflows import updater

    monkeypatch.setattr(updater, "REPO_ROOT", tmp_path)

    async def _collect() -> list[str]:
        events: list[str] = []
        async for chunk in updater.pull_and_apply_update_stream():
            events.append(chunk)
        return events

    events = asyncio.run(_collect())
    assert events, "离线副本也必须返回一条明确的失败事件"
    last = json.loads(events[-1].replace("data:", "", 1).strip())
    assert last["type"] == "complete"
    assert last["stage"] == "无法热更新"
    assert last["result"]["ok"] is False
    assert "不是 Git 仓库" in last["result"]["message"]


def test_deferred_exe_rebuild_requires_build_script(tmp_path, monkeypatch):
    from app.workflows import updater

    monkeypatch.setattr(updater, "BUILD_EXE_SCRIPT", tmp_path / "missing.ps1")
    ok, detail = updater._schedule_deferred_exe_rebuild()
    assert ok is False
    assert "未找到" in detail
