"""Soul registry —— 所有生成资料用的 prompt 文本都从 `souls/courseware/*.md` 读取。

设计约定（详见 `souls/README.md`）：

* `souls/courseware/mode_{a,b,c}.md`        三套模式人设
* `souls/courseware/protocols.md`           全局清洗 + 打印/导出协议（三场景共用）
* `souls/courseware/deliverables/<scenario>/<deliverable_id>.md`
                                            每个交付物的任务模板，文件名即 deliverable_id
* `souls/sayalive_writing_soul.md`          通用写作声音规范，拼到每份 prompt 末尾

改 prompt = 改这些 md 文件，不需要动 Python。历史版本把同样内容硬编码在本文件里，
导致「设计稿说的」和「线上发的」长期漂移，这里刻意不再保留任何内联 prompt 文本。
"""

from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Tuple

from app.schemas import ScenarioType

SOULS_DIR = Path(__file__).resolve().parent
COURSEWARE_DIR = SOULS_DIR / "courseware"
DELIVERABLES_DIR = COURSEWARE_DIR / "deliverables"

# 通用写作声音规范（Say Alive, MIT）——每个生成资料的子 Agent 都会挂载这一段。
WRITING_STYLE_SOUL_FILE = SOULS_DIR / "sayalive_writing_soul.md"

_MODE_FILE_BY_SCENARIO: Dict[ScenarioType, str] = {
    "A_beginner": "mode_a.md",
    "B_consolidate": "mode_b.md",
    "C_sprint": "mode_c.md",
}


def _read_soul_file(path: Path, *, required: bool = False) -> str:
    if path.is_file():
        return path.read_text(encoding="utf-8").strip()
    if required:
        raise RuntimeError(
            f"缺少 soul 文件: {path} —— souls/courseware 下的 .md 就是运行时下发的 prompt，不允许缺失。"
        )
    return ""


def get_writing_style_soul() -> str:
    """The shared 'write like a person, not a chatbot' block appended to every task soul."""
    return _read_soul_file(WRITING_STYLE_SOUL_FILE)


def with_writing_style(soul_text: str) -> str:
    """Append the shared writing-style block to any soul/system prompt."""
    style = get_writing_style_soul()
    if not style or style in (soul_text or ""):
        return (soul_text or "").strip()
    return f"{(soul_text or '').strip()}\n\n---\n\n{style}"


# ==============================================================================
# 0. Global Protocols (Courseware PDF/PPTX Ingestion + Print/Export Spec)
# ==============================================================================

def _load_protocols() -> str:
    return _read_soul_file(COURSEWARE_DIR / "protocols.md", required=True)


# ==============================================================================
# 1. Mode System Souls (Mode A / Mode B / Mode C)
# ==============================================================================

def _load_modes() -> Dict[ScenarioType, str]:
    modes: Dict[ScenarioType, str] = {}
    for scenario, filename in _MODE_FILE_BY_SCENARIO.items():
        modes[scenario] = _read_soul_file(COURSEWARE_DIR / filename, required=True)
    return modes


# ==============================================================================
# 2. Deliverable Task Souls (A1..A5, B1..B4, C1..C3) —— 目录扫描，文件名即 deliverable_id
# ==============================================================================

def _load_deliverable_paths() -> Dict[Tuple[ScenarioType, str], Path]:
    paths: Dict[Tuple[ScenarioType, str], Path] = {}
    for scenario in _MODE_FILE_BY_SCENARIO:
        scene_dir = DELIVERABLES_DIR / scenario
        if not scene_dir.is_dir():
            continue
        for md_path in sorted(scene_dir.glob("*.md")):
            paths[(scenario, md_path.stem)] = md_path
    return paths


DELIVERABLE_SOUL_PATHS: Dict[Tuple[ScenarioType, str], Path] = _load_deliverable_paths()

MODE_SYSTEM_SOULS: Dict[ScenarioType, str] = _load_modes()
GLOBAL_COURSEWARE_PROTOCOLS: str = _load_protocols()
DELIVERABLE_TASK_SOULS: Dict[Tuple[ScenarioType, str], str] = {
    key: md_path.read_text(encoding="utf-8").strip()
    for key, md_path in DELIVERABLE_SOUL_PATHS.items()
}


def reload_souls() -> None:
    """Re-read every soul md from disk (dev / tests: edit md without restarting the backend)."""
    global MODE_SYSTEM_SOULS, GLOBAL_COURSEWARE_PROTOCOLS, DELIVERABLE_TASK_SOULS, DELIVERABLE_SOUL_PATHS
    DELIVERABLE_SOUL_PATHS = _load_deliverable_paths()
    MODE_SYSTEM_SOULS = _load_modes()
    GLOBAL_COURSEWARE_PROTOCOLS = _load_protocols()
    DELIVERABLE_TASK_SOULS = {
        key: md_path.read_text(encoding="utf-8").strip()
        for key, md_path in DELIVERABLE_SOUL_PATHS.items()
    }


def get_courseware_soul_label(scenario_type: ScenarioType) -> str:
    if scenario_type == "A_beginner":
        return "Mode A · 零基础入门导师 (The Patient Tutor · mode_a.md)"
    if scenario_type == "B_consolidate":
        return "Mode B · 进阶提分教练 (The Strict Coach · mode_b.md)"
    return "Mode C · 考前急救与押题专家 (The Exam Hacker · mode_c.md)"


def get_deliverable_soul_filename(scenario_type: ScenarioType, deliverable_id: str) -> str:
    """The .md file actually backing this deliverable (shown in progress messages for traceability)."""
    path = DELIVERABLE_SOUL_PATHS.get((scenario_type, deliverable_id))
    if path is None:
        for (_, did), cand in DELIVERABLE_SOUL_PATHS.items():
            if did == deliverable_id:
                path = cand
                break
    return path.name if path is not None else "（未定义）"


def build_courseware_deliverable_soul(scenario_type: ScenarioType, deliverable_id: str) -> str:
    """Assemble Mode Soul + Global Protocols + Writing Style + Deliverable Task Soul."""
    mode_soul = MODE_SYSTEM_SOULS.get(scenario_type, MODE_SYSTEM_SOULS["A_beginner"])
    task_soul = DELIVERABLE_TASK_SOULS.get((scenario_type, deliverable_id))
    if not task_soul:
        # Graceful fallback across scenarios by deliverable_id
        for (_, did), prompt_text in DELIVERABLE_TASK_SOULS.items():
            if did == deliverable_id:
                task_soul = prompt_text
                break
    parts: List[str] = [mode_soul.strip(), GLOBAL_COURSEWARE_PROTOCOLS.strip()]
    style_soul = get_writing_style_soul()
    if style_soul:
        parts.append(style_soul)
    if task_soul:
        parts.append(task_soul.strip())
    return "\n\n---\n\n".join(parts)
