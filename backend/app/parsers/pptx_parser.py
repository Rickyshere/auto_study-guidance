from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import List
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE

from app.parsers.ocr_engine import extract_text_from_image_vision
from app.parsers.pdf_parser import extract_key_terms
from app.schemas import AssetItem, ChapterNode, DocumentIR, RouterSettings


@dataclass
class _SlideData:
    slide_num: int
    title: str
    body_markdown: str
    speaker_notes: str
    is_divider: bool
    assets: List[AssetItem] = field(default_factory=list)


def _table_to_markdown(table) -> str:
    rows = []
    for r_idx, row in enumerate(table.rows):
        cells = [cell.text.strip().replace("\n", " ") for cell in row.cells]
        rows.append("| " + " | ".join(cells) + " |")
        if r_idx == 0:
            rows.append("| " + " | ".join(["---"] * len(cells)) + " |")
    return "\n".join(rows)


async def parse_pptx(
    file_path: Path,
    project_id: str,
    assets_dir: Path,
    settings: RouterSettings,
) -> DocumentIR:
    prs = Presentation(str(file_path))
    slides_data: List[_SlideData] = []
    all_assets: List[AssetItem] = []
    ocr_applied = False

    for idx, slide in enumerate(prs.slides, start=1):
        slide_title = ""
        if slide.shapes.title and slide.shapes.title.text:
            slide_title = slide.shapes.title.text.strip()

        body_lines: List[str] = []
        assets_here: List[AssetItem] = []
        img_counter = 0

        for shape in slide.shapes:
            # Skip title shape in body loop
            if slide.shapes.title and shape == slide.shapes.title:
                continue

            if shape.has_text_frame:
                for p in shape.text_frame.paragraphs:
                    txt = p.text.strip()
                    if not txt:
                        continue
                    indent = "  " * min(p.level, 4)
                    body_lines.append(f"{indent}- {txt}")

            if shape.has_table:
                body_lines.append("")
                body_lines.append(_table_to_markdown(shape.table))
                body_lines.append("")

            if shape.shape_type == MSO_SHAPE_TYPE.PICTURE:
                img_counter += 1
                try:
                    image = shape.image
                    ext = image.ext or "png"
                    img_filename = f"slide_{idx}_img_{img_counter}.{ext}"
                    out_path = assets_dir / img_filename
                    out_path.write_bytes(image.blob)
                    ocr_text = ""
                    if len("\n".join(body_lines)) < 40:
                        ocr_text = await extract_text_from_image_vision(out_path, settings)
                        if ocr_text:
                            ocr_applied = True
                            body_lines.append(f"[图片识图内容]: {ocr_text}")

                    asset = AssetItem(
                        asset_id=f"s{idx}_img{img_counter}",
                        filename=img_filename,
                        url=f"/api/projects/{project_id}/assets/{img_filename}",
                        page_or_slide=idx,
                        caption=f"幻灯片 {idx} 配图 {img_counter}" + (f" ({slide_title})" if slide_title else ""),
                        ocr_text=ocr_text,
                    )
                    assets_here.append(asset)
                    all_assets.append(asset)
                except Exception:
                    continue

        notes_text = ""
        try:
            if slide.has_notes_slide and slide.notes_slide.notes_text_frame:
                notes_text = slide.notes_slide.notes_text_frame.text.strip()
        except Exception:
            notes_text = ""

        if not slide_title and body_lines:
            slide_title = body_lines[0].lstrip("- ").strip()[:50]
        if not slide_title:
            slide_title = f"幻灯片 {idx}"

        body_md = "\n".join(body_lines).strip()
        is_divider = bool(
            slide_title
            and idx > 1
            and any(k in slide_title for k in ["第", "章", "节", "Chapter", "Part", "Section", "目录", "单元"])
        )

        slides_data.append(
            _SlideData(
                slide_num=idx,
                title=slide_title,
                body_markdown=body_md,
                speaker_notes=notes_text,
                is_divider=is_divider,
                assets=assets_here,
            )
        )

    # Group slides into logical chapters/topics
    chapters: List[ChapterNode] = []
    has_dividers = any(s.is_divider for s in slides_data)

    groups: List[List[_SlideData]] = []
    if has_dividers:
        current: List[_SlideData] = []
        for s in slides_data:
            if s.is_divider and current:
                groups.append(current)
                current = [s]
            else:
                current.append(s)
        if current:
            groups.append(current)
    else:
        group_size = 5 if len(slides_data) > 6 else max(1, len(slides_data))
        for i in range(0, len(slides_data), group_size):
            groups.append(slides_data[i : i + group_size])

    for g_idx, grp in enumerate(groups, start=1):
        start_s = grp[0].slide_num
        end_s = grp[-1].slide_num
        chap_title = grp[0].title
        if len(grp) > 1 and not grp[0].is_divider:
            chap_title = f"专题 {g_idx} (Slide {start_s}-{end_s}): {grp[0].title}"

        parts: List[str] = []
        ch_assets: List[AssetItem] = []
        for s in grp:
            block = f"### [Slide {s.slide_num}] {s.title}\n"
            if s.body_markdown:
                block += s.body_markdown + "\n"
            if s.speaker_notes:
                block += f"> **演讲者备注**: {s.speaker_notes}\n"
            parts.append(block.strip())
            ch_assets.extend(s.assets)

        full_text = "\n\n".join(parts)
        chapters.append(
            ChapterNode(
                chapter_id=f"ch_{g_idx}",
                title=chap_title,
                start_page=start_s,
                end_page=end_s,
                char_count=len(full_text),
                summary_preview=full_text[:180].replace("\n", " "),
                content_text=full_text,
                assets=ch_assets,
                key_terms=extract_key_terms(full_text),
            )
        )

    total_chars = sum(c.char_count for c in chapters)
    return DocumentIR(
        project_id=project_id,
        filename=file_path.name,
        file_type="pptx",
        total_pages_or_slides=len(slides_data),
        total_chars=total_chars,
        ocr_applied=ocr_applied,
        chapters=chapters,
        all_assets=all_assets,
    )
