from __future__ import annotations

import re
from pathlib import Path
from typing import Awaitable, Callable, List, Optional, Tuple
from bs4 import BeautifulSoup
from docx import Document as DocxDocument
import ebooklib
from ebooklib import epub

from app.parsers.ocr_engine import extract_text_from_image_vision
from app.parsers.pdf_parser import extract_key_terms
from app.schemas import AssetItem, ChapterNode, DocumentIR, RouterSettings

OcrProgressCallback = Optional[Callable[[int, str, str], Awaitable[None]]]


async def parse_docx(
    file_path: Path, project_id: str, progress_cb: OcrProgressCallback = None
) -> DocumentIR:
    if progress_cb:
        await progress_cb(20, "ocr_scanning", f"正在读取 DOCX 文档 {file_path.name}...")
    doc = DocxDocument(str(file_path))
    sections: List[Tuple[str, List[str]]] = []
    current_title = file_path.stem
    current_lines: List[str] = []

    for para in doc.paragraphs:
        txt = para.text.strip()
        if not txt:
            continue
        style_name = (para.style.name or "").lower() if para.style else ""
        if "heading 1" in style_name or "heading 2" in style_name or style_name.startswith("标题 1"):
            if current_lines:
                sections.append((current_title, current_lines))
            current_title = txt
            current_lines = []
        else:
            current_lines.append(txt)

    # Also append tables into the last section
    for table in doc.tables:
        t_lines: List[str] = []
        for r_idx, row in enumerate(table.rows):
            cells = [c.text.strip().replace("\n", " ") for c in row.cells]
            t_lines.append("| " + " | ".join(cells) + " |")
            if r_idx == 0:
                t_lines.append("| " + " | ".join(["---"] * len(cells)) + " |")
        if t_lines:
            current_lines.append("\n".join(t_lines))

    if current_lines or not sections:
        sections.append((current_title, current_lines))

    chapters: List[ChapterNode] = []
    for idx, (title, lines) in enumerate(sections, start=1):
        text = "\n\n".join(lines).strip()
        if not text:
            continue
        chapters.append(
            ChapterNode(
                chapter_id=f"ch_{idx}",
                title=title,
                start_page=idx,
                end_page=idx,
                char_count=len(text),
                summary_preview=text[:180].replace("\n", " "),
                content_text=text,
                key_terms=extract_key_terms(text),
            )
        )

    return DocumentIR(
        project_id=project_id,
        filename=file_path.name,
        file_type="docx",
        total_pages_or_slides=len(chapters),
        total_chars=sum(c.char_count for c in chapters),
        chapters=chapters,
    )


async def parse_epub(
    file_path: Path, project_id: str, progress_cb: OcrProgressCallback = None
) -> DocumentIR:
    if progress_cb:
        await progress_cb(20, "ocr_scanning", f"正在读取 EPUB 电子书章节结构...")
    book = epub.read_epub(str(file_path))
    chapters: List[ChapterNode] = []
    idx = 0
    for item in book.get_items():
        if item.get_type() == ebooklib.ITEM_DOCUMENT:
            soup = BeautifulSoup(item.get_content(), "html.parser")
            text = soup.get_text("\n", strip=True)
            if len(text) < 40:
                continue
            idx += 1
            heading_tag = soup.find(["h1", "h2", "h3", "title"])
            title = heading_tag.get_text(strip=True) if heading_tag else f"章节 {idx}"
            chapters.append(
                ChapterNode(
                    chapter_id=f"ch_{idx}",
                    title=title[:80],
                    start_page=idx,
                    end_page=idx,
                    char_count=len(text),
                    summary_preview=text[:180].replace("\n", " "),
                    content_text=text,
                    key_terms=extract_key_terms(text),
                )
            )
    return DocumentIR(
        project_id=project_id,
        filename=file_path.name,
        file_type="epub",
        total_pages_or_slides=len(chapters),
        total_chars=sum(c.char_count for c in chapters),
        chapters=chapters,
    )


async def parse_markdown_or_text(
    file_path: Path, project_id: str, progress_cb: OcrProgressCallback = None
) -> DocumentIR:
    if progress_cb:
        await progress_cb(30, "ocr_scanning", f"正在切分文本章节结构...")
    raw = file_path.read_text(encoding="utf-8", errors="replace")
    parts = re.split(r"(?m)^(#{1,2}\s+.+)$", raw)
    sections: List[Tuple[str, str]] = []
    if len(parts) <= 1:
        sections.append((file_path.stem, raw.strip()))
    else:
        preamble = parts[0].strip()
        if preamble:
            sections.append(("导言 / 前言", preamble))
        for i in range(1, len(parts), 2):
            title = parts[i].lstrip("# ").strip()
            body = parts[i + 1].strip() if i + 1 < len(parts) else ""
            if body or title:
                sections.append((title, body))

    chapters: List[ChapterNode] = []
    for idx, (title, body) in enumerate(sections, start=1):
        chapters.append(
            ChapterNode(
                chapter_id=f"ch_{idx}",
                title=title,
                start_page=idx,
                end_page=idx,
                char_count=len(body),
                summary_preview=body[:180].replace("\n", " "),
                content_text=body,
                key_terms=extract_key_terms(body),
            )
        )

    return DocumentIR(
        project_id=project_id,
        filename=file_path.name,
        file_type=file_path.suffix.lstrip(".") or "md",
        total_pages_or_slides=len(chapters),
        total_chars=sum(c.char_count for c in chapters),
        chapters=chapters,
    )


async def parse_image_file(
    file_path: Path,
    project_id: str,
    assets_dir: Path,
    settings: RouterSettings,
    progress_cb: OcrProgressCallback = None,
) -> DocumentIR:
    dest = assets_dir / file_path.name
    if dest != file_path:
        dest.write_bytes(file_path.read_bytes())

    if progress_cb:
        await progress_cb(25, "ocr_vision", f"正在调用 OCR / 视觉模型识别图片 {file_path.name}...")
    ocr_text = await extract_text_from_image_vision(dest, settings)
    if progress_cb:
        await progress_cb(90, "ocr_done", "图片文字与公式识别完成，正在整理知识节点...")
    effective_text = ocr_text or f"[图片课件: {file_path.name}] (未检测到本地 OCR 文本，可在路由设置中配置支持视觉的多模态模型进行深度识图)"
    asset = AssetItem(
        asset_id="img_1",
        filename=file_path.name,
        url=f"/api/projects/{project_id}/assets/{file_path.name}",
        page_or_slide=1,
        caption=f"上传课件图片: {file_path.name}",
        ocr_text=ocr_text,
    )
    chap = ChapterNode(
        chapter_id="ch_1",
        title=f"课件截图: {file_path.stem}",
        start_page=1,
        end_page=1,
        char_count=len(effective_text),
        summary_preview=effective_text[:180].replace("\n", " "),
        content_text=effective_text,
        assets=[asset],
        key_terms=extract_key_terms(effective_text),
    )
    return DocumentIR(
        project_id=project_id,
        filename=file_path.name,
        file_type="image",
        total_pages_or_slides=1,
        total_chars=len(effective_text),
        ocr_applied=bool(ocr_text),
        chapters=[chap],
        all_assets=[asset],
    )
