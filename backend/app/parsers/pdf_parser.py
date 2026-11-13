from __future__ import annotations

import re
from pathlib import Path
from typing import Dict, List, Tuple
import fitz  # PyMuPDF

from app.parsers.ocr_engine import extract_text_from_image_vision
from app.schemas import AssetItem, ChapterNode, DocumentIR, RouterSettings


_HEADING_PATTERN = re.compile(
    r"^(第[一二三四五六七八九十百0-9]+[章节篇讲课][\s:：]?.*|Chapter\s+\d+.*|CHAPTER\s+\d+.*|Unit\s+\d+.*|Part\s+\d+.*|\d+\.\s+\S.*)$",
    re.MULTILINE,
)


def extract_key_terms(text: str, limit: int = 8) -> List[str]:
    candidates: List[str] = []
    # Extract capitalized/multi-char Chinese concepts or bolded/colon-preceded terms
    for m in re.finditer(r"(?:^|\n)\s*(?:[-*•\d.]+\s*)?([^\n:：]{2,24})[:：]", text):
        term = m.group(1).strip(" #*`")
        if 2 <= len(term) <= 22 and term not in candidates:
            candidates.append(term)
    for m in re.finditer(r"\b([A-Z][a-zA-Z0-9_-]{2,24}(?:\s+[A-Z][a-zA-Z0-9_-]{2,20})?)\b", text):
        term = m.group(1).strip()
        if term not in candidates and term.lower() not in {"chapter", "section", "figure", "table", "slide"}:
            candidates.append(term)
    return candidates[:limit]


