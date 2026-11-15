"""交互讲义批注持久化：一个项目一个 annotations.json。

锚点用「块级 id + 字符偏移 + 原文引用」三重定位（照 spec 的 Annotation_Schema），
这样即使讲义重新生成、段落顺序变了，也能靠 exact_quote 兜底重定位。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import List, Optional

from app.config import get_project_dir
from app.schemas import HandoutAnnotation

FILENAME = "annotations.json"


def _path(project_id: str) -> Path:
    return get_project_dir(project_id) / FILENAME


def load_annotations(project_id: str) -> List[HandoutAnnotation]:
    path = _path(project_id)
    if not path.exists():
        return []
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    items: List[HandoutAnnotation] = []
    for row in raw if isinstance(raw, list) else []:
        try:
            items.append(HandoutAnnotation.model_validate(row))
        except Exception:
            continue
    return items


def _save(project_id: str, items: List[HandoutAnnotation]) -> None:
    path = _path(project_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = [item.model_dump() for item in items]
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def upsert_annotation(project_id: str, annotation: HandoutAnnotation) -> HandoutAnnotation:
    annotation = annotation.model_copy(update={"project_id": project_id})
    items = load_annotations(project_id)
    for idx, existing in enumerate(items):
        if existing.annotation_id == annotation.annotation_id:
            items[idx] = annotation
            _save(project_id, items)
            return annotation
    items.append(annotation)
    _save(project_id, items)
    return annotation


def delete_annotation(project_id: str, annotation_id: str) -> bool:
    items = load_annotations(project_id)
    kept = [row for row in items if row.annotation_id != annotation_id]
    if len(kept) == len(items):
        return False
    _save(project_id, kept)
    return True


def pinned_annotations(project_id: str) -> List[HandoutAnnotation]:
    return [row for row in load_annotations(project_id) if row.margin_card.is_pinned]


def find_by_id(project_id: str, annotation_id: str) -> Optional[HandoutAnnotation]:
    for row in load_annotations(project_id):
        if row.annotation_id == annotation_id:
            return row
    return None