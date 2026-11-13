from __future__ import annotations

from pathlib import Path

from app.parsers.doc_parser import (
    parse_docx,
    parse_epub,
    parse_image_file,
    parse_markdown_or_text,
)
from app.parsers.pdf_parser import parse_pdf
from app.parsers.pptx_parser import parse_pptx
from app.schemas import DocumentIR, RouterSettings

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


async def parse_uploaded_file(
    file_path: Path,
    project_id: str,
    assets_dir: Path,
    settings: RouterSettings,
) -> DocumentIR:
    ext = file_path.suffix.lower()
    if ext == ".pdf":
        return await parse_pdf(file_path, project_id, assets_dir, settings)
    if ext == ".pptx":
        return await parse_pptx(file_path, project_id, assets_dir, settings)
    if ext == ".docx":
        return await parse_docx(file_path, project_id)
    if ext == ".epub":
        return await parse_epub(file_path, project_id)
    if ext in (".md", ".txt"):
        return await parse_markdown_or_text(file_path, project_id)
    if ext in (".png", ".jpg", ".jpeg", ".webp"):
        return await parse_image_file(file_path, project_id, assets_dir, settings)
    raise ValueError(f"暂不支持的文件格式: {ext}")
