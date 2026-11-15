from __future__ import annotations

import html
import io
import re
from pathlib import Path
from typing import Dict, List, Literal, Optional, Tuple

import pymupdf

from app.schemas import DocumentIR, QuizQuestion, StudyPackage
from app.workflows.generator import (
    PAGE_BREAK_TOKEN,
    normalize_markdown_math,
    strip_document_images,
)
from app.workflows.latex_render import render_math

PaperSize = Literal["a4", "a3"]
PdfDocType = Literal["quiz", "study_guide", "cheatsheet"]

# ---------------------------------------------------------------------------
# Math rendering
# ---------------------------------------------------------------------------
# The print pipeline feeds HTML to PyMuPDF Story, which has no TeX engine, so the
# LaTeX subset used by the prompts is converted by `latex_render` (real <sup>/<sub>,
# staged fractions in display math, a full symbol table, no leaked control words).


def _latex_expr_to_html(expr: str) -> str:
    """Render inline LaTeX math ($…$) as printable HTML."""
    return render_math(expr, display=False)


def _latex_display_to_html(expr: str) -> str:
    """Render display LaTeX math ($$…$$) as printable HTML (staged fractions)."""
    return render_math(expr, display=True)


def _format_inline_text(raw: str, assets_dir: Optional[Path] = None) -> str:
    """Escape inline markdown text while rendering math, bold, italic, code, and images."""
    norm = normalize_markdown_math(raw)
    tokens: Dict[str, str] = {}
    counter = 0

    def _stash(fragment_html: str) -> str:
        nonlocal counter
        key = f"@@ASGTOK{counter}@@"
        counter += 1
        tokens[key] = fragment_html
        return key

    # Inline images ![alt](url)
    def _img_sub(m: re.Match[str]) -> str:
        alt = html.escape(m.group(1).strip())
        src = m.group(2).strip()
        filename = src.rsplit("/", 1)[-1]
        if assets_dir and (assets_dir / filename).exists():
            return _stash(
                f'<div class="figure-wrap"><img src="{html.escape(filename)}" />'
                + (f'<div class="figure-cap">{alt}</div>' if alt else "")
                + "</div>"
            )
        return _stash(f'<span class="fig-ref">[附图：{alt}]</span>')

    work = re.sub(r"!\[([^\]]*)\]\(([^)]+)\)", _img_sub, norm)

    # Display math inside line
    work = re.sub(
        r"\$\$([\s\S]*?)\$\$",
        lambda m: _stash(f'<div class="math-block">{_latex_display_to_html(m.group(1))}</div>'),
        work,
    )
    # Inline math $...$
    work = re.sub(
        r"(?<!\$)\$(?!\$)([^\n$]+?)(?<!\$)\$(?!\$)",
        lambda m: _stash(_latex_expr_to_html(m.group(1))),
        work,
    )
    # Inline code `...`
    work = re.sub(
        r"`([^`\n]+)`",
        lambda m: _stash(f"<code>{html.escape(m.group(1))}</code>"),
        work,
    )

    # Bare scientific subscripts/superscripts left un-delimited by LLM (e.g. K_m^{app}, V_{max}, V_T, 4K_m)
    work = re.sub(
        r"\b([A-Za-z0-9]+(?:_(?:\{[^{}]+\}|[A-Za-z0-9]+))?\^\{[^{}]+\}|[A-Za-z0-9]+_\{[^{}]+\})",
        lambda m: _stash(_latex_expr_to_html(m.group(1))),
        work,
    )
    work = re.sub(
        r"(?<![A-Za-z_])([0-9]*[A-Z]_[A-Za-z0-9]{1,3}|[0-9]*[a-z]_[0-9]{1,2})(?![A-Za-z0-9_])",
        lambda m: _stash(_latex_expr_to_html(m.group(1))),
        work,
    )

    # Clean stray LaTeX escapes in non-math prose (e.g. 57.1\%, 150\ mL, \|)
    work = work.replace(r"\%", "%").replace(r"\|", "|")
    work = re.sub(r"\\(?=[ \t])", "", work)

    escaped = html.escape(work)
    # Bold & Italic
    escaped = re.sub(r"\*\*([^\*\n]+?)\*\*", r"<strong>\1</strong>", escaped)
    escaped = re.sub(r"(?<!\*)\*([^\*\n]+?)\*(?!\*)", r"<em>\1</em>", escaped)
    # Checklist boxes
    escaped = escaped.replace("[ ] ", "☐ ").replace("[x] ", "☑ ").replace("[X] ", "☑ ")

    for key, val in tokens.items():
        escaped = escaped.replace(key, val)
    return escaped


_MERMAID_ARROW_RE = re.compile(r"\s*(?:-{2,}>|={2,}>|-\.->|-{3}|={3}|--[ox])\s*(?:\|[^|]*\|)?")
_MERMAID_NODE_RE = re.compile(r"([A-Za-z0-9_]+)\s*(?:\[|\(|\{)+([^\]\)\}]*)[\]\)\}]+")


