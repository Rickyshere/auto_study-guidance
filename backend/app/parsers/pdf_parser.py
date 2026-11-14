from __future__ import annotations

import re
from pathlib import Path
from typing import Awaitable, Callable, Dict, List, Optional, Tuple
import fitz  # PyMuPDF

from app.parsers.ocr_engine import (
    extract_exam_page_with_forced_oxr,
    extract_text_from_image_vision,
    probe_local_oxr_only,
)
from app.schemas import AssetItem, ChapterNode, DocumentIR, RouterSettings

OcrProgressCallback = Optional[Callable[[int, str, str], Awaitable[None]]]


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
    progress_cb: OcrProgressCallback = None,
) -> DocumentIR:
    doc = fitz.open(str(file_path))
    total_pages = len(doc)
    page_texts: Dict[int, str] = {}
    page_assets: Dict[int, List[AssetItem]] = {}
    all_assets: List[AssetItem] = []
    ocr_applied = False

    if progress_cb:
        await progress_cb(8, "ocr_init", f"已读取 PDF 共 {total_pages} 页，正在启动版面分析与 OCR 识别...")

    for page_idx in range(total_pages):
        page_num = page_idx + 1
        page = doc[page_idx]
        text = page.get_text("text").strip()
        pct = 10 + int(78 * page_num / max(1, total_pages))
        if progress_cb:
            await progress_cb(pct, "ocr_scanning", f"正在解析第 {page_num}/{total_pages} 页文本与插图...")

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
            if progress_cb:
                pct = 10 + int(78 * page_num / max(1, total_pages))
                await progress_cb(
                    pct,
                    "ocr_vision",
                    f"第 {page_num}/{total_pages} 页为扫描图像页，正在执行 OCR 识别（{settings.ocr_config.active_engine}）...",
                )
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
    if progress_cb:
        await progress_cb(100, "done", f"OCR 与章节切片完成！共识别 {len(chapters)} 个章节、{total_chars:,} 字。")
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


async def parse_exam_pdf(
    file_path: Path,
    project_id: str,
    assets_dir: Path,
    settings: RouterSettings,
    progress_cb: OcrProgressCallback = None,
) -> DocumentIR:
    """Parse an exam PDF by probing local OXR (without downloading) and falling back directly to Cloud OXR."""
    if progress_cb:
        await progress_cb(4, "oxr_probe", "正在探查本机是否安装并运行 OXR 模型（仅探查不下载）...")
    probe = await probe_local_oxr_only(settings)
    prefer_local_oxr = bool(probe["local_oxr_ready"])
    selected_engine = str(probe["selected_engine"])
    probe_summary = str(probe["summary"])

    if progress_cb:
        await progress_cb(10, "oxr_probe", probe_summary)

    assets_dir.mkdir(parents=True, exist_ok=True)
    doc = fitz.open(str(file_path))
    total_pages = len(doc)
    page_texts: Dict[int, str] = {}
    all_assets: List[AssetItem] = []
    actual_engines: List[str] = []

    for page_idx in range(total_pages):
        page_num = page_idx + 1
        page = doc[page_idx]
        native_text = page.get_text("text").strip()
        pct = 14 + int(76 * page_num / max(1, total_pages))
        if progress_cb:
            mode_label = "本地 OXR" if prefer_local_oxr else "云端 OXR (SoMark Free-OXR)"
            await progress_cb(
                pct,
                "oxr_scanning",
                f"正在使用 {mode_label} 提取试卷第 {page_num}/{total_pages} 页版面与公式...",
            )

        scan_filename = f"exam_p{page_num}.png"
        scan_path = assets_dir / scan_filename
        pix = page.get_pixmap(dpi=170)
        pix.save(str(scan_path))

        oxr_text, used_label = await extract_exam_page_with_forced_oxr(
            scan_path, settings, prefer_local_oxr=prefer_local_oxr
        )
        if used_label and used_label not in actual_engines:
            actual_engines.append(used_label)

        if oxr_text and native_text:
            combined = oxr_text if len(oxr_text) >= len(native_text) * 0.65 else f"{native_text}\n\n{oxr_text}"
        else:
            combined = oxr_text or native_text

        page_texts[page_num] = combined.strip()
        all_assets.append(
            AssetItem(
                asset_id=f"exam_p{page_num}",
                filename=scan_filename,
                url=f"/api/projects/{project_id}/assets/{scan_filename}",
                page_or_slide=page_num,
                caption=f"试卷第 {page_num} 页图像",
                ocr_text=oxr_text,
            )
        )

    doc.close()

    chapters: List[ChapterNode] = []
    full_sections: List[str] = []
    for p in range(1, total_pages + 1):
        pt = page_texts.get(p, "").strip()
        if not pt:
            continue
        section_text = f"[试卷第 {p} 页]\n{pt}"
        full_sections.append(section_text)
        chapters.append(
            ChapterNode(
                chapter_id=f"exam_p{p}",
                title=f"试卷第 {p} 页",
                start_page=p,
                end_page=p,
                char_count=len(pt),
                summary_preview=pt[:180].replace("\n", " "),
                content_text=pt,
                assets=[a for a in all_assets if a.page_or_slide == p],
                key_terms=extract_key_terms(pt),
            )
        )

    raw_exam_text = "\n\n".join(full_sections).strip()
    total_chars = len(raw_exam_text)
    engine_label = actual_engines[0] if actual_engines else selected_engine
    if progress_cb:
        await progress_cb(
            100,
            "oxr_done",
            f"试卷 OXR 文本层提取完成（{engine_label}），共 {total_pages} 页、{total_chars:,} 字。",
        )

    return DocumentIR(
        project_id=project_id,
        project_type="exam_paper",
        filename=file_path.name,
        file_type="exam_pdf",
        total_pages_or_slides=total_pages,
        total_chars=total_chars,
        ocr_applied=True,
        oxr_engine_used=engine_label,
        oxr_probe_summary=probe_summary,
        raw_exam_text=raw_exam_text,
        chapters=chapters,
        all_assets=all_assets,
    )
