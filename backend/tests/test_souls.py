"""v1.2.x 契约测试：soul 只从 md 文件读取，且 prompt 不再重复下发。

这两条是「soul.md 到底有没有准确发给 agent」的回归护栏：
* 若有人把 prompt 文本又硬编码回 Python，`test_soul_prompts_come_from_markdown_files` 会红；
* 若有人把 system 段重新塞回 user 消息（造成双份下发），`test_dsh_prompt_splits_system_and_task` 会红。
"""

from __future__ import annotations

import shutil
import uuid

from fastapi.testclient import TestClient

from app.main import app


def test_soul_prompts_come_from_markdown_files():
    from app.workflows.souls import (
        DELIVERABLE_SOUL_PATHS,
        DELIVERABLE_TASK_SOULS,
        MODE_SYSTEM_SOULS,
        build_courseware_deliverable_soul,
        reload_souls,
    )

    reload_souls()
    assert len(MODE_SYSTEM_SOULS) == 3
    assert len(DELIVERABLE_SOUL_PATHS) >= 14, "三个场景的交付物任务书都应是 md 文件"

    for (scenario, deliverable_id), path in DELIVERABLE_SOUL_PATHS.items():
        assert path.suffix == ".md", f"{scenario}/{deliverable_id} 应来自 md 文件"
        on_disk = path.read_text(encoding="utf-8").strip()
        assert on_disk == DELIVERABLE_TASK_SOULS[(scenario, deliverable_id)], (
            f"{path.name} 的文件内容与注册表不一致（说明有人把 prompt 又改回了 Python 字符串）"
        )

    assembled = build_courseware_deliverable_soul("A_beginner", "detailed_study_guide")
    # 拼装顺序：Mode 人设 -> 全局协议 -> 交付物任务书
    assert assembled.index("Mode A") < assembled.index("全局解析与打印")
    assert assembled.index("全局解析与打印") < assembled.index("Task (A1)")
    # 分页标记受渲染器支持（导出器统一成 token 后真正分页）；answer-box 没有渲染支持，只能作为禁止项出现
    assert '<div class="page-break"></div>' in assembled
    assert "禁止输出任何其它 HTML 标签" in assembled
    assert "或在文末统一附上参考答案" not in assembled
    assert 'answer-box" style="height' not in assembled


def test_dsh_prompt_splits_system_and_task():
    from app.router.harness_provider import (
        _EXECUTION_CONTRACT,
        _build_cli_prompt,
        _compose_system_text,
        _materialize_system_soul,
    )

    system_prompt = "SOUL-BODY-MARKER"
    user_prompt = "TASK-BODY-MARKER"

    # dsh 通道：system 段落落到 soul 文件（dsh_cli 以 role=system 下发）
    composed = _compose_system_text(system_prompt, None)
    soul_path = _materialize_system_soul(f"{_EXECUTION_CONTRACT}\n\n{composed}")
    assert soul_path is not None and soul_path.is_file()
    system_text = soul_path.read_text(encoding="utf-8")
    assert "SOUL-BODY-MARKER" in system_text
    assert "[Execution Mode & Output Contract]" in system_text

    # 用户消息里只剩任务，不能重复带 system 段
    user_msg = _build_cli_prompt(user_prompt=user_prompt, include_system=False, include_contract=False)
    assert "SOUL-BODY-MARKER" not in user_msg
    assert "[System Instructions]" not in user_msg
    assert user_msg.strip() == "[Task]\nTASK-BODY-MARKER"

    # 没有 system 通道的 CLI（claude / codex / gemini / 自定义命令）仍然内联，确保不丢 soul
    inline = _build_cli_prompt(system_prompt, user_prompt)
    assert "[System Instructions]\nSOUL-BODY-MARKER" in inline
    assert "TASK-BODY-MARKER" in inline


def test_rename_workspace_endpoint():
    from app.config import PROJECTS_DIR
    from app.schemas import DocumentIR

    client = TestClient(app)
    project_id = f"proj_test_{uuid.uuid4().hex[:6]}"
    project_dir = PROJECTS_DIR / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    ir = DocumentIR(
        project_id=project_id,
        filename="第02章_电位分析法和永停滴定法.pdf",
        file_type="pdf",
        total_pages_or_slides=3,
    )
    (project_dir / "document_ir.json").write_text(ir.model_dump_json(indent=2), encoding="utf-8")

    try:
        renamed = client.post(f"/api/projects/{project_id}/rename", json={"title": "  电位分析 · 第一章  "})
        assert renamed.status_code == 200
        assert renamed.json()["workspace_title"] == "电位分析 · 第一章"

        listed = {p["project_id"]: p for p in client.get("/api/projects").json()}
        assert listed[project_id]["workspace_title"] == "电位分析 · 第一章"

        # 显式清空 -> 回退到原始文件名
        cleared = client.post(f"/api/projects/{project_id}/rename", json={"title": "   "})
        assert cleared.json()["workspace_title"] == ""
        assert cleared.json()["display_name"] == "第02章_电位分析法和永停滴定法.pdf"

        too_long = client.post(f"/api/projects/{project_id}/rename", json={"title": "长" * 61})
        assert too_long.status_code == 400
    finally:
        shutil.rmtree(project_dir, ignore_errors=True)