def _mermaid_to_outline_html(code: str) -> str:
    """Turn a Mermaid flowchart into a printable outline tree.

    Story cannot run Mermaid, and printing the raw source is noise for a learner, so the
    diagram is flattened into the same hierarchy as an indented list (root → children).
    """
    labels: Dict[str, str] = {}
    edges: List[Tuple[str, str]] = []
    order: List[str] = []

    def _clean(text: str) -> str:
        text = re.sub(r"<br\s*/?>", " ", text)
        text = text.replace('"', "").replace("'", "").strip()
        return re.sub(r"\s+", " ", text)

    for raw_line in code.splitlines():
        line = raw_line.strip()
        if not line or line.startswith(("flowchart", "graph", "mindmap", "%%", "direction", "classDef", "style", "subgraph", "end")):
            continue
        for match in _MERMAID_NODE_RE.finditer(line):
            node_id, label = match.group(1), _clean(match.group(2))
            if node_id not in labels:
                labels[node_id] = label or node_id
                order.append(node_id)
        flattened = _MERMAID_NODE_RE.sub(lambda m: m.group(1), line)
        parts = [p.strip() for p in _MERMAID_ARROW_RE.split(flattened) if p.strip()]
        ids = [p for p in parts if re.fullmatch(r"[A-Za-z0-9_]+", p)]
        for left, right in zip(ids, ids[1:]):
            if left != right:
                edges.append((left, right))

    if not labels or not edges:
        return ""

    children: Dict[str, List[str]] = {}
    has_parent = set()
    for left, right in edges:
        bucket = children.setdefault(left, [])
        if right not in bucket:
            bucket.append(right)
            has_parent.add(right)
    roots = [node for node in order if node not in has_parent]

    def _node_html(node_id: str, depth: int, trail: Tuple[str, ...]) -> str:
        label = html.escape(labels.get(node_id, node_id))
        kids = [k for k in children.get(node_id, []) if k not in trail]
        if not kids or depth >= 5:
            return f"<li>{label}</li>"
        inner = "".join(_node_html(kid, depth + 1, trail + (kid,)) for kid in kids)
        return f"<li>{label}<ul class=\"map-list\">{inner}</ul></li>"

    items: List[str] = []
    covered = set()
    for root in roots or order[:1]:
        items.append(_node_html(root, 0, (root,)))
        covered.add(root)
    for node in order:
        if node not in covered and node not in has_parent:
            items.append(_node_html(node, 0, (node,)))

    if not items:
        return ""
    return (
        '<div class="map-title">知识脉络导图（图谱结构）</div>'
        f'<ul class="map-list">{"".join(items)}</ul>'
    )


def _markdown_to_block_list(
    md_text: str,
    *,
    assets_dir: Optional[Path] = None,
    highlight_examples: bool = False,
) -> List[Tuple[str, str]]:
    """Parse normalized Markdown into typed HTML blocks shared by prose and question stem renderers."""
    norm = normalize_markdown_math(md_text or "")
    lines = norm.splitlines()
    blocks: List[Tuple[str, str]] = []
    i = 0
    n = len(lines)

    def _split_table_row(row_str: str) -> List[str]:
        s = row_str.strip()
        if s.startswith("|"):
            s = s[1:]
        if s.endswith("|"):
            s = s[:-1]
        return [cell.strip() for cell in s.split("|")]

    def _is_table_sep(sep_line: str) -> bool:
        st = sep_line.strip()
        return "--" in st and bool(re.match(r"^\|?[\s:\-|]+\|[\s:\-|]*$", st))

    while i < n:
        line = lines[i]
        stripped = line.strip()

        if not stripped:
            i += 1
            continue

        # Code block ```  (a Mermaid diagram is flattened into a printable outline)
        if stripped.startswith("```"):
            fence_lang = stripped[3:].strip().lower()
            code_lines: List[str] = []
            i += 1
            while i < n and not lines[i].strip().startswith("```"):
                code_lines.append(lines[i])
                i += 1
            i += 1
            raw_code = "\n".join(code_lines)
            if fence_lang.startswith("mermaid"):
                outline = _mermaid_to_outline_html(raw_code)
                if outline:
                    blocks.append(("block", outline))
                    continue
            code_body = html.escape(raw_code)
            blocks.append(("block", f"<pre class='code-box'>{code_body}</pre>"))
            continue

        # Display math $$ ... $$
        if stripped.startswith("$$"):
            if stripped.endswith("$$") and len(stripped) > 4:
                expr = stripped[2:-2]
                i += 1
            else:
                math_lines: List[str] = []
                if len(stripped) > 2:
                    math_lines.append(stripped[2:])
                i += 1
                while i < n and "$$" not in lines[i]:
                    math_lines.append(lines[i])
                    i += 1
                if i < n:
                    tail = lines[i].split("$$", 1)[0]
                    if tail.strip():
                        math_lines.append(tail)
                    i += 1
                expr = "\n".join(math_lines)
            blocks.append(("block", f'<div class="math-block">{_latex_display_to_html(expr)}</div>'))
            continue

        # Page break marker (handled before anything else can swallow it as prose)
        if stripped == PAGE_BREAK_TOKEN or stripped == f"**{PAGE_BREAK_TOKEN}**":
            blocks.append(("block", '<div style="page-break-after: always;"></div>'))
            i += 1
            continue

        # Horizontal rule
        if re.match(r"^[-*_]{3,}$", stripped):
            blocks.append(("block", '<hr class="section-rule" />'))
            i += 1
            continue

        # Headings
        hm = re.match(r"^(#{1,4})\s+(.+)$", stripped)
        if hm:
            lvl = len(hm.group(1))
            tag = f"h{min(4, lvl)}"
            heading_txt = hm.group(2).strip()
            extra_cls = (
                " example-heading"
                if highlight_examples and ("例题" in heading_txt or "典型例" in heading_txt)
                else ""
            )
            blocks.append(("block", f'<{tag} class="md-{tag}{extra_cls}">{_format_inline_text(heading_txt, assets_dir)}</{tag}>'))
            i += 1
            continue

        # GFM Table
        if stripped.startswith("|") and i + 1 < n and _is_table_sep(lines[i + 1]):
            headers = _split_table_row(lines[i])
            i += 2
            rows: List[List[str]] = []
            while i < n and lines[i].strip().startswith("|"):
                rows.append(_split_table_row(lines[i]))
                i += 1
            ths = "".join(f"<th>{_format_inline_text(h, assets_dir)}</th>" for h in headers)
            trs: List[str] = []
            for r in rows:
                padded = r + [""] * max(0, len(headers) - len(r))
                tds = "".join(
                    f"<td>{_format_inline_text(cell, assets_dir)}</td>"
                    for cell in padded[: len(headers)]
                )
                trs.append(f"<tr>{tds}</tr>")
            blocks.append(
                (
                    "table",
                    f'<table class="print-table"><thead><tr>{ths}</tr></thead><tbody>{"".join(trs)}</tbody></table>',
                )
            )
            continue

        # Blockquote > ...
        if stripped.startswith(">"):
            q_lines: List[str] = []
            while i < n and lines[i].strip().startswith(">"):
                q_lines.append(lines[i].strip()[1:].strip())
                i += 1
            joined_q = "<br/>".join(_format_inline_text(ql, assets_dir) if ql else "" for ql in q_lines)
            is_example_ans = highlight_examples and any(
                tag in "\n".join(q_lines) for tag in ("【答", "【解", "【审题", "【详细解答", "【易错", "【题目分析", "【规范解答")
            )
            box_cls = "example-sol-box" if is_example_ans else "quote-box"
            blocks.append(("block", f'<div class="{box_cls}">{joined_q}</div>'))
            continue

        # Unordered list
        if re.match(r"^[-*•]\s+", stripped):
            items: List[str] = []
            while i < n and re.match(r"^[-*•]\s+", lines[i].strip()):
                item_txt = re.sub(r"^[-*•]\s+", "", lines[i].strip())
                items.append(f"<li>{_format_inline_text(item_txt, assets_dir)}</li>")
                i += 1
            blocks.append(("block", f'<ul class="print-list">{"".join(items)}</ul>'))
            continue

        # Ordered list
        if re.match(r"^\d+\.\s+", stripped):
            items_ol: List[str] = []
            while i < n and re.match(r"^\d+\.\s+", lines[i].strip()):
                item_txt = re.sub(r"^\d+\.\s+", "", lines[i].strip())
                items_ol.append(f"<li>{_format_inline_text(item_txt, assets_dir)}</li>")
                i += 1
            blocks.append(("block", f'<ol class="print-list">{"".join(items_ol)}</ol>'))
            continue

        # Standalone image line
        if re.match(r"^!\[[^\]]*\]\([^)]+\)$", stripped):
            blocks.append(("block", _format_inline_text(stripped, assets_dir)))
            i += 1
            continue

        # Paragraph
        para_lines: List[str] = [stripped]
        i += 1
        while i < n:
            nxt = lines[i].strip()
            if (
                not nxt
                or nxt.startswith("#")
                or nxt.startswith("|")
                or nxt.startswith(">")
                or nxt.startswith("```")
                or nxt.startswith("$$")
                or re.match(r"^[-*_]{3,}$", nxt)
                or re.match(r"^[-*•]\s+", nxt)
                or re.match(r"^\d+\.\s+", nxt)
            ):
                break
            para_lines.append(nxt)
            i += 1
        para_text = " ".join(para_lines)
        if highlight_examples and (
            para_text.startswith("**【例")
            or para_text.startswith("**【综合例")
            or para_text.startswith("【例")
        ):
            blocks.append(("block", f'<div class="example-stem-box">{_format_inline_text(para_text, assets_dir)}</div>'))
        else:
            blocks.append(("p", _format_inline_text(para_text, assets_dir)))

    return blocks


