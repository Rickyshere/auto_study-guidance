"""Agent 5 · 伴读微导师：把划词/点图的焦点变成一张 60~140 字的页边批注卡。

设计原则：
- 走现有的 ModelRouter，因此自动继承 harness / cloud / 离线的路由与重试；
- 模型不可用时给一张确定性的兜底卡，前端永远有东西可显示，不会空白或报错。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional

from app.router import ModelRouter
from app.schemas import MicroTutorRequest, MicroTutorResponse

SOUL_FILENAME = "soul_micro_tutor.md"
SOUL_PATH = Path(__file__).resolve().parent / "handout_agents" / SOUL_FILENAME

_MODE_LABELS = {
    "A_beginner": "A · 零基础入门",
    "B_consolidate": "B · 巩固提高",
    "C_sprint": "C · 考前抱佛脚",
}

_ACTION_LABELS = {
    "EXPLAIN_SIMPLE": "讲懂它",
    "GIVE_ANALOGY": "举个栗子",
    "TRAP_ALERT": "怎么挖坑",
    "MICRO_QUIZ": "考我一下",
    "EXPLAIN_SVG_NODE": "看图说话",
}


def _render(template: str, variables: Dict[str, str]) -> str:
    out = template
    for key, val in variables.items():
        out = out.replace(f"{{{{{key}}}}}", val)
    return out


def _offline_card(req: MicroTutorRequest) -> MicroTutorResponse:
    """模型不可用时的确定性兜底：直接引用焦点原文，给一句可执行的阅读提示。"""
    focus = (req.selected_focus or "").strip()[:60] or "这段内容"
    action = _ACTION_LABELS.get(req.action_type, "讲懂它")
    mode = _MODE_LABELS.get(req.study_mode, req.study_mode)
    body = (
        f"**{action}**：`{focus}` 是当前这段的关键抓手。"
        f"先用自己的话复述一遍因果链（A → B → C），再回头看它在{mode}里承担的作用。"
        "AI 引擎此刻不可用，这条是本地兜底提示。"
    )
    quiz: Optional[Dict[str, Any]] = None
    if req.action_type == "MICRO_QUIZ":
        quiz = {
            "question": f"关于「{focus}」，下列说法正确的是？",
            "options": {"A": "按原文表述判断", "B": "与原文相反"},
            "answer": "A",
            "one_line_reason": "回到原文核对关键词即可。",
        }
    return MicroTutorResponse(
        card_title=f"{action} · {focus[:8]}",
        content_markdown=body,
        micro_quiz=quiz,
        fallback=True,
        model_label="offline",
    )


async def generate_micro_tutor_card(req: MicroTutorRequest, router: ModelRouter) -> MicroTutorResponse:
    if not (req.selected_focus or "").strip():
        return MicroTutorResponse(
            card_title="",
            content_markdown="",
            fallback=True,
            model_label="empty-selection",
        )

    try:
        template = SOUL_PATH.read_text(encoding="utf-8")
    except Exception:
        return _offline_card(req)

    system_prompt = _render(
        template,
        {
            "study_mode": _MODE_LABELS.get(req.study_mode, req.study_mode),
            "action_type": req.action_type,
            "selected_focus": req.selected_focus.strip()[:400],
            "surrounding_context": (req.surrounding_context or "").strip()[:1200],
            "document_title": req.document_title or "当前讲义",
        },
    )
    user_prompt = (
        "请为上面划选的焦点生成一张页边批注卡，严格按任务书输出单个 JSON 对象：\n"
        f"- 触发动作：{req.action_type}\n"
        f"- 学习模式：{_MODE_LABELS.get(req.study_mode, req.study_mode)}\n"
        f"- 焦点：{req.selected_focus.strip()[:400]}"
    )

    try:
        payload, label = await router.execute_json(
            "requirement_negotiation", system_prompt, user_prompt, soul_file_path=SOUL_PATH
        )
    except Exception:
        return _offline_card(req)

    if not isinstance(payload, dict):
        return _offline_card(req)

    content = str(payload.get("content_markdown") or payload.get("content") or "").strip()
    title = str(payload.get("card_title") or "").strip()
    if not content:
        return _offline_card(req)

    quiz = payload.get("micro_quiz")
    if not isinstance(quiz, dict) or not str(quiz.get("question") or "").strip():
        quiz = None
    return MicroTutorResponse(
        card_title=title[:24] or "页边批注",
        content_markdown=content,
        micro_quiz=quiz,
        fallback=False,
        model_label=label,
    )