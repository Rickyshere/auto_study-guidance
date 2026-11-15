from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Tuple

from app.schemas import RouterSettings

# 以本文件位置反推 backend 目录，绝不能写死盘符路径：
# 写死会在换机器/换安装位置时凭空创建一个 D:\auto_study_guidance 目录，
# 用户的工程数据就跑到项目文件夹外面去了。
BASE_DIR = Path(__file__).resolve().parents[1]
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


def _read_dsh_magpie_env() -> Tuple[str, str]:
    """Read MAGPIE_GATEWAY_KEY / MAGPIE_BASE_URL from ~/.dsh/.env if present."""
    env_file = Path.home() / ".dsh" / ".env"
    key = ""
    url = ""
    if env_file.exists():
        try:
            for line in env_file.read_text(encoding="utf-8", errors="ignore").splitlines():
                stripped = line.strip()
                if not stripped or stripped.startswith("#") or "=" not in stripped:
                    continue
                k, v = stripped.split("=", 1)
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k == "MAGPIE_GATEWAY_KEY" and v:
                    key = v
                elif k in ("MAGPIE_BASE_URL", "MAGPIE_GATEWAY_URL") and v:
                    url = v
        except Exception:
            pass
    return key, url


def _migrate_raw_settings(raw: dict) -> tuple[dict, bool]:
    changed = False
    data = dict(raw)
    if data.get("active_provider") in ("heuristic", "local", None, ""):
        data["active_provider"] = "harness"
        changed = True
    if "local_config" in data:
        data.pop("local_config", None)
        changed = True
    if data.get("ui_visual_mode") not in ("academic_pure", "liquid_glass"):
        data["ui_visual_mode"] = "academic_pure"
        changed = True
    free_auth = data.get("free_ai_auth")
    proxy_mode = free_auth.get("preferred_proxy_mode", "magpie_dsh") if isinstance(free_auth, dict) else "magpie_dsh"
    harness_cfg = data.get("harness_config")
    if proxy_mode == "magpie_dsh" and (
        not isinstance(harness_cfg, dict) or harness_cfg.get("preferred_cli") != "dsh"
    ):
        data.setdefault("harness_config", {})["preferred_cli"] = "dsh"
        changed = True
    stage_map = data.get("stage_mapping")
    if isinstance(stage_map, dict):
        for stage_key, sel in list(stage_map.items()):
            if isinstance(sel, dict) and sel.get("provider") in ("heuristic", "local", None, ""):
                sel["provider"] = "harness"
                changed = True
    return data, changed


def load_settings() -> RouterSettings:
    settings: RouterSettings
    migrated = False
    if SETTINGS_FILE.exists():
        try:
            raw = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                raw, migrated = _migrate_raw_settings(raw)
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

    magpie_key, magpie_url = _read_dsh_magpie_env()
    free_ai_updates = {}
    if magpie_key and (not settings.free_ai_auth.magpie_gateway_key or settings.free_ai_auth.magpie_gateway_key == "magpie"):
        free_ai_updates["magpie_gateway_key"] = magpie_key
    if magpie_url and not settings.free_ai_auth.magpie_gateway_url:
        free_ai_updates["magpie_gateway_url"] = magpie_url
    if free_ai_updates:
        settings = settings.model_copy(
            update={"free_ai_auth": settings.free_ai_auth.model_copy(update=free_ai_updates)}
        )

    if migrated:
        save_settings(settings)
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