def _markdown_to_print_html(
    md_text: str,
    *,
    assets_dir: Optional[Path] = None,
    highlight_examples: bool = False,
) -> str:
    """Convert Markdown (including tables, $$ math blocks, callouts, images) into clean print HTML."""
    blocks = _markdown_to_block_list(
        md_text, assets_dir=assets_dir, highlight_examples=highlight_examples
    )
    return "\n".join(f"<p>{content}</p>" if kind == "p" else content for kind, content in blocks)


def _render_question_stem_html(
    raw: str,
    *,
    prefix_html: str,
    tail_html: str = "",
    assets_dir: Optional[Path] = None,
    underline_blanks: bool = False,
) -> str:
    """Render a question stem supporting inline text as well as embedded GFM tables and blocks."""
    blocks = _markdown_to_block_list(raw, assets_dir=assets_dir)
    if underline_blanks:
        blocks = [
            (
                kind,
                re.sub(
                    r"_{2,}",
                    "<u>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</u>",
                    content,
                )
                if kind == "p"
                else content,
            )
            for kind, content in blocks
        ]

    if not blocks:
        return f'<div class="q-stem">{prefix_html}{tail_html}</div>'

    p_indices = [idx for idx, (kind, _) in enumerate(blocks) if kind == "p"]
    last_p_idx = p_indices[-1] if p_indices else -1
    out: List[str] = []

    if blocks[0][0] != "p":
        out.append(f'<div class="q-stem">{prefix_html}</div>')

    for idx, (kind, content) in enumerate(blocks):
        tail = tail_html if idx == last_p_idx else ""
        if idx == 0 and kind == "p":
            out.append(f'<div class="q-stem">{prefix_html}{content}{tail}</div>')
        elif kind == "p":
            out.append(f'<div class="q-stem-cont">{content}{tail}</div>')
        elif kind == "table":
            out.append(f'<div class="q-stem-table-wrap">{content}</div>')
        else:
            out.append(f'<div class="q-stem-cont">{content}</div>')

    if last_p_idx == -1 and tail_html:
        out.append(f'<div class="q-stem-cont">{tail_html}</div>')

    return "\n".join(out)


