from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Tuple

from app.schemas import RouterSettings

BASE_DIR = Path(r"D:\auto_study_guidance\backend")
DATA_DIR = BASE_DIR / "data"
PROJECTS_DIR = DATA_DIR / "projects"
SETTINGS_FILE = DATA_DIR / "settings.json"

DATA_DIR.mkdir(parents=True, exist_ok=True)
PROJECTS_DIR.mkdir(parents=True, exist_ok=True)

_PROJECT_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")


def mask_secret(secret: str) -> str:
    val = (secret or "").strip()
    if not val:
        return ""
    if len(val) <= 8:
        return "*" * len(val)
    return f"{val[:4]}****{val[-4:]}"


def is_masked_secret(candidate: str, original: str) -> bool:
    cand = (candidate or "").strip()
    if not cand:
        return False
    if "****" in cand or set(cand) == {"*"}:
        return True
    return bool(original and cand == mask_secret(original))


def redact_settings(settings: RouterSettings) -> RouterSettings:
    """Return a copy of RouterSettings with API keys masked for safe HTTP responses."""
    return settings.model_copy(
        update={
            "cloud_config": settings.cloud_config.model_copy(
                update={"api_key": mask_secret(settings.cloud_config.api_key)}
            ),
            "ocr_config": settings.ocr_config.model_copy(
                update={"somark_api_key": mask_secret(settings.ocr_config.somark_api_key)}
            ),
        }
    )


def _read_raw_existing_keys() -> Tuple[str, str]:
    if SETTINGS_FILE.exists():
        try:
            raw = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
            ck = str(raw.get("cloud_config", {}).get("api_key", "") or "")
            ok = str(raw.get("ocr_config", {}).get("somark_api_key", "") or "")
            return ck, ok
        except Exception:
            pass
    return "", ""


def load_settings() -> RouterSettings:
    settings: RouterSettings
    if SETTINGS_FILE.exists():
        try:
            raw = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
            settings = RouterSettings.model_validate(raw)
        except Exception:
            settings = RouterSettings()
            save_settings(settings)
    else:
        settings = RouterSettings()
        save_settings(settings)

    env_cloud_key = (
        os.environ.get("DEEPSEEK_API_KEY", "").strip()
        or os.environ.get("OPENAI_API_KEY", "").strip()
    )
    env_somark_key = os.environ.get("SOMARK_API_KEY", "").strip()

    if not settings.cloud_config.api_key and env_cloud_key:
        settings = settings.model_copy(
            update={"cloud_config": settings.cloud_config.model_copy(update={"api_key": env_cloud_key})}
        )
    if not settings.ocr_config.somark_api_key and env_somark_key:
        settings = settings.model_copy(
            update={"ocr_config": settings.ocr_config.model_copy(update={"somark_api_key": env_somark_key})}
        )
    return settings


def save_settings(settings: RouterSettings) -> RouterSettings:
    existing_ck, existing_ok = _read_raw_existing_keys()
    new_ck = settings.cloud_config.api_key
    if is_masked_secret(new_ck, existing_ck):
        new_ck = existing_ck
    new_ok = settings.ocr_config.somark_api_key
    if is_masked_secret(new_ok, existing_ok):
        new_ok = existing_ok

    to_persist = settings.model_copy(
        update={
            "cloud_config": settings.cloud_config.model_copy(update={"api_key": new_ck}),
            "ocr_config": settings.ocr_config.model_copy(update={"somark_api_key": new_ok}),
        }
    )
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(
        to_persist.model_dump_json(indent=2),
        encoding="utf-8",
    )
    return to_persist


def resolve_safe_project_dir(project_id: str) -> Path:
    pid = (project_id or "").strip()
    if not _PROJECT_ID_RE.fullmatch(pid) or ".." in pid:
        raise ValueError(f"非法项目 ID: {project_id}")
    base = PROJECTS_DIR.resolve()
    target = (base / pid).resolve()
    if target.parent != base:
        raise ValueError(f"非法项目路径: {project_id}")
    return target


def get_project_dir(project_id: str) -> Path:
    pdir = resolve_safe_project_dir(project_id)
    pdir.mkdir(parents=True, exist_ok=True)
    (pdir / "assets").mkdir(parents=True, exist_ok=True)
    return pdir
