# -*- coding: utf-8 -*-
"""Timeout semantics: a stall gate must never cut off a long but productive run.

pytest-asyncio is not part of this environment, so the async cases are driven with
asyncio.run inside plain sync tests.
"""
from __future__ import annotations

import asyncio
import json
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.router.harness_provider import _run_cli_attempt, _timeout_verdict  # noqa: E402


def _run(**kwargs):
    return asyncio.run(_run_cli_attempt(**kwargs))


def _script(tmp_path: Path, body: str) -> list[str]:
    path = tmp_path / "fake_cli.py"
    path.write_text(body, encoding="utf-8")
    return [sys.executable, "-X", "utf8", str(path)]


# --------------------------------------------------------------------------- verdict
def test_idle_window_extends_while_output_keeps_coming() -> None:
    # 跑了 100 秒，但 4 秒前还有新字 -> 不超时
    assert _timeout_verdict(100.0, 0.0, 96.0, 180.0, 1800.0) is None
    # 持续出字跑了 5 分钟 -> 也不该被 180s 掐断
    assert _timeout_verdict(300.0, 0.0, 299.0, 180.0, 1800.0) is None


def test_stall_is_reported_as_idle_timeout() -> None:
    assert _timeout_verdict(200.0, 0.0, 10.0, 180.0, 1800.0) == "idle"


def test_hard_cap_still_stops_a_never_ending_run() -> None:
    assert _timeout_verdict(1801.0, 0.0, 1800.0, 180.0, 1800.0) == "total"


# --------------------------------------------------------------------------- real child
def test_long_but_streaming_child_is_not_killed(tmp_path: Path) -> None:
    """A child that keeps printing for longer than `timeout_seconds` must still succeed."""
    cmd = _script(
        tmp_path,
        "import time\n"
        "for i in range(12):\n"
        "    print(f'chunk-{i}', flush=True)\n"
        "    time.sleep(0.25)\n"
        "print('DONE', flush=True)\n",
    )
    started = time.monotonic()
    out = _run(
        cmd=cmd,
        cli_label="fake",
        stdin_payload=None,
        env={},
        timeout_seconds=1,  # 停滞窗口 1s，远短于整个任务时长
        expect_stream_json=False,
        cancel_token=None,
        status_cb=None,
        max_total_seconds=120,
    )
    elapsed = time.monotonic() - started
    assert "DONE" in out
    assert "chunk-11" in out
    assert elapsed > 1.5, "任务确实跑得比停滞窗口久，说明它不是按总时长被掐断的"


def test_silent_child_is_killed_as_stalled(tmp_path: Path) -> None:
    cmd = _script(
        tmp_path,
        "import time\n"
        "print('start', flush=True)\n"
        "time.sleep(30)\n"
        "print('never', flush=True)\n",
    )
    with pytest.raises(TimeoutError) as exc:
        _run(
            cmd=cmd,
            cli_label="fake",
            stdin_payload=None,
            env={},
            timeout_seconds=2,
            expect_stream_json=False,
            cancel_token=None,
            status_cb=None,
            max_total_seconds=60,
        )
    assert "没有任何输出" in str(exc.value)


def test_stream_json_deltas_also_reset_the_stall_clock(tmp_path: Path) -> None:
    """Streaming JSON (the dsh/claude path) must count as activity too."""
    lines = [
        json.dumps(
            {"type": "assistant", "message": {"content": [{"type": "text", "text": "段"}]}},
            ensure_ascii=False,
        )
        for _ in range(6)
    ]
    cmd = _script(
        tmp_path,
        "import time, json\n"
        f"lines = {lines!r}\n"
        "for line in lines:\n"
        "    print(line, flush=True)\n"
        "    time.sleep(0.3)\n"
        "print(json.dumps({'type': 'result', 'result': 'FINAL-OK'}), flush=True)\n",
    )
    out = _run(
        cmd=cmd,
        cli_label="fake",
        stdin_payload=None,
        env={},
        timeout_seconds=1,
        expect_stream_json=True,
        cancel_token=None,
        status_cb=None,
        max_total_seconds=120,
    )
    assert out == "FINAL-OK"