def _render_story_to_doc(
    html_body: str,
    *,
    css: str,
    paper_size: PaperSize,
    assets_dir: Optional[Path] = None,
    seal_margin: bool = False,
    max_pages: int = 80,
) -> Tuple[pymupdf.Document, int]:
    """Render HTML+CSS via PyMuPDF Story into an in-memory PDF Document."""
    full_html = f"<!DOCTYPE html><html><head><meta charset='utf-8'><style>{css}</style></head><body>{html_body}</body></html>"
    archive = pymupdf.Archive(str(assets_dir)) if assets_dir and assets_dir.exists() else None
    story = pymupdf.Story(html=full_html, archive=archive)

    buf = io.BytesIO()
    writer = pymupdf.DocumentWriter(buf)

    if paper_size == "a3":
        mediabox = pymupdf.paper_rect("a3-l")  # 1191 x 842 pt
        left_x = 96.0 if seal_margin else 42.0
        col_gap = 28.0
        right_edge = 1152.0
        usable_w = right_edge - left_x - col_gap
        col_w = usable_w / 2.0
        col_rects = [
            pymupdf.Rect(left_x, 42.0, left_x + col_w, 794.0),
            pymupdf.Rect(left_x + col_w + col_gap, 42.0, right_edge, 794.0),
        ]
    else:
        mediabox = pymupdf.paper_rect("a4")  # 595 x 842 pt
        col_rects = [pymupdf.Rect(42.0, 44.0, 553.0, 794.0)]

    column_count = 0
    more = 1
    page_counter = 0
    while more and page_counter < max_pages:
        page_counter += 1
        dev = writer.begin_page(mediabox)
        for rect in col_rects:
            more, _ = story.place(rect)
            story.draw(dev)
            column_count += 1
            if not more:
                break
        writer.end_page()

    writer.close()
    doc = pymupdf.open("pdf", buf.getvalue())
    return doc, column_count


def _decorate_pages(
    doc: pymupdf.Document,
    *,
    paper_size: PaperSize,
    seal_margin: bool,
    start_page_index: int = 0,
    total_pages_override: Optional[int] = None,
    doc_footer_label: str = "",
) -> None:
    """Draw A3 binding seal line, column divider, and page/column footers cleanly."""
    total_pages = total_pages_override or len(doc)
    total_cols = total_pages * 2

    for idx in range(start_page_index, len(doc)):
        page = doc[idx]
        if paper_size == "a3":
            # Binding seal margin on left side of every A3 page
            if seal_margin:
                page.draw_rect(pymupdf.Rect(18, 36, 82, 806), color=(0.45, 0.45, 0.5), width=0.8)
                page.draw_line((84, 32), (84, 810), color=(0.35, 0.35, 0.4), width=0.9, dashes="[4 4] 0")
                page.insert_text(
                    (40, 775),
                    "学校：____________   班级：__________   姓名：__________   考号：____________",
                    fontname="china-ss",
                    fontsize=9.5,
                    color=(0.15, 0.15, 0.2),
                    rotate=90,
                )
                page.insert_text(
                    (74, 780),
                    "········ 密 ········ 封 ········ 线 ········ 内 ········ 不 ········ 要 ········ 答 ········ 题 ········",
                    fontname="china-ss",
                    fontsize=8.8,
                    color=(0.35, 0.35, 0.4),
                    rotate=90,
                )
                div_x = 610.0
                c1_mid = 346.0
                c2_mid = 881.0
            else:
                div_x = 595.5
                c1_mid = 312.0
                c2_mid = 875.0

            # Center divider line
            page.draw_line((div_x, 42), (div_x, 796), color=(0.78, 0.78, 0.82), width=0.6)
            col1_num = idx * 2 + 1
            col2_num = idx * 2 + 2
            page.insert_text(
                (c1_mid - 48, 818),
                f"{doc_footer_label}第 {col1_num} 栏（共 {total_cols} 栏）",
                fontname="china-ss",
                fontsize=8.5,
                color=(0.42, 0.42, 0.46),
            )
            page.insert_text(
                (c2_mid - 48, 818),
                f"{doc_footer_label}第 {col2_num} 栏（共 {total_cols} 栏）",
                fontname="china-ss",
                fontsize=8.5,
                color=(0.42, 0.42, 0.46),
            )
        else:
            page_num = idx + 1
            page.draw_line((42, 804), (553, 804), color=(0.82, 0.82, 0.85), width=0.5)
            page.insert_text(
                (238, 820),
                f"{doc_footer_label}第 {page_num} 页（共 {total_pages} 页）",
                fontname="china-ss",
                fontsize=8.5,
                color=(0.42, 0.42, 0.46),
            )


