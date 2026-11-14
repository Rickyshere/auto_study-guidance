from __future__ import annotations

from pathlib import Path
from typing import Awaitable, Callable, Optional

from app.parsers.doc_parser import (
    parse_docx,
    parse_epub,
    parse_exam_image,
    parse_image_file,
    parse_markdown_or_text,
)
from app.parsers.ocr_engine import probe_local_oxr_only
from app.parsers.pdf_parser import parse_exam_pdf, parse_pdf
from app.parsers.pptx_parser import parse_pptx
from app.schemas import DocumentIR, RouterSettings

OcrProgressCallback = Optional[Callable[[int, str, str], Awaitable[None]]]

SUPPORTED_EXTENSIONS = {
    ".pdf",
    ".pptx",
    ".docx",
    ".epub",
    ".md",
    ".txt",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
}

SUPPORTED_EXAM_EXTENSIONS = {
    ".pdf",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".docx",
    ".md",
    ".txt",
}


async def parse_uploaded_file(
    file_path: Path,
    project_id: str,
    assets_dir: Path,
    settings: RouterSettings,
    progress_cb: OcrProgressCallback = None,
) -> DocumentIR:
    ext = file_path.suffix.lower()
    if ext == ".pdf":
        return await parse_pdf(file_path, project_id, assets_dir, settings, progress_cb=progress_cb)
    if ext == ".pptx":
        return await parse_pptx(file_path, project_id, assets_dir, settings, progress_cb=progress_cb)
    if ext == ".docx":
        return await parse_docx(file_path, project_id, progress_cb=progress_cb)
    if ext == ".epub":
        return await parse_epub(file_path, project_id, progress_cb=progress_cb)
    if ext in (".md", ".txt"):
        return await parse_markdown_or_text(file_path, project_id, progress_cb=progress_cb)
    if ext in (".png", ".jpg", ".jpeg", ".webp"):
        return await parse_image_file(file_path, project_id, assets_dir, settings, progress_cb=progress_cb)
    raise ValueError(f"暂不支持的文件格式: {ext}")


async def parse_uploaded_exam_file(
    file_path: Path,
    project_id: str,
    assets_dir: Path,
    settings: RouterSettings,
    progress_cb: OcrProgressCallback = None,
) -> DocumentIR:
    """Parse an uploaded exam paper with forced OXR probing (local OXR if ready -> Cloud OXR)."""
    ext = file_path.suffix.lower()
    if ext == ".pdf":
        return await parse_exam_pdf(file_path, project_id, assets_dir, settings, progress_cb=progress_cb)
    if ext in (".png", ".jpg", ".jpeg", ".webp"):
        return await parse_exam_image(file_path, project_id, assets_dir, settings, progress_cb=progress_cb)
    if ext in (".docx", ".md", ".txt"):
        if progress_cb:
            await progress_cb(8, "oxr_probe", "正在探查 OXR 服务与试卷文本层（仅探查不下载）...")
        probe = await probe_local_oxr_only(settings)
        doc_ir = (
            await parse_docx(file_path, project_id, progress_cb=progress_cb)
            if ext == ".docx"
            else await parse_markdown_or_text(file_path, project_id, progress_cb=progress_cb)
        )
        raw_text = "\n\n".join(c.content_text for c in doc_ir.chapters if c.content_text.strip()).strip()
        if progress_cb:
            await progress_cb(100, "oxr_done", f"试卷文本层提取完成，共 {len(raw_text):,} 字。")
        return doc_ir.model_copy(
            update={
                "project_type": "exam_paper",
                "file_type": f"exam_{ext.lstrip('.')}",
                "ocr_applied": False,
                "oxr_engine_used": str(probe["selected_engine"]),
                "oxr_probe_summary": f"{probe['summary']}（当前文件含原生结构化文本层）",
                "raw_exam_text": raw_text,
            }
        )
    raise ValueError(f"试卷上传暂不支持格式: {ext}，支持 PDF / PNG / JPG / WEBP / DOCX / MD / TXT")