async def parse_pdf(
    file_path: Path,
    project_id: str,
    assets_dir: Path,
    settings: RouterSettings,
) -> DocumentIR:
    doc = fitz.open(str(file_path))
    total_pages = len(doc)
    page_texts: Dict[int, str] = {}
    page_assets: Dict[int, List[AssetItem]] = {}
    all_assets: List[AssetItem] = []
    ocr_applied = False

    for page_idx in range(total_pages):
        page_num = page_idx + 1
        page = doc[page_idx]
        text = page.get_text("text").strip()

        # Extract embedded images
        assets_here: List[AssetItem] = []
        for img_idx, img_info in enumerate(page.get_images(full=True)):
            xref = img_info[0]
            try:
                base_img = doc.extract_image(xref)
                w, h = base_img.get("width", 0), base_img.get("height", 0)
                if w < 80 or h < 80:
                    continue
                ext = base_img.get("ext", "png")
                img_filename = f"pdf_p{page_num}_img{img_idx + 1}.{ext}"
                out_path = assets_dir / img_filename
                out_path.write_bytes(base_img["image"])
                asset = AssetItem(
                    asset_id=f"p{page_num}_img{img_idx + 1}",
                    filename=img_filename,
                    url=f"/api/projects/{project_id}/assets/{img_filename}",
                    page_or_slide=page_num,
                    caption=f"第 {page_num} 页插图 {img_idx + 1}",
                )
                assets_here.append(asset)
                all_assets.append(asset)
            except Exception:
                continue

        # Scanned page detection: very little text -> render page and run OCR/VLM
        if len(text) < 35:
            scan_filename = f"pdf_scan_p{page_num}.png"
            scan_path = assets_dir / scan_filename
            pix = page.get_pixmap(dpi=160)
            pix.save(str(scan_path))
            ocr_text = await extract_text_from_image_vision(scan_path, settings)
            if ocr_text:
                text = ocr_text
                ocr_applied = True
            if not assets_here:
                scan_asset = AssetItem(
                    asset_id=f"p{page_num}_scan",
                    filename=scan_filename,
                    url=f"/api/projects/{project_id}/assets/{scan_filename}",
                    page_or_slide=page_num,
                    caption=f"第 {page_num} 页页面扫描图",
                    ocr_text=ocr_text,
                )
                assets_here.append(scan_asset)
                all_assets.append(scan_asset)

        page_texts[page_num] = text
        page_assets[page_num] = assets_here

    # Determine chapter boundaries via TOC or heuristic splitting
    toc = doc.get_toc(simple=True)
    chapters: List[ChapterNode] = []

    if toc:
        # Use top-level (or level<=2 if level 1 only has 1 entry) TOC items
        top_entries = [item for item in toc if item[0] == 1]
        if len(top_entries) <= 1:
            top_entries = [item for item in toc if item[0] <= 2]
        # Clean & sort by page
        cleaned: List[Tuple[str, int]] = []
        for _, title, page_num in top_entries:
            p = max(1, min(total_pages, int(page_num)))
            if not cleaned or p >= cleaned[-1][1]:
                cleaned.append((title.strip(), p))

        for idx, (title, start_p) in enumerate(cleaned):
            end_p = (
                cleaned[idx + 1][1] - 1
                if idx + 1 < len(cleaned) and cleaned[idx + 1][1] > start_p
                else (cleaned[idx + 1][1] if idx + 1 < len(cleaned) else total_pages)
            )
            end_p = max(start_p, min(total_pages, end_p))
            if idx + 1 == len(cleaned):
                end_p = total_pages
            chunk_text = "\n\n".join(
                f"[第 {p} 页]\n{page_texts.get(p, '')}"
                for p in range(start_p, end_p + 1)
                if page_texts.get(p, "").strip()
            )
            ch_assets: List[AssetItem] = []
            for p in range(start_p, end_p + 1):
                ch_assets.extend(page_assets.get(p, []))
            chapters.append(
                ChapterNode(
                    chapter_id=f"ch_{idx + 1}",
                    title=title or f"第 {idx + 1} 节",
                    start_page=start_p,
                    end_page=end_p,
                    char_count=len(chunk_text),
                    summary_preview=chunk_text[:180].replace("\n", " "),
                    content_text=chunk_text,
                    assets=ch_assets,
                    key_terms=extract_key_terms(chunk_text),
                )
            )

    if not chapters:
        # Heuristic heading scan across pages
        detected_starts: List[Tuple[str, int]] = []
        for p in range(1, total_pages + 1):
            t = page_texts.get(p, "")
            first_lines = "\n".join(t.splitlines()[:6])
            m = _HEADING_PATTERN.search(first_lines)
            if m:
                heading = m.group(1).strip()[:60]
                if not detected_starts or p - detected_starts[-1][1] >= 1:
                    detected_starts.append((heading, p))

        if len(detected_starts) >= 2:
            for idx, (title, start_p) in enumerate(detected_starts):
                end_p = detected_starts[idx + 1][1] - 1 if idx + 1 < len(detected_starts) else total_pages
                end_p = max(start_p, end_p)
                chunk_text = "\n\n".join(
                    f"[第 {p} 页]\n{page_texts.get(p, '')}"
                    for p in range(start_p, end_p + 1)
                    if page_texts.get(p, "").strip()
                )
                ch_assets = [a for p in range(start_p, end_p + 1) for a in page_assets.get(p, [])]
                chapters.append(
                    ChapterNode(
                        chapter_id=f"ch_{idx + 1}",
                        title=title,
                        start_page=start_p,
                        end_page=end_p,
                        char_count=len(chunk_text),
                        summary_preview=chunk_text[:180].replace("\n", " "),
                        content_text=chunk_text,
                        assets=ch_assets,
                        key_terms=extract_key_terms(chunk_text),
                    )
                )
        else:
            # Group by page windows (up to 6 pages per section)
            window = 6 if total_pages > 8 else max(1, total_pages)
            idx = 0
            for start_p in range(1, total_pages + 1, window):
                idx += 1
                end_p = min(total_pages, start_p + window - 1)
                chunk_text = "\n\n".join(
                    f"[第 {p} 页]\n{page_texts.get(p, '')}"
                    for p in range(start_p, end_p + 1)
                    if page_texts.get(p, "").strip()
                )
                first_line = next((ln.strip() for ln in chunk_text.splitlines() if ln.strip() and not ln.startswith("[第")), "")
                title = first_line[:40] if first_line else f"第 {start_p}-{end_p} 页"
                if total_pages > window:
                    title = f"第 {idx} 部分 ({start_p}-{end_p}页): {title}" if first_line else f"第 {idx} 部分 ({start_p}-{end_p}页)"
                ch_assets = [a for p in range(start_p, end_p + 1) for a in page_assets.get(p, [])]
                chapters.append(
                    ChapterNode(
                        chapter_id=f"ch_{idx}",
                        title=title,
                        start_page=start_p,
                        end_page=end_p,
                        char_count=len(chunk_text),
                        summary_preview=chunk_text[:180].replace("\n", " "),
                        content_text=chunk_text,
                        assets=ch_assets,
                        key_terms=extract_key_terms(chunk_text),
                    )
                )

    total_chars = sum(c.char_count for c in chapters)
    doc.close()
    return DocumentIR(
        project_id=project_id,
        filename=file_path.name,
        file_type="pdf",
        total_pages_or_slides=total_pages,
        total_chars=total_chars,
        ocr_applied=ocr_applied,
        chapters=chapters,
        all_assets=all_assets,
    )