_BASE_PRINT_CSS = """
body {
  font-family: "Microsoft YaHei", "PingFang SC", "SimSun", sans-serif;
  font-size: 9.8pt;
  line-height: 1.56;
  color: #111827;
}
.exam-header {
  text-align: center;
  border-bottom: 1.6pt solid #111827;
  padding-bottom: 7pt;
  margin-bottom: 8pt;
}
.exam-title {
  font-size: 15.5pt;
  font-weight: 700;
  color: #0f172a;
  margin: 0 0 4pt 0;
  letter-spacing: 0.4pt;
}
.exam-subtitle {
  font-size: 9pt;
  color: #374151;
  margin: 0;
}
.student-line {
  font-size: 9.2pt;
  margin: 6pt 0 7pt 0;
  text-align: center;
  color: #1f2937;
}
.score-table {
  width: 100%;
  border-collapse: collapse;
  margin: 4pt 0 11pt 0;
  font-size: 8.8pt;
  text-align: center;
}
.score-table th, .score-table td {
  border: 0.8pt solid #1f2937;
  padding: 3.5pt 5pt;
}
.score-table th {
  background-color: #f3f4f6;
  font-weight: 700;
}
.notice-box {
  border: 0.7pt solid #9ca3af;
  background-color: #f9fafb;
  padding: 5pt 8pt;
  margin-bottom: 10pt;
  font-size: 8.6pt;
  color: #374151;
}
.part-title {
  font-size: 11.2pt;
  font-weight: 700;
  color: #0f172a;
  border-bottom: 1pt solid #4b5563;
  padding-bottom: 2.5pt;
  margin: 11pt 0 7pt 0;
}
.q-item {
  margin-bottom: 8.5pt;
  break-inside: avoid;
}
.q-stem {
  margin: 0 0 3.5pt 0;
  font-size: 9.8pt;
}
.q-stem-cont {
  margin: 2pt 0 3.5pt 14pt;
  font-size: 9.8pt;
}
.q-stem-table-wrap {
  margin: 4pt 0 5pt 14pt;
}
.q-stem-table-wrap .print-table {
  margin: 0;
  font-size: 8.4pt;
}
.q-num {
  font-weight: 700;
  color: #111827;
}
.q-meta {
  font-size: 8.2pt;
  color: #4b5563;
}
.opt-grid {
  width: 100%;
  border-collapse: collapse;
  margin: 2pt 0 3pt 14pt;
}
.opt-grid td {
  border: none;
  padding: 1.5pt 8pt 1.5pt 0;
  vertical-align: top;
  font-size: 9.2pt;
}
.opt-line {
  margin: 1.5pt 0 1.5pt 14pt;
  font-size: 9.2pt;
}
.answer-lines {
  margin: 5pt 0 4pt 14pt;
  height: 64pt;
}
.ans-header {
  text-align: center;
  border-bottom: 1.4pt solid #1d4ed8;
  padding-bottom: 6pt;
  margin-bottom: 10pt;
}
.ans-header-title {
  font-size: 14pt;
  font-weight: 700;
  color: #1e3a8a;
  margin: 0 0 3pt 0;
}
.ans-grid-table {
  width: 100%;
  border-collapse: collapse;
  margin: 6pt 0 10pt 0;
  font-size: 8.8pt;
  text-align: center;
}
.ans-grid-table th, .ans-grid-table td {
  border: 0.7pt solid #4b5563;
  padding: 3pt 4pt;
}
.ans-grid-table th {
  background-color: #eff6ff;
  font-weight: 700;
}
.ans-item {
  border-left: 2.2pt solid #2563eb;
  background-color: #f8fafc;
  padding: 5pt 8pt;
  margin-bottom: 6.5pt;
  font-size: 9pt;
}
.guide-masthead {
  border-top: 2pt solid #0f172a;
  border-bottom: 1pt solid #0f172a;
  padding: 8pt 0 7pt 0;
  margin-bottom: 10pt;
}
.guide-badge {
  font-size: 8.2pt;
  font-weight: 700;
  color: #1d4ed8;
  margin-bottom: 3pt;
}
.guide-title {
  font-size: 15pt;
  font-weight: 700;
  color: #0f172a;
  margin: 0 0 4pt 0;
}
.guide-meta-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 10pt;
  font-size: 8.6pt;
}
.guide-meta-table td {
  border: 0.6pt solid #cbd5e1;
  padding: 3.5pt 6pt;
  background-color: #f8fafc;
}
.md-h1 {
  font-size: 13.5pt;
  font-weight: 700;
  color: #0f172a;
  border-bottom: 1pt solid #cbd5e1;
  padding-bottom: 3pt;
  margin: 10pt 0 6pt 0;
}
.md-h2 {
  font-size: 11.6pt;
  font-weight: 700;
  color: #1e3a8a;
  border-left: 3pt solid #2563eb;
  padding-left: 6pt;
  margin: 11pt 0 5pt 0;
}
.md-h3 {
  font-size: 10.4pt;
  font-weight: 700;
  color: #111827;
  margin: 8pt 0 4pt 0;
}
.md-h3.example-heading {
  color: #9a3412;
  background-color: #fff7ed;
  border-left: 3pt solid #ea580c;
  padding: 3pt 6pt;
}
.md-h4 {
  font-size: 9.8pt;
  font-weight: 700;
  color: #374151;
  margin: 6pt 0 3pt 0;
}
.print-table {
  width: 100%;
  border-collapse: collapse;
  margin: 6pt 0 8pt 0;
  font-size: 8.6pt;
}
.print-table th, .print-table td {
  border: 0.6pt solid #94a3b8;
  padding: 3.5pt 5pt;
  text-align: left;
  vertical-align: top;
}
.print-table th {
  background-color: #f1f5f9;
  font-weight: 700;
}
.quote-box {
  border-left: 2.4pt solid #64748b;
  background-color: #f8fafc;
  padding: 4.5pt 8pt;
  margin: 4pt 0 6pt 0;
  font-size: 9pt;
  color: #334155;
}
.example-stem-box {
  border: 0.8pt solid #fdba74;
  background-color: #fffaf0;
  padding: 5pt 8pt;
  margin: 6pt 0 2pt 0;
  font-size: 9.5pt;
  color: #7c2d12;
}
.example-sol-box {
  border-left: 2.8pt solid #ea580c;
  background-color: #fff7ed;
  padding: 5pt 8pt;
  margin: 0 0 7pt 0;
  font-size: 9pt;
  color: #334155;
}
.print-list {
  margin: 3pt 0 6pt 14pt;
  padding-left: 6pt;
}
.print-list li {
  margin-bottom: 2.5pt;
}
.code-box {
  border: 0.6pt solid #cbd5e1;
  background-color: #f8fafc;
  padding: 5pt 7pt;
  font-size: 8.2pt;
  font-family: Consolas, "Courier New", monospace;
  margin: 5pt 0;
  white-space: pre-wrap;
}
.math {
  font-family: "Cambria Math", "Times New Roman", "Microsoft YaHei", serif;
}
.math sup, .math sub {
  font-size: 66%;
}
.math-display {
  font-size: 10.5pt;
}
.math-block {
  text-align: center;
  margin: 5pt 0;
  font-size: 10pt;
}
.map-list {
  margin: 3pt 0 4pt 12pt;
  padding-left: 8pt;
  font-size: 9.2pt;
}
.map-list li {
  margin-bottom: 1.5pt;
}
.map-title {
  font-size: 8.6pt;
  color: #475569;
  margin: 5pt 0 2pt 0;
}
.section-rule {
  border: none;
  border-top: 0.6pt solid #e2e8f0;
  margin: 7pt 0;
}
.figure-wrap {
  text-align: center;
  margin: 6pt 0;
}
.figure-wrap img {
  max-width: 82%;
  max-height: 170pt;
  border: 0.6pt solid #cbd5e1;
}
.figure-cap {
  font-size: 8pt;
  color: #4b5563;
  margin-top: 2pt;
}
.fig-ref {
  font-size: 8.5pt;
  color: #4b5563;
}
code {
  background-color: #f1f5f9;
  padding: 0.5pt 2.5pt;
  font-family: Consolas, monospace;
  font-size: 8.6pt;
}
"""


