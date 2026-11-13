from __future__ import annotations

import json
from pathlib import Path
from app.schemas import RouterSettings

BASE_DIR = Path(r"D:\auto_study_guidance\backend")
DATA_DIR = BASE_DIR / "data"
PROJECTS_DIR = DATA_DIR / "projects"
SETTINGS_FILE = DATA_DIR / "settings.json"

DATA_DIR.mkdir(parents=True, exist_ok=True)
PROJECTS_DIR.mkdir(parents=True, exist_ok=True)


def load_settings() -> RouterSettings:
    if SETTINGS_FILE.exists():
        try:
            raw = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
            return RouterSettings.model_validate(raw)
        except Exception:
            pass
    settings = RouterSettings()
    save_settings(settings)
    return settings


def save_settings(settings: RouterSettings) -> RouterSettings:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(
        settings.model_dump_json(indent=2),
        encoding="utf-8",
    )
    return settings


def get_project_dir(project_id: str) -> Path:
    pdir = PROJECTS_DIR / project_id
    pdir.mkdir(parents=True, exist_ok=True)
    (pdir / "assets").mkdir(parents=True, exist_ok=True)
    return pdir