def _build_quiz_exam_html(
    doc_ir: DocumentIR,
    package: StudyPackage,
    *,
    paper_size: PaperSize,
    assets_dir: Optional[Path] = None,
    quiz_override: Optional[Any] = None,
) -> str:
    quiz = quiz_override or package.quiz_paper
    mcqs = [q for q in quiz.questions if q.type == "mcq"]
    fills = [q for q in quiz.questions if q.type == "fill_blank"]
    shorts = [q for q in quiz.questions if q.type == "short_answer"]

    parts: List[str] = []
    # Masthead
    paper_tag = "A3 横版双栏标准卷" if paper_size == "a3" else "A4 标准印刷卷"
    parts.append(
        f"""
        <div class="exam-header">
          <div class="exam-title">{_format_inline_text(quiz.title, None)}</div>
          <div class="exam-subtitle">
            {paper_tag} ｜ 命题范围：{html.escape(doc_ir.filename)} ｜ 考试用时：{quiz.suggested_minutes} 分钟 ｜ 满分：{quiz.total_score} 分
          </div>
        </div>
        """
    )

    if paper_size == "a4":
        parts.append(
            '<div class="student-line">学校：______________ &nbsp;&nbsp; 班级：____________ &nbsp;&nbsp; 姓名：____________ &nbsp;&nbsp; 学号：______________</div>'
        )

    # Score Matrix
    mcq_total = sum(q.score for q in mcqs)
    fill_total = sum(q.score for q in fills)
    short_total = sum(q.score for q in shorts)
    parts.append(
        f"""
        <table class="score-table">
          <tr>
            <th>题号</th>
            <th>一、选择题（{len(mcqs)}题 / {mcq_total}分）</th>
            <th>二、填空题（{len(fills)}题 / {fill_total}分）</th>
            <th>三、简答分析（{len(shorts)}题 / {short_total}分）</th>
            <th>总分（{quiz.total_score}分）</th>
            <th>复核人</th>
          </tr>
          <tr>
            <td><strong>得分</strong></td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>
          </tr>
        </table>
        """
    )

    parts.append(
        f'<div class="notice-box"><strong>考生注意：</strong>{_format_inline_text(quiz.instructions, None)} 请将答案规范书写在题后或作答区内，参考答案与教材溯源解析附于本卷末页。</div>'
    )

    q_global_num = 0

    def _render_question_block(q: QuizQuestion, num: int) -> str:
        prefix = f'<span class="q-num">{num}.</span> <span class="q-meta">[{q.score}分 · {html.escape(q.tier)}]</span> '
        if q.type == "mcq":
            # Add right-hand parenthesis if question lacks one
            paren_tail = (
                ""
                if ("（）" in q.question or "（ ）" in q.question or "( )" in q.question)
                else " &nbsp;（ &nbsp;&nbsp;&nbsp; ）"
            )
            stem_block_html = _render_question_stem_html(
                q.question,
                prefix_html=prefix,
                tail_html=paren_tail,
                assets_dir=assets_dir,
            )
            opt_cells = ""
            if q.options:
                max_len = max(len(o) for o in q.options)
                if max_len <= 22 and len(q.options) == 4:
                    opt_cells = (
                        '<table class="opt-grid">'
                        f"<tr><td>{_format_inline_text(q.options[0], assets_dir)}</td><td>{_format_inline_text(q.options[1], assets_dir)}</td></tr>"
                        f"<tr><td>{_format_inline_text(q.options[2], assets_dir)}</td><td>{_format_inline_text(q.options[3], assets_dir)}</td></tr>"
                        "</table>"
                    )
                else:
                    opt_cells = "".join(
                        f'<div class="opt-line">{_format_inline_text(o, assets_dir)}</div>'
                        for o in q.options
                    )
            return (
                '<div class="q-item">'
                f"{stem_block_html}"
                f"{opt_cells}"
                "</div>"
            )
        if q.type == "fill_blank":
            stem_block_html = _render_question_stem_html(
                q.question,
                prefix_html=prefix,
                assets_dir=assets_dir,
                underline_blanks=True,
            )
            return (
                '<div class="q-item">'
                f"{stem_block_html}"
                "</div>"
            )
        stem_block_html = _render_question_stem_html(
            q.question,
            prefix_html=prefix,
            assets_dir=assets_dir,
        )
        return (
            '<div class="q-item">'
            f"{stem_block_html}"
            '<div class="answer-lines">&nbsp;</div>'
            "</div>"
        )

    part_idx = 1
    cn_nums = ["一", "二", "三", "四"]

    if mcqs:
        parts.append(
            f'<div class="part-title">{cn_nums[part_idx - 1]}、单项选择题（本大题共 {len(mcqs)} 小题，共 {mcq_total} 分）</div>'
        )
        part_idx += 1
        for q in mcqs:
            q_global_num += 1
            parts.append(_render_question_block(q, q_global_num))

    if fills:
        parts.append(
            f'<div class="part-title">{cn_nums[part_idx - 1]}、填空题（本大题共 {len(fills)} 小题，共 {fill_total} 分）</div>'
        )
        part_idx += 1
        for q in fills:
            q_global_num += 1
            parts.append(_render_question_block(q, q_global_num))

    if shorts:
        parts.append(
            f'<div class="part-title">{cn_nums[part_idx - 1]}、简答与综合分析题（本大题共 {len(shorts)} 小题，共 {short_total} 分）</div>'
        )
        part_idx += 1
        for q in shorts:
            q_global_num += 1
            parts.append(_render_question_block(q, q_global_num))

    return "\n".join(parts)


def _build_quiz_answers_html(
    package: StudyPackage,
    *,
    assets_dir: Optional[Path] = None,
    quiz_override: Optional[Any] = None,
) -> str:
    quiz = quiz_override or package.quiz_paper
    ordered_qs: List[QuizQuestion] = (
        [q for q in quiz.questions if q.type == "mcq"]
        + [q for q in quiz.questions if q.type == "fill_blank"]
        + [q for q in quiz.questions if q.type == "short_answer"]
    )
    parts: List[str] = [
        f"""
        <div class="ans-header">
          <div class="ans-header-title">{html.escape(quiz.title)} · 参考答案与教材溯源解析</div>
          <div class="exam-subtitle">满分 {quiz.total_score} 分 ｜ 共 {len(ordered_qs)} 题 ｜ 供阅卷与自查核对使用</div>
        </div>
        """
    ]

    # Quick Answer Table for MCQs
    mcqs_indexed = [(i + 1, q) for i, q in enumerate(ordered_qs) if q.type == "mcq"]
    if mcqs_indexed:
        ths = "".join(f"<th>第{num}题</th>" for num, _ in mcqs_indexed)
        tds = "".join(f"<td><strong>{html.escape(q.answer)}</strong></td>" for _, q in mcqs_indexed)
        parts.append(
            f"""
            <div class="part-title">选择题快速对答案总览</div>
            <table class="ans-grid-table">
              <tr><th>题号</th>{ths}</tr>
              <tr><td><strong>标准答案</strong></td>{tds}</tr>
            </table>
            """
        )

    parts.append('<div class="part-title">逐题详细解析与教材出处溯源</div>')
    for idx, q in enumerate(ordered_qs, start=1):
        type_cn = "单选" if q.type == "mcq" else ("填空" if q.type == "fill_blank" else "简答")
        norm_exp = normalize_markdown_math(q.explanation or "")
        if "\n" in norm_exp and "|" in norm_exp:
            exp_html = f'<div style="margin-top:3pt;">{_markdown_to_print_html(q.explanation, assets_dir=assets_dir)}</div>'
        else:
            exp_html = _format_inline_text(q.explanation, assets_dir)
        parts.append(
            f"""
            <div class="ans-item">
              <div><strong>第 {idx} 题（{type_cn} · {q.score}分 · {html.escape(q.tier)}）</strong>
                <span style="color:#475569;"> — 来源：{html.escape(q.source_chapter)} {html.escape(q.source_page)}</span>
              </div>
              <div style="margin-top:2pt;"><strong>参考答案：</strong>{_format_inline_text(q.answer, assets_dir)}</div>
              <div style="margin-top:2pt;"><strong>详细解析：</strong>{exp_html}</div>
            </div>
            """
        )

    return "\n".join(parts)


def export_quiz_pdf_bytes(
    doc_ir: DocumentIR,
    package: StudyPackage,
    *,
    paper_size: PaperSize = "a4",
    include_answers: bool = True,
    assets_dir: Optional[Path] = None,
    quiz_override: Optional[Any] = None,
) -> bytes:
    """Export interactive quiz paper as a standalone print-ready A4 or A3 sealed two-column PDF."""
    active_quiz = quiz_override or package.quiz_paper
    exam_html = _build_quiz_exam_html(
        doc_ir, package, paper_size=paper_size, assets_dir=assets_dir, quiz_override=active_quiz
    )
    exam_doc, _ = _render_story_to_doc(
        exam_html,
        css=_BASE_PRINT_CSS,
        paper_size=paper_size,
        assets_dir=assets_dir,
        seal_margin=(paper_size == "a3"),
    )
    _decorate_pages(
        exam_doc,
        paper_size=paper_size,
        seal_margin=(paper_size == "a3"),
        doc_footer_label="试卷正文 · ",
    )

    if include_answers and active_quiz.questions:
        ans_html = _build_quiz_answers_html(package, assets_dir=assets_dir, quiz_override=active_quiz)
        ans_doc, _ = _render_story_to_doc(
            ans_html,
            css=_BASE_PRINT_CSS,
            paper_size=paper_size,
            assets_dir=assets_dir,
            seal_margin=False,
        )
        _decorate_pages(
            ans_doc,
            paper_size=paper_size,
            seal_margin=False,
            doc_footer_label="参考答案与解析 · ",
        )
        exam_doc.insert_pdf(ans_doc)
        ans_doc.close()

    pdf_bytes = exam_doc.tobytes(garbage=3, deflate=True)
    exam_doc.close()
    return pdf_bytes


def _build_study_guide_companion_examples_html(
    package: StudyPackage,
    *,
    assets_dir: Optional[Path] = None,
) -> str:
    """Append companion practice exercises & full solutions to the self-study guide PDF."""
    qs = package.quiz_paper.questions
    if not qs:
        return ""
    parts: List[str] = [
        '<hr class="section-rule" />',
        '<h2 class="md-h2">配套典型例题演练与完整解析（随讲义附带）</h2>',
        '<p style="font-size:9pt;color:#475569;">以下精选习题紧扣本自学案重难点，建议先独立完成再核对下方思路引导与参考解析。</p>',
    ]
    for idx, q in enumerate(qs, start=1):
        type_cn = "单选" if q.type == "mcq" else ("填空" if q.type == "fill_blank" else "简答")
        opts_html = ""
        if q.options:
            opts_html = "<div style='margin:2pt 0 3pt 10pt;font-size:9pt;'>" + " &nbsp;&nbsp; ".join(
                _format_inline_text(o, assets_dir) for o in q.options
            ) + "</div>"
        parts.append(
            f"""
            <div class="example-stem-box">
              <strong>【配套演练 {idx}｜{type_cn} · {html.escape(q.tier)} · {q.score}分】</strong>
              {_format_inline_text(q.question, assets_dir)}
              {opts_html}
            </div>
            <div class="example-sol-box">
              <div><strong>参考答案：</strong>{_format_inline_text(q.answer, assets_dir)}</div>
              <div style="margin-top:2pt;"><strong>思路与详细解析：</strong>{_format_inline_text(q.explanation, assets_dir)}
                <span style="color:#64748b;">（溯源：{html.escape(q.source_chapter)} {html.escape(q.source_page)}）</span>
              </div>
            </div>
            """
        )
    return "\n".join(parts)


def export_study_guide_pdf_bytes(
    doc_ir: DocumentIR,
    package: StudyPackage,
    *,
    paper_size: PaperSize = "a4",
    include_answers: bool = True,
    assets_dir: Optional[Path] = None,
) -> bytes:
    """Export Self-Study Guide / Study Notes in a dedicated printable booklet layout (NOT web UI layout)."""
    bp = package.blueprint_used
    sel_chapters = [c for c in doc_ir.chapters if c.chapter_id in bp.selected_chapter_ids] or doc_ir.chapters
    chap_str = "、".join(c.title for c in sel_chapters[:5]) + (" 等" if len(sel_chapters) > 5 else "")
    focus_str = " · ".join(bp.focus_topics[:8]) or "全章核心知识点"

    masthead = f"""
    <div class="guide-masthead">
      <div class="guide-badge">AUTO STUDY GUIDANCE · 正式印刷版自主导学讲义（{"A3 双栏版" if paper_size == "a3" else "A4 讲义版"}）</div>
      <div class="guide-title">{html.escape(bp.blueprint_title)}</div>
    </div>
    <table class="guide-meta-table">
      <tr>
        <td><strong>原始教材</strong>：{html.escape(doc_ir.filename)}</td>
        <td><strong>模板类型</strong>：{html.escape(bp.preset_name)}（难度：{html.escape(bp.target_difficulty)}）</td>
      </tr>
      <tr>
        <td><strong>覆盖章节</strong>：{html.escape(chap_str)}（共 {len(sel_chapters)} 章）</td>
        <td><strong>核心聚焦</strong>：{html.escape(focus_str)}</td>
      </tr>
    </table>
    """

    notes_md = strip_document_images(package.study_notes_markdown or "暂无导学笔记正文。")
    notes_html = _markdown_to_print_html(notes_md, assets_dir=assets_dir, highlight_examples=True)
    examples_html = (
        _build_study_guide_companion_examples_html(package, assets_dir=assets_dir)
        if include_answers
        else ""
    )

    doc, _ = _render_story_to_doc(
        masthead + notes_html + examples_html,
        css=_BASE_PRINT_CSS,
        paper_size=paper_size,
        assets_dir=assets_dir,
        seal_margin=False,
    )
    _decorate_pages(
        doc,
        paper_size=paper_size,
        seal_margin=False,
        doc_footer_label="导学讲义（含典型例题与解析） · ",
    )
    pdf_bytes = doc.tobytes(garbage=3, deflate=True)
    doc.close()
    return pdf_bytes


def export_cheatsheet_pdf_bytes(
    doc_ir: DocumentIR,
    package: StudyPackage,
    *,
    paper_size: PaperSize = "a4",
    assets_dir: Optional[Path] = None,
) -> bytes:
    """Export Cheat Sheet as a crisp printable A4 or A3 reference card PDF."""
    cs_md = strip_document_images(package.cheatsheet_markdown or "暂无考前速记表内容。")
    header = f"""
    <div class="guide-masthead">
      <div class="guide-badge">HIGH-DENSITY EXAM CHEAT SHEET · 考前冲刺速记手册</div>
      <div class="guide-title">{html.escape(doc_ir.filename)} · 考前速记表</div>
    </div>
    """
    cs_html = _markdown_to_print_html(cs_md, assets_dir=assets_dir, highlight_examples=False)
    doc, _ = _render_story_to_doc(
        header + cs_html,
        css=_BASE_PRINT_CSS,
        paper_size=paper_size,
        assets_dir=assets_dir,
        seal_margin=False,
    )
    _decorate_pages(
        doc,
        paper_size=paper_size,
        seal_margin=False,
        doc_footer_label="考前速记表 · ",
    )
    pdf_bytes = doc.tobytes(garbage=3, deflate=True)
    doc.close()
    return pdf_bytes
