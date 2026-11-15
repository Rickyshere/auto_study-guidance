"""Pre-baked inline SVG visual compiler and 3-level self-healing fallback engine.

Compiles ECharts JSON configs, SMILES / Reaction SMILES, Mermaid diagrams,
parameterized SVG diagrams, and cropped image references into self-contained
static `<svg>` or Base64 DataURL strings so online interactive practice and A4/A3
PDF export render identically without runtime canvas or network dependencies.
"""

from __future__ import annotations

import base64
import html
import json
import math
import mimetypes
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional, Sequence, Tuple

from app.schemas import DocumentIR, QuestionFigureBlock, VisualBlueprint

# Triple-encoding palette for both online high-contrast viewing & monochrome print
_SERIES_STYLES: List[Dict[str, str]] = [
    {"stroke": "#111827", "dash": "", "width": "2.5", "marker": "circle", "name": "a"},
    {"stroke": "#B91C1C", "dash": "6,4", "width": "2.0", "marker": "triangle", "name": "b"},
    {"stroke": "#1D4ED8", "dash": "2,3", "width": "2.2", "marker": "square", "name": "c"},
    {"stroke": "#047857", "dash": "8,3,2,3", "width": "2.0", "marker": "diamond", "name": "d"},
]

_FONT_STACK = "Microsoft YaHei, SimSun, sans-serif"

try:
    from rdkit import Chem  # type: ignore
    from rdkit.Chem.Draw import rdMolDraw2D  # type: ignore

    _HAS_RDKIT = True
except Exception:
    Chem = None  # type: ignore
    rdMolDraw2D = None  # type: ignore
    _HAS_RDKIT = False


def _esc(val: Any) -> str:
    return html.escape(str(val or ""), quote=True)


def _strip_code_fence(raw: str) -> str:
    s = (raw or "").strip()
    m = re.match(r"^```[A-Za-z0-9_-]*\s*\n([\s\S]*?)\n?```\s*$", s)
    return m.group(1).strip() if m else s


def _parse_json_lenient(raw: str) -> Any:
    s = _strip_code_fence(raw)
    if re.search(r"\bfunction\s*\(", s) or "=>" in s:
        raise ValueError("ECharts 配置禁止包含 JavaScript 函数或箭头函数回调，请输出纯 JSON。")
    return json.loads(s)


def _nice_ticks(vmin: float, vmax: float, count: int = 5) -> List[float]:
    if not math.isfinite(vmin) or not math.isfinite(vmax):
        return [0.0, 1.0]
    if abs(vmax - vmin) < 1e-9:
        pad = 1.0 if vmin == 0 else abs(vmin) * 0.2
        vmin, vmax = vmin - pad, vmax + pad
    span = vmax - vmin
    raw_step = span / max(2, count - 1)
    mag = 10 ** math.floor(math.log10(raw_step))
    norm = raw_step / mag
    if norm <= 1.5:
        step = 1.0 * mag
    elif norm <= 3.0:
        step = 2.0 * mag
    elif norm <= 7.0:
        step = 5.0 * mag
    else:
        step = 10.0 * mag
    start = math.floor(vmin / step) * step
    ticks: List[float] = []
    cur = start
    while cur <= vmax + step * 0.01 and len(ticks) < 12:
        ticks.append(0.0 if abs(cur) < 1e-12 else cur)
        cur += step
    if len(ticks) < 2:
        ticks = [vmin, vmax]
    return ticks


def _fmt_num(v: float) -> str:
    if abs(v) < 1e-9:
        return "0"
    if abs(v - round(v)) < 1e-6:
        return str(int(round(v)))
    return f"{v:.2g}"


def _marker_svg(marker: str, x: float, y: float, stroke: str, idx: int) -> str:
    if marker == "circle":
        return f'<circle cx="{x:.1f}" cy="{y:.1f}" r="3.2" fill="{stroke}"/>'
    if marker == "triangle":
        pts = f"{x:.1f},{y - 4:.1f} {x - 3.6:.1f},{y + 3:.1f} {x + 3.6:.1f},{y + 3:.1f}"
        return f'<polygon points="{pts}" fill="#FFFFFF" stroke="{stroke}" stroke-width="1.6"/>'
    if marker == "square":
        return (
            f'<rect x="{x - 3:.1f}" y="{y - 3:.1f}" width="6" height="6" '
            f'fill="#FFFFFF" stroke="{stroke}" stroke-width="1.6"/>'
        )
    pts = f"{x:.1f},{y - 4:.1f} {x + 3.8:.1f},{y:.1f} {x:.1f},{y + 4:.1f} {x - 3.8:.1f},{y:.1f}"
    return f'<polygon points="{pts}" fill="#FFFFFF" stroke="{stroke}" stroke-width="1.5"/>'


def _extract_echarts_series_points(
    series_list: List[Dict[str, Any]],
    x_categories: Optional[List[Any]],
) -> Tuple[List[List[Tuple[float, float]]], float, float, float, float]:
    parsed_series: List[List[Tuple[float, float]]] = []
    xs: List[float] = []
    ys: List[float] = []
    for s in series_list:
        data = s.get("data")
        if not isinstance(data, list) or not data:
            raise ValueError("ECharts series.data 必须是非空数组。")
        pts: List[Tuple[float, float]] = []
        for idx, pt in enumerate(data):
            if isinstance(pt, (list, tuple)) and len(pt) >= 2:
                xv, yv = float(pt[0]), float(pt[1])
            elif isinstance(pt, dict) and "value" in pt:
                val = pt["value"]
                if isinstance(val, (list, tuple)) and len(val) >= 2:
                    xv, yv = float(val[0]), float(val[1])
                else:
                    xv, yv = float(idx), float(val)
            else:
                xv = float(x_categories[idx]) if (x_categories and _is_float(x_categories[idx])) else float(idx)
                yv = float(pt)
            if not (math.isfinite(xv) and math.isfinite(yv)):
                raise ValueError("ECharts 采样点包含非有限数值。")
            pts.append((xv, yv))
            xs.append(xv)
            ys.append(yv)
        parsed_series.append(pts)
    xmin, xmax = min(xs), max(xs)
    ymin, ymax = min(ys), max(ys)
    if ymin > 0 and ymin < ymax * 0.25:
        ymin = 0.0
    return parsed_series, xmin, xmax, ymin, ymax


def _is_float(v: Any) -> bool:
    try:
        float(v)
        return True
    except (TypeError, ValueError):
        return False


def compile_echarts_to_svg(option_or_str: Any, is_sub_option: bool = False) -> str:
    """Compile an ECharts JSON option object into a publication-grade static SVG."""
    if isinstance(option_or_str, str):
        option = _parse_json_lenient(option_or_str)
    elif isinstance(option_or_str, dict):
        option = option_or_str
    else:
        raise ValueError("ECharts 配置必须是 JSON 字符串或字典对象。")

    if not isinstance(option, dict):
        raise ValueError("ECharts 顶层结构必须是 JSON 对象。")
    series_raw = option.get("series")
    if not isinstance(series_raw, list) or not series_raw:
        raise ValueError("ECharts 配置缺少有效的 series 数组。")

    w, h = (280, 200) if is_sub_option else (500, 320)
    x_axis = option.get("xAxis") if isinstance(option.get("xAxis"), dict) else {}
    y_axis = option.get("yAxis") if isinstance(option.get("yAxis"), dict) else {}
    if isinstance(option.get("xAxis"), list) and option["xAxis"]:
        x_axis = option["xAxis"][0] or {}
    if isinstance(option.get("yAxis"), list) and option["yAxis"]:
        y_axis = option["yAxis"][0] or {}

    x_categories = x_axis.get("data") if isinstance(x_axis.get("data"), list) else None
    parsed_series, xmin, xmax, ymin, ymax = _extract_echarts_series_points(series_raw, x_categories)

    if _is_float(x_axis.get("min")):
        xmin = float(x_axis["min"])
    if _is_float(x_axis.get("max")):
        xmax = float(x_axis["max"])
    if _is_float(y_axis.get("min")):
        ymin = float(y_axis["min"])
    if _is_float(y_axis.get("max")):
        ymax = float(y_axis["max"])

    xticks = _nice_ticks(xmin, xmax, 4 if is_sub_option else 6)
    yticks = _nice_ticks(ymin, ymax, 4 if is_sub_option else 5)
    px0, px1 = (xticks[0], xticks[-1]) if xticks else (xmin, xmax)
    py0, py1 = (yticks[0], yticks[-1]) if yticks else (ymin, ymax)
    if abs(px1 - px0) < 1e-9:
        px1 = px0 + 1.0
    if abs(py1 - py0) < 1e-9:
        py1 = py0 + 1.0

    pad_l = 42 if is_sub_option else 62
    pad_r = 24 if is_sub_option else 46
    pad_t = 22 if is_sub_option else 42
    pad_b = 34 if is_sub_option else 46
    gw = w - pad_l - pad_r
    gh = h - pad_t - pad_b

    def sx(x: float) -> float:
        return pad_l + ((x - px0) / (px1 - px0)) * gw

    def sy(y: float) -> float:
        return pad_t + gh - ((y - py0) / (py1 - py0)) * gh

    elems: List[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="100%" height="100%" '
        f'style="font-family:{_FONT_STACK};">',
        f'<rect x="0" y="0" width="{w}" height="{h}" fill="#FFFFFF"/>',
    ]

    title_obj = option.get("title") if isinstance(option.get("title"), dict) else {}
    title_text = str(title_obj.get("text") or "").strip()
    if title_text and not is_sub_option:
        elems.append(
            f'<text x="{w / 2:.1f}" y="20" text-anchor="middle" font-size="13" font-weight="700" '
            f'fill="#111827">{_esc(title_text)}</text>'
        )

    # Grid lines & ticks
    font_tick = 10 if is_sub_option else 11
    for yv in yticks:
        yy = sy(yv)
        elems.append(
            f'<line x1="{pad_l}" y1="{yy:.1f}" x2="{pad_l + gw}" y2="{yy:.1f}" '
            f'stroke="#E5E7EB" stroke-width="1"/>'
        )
        elems.append(
            f'<text x="{pad_l - 6}" y="{yy + 3.5:.1f}" text-anchor="end" font-size="{font_tick}" '
            f'fill="#4B5563">{_esc(_fmt_num(yv))}</text>'
        )

    if x_categories and len(x_categories) <= 10:
        step_x = max(1, len(x_categories) // (4 if is_sub_option else 6))
        for idx in range(0, len(x_categories), step_x):
            xx = sx(float(idx))
            elems.append(
                f'<line x1="{xx:.1f}" y1="{pad_t + gh}" x2="{xx:.1f}" y2="{pad_t + gh + 4}" '
                f'stroke="#111827" stroke-width="1"/>'
            )
            elems.append(
                f'<text x="{xx:.1f}" y="{pad_t + gh + 16}" text-anchor="middle" font-size="{font_tick}" '
                f'fill="#4B5563">{_esc(x_categories[idx])}</text>'
            )
    else:
        for xv in xticks:
            xx = sx(xv)
            elems.append(
                f'<line x1="{xx:.1f}" y1="{pad_t}" x2="{xx:.1f}" y2="{pad_t + gh}" '
                f'stroke="#F3F4F6" stroke-width="1"/>'
            )
            elems.append(
                f'<line x1="{xx:.1f}" y1="{pad_t + gh}" x2="{xx:.1f}" y2="{pad_t + gh + 4}" '
                f'stroke="#111827" stroke-width="1"/>'
            )
            elems.append(
                f'<text x="{xx:.1f}" y="{pad_t + gh + 16}" text-anchor="middle" font-size="{font_tick}" '
                f'fill="#4B5563">{_esc(_fmt_num(xv))}</text>'
            )

    # Axes lines with arrows
    ax_x0, ax_y0 = pad_l, pad_t + gh
    elems.append(f'<line x1="{ax_x0}" y1="{ax_y0}" x2="{pad_l + gw + 6}" y2="{ax_y0}" stroke="#111827" stroke-width="1.5"/>')
    elems.append(f'<line x1="{ax_x0}" y1="{ax_y0}" x2="{ax_x0}" y2="{pad_t - 6}" stroke="#111827" stroke-width="1.5"/>')

    # Axis names
    x_name = str(x_axis.get("name") or "").strip()
    y_name = str(y_axis.get("name") or "").strip()
    axis_fs = 10 if is_sub_option else 12
    if x_name:
        elems.append(
            f'<text x="{pad_l + gw / 2:.1f}" y="{h - 6}" text-anchor="middle" font-size="{axis_fs}" '
            f'font-weight="600" fill="#111827">{_esc(x_name)}</text>'
        )
    if y_name:
        elems.append(
            f'<text x="{pad_l - 8}" y="{pad_t - 12}" text-anchor="start" font-size="{axis_fs}" '
            f'font-weight="600" fill="#111827">{_esc(y_name)}</text>'
        )

    # Draw curves & triple encodings
    placed_labels: List[Tuple[float, float]] = []
    for s_idx, (s_cfg, pts) in enumerate(zip(series_raw, parsed_series)):
        style = _SERIES_STYLES[s_idx % len(_SERIES_STYLES)]
        item_st = s_cfg.get("lineStyle") if isinstance(s_cfg.get("lineStyle"), dict) else {}
        stroke = style["stroke"]
        dash_attr = f' stroke-dasharray="{style["dash"]}"' if style["dash"] else ""
        if str(item_st.get("type") or "").lower() == "dashed" and not dash_attr:
            dash_attr = ' stroke-dasharray="6,4"'

        poly_pts = " ".join(f"{sx(px):.1f},{sy(py):.1f}" for px, py in pts)
        elems.append(
            f'<polyline fill="none" stroke="{stroke}" stroke-width="{style["width"]}"'
            f'{dash_attr} stroke-linejoin="round" stroke-linecap="round" points="{poly_pts}"/>'
        )

        # Sampled data markers (sparse so curves stay crisp)
        stride = max(1, len(pts) // (5 if is_sub_option else 7))
        for idx in range(0, len(pts), stride):
            elems.append(_marker_svg(style["marker"], sx(pts[idx][0]), sy(pts[idx][1]), stroke, s_idx))

        # End label / short series symbol (a, b, c)
        end_lbl_obj = s_cfg.get("endLabel") if isinstance(s_cfg.get("endLabel"), dict) else {}
        show_end = end_lbl_obj.get("show", len(series_raw) > 1 and not is_sub_option)
        short_tag = str(s_cfg.get("name") or style["name"]).strip()
        if len(short_tag) > 6:
            short_tag = style["name"]
        if show_end and short_tag and pts:
            ex = min(w - 10.0, sx(pts[-1][0]) + 8.0)
            ey = sy(pts[-1][1]) + 4.0
            for lx, ly in placed_labels:
                if abs(ex - lx) < 18 and abs(ey - ly) < 14:
                    ey += 14.0
            placed_labels.append((ex, ey))
            elems.append(
                f'<text x="{ex:.1f}" y="{ey:.1f}" font-size="{11 if is_sub_option else 12}" '
                f'font-weight="700" fill="{stroke}">{_esc(short_tag)}</text>'
            )

        # markPoint annotations (P1, P2, etc.)
        mp = s_cfg.get("markPoint") if isinstance(s_cfg.get("markPoint"), dict) else {}
        mp_data = mp.get("data") if isinstance(mp.get("data"), list) else []
        for m_item in mp_data:
            if not isinstance(m_item, dict):
                continue
            coord = m_item.get("coord")
            if isinstance(coord, (list, tuple)) and len(coord) >= 2 and _is_float(coord[0]) and _is_float(coord[1]):
                mx, my = sx(float(coord[0])), sy(float(coord[1]))
                lbl = m_item.get("label") if isinstance(m_item.get("label"), dict) else {}
                lbl_text = str(lbl.get("formatter") or m_item.get("name") or "").strip()
                elems.append(f'<circle cx="{mx:.1f}" cy="{my:.1f}" r="4.2" fill="#FFFFFF" stroke="{stroke}" stroke-width="2"/>')
                if lbl_text:
                    ty = my - 10.0
                    for lx, ly in placed_labels:
                        if abs(mx - lx) < 22 and abs(ty - ly) < 14:
                            ty = my + 16.0
                    placed_labels.append((mx, ty))
                    elems.append(
                        f'<text x="{mx + 6:.1f}" y="{ty:.1f}" font-size="11" font-weight="700" '
                        f'fill="#111827">{_esc(lbl_text)}</text>'
                    )

    elems.append("</svg>")
    return "\n".join(elems)


# -------------------- SMILES Validator & Pure-Python 2D SVG Renderer --------------------

_SMILES_TOKEN_RE = re.compile(
    r"(\[[^\]]+\]|Br|Cl|Si|Se|@@|@|=|#|:|/|\\|\(|\)|%[0-9]{2}|[0-9]|[A-Za-z*+\-.])"
)
_ORGANIC_ELEMENTS = {"B", "C", "N", "O", "P", "S", "F", "Cl", "Br", "I", "b", "c", "n", "o", "p", "s"}


def _validate_smiles_piece(piece: str) -> List[str]:
    if not piece:
        raise ValueError("SMILES 片段不能为空。")
    tokens = _SMILES_TOKEN_RE.findall(piece)
    if "".join(tokens) != piece:
        raise ValueError(f"SMILES 存在非法字符: {piece}")
    depth = 0
    open_rings: set[str] = set()
    atoms: List[Dict[str, Any]] = []
    next_bond = 1
    prev_atom: Optional[int] = None
    stack: List[Optional[int]] = []

    for tok in tokens:
        if tok == "(":
            depth += 1
            stack.append(prev_atom)
        elif tok == ")":
            depth -= 1
            if depth < 0 or not stack:
                raise ValueError(f"SMILES 括号不配对: {piece}")
            prev_atom = stack.pop()
            next_bond = 1
        elif tok == "=":
            next_bond = 2
        elif tok == "#":
            next_bond = 3
        elif tok in ("-", "/", "\\", ":"):
            next_bond = 1
        elif tok.isdigit() or tok.startswith("%"):
            if tok in open_rings:
                open_rings.remove(tok)
            else:
                open_rings.add(tok)
            if prev_atom is not None:
                atoms[prev_atom]["valence"] += next_bond
            next_bond = 1
        elif tok.startswith("[") or tok in _ORGANIC_ELEMENTS:
            elem = tok.strip("[]")
            idx = len(atoms)
            atoms.append({"elem": elem, "valence": 0})
            if prev_atom is not None:
                atoms[prev_atom]["valence"] += next_bond
                atoms[idx]["valence"] += next_bond
            prev_atom = idx
            next_bond = 1
        elif tok in (".", ">", "@", "@@"):
            if tok == ".":
                prev_atom = None
                next_bond = 1
        else:
            raise ValueError(f"无法识别的 SMILES 记号: {tok}")

    if depth != 0:
        raise ValueError(f"SMILES 括号未闭合: {piece}")
    if open_rings:
        raise ValueError(f"SMILES 环闭合数字未成对: {sorted(open_rings)}")
    if not atoms:
        raise ValueError(f"SMILES 未包含任何有效原子: {piece}")
    for a in atoms:
        if a["elem"] == "C" and a["valence"] > 4:
            raise ValueError(f"SMILES 违反碳四价规则（检测到成键数 {a['valence']}）: {piece}")
    return tokens


def _layout_smiles_molecule(piece: str) -> Tuple[List[Dict[str, Any]], List[Tuple[int, int, int]]]:
    """Deterministic 2D skeletal coordinates for standard SMILES rings & chains."""
    tokens = _validate_smiles_piece(piece)
    nodes: List[Dict[str, Any]] = []
    edges: List[Tuple[int, int, int]] = []
    ring_anchors: Dict[str, Tuple[int, int]] = {}
    stack: List[Tuple[Optional[int], float]] = []
    prev_idx: Optional[int] = None
    cur_angle = 0.0
    next_bond = 1
    bond_len = 34.0

    def _add_atom(label: str, pos: Tuple[float, float]) -> int:
        idx = len(nodes)
        nodes.append({"label": label, "x": pos[0], "y": pos[1]})
        return idx

    # Detect benzene / cyclohexane ring anchor hints and lay out bonds with zigzag/ring geometry
    branch_dir = 1
    for tok in tokens:
        if tok == "(":
            stack.append((prev_idx, cur_angle))
            cur_angle = cur_angle + branch_dir * math.radians(60)
            branch_dir *= -1
        elif tok == ")":
            if stack:
                prev_idx, cur_angle = stack.pop()
            next_bond = 1
        elif tok == "=":
            next_bond = 2
        elif tok == "#":
            next_bond = 3
        elif tok in ("-", "/", "\\", ":"):
            next_bond = 1
        elif tok == ".":
            prev_idx = None
            cur_angle = 0.0
            next_bond = 1
        elif tok in ("@", "@@"):
            continue
        elif tok.isdigit() or tok.startswith("%"):
            if prev_idx is None:
                continue
            if tok in ring_anchors:
                target_idx, b_order = ring_anchors.pop(tok)
                edges.append((prev_idx, target_idx, max(b_order, next_bond)))
            else:
                ring_anchors[tok] = (prev_idx, next_bond)
            next_bond = 1
        else:
            label = tok
            if tok in ("C", "c"):
                label = ""
            elif tok.startswith("["):
                label = tok[1:-1].replace("@@", "").replace("@", "")
            else:
                label = tok.upper() if tok in ("n", "o", "s") else tok

            if prev_idx is None:
                new_idx = _add_atom(label, (0.0, 0.0))
            else:
                px, py = nodes[prev_idx]["x"], nodes[prev_idx]["y"]
                # If inside a 6-membered ring context, advance 60 deg turns for compact hexagon
                step_angle = cur_angle
                if ring_anchors:
                    step_angle = cur_angle
                    cur_angle += math.radians(60)
                else:
                    cur_angle += math.radians(52 if len(nodes) % 2 == 1 else -52)
                nx = px + bond_len * math.cos(step_angle)
                ny = py + bond_len * math.sin(step_angle)
                new_idx = _add_atom(label, (nx, ny))
                edges.append((prev_idx, new_idx, next_bond))
            prev_idx = new_idx
            next_bond = 1

    return nodes, edges


def _render_smiles_fallback_svg(smiles: str, is_sub: bool) -> str:
    w, h = (240, 160) if is_sub else (380, 220)
    parts = [s.strip() for s in smiles.split(">") if s.strip()]
    if len(parts) == 1:
        mol_strs = [parts[0]]
        reaction_mode = False
    else:
        mol_strs = parts
        reaction_mode = True

    elems: List[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="100%" height="100%" '
        f'style="font-family:{_FONT_STACK};">',
        f'<rect x="0" y="0" width="{w}" height="{h}" fill="#FFFFFF"/>',
    ]

    slot_w = w / max(1, len(mol_strs))
    for s_idx, m_str in enumerate(mol_strs):
        nodes, edges = _layout_smiles_molecule(m_str)
        xs = [n["x"] for n in nodes]
        ys = [n["y"] for n in nodes]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        mw = max(1.0, max_x - min_x)
        mh = max(1.0, max_y - min_y)
        pad = 24.0 if is_sub else 32.0
        target_w = max(40.0, slot_w - pad * 1.4)
        target_h = max(40.0, h - pad * 1.6)
        scale = min(1.15, min(target_w / mw, target_h / mh))
        cx = s_idx * slot_w + slot_w / 2.0
        cy = h / 2.0 - 4.0
        ox = cx - ((min_x + max_x) / 2.0) * scale
        oy = cy - ((min_y + max_y) / 2.0) * scale

        for u, v, order in edges:
            x1, y1 = ox + nodes[u]["x"] * scale, oy + nodes[u]["y"] * scale
            x2, y2 = ox + nodes[v]["x"] * scale, oy + nodes[v]["y"] * scale
            dx, dy = x2 - x1, y2 - y1
            dist = max(1e-6, math.hypot(dx, dy))
            nx, ny = -dy / dist, dx / dist
            if order == 1:
                elems.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="#111827" stroke-width="2"/>')
            elif order == 2:
                off = 2.6
                elems.append(f'<line x1="{x1 + nx*off:.1f}" y1="{y1 + ny*off:.1f}" x2="{x2 + nx*off:.1f}" y2="{y2 + ny*off:.1f}" stroke="#111827" stroke-width="1.8"/>')
                elems.append(f'<line x1="{x1 - nx*off:.1f}" y1="{y1 - ny*off:.1f}" x2="{x2 - nx*off:.1f}" y2="{y2 - ny*off:.1f}" stroke="#111827" stroke-width="1.8"/>')
            else:
                off = 3.2
                elems.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="#111827" stroke-width="1.6"/>')
                elems.append(f'<line x1="{x1 + nx*off:.1f}" y1="{y1 + ny*off:.1f}" x2="{x2 + nx*off:.1f}" y2="{y2 + ny*off:.1f}" stroke="#111827" stroke-width="1.5"/>')
                elems.append(f'<line x1="{x1 - nx*off:.1f}" y1="{y1 - ny*off:.1f}" x2="{x2 - nx*off:.1f}" y2="{y2 - ny*off:.1f}" stroke="#111827" stroke-width="1.5"/>')

        fs = 11 if is_sub else 13
        for n in nodes:
            lbl = n["label"]
            if not lbl:
                continue
            tx = ox + n["x"] * scale
            ty = oy + n["y"] * scale
            bw = max(14, len(lbl) * (fs * 0.65) + 4)
            elems.append(f'<rect x="{tx - bw/2:.1f}" y="{ty - fs*0.65:.1f}" width="{bw:.1f}" height="{fs*1.2:.1f}" fill="#FFFFFF"/>')
            elems.append(f'<text x="{tx:.1f}" y="{ty + fs*0.35:.1f}" text-anchor="middle" font-size="{fs}" font-weight="700" fill="#111827">{_esc(lbl)}</text>')

        if reaction_mode and s_idx < len(mol_strs) - 1:
            ax = (s_idx + 1) * slot_w - 10
            elems.append(f'<line x1="{ax - 12:.1f}" y1="{h/2:.1f}" x2="{ax + 10:.1f}" y2="{h/2:.1f}" stroke="#111827" stroke-width="1.8"/>')
            elems.append(f'<polygon points="{ax + 12:.1f},{h/2:.1f} {ax + 5:.1f},{h/2 - 4:.1f} {ax + 5:.1f},{h/2 + 4:.1f}" fill="#111827"/>')

    elems.append("</svg>")
    return "\n".join(elems)


def compile_smiles_to_svg(smiles: str, is_sub: bool = False) -> str:
    """Validate and compile a SMILES or Reaction SMILES string into crisp B&W `<svg>`."""
    cleaned = _strip_code_fence(smiles).strip()
    if not cleaned:
        raise ValueError("SMILES 字符串为空。")

    # Validate pieces first regardless of whether RDKit is available
    for piece in [p.strip() for p in cleaned.split(">") if p.strip()]:
        _validate_smiles_piece(piece)

    if _HAS_RDKIT and Chem is not None and rdMolDraw2D is not None and ">" not in cleaned:
        mol = Chem.MolFromSmiles(cleaned)
        if mol is None:
            raise ValueError(f"RDKit 无法解析 SMILES: {cleaned}")
        w, h = (240, 160) if is_sub else (380, 220)
        drawer = rdMolDraw2D.MolDraw2DSVG(w, h)
        opts = drawer.drawOptions()
        opts.useBWAtomPalette()
        opts.bondLineWidth = 2.0
        drawer.DrawMolecule(mol)
        drawer.FinishDrawing()
        return drawer.GetDrawingText()

    return _render_smiles_fallback_svg(cleaned, is_sub)


# -------------------- Mermaid Flowchart Static SVG Compiler --------------------

_MERMAID_NODE_DEF_RE = re.compile(r'([A-Za-z0-9_]+)\s*(?:\(\[([^\]]+)\]\)|\[["\']?([^"\'\]]+)["\']?\]|\(["\']?([^"\'\)]+)["\']?\)|\{["\']?([^"\'\}]+)["\']?\})')
_MERMAID_EDGE_RE = re.compile(
    r'([A-Za-z0-9_]+)(?:\s*(?:\(\[[^\]]*\]\)|\[[^\]]*\]|\([^\)]*\)|\{[^\}]*\}))?\s*'
    r'(--+>|-.->|==>|--\s*([^-\n>]+?)\s*--+>)\s*'
    r'([A-Za-z0-9_]+)(?:\s*(?:\(\[[^\]]*\]\)|\[[^\]]*\]|\([^\)]*\)|\{[^\}]*\}))?(?:\s*\|([^|\n]+)\|)?'
)


def compile_mermaid_to_svg(code: str, is_sub: bool = False) -> str:
    """Compile Mermaid `graph TD/LR` or `flowchart TD/LR` into static white-bg SVG."""
    src = _strip_code_fence(code)
    if not src:
        raise ValueError("Mermaid 代码为空。")

    lines = [ln.strip() for ln in src.splitlines() if ln.strip() and not ln.strip().startswith("%%")]
    direction = "LR"
    if lines:
        head = lines[0].lower()
        if any(head.startswith(p) for p in ("graph td", "graph tb", "flowchart td", "flowchart tb")):
            direction = "TD"
        elif any(head.startswith(p) for p in ("graph lr", "flowchart lr")):
            direction = "LR"

    labels: Dict[str, str] = {}
    edges: List[Tuple[str, str, str, bool]] = []
    blank_ids: set[str] = set()
    in_deg: Dict[str, int] = {}

    for line in lines:
        if line.lower().startswith(("graph ", "flowchart ", "classdef ", "style ")):
            continue
        cls_m = re.match(r"^class\s+([A-Za-z0-9_,\s]+)\s+blankNode", line, re.IGNORECASE)
        if cls_m:
            for nid in cls_m.group(1).split(","):
                blank_ids.add(nid.strip())
            continue

        for m in _MERMAID_NODE_DEF_RE.finditer(line):
            nid = m.group(1)
            lbl = next((g for g in m.groups()[1:] if g), nid).strip()
            labels[nid] = lbl
            if any(tok in lbl for tok in ("【", "?", "？", "①", "②", "③", "甲", "乙")):
                blank_ids.add(nid)

        em = _MERMAID_EDGE_RE.search(line)
        if em:
            u, op, mid_lbl, v, pipe_lbl = em.groups()
            edge_lbl = (pipe_lbl or mid_lbl or "").strip()
            dashed = "-." in op
            labels.setdefault(u, u)
            labels.setdefault(v, v)
            edges.append((u, v, edge_lbl, dashed))
            in_deg[v] = in_deg.get(v, 0) + 1
            in_deg.setdefault(u, in_deg.get(u, 0))

    if not labels:
        raise ValueError("Mermaid 图中未解析到任何节点。")

    # BFS topological layering
    layer: Dict[str, int] = {}
    roots = [nid for nid in labels if in_deg.get(nid, 0) == 0] or [next(iter(labels))]
    queue: List[str] = []
    for r in roots:
        layer[r] = 0
        queue.append(r)
    while queue:
        cur = queue.pop(0)
        for u, v, _, _ in edges:
            if u == cur and v not in layer:
                layer[v] = layer[cur] + 1
                queue.append(v)
    for nid in labels:
        layer.setdefault(nid, 0)

    buckets: Dict[int, List[str]] = {}
    for nid, lv in layer.items():
        buckets.setdefault(lv, []).append(nid)

    num_layers = max(buckets.keys()) + 1
    max_per_layer = max(len(v) for v in buckets.values())
    node_w = 112 if not is_sub else 88
    node_h = 38 if not is_sub else 30
    gap_main = 62 if direction == "LR" else 52
    gap_cross = 24

    if direction == "LR":
        w = max(460 if not is_sub else 280, num_layers * (node_w + gap_main) + 40)
        h = max(240 if not is_sub else 160, max_per_layer * (node_h + gap_cross) + 50)
    else:
        w = max(460 if not is_sub else 280, max_per_layer * (node_w + gap_cross) + 60)
        h = max(260 if not is_sub else 170, num_layers * (node_h + gap_main) + 40)

    coords: Dict[str, Tuple[float, float]] = {}
    for lv, nids in buckets.items():
        for idx, nid in enumerate(nids):
            if direction == "LR":
                x = 24.0 + lv * (node_w + gap_main)
                total_h = len(nids) * node_h + (len(nids) - 1) * gap_cross
                y = (h - total_h) / 2.0 + idx * (node_h + gap_cross)
            else:
                total_w = len(nids) * node_w + (len(nids) - 1) * gap_cross
                x = (w - total_w) / 2.0 + idx * (node_w + gap_cross)
                y = 24.0 + lv * (node_h + gap_main)
            coords[nid] = (x, y)

    elems: List[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {int(w)} {int(h)}" width="100%" height="100%" '
        f'style="font-family:{_FONT_STACK};">',
        "<defs>"
        '<marker id="asgArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">'
        '<path d="M 0 1 L 10 5 L 0 9 z" fill="#111827"/>'
        "</marker>"
        "</defs>",
        f'<rect x="0" y="0" width="{int(w)}" height="{int(h)}" fill="#FFFFFF"/>',
    ]

    for u, v, elbl, dashed in edges:
        if u not in coords or v not in coords:
            continue
        ux, uy = coords[u]
        vx, vy = coords[v]
        if direction == "LR":
            x1, y1 = ux + node_w, uy + node_h / 2.0
            x2, y2 = vx - 2.0, vy + node_h / 2.0
        else:
            x1, y1 = ux + node_w / 2.0, uy + node_h
            x2, y2 = vx + node_w / 2.0, vy - 2.0
        dash = ' stroke-dasharray="5,4"' if dashed else ""
        elems.append(
            f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" '
            f'stroke="#111827" stroke-width="1.6"{dash} marker-end="url(#asgArrow)"/>'
        )
        if elbl:
            mx, my = (x1 + x2) / 2.0, (y1 + y2) / 2.0 - 6.0
            bw = max(22, len(elbl) * 8 + 8)
            elems.append(f'<rect x="{mx - bw/2:.1f}" y="{my - 10:.1f}" width="{bw:.1f}" height="14" fill="#FFFFFF"/>')
            elems.append(
                f'<text x="{mx:.1f}" y="{my + 1:.1f}" text-anchor="middle" font-size="11" '
                f'font-weight="700" fill="#B91C1C">{_esc(elbl)}</text>'
            )

    fs = 11 if is_sub else 12
    for nid, lbl in labels.items():
        x, y = coords[nid]
        is_blank = nid in blank_ids
        fill = "#F9FAFB" if is_blank else "#FFFFFF"
        sw = "2" if is_blank else "1.5"
        dash = ' stroke-dasharray="5,5"' if is_blank else ""
        elems.append(
            f'<rect x="{x:.1f}" y="{y:.1f}" width="{node_w}" height="{node_h}" rx="6" '
            f'fill="{fill}" stroke="#111827" stroke-width="{sw}"{dash}/>'
        )
        short_lbl = lbl if len(lbl) <= 14 else f"{lbl[:13]}…"
        elems.append(
            f'<text x="{x + node_w / 2:.1f}" y="{y + node_h / 2 + 4:.1f}" text-anchor="middle" '
            f'font-size="{fs}" font-weight="{"700" if is_blank else "600"}" fill="#111827">{_esc(short_lbl)}</text>'
        )

    elems.append("</svg>")
    return "\n".join(elems)


# -------------------- Raw SVG Sanitizer & Reuse Crop --------------------


def compile_raw_svg(svg_code: str, is_sub: bool = False) -> str:
    """Validate and normalize an inline `<svg>` document for safe cross-platform rendering."""
    src = _strip_code_fence(svg_code)
    if not src or "<svg" not in src.lower():
        raise ValueError("SVG 内容缺少 <svg> 根节点。")
    # Extract `<svg ...>...</svg>` substring if surrounded by text
    m = re.search(r"(<svg[\s\S]*?</svg>)", src, re.IGNORECASE)
    if not m:
        raise ValueError("SVG 标签未完整闭合。")
    svg_str = m.group(1)
    # Strip any `<script>` tags before parsing
    svg_str = re.sub(r"<script[\s\S]*?</script>", "", svg_str, flags=re.IGNORECASE)

    try:
        root = ET.fromstring(svg_str)
    except ET.ParseError as exc:
        raise ValueError(f"SVG XML 语法无效: {exc}") from exc

    tag_name = root.tag.split("}", 1)[-1].lower()
    if tag_name != "svg":
        raise ValueError("根节点不是 <svg>。")

    if "xmlns" not in root.attrib and not root.tag.startswith("{"):
        root.set("xmlns", "http://www.w3.org/2000/svg")
    if "viewBox" not in root.attrib:
        w = root.attrib.get("width", "280" if is_sub else "450").replace("px", "").strip()
        h = root.attrib.get("height", "200" if is_sub else "280").replace("px", "").strip()
        root.set("viewBox", f"0 0 {w or 450} {h or 280}")
    style = root.attrib.get("style", "")
    if "font-family" not in style:
        root.set("style", f"font-family:{_FONT_STACK}; {style}".strip())

    # Register default SVG namespace cleanly and ensure white background rect
    ET.register_namespace("", "http://www.w3.org/2000/svg")
    has_bg = False
    for child in list(root)[:2]:
        ctag = child.tag.split("}", 1)[-1].lower()
        if ctag == "rect" and child.attrib.get("width") in ("100%", root.attrib.get("width")):
            has_bg = True
            break
    if not has_bg:
        bg = ET.Element(
            "{http://www.w3.org/2000/svg}rect",
            {"x": "0", "y": "0", "width": "100%", "height": "100%", "fill": "#FFFFFF"},
        )
        root.insert(0, bg)

    return ET.tostring(root, encoding="unicode")


def compile_reuse_crop(
    raw_payload: str,
    assets_dir: Optional[Path] = None,
    doc_ir: Optional[DocumentIR] = None,
) -> str:
    """Resolve an existing image asset ID or filename to a self-contained DataURL / SVG."""
    ref = (raw_payload or "").strip()
    if ref.startswith("data:image/"):
        return ref

    candidates: List[Path] = []
    if doc_ir is not None:
        for asset in doc_ir.all_assets:
            if ref and (asset.asset_id == ref or asset.filename == ref or ref in asset.url):
                if assets_dir:
                    candidates.append(assets_dir / asset.filename)
    if assets_dir and assets_dir.exists():
        if ref:
            candidates.append(assets_dir / Path(ref).name)
        for p in sorted(assets_dir.iterdir()):
            if p.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp", ".svg") and (not ref or ref in p.name):
                candidates.append(p)

    target = next((p for p in candidates if p.is_file()), None)
    if target is None:
        raise ValueError(f"未找到可复用的原图资产: {ref or '(空)'}")

    if target.suffix.lower() == ".svg":
        return compile_raw_svg(target.read_text(encoding="utf-8", errors="replace"))

    mime, _ = mimetypes.guess_type(str(target))
    mime = mime or "image/png"
    b64 = base64.b64encode(target.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{b64}"


# -------------------- Built-in 5 Recipes & Modeling Synthesis --------------------


def build_recipe_figure_block(
    recipe: str,
    *,
    topic_hint: str = "核心考点",
    visual_strategy: str = "ORIGINAL_SYNTHESIS",
    figure_caption: str = "",
) -> QuestionFigureBlock:
    """Build and compile a self-contained QuestionFigureBlock for any of the 5 standard recipes."""
    r = (recipe or "ORIGINAL_DUAL_CURVE").strip().upper()
    short_topic = re.sub(r"[\s《》【】]+", "", topic_hint)[:12] or "核心机制"

    if r == "ORIGINAL_FOUR_OPTION_CHARTS":
        opt_defs = {
            "A": ("单调上升型", [(0, 10), (20, 35), (40, 60), (60, 82), (80, 96)]),
            "B": ("先升后降型", [(0, 15), (20, 75), (40, 92), (60, 50), (80, 18)]),
            "C": ("饱和平台型", [(0, 0), (15, 58), (30, 76), (50, 88), (80, 95)]),
            "D": ("反向衰减型", [(0, 95), (20, 65), (40, 42), (60, 26), (80, 14)]),
        }
        compiled_subs: Dict[str, str] = {}
        raw_subs: Dict[str, str] = {}
        for k, (_lbl, pts) in opt_defs.items():
            cfg = {
                "backgroundColor": "#FFFFFF",
                "animation": False,
                "xAxis": {"type": "value", "name": "t / S"},
                "yAxis": {"type": "value", "name": "Y"},
                "series": [{"name": k, "type": "line", "data": pts}],
            }
            cfg_str = json.dumps(cfg, ensure_ascii=False)
            raw_subs[k] = cfg_str
            compiled_subs[k] = compile_echarts_to_svg(cfg, is_sub_option=True)
        return QuestionFigureBlock(
            position="OPTIONS_GRID",
            visual_strategy=visual_strategy,
            original_recipe="ORIGINAL_FOUR_OPTION_CHARTS",
            render_engine="ECHARTS",
            raw_payload=json.dumps(raw_subs, ensure_ascii=False),
            compiled_svg_or_base64="",
            figure_caption=figure_caption or f"图 四个原创实验条件下的响应曲线选项（{short_topic}）",
            sub_figures_compiled=compiled_subs,
        )

    if r == "ORIGINAL_PATHWAY_PUZZLE":
        code = "\n".join([
            "graph LR",
            f'  S1["信号输入 {short_topic}"] -->|"+"| N1["中间调控节点"]',
            '  N1 -->|"+"| B1["【 过程① 】"]',
            '  B1 -->|"-"| N2["效应输出 Y"]',
            '  N2 -.->|"负反馈"| S1',
            "  class B1 blankNode",
        ])
        svg = compile_mermaid_to_svg(code)
        return QuestionFigureBlock(
            position="BELOW_STEM",
            visual_strategy=visual_strategy,
            original_recipe="ORIGINAL_PATHWAY_PUZZLE",
            render_engine="MERMAID",
            raw_payload=code,
            compiled_svg_or_base64=svg,
            figure_caption=figure_caption or f"图 {short_topic} 原创调控通路机制框图（虚线框为待推断环节）",
            sub_figures_compiled=None,
        )

    if r == "ORIGINAL_CHEM_SYNTHESIS":
        smiles = "CC(=O)OC1=CC=C(C=C1)C=CC(=O)O"
        svg = compile_smiles_to_svg(smiles)
        return QuestionFigureBlock(
            position="BELOW_STEM",
            visual_strategy=visual_strategy,
            original_recipe="ORIGINAL_CHEM_SYNTHESIS",
            render_engine="SMILES",
            raw_payload=smiles,
            compiled_svg_or_base64=svg,
            figure_caption=figure_caption or f"图 {short_topic} 原创多官能团有机分子结构简式",
            sub_figures_compiled=None,
        )

    if r == "ORIGINAL_SCHEMATIC_MODEL":
        svg_src = f"""<svg viewBox="0 0 450 260" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="450" height="260" fill="#FFFFFF"/>
  <rect x="45" y="105" width="360" height="44" rx="6" fill="#F8FAFC" stroke="#111827" stroke-width="1.8"/>
  <rect x="195" y="88" width="54" height="78" rx="8" fill="#FFFFFF" stroke="#B91C1C" stroke-width="2" stroke-dasharray="5,4"/>
  <line x1="222" y1="36" x2="222" y2="196" stroke="#111827" stroke-width="2.2"/>
  <polygon points="222,208 216,194 228,194" fill="#111827"/>
  <text x="225" y="132" text-anchor="middle" font-size="13" font-weight="700" fill="#B91C1C">①</text>
  <text x="115" y="72" text-anchor="middle" font-size="13" font-weight="700" fill="#111827">状态甲 (C1)</text>
  <text x="115" y="218" text-anchor="middle" font-size="13" font-weight="700" fill="#111827">状态乙 (C2)</text>
  <text x="340" y="72" text-anchor="middle" font-size="12" fill="#4B5563">{_esc(short_topic)}</text>
</svg>"""
        svg = compile_raw_svg(svg_src)
        return QuestionFigureBlock(
            position="BELOW_STEM",
            visual_strategy=visual_strategy,
            original_recipe="ORIGINAL_SCHEMATIC_MODEL",
            render_engine="SVG",
            raw_payload=svg_src,
            compiled_svg_or_base64=svg,
            figure_caption=figure_caption or f"图 {short_topic} 原创空间状态模型示意图（①为关键过程通道）",
            sub_figures_compiled=None,
        )

    # Default: ORIGINAL_DUAL_CURVE (Michaelis / saturation dual-curve contrast)
    xs = [0, 5, 10, 20, 30, 50, 75, 100]
    curve_a = [[x, round((100.0 * x) / (10.0 + x), 1)] for x in xs]
    curve_b = [[x, round((100.0 * x) / (30.0 + x), 1)] for x in xs]
    cfg = {
        "backgroundColor": "#FFFFFF",
        "animation": False,
        "grid": {"top": 45, "right": 55, "bottom": 45, "left": 60, "containLabel": True},
        "xAxis": {"type": "value", "name": "[S] / mmol·L⁻¹", "min": 0, "max": 100},
        "yAxis": {"type": "value", "name": "v / U", "min": 0, "max": 100},
        "series": [
            {
                "name": "a",
                "type": "line",
                "data": curve_a,
                "endLabel": {"show": True, "formatter": "a"},
                "markPoint": {"data": [{"name": "P1", "coord": [10, 50], "label": {"show": True, "formatter": "P1"}}]},
            },
            {
                "name": "b",
                "type": "line",
                "lineStyle": {"type": "dashed"},
                "data": curve_b,
                "endLabel": {"show": True, "formatter": "b"},
                "markPoint": {"data": [{"name": "P2", "coord": [30, 50], "label": {"show": True, "formatter": "P2"}}]},
            },
        ],
    }
    cfg_str = json.dumps(cfg, ensure_ascii=False)
    return QuestionFigureBlock(
        position="BELOW_STEM",
        visual_strategy=visual_strategy,
        original_recipe="ORIGINAL_DUAL_CURVE",
        render_engine="ECHARTS",
        raw_payload=cfg_str,
        compiled_svg_or_base64=compile_echarts_to_svg(cfg, is_sub_option=False),
        figure_caption=figure_caption or f"图 对照组（实线 a）与实验处理组（虚线 b）响应对比曲线（P1、P2 为半速特征点）",
        sub_figures_compiled=None,
    )


def _modeling_to_markdown_table(modeling: str) -> str:
    """Convert original_graphic_modeling points or equations into a clean Markdown fallback table."""
    src = (modeling or "").strip()
    if not src:
        return ""
    if "|" in src and "---" in src:
        return "\n\n**【采样数据参考表】**\n\n" + src

    pairs = re.findall(r"\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)", src)
    if pairs:
        rows = ["| 自变量 $x$ | 特征值 $y$ |", "| :---: | :---: |"]
        for x_val, y_val in pairs[:8]:
            rows.append(f"| {x_val} | {y_val} |")
        return "\n\n**【图形关键观测数据表】**\n\n" + "\n".join(rows)

    # 没有可解析的数值数据：什么都不补。
    # 以前这里会把整段建模草稿（"使用教材图5-2，标号a为吸收…"）以引用块塞进题干，
    # 等于把内部推理泄露给学生，卷面上多出一段莫名其妙的紫色说明。
    return ""


def _compile_by_engine(
    engine: str,
    payload: str,
    *,
    is_sub: bool = False,
    assets_dir: Optional[Path] = None,
    doc_ir: Optional[DocumentIR] = None,
) -> str:
    eng = (engine or "SVG").strip().upper()
    if eng == "ECHARTS":
        return compile_echarts_to_svg(payload, is_sub_option=is_sub)
    if eng == "SMILES":
        return compile_smiles_to_svg(payload, is_sub=is_sub)
    if eng == "MERMAID":
        return compile_mermaid_to_svg(payload, is_sub=is_sub)
    if eng == "REUSE_CROP":
        return compile_reuse_crop(payload, assets_dir=assets_dir, doc_ir=doc_ir)
    return compile_raw_svg(payload, is_sub=is_sub)


def _attempt_compile_payload(
    *,
    position: str,
    visual_strategy: str,
    original_recipe: Optional[str],
    render_engine: str,
    raw_payload: str,
    sub_figures: Optional[Dict[str, str]],
    figure_caption: str,
    layout_calculation: str,
    assets_dir: Optional[Path],
    doc_ir: Optional[DocumentIR],
) -> QuestionFigureBlock:
    pos = (position or "BELOW_STEM").strip().upper()
    if pos == "OPTIONS_GRID":
        subs_in = sub_figures
        if not subs_in and raw_payload.strip().startswith("{"):
            maybe_dict = json.loads(_strip_code_fence(raw_payload))
            if isinstance(maybe_dict, dict) and all(k in maybe_dict for k in ("A", "B", "C", "D")):
                subs_in = {k: str(maybe_dict[k]) for k in ("A", "B", "C", "D")}
        if not isinstance(subs_in, dict) or not all(k in subs_in and str(subs_in[k]).strip() for k in ("A", "B", "C", "D")):
            raise ValueError("OPTIONS_GRID 模式必须提供包含 A/B/C/D 四个非空图形配置的 sub_figures。")
        compiled_subs: Dict[str, str] = {}
        for k in ("A", "B", "C", "D"):
            raw_k = subs_in[k]
            raw_k_str = json.dumps(raw_k, ensure_ascii=False) if isinstance(raw_k, dict) else str(raw_k)
            compiled_subs[k] = _compile_by_engine(
                render_engine, raw_k_str, is_sub=True, assets_dir=assets_dir, doc_ir=doc_ir
            )
        return QuestionFigureBlock(
            position="OPTIONS_GRID",
            visual_strategy=visual_strategy,
            original_recipe=original_recipe,
            render_engine=render_engine,
            raw_payload=raw_payload or json.dumps(subs_in, ensure_ascii=False),
            compiled_svg_or_base64="",
            figure_caption=figure_caption,
            sub_figures_compiled=compiled_subs,
            layout_calculation=layout_calculation,
        )

    compiled_main = _compile_by_engine(
        render_engine, raw_payload, is_sub=False, assets_dir=assets_dir, doc_ir=doc_ir
    )
    return QuestionFigureBlock(
        position="BELOW_STEM",
        visual_strategy=visual_strategy,
        original_recipe=original_recipe,
        render_engine=render_engine,
        raw_payload=raw_payload,
        compiled_svg_or_base64=compiled_main,
        figure_caption=figure_caption,
        sub_figures_compiled=None,
        layout_calculation=layout_calculation,
    )


def compile_figure_block_with_fallbacks(
    *,
    stem: str,
    position: str = "BELOW_STEM",
    visual_strategy: str = "ORIGINAL_SYNTHESIS",
    original_recipe: Optional[str] = None,
    render_engine: str = "ECHARTS",
    raw_payload: str = "",
    sub_figures: Optional[Dict[str, str]] = None,
    figure_caption: str = "",
    layout_calculation: str = "",
    original_graphic_modeling: str = "",
    visual_blueprint: Optional[VisualBlueprint] = None,
    original_image_id: Optional[str] = None,
    assets_dir: Optional[Path] = None,
    doc_ir: Optional[DocumentIR] = None,
    retry_callback: Optional[Callable[[str], Dict[str, Any]]] = None,
) -> Tuple[bool, Optional[QuestionFigureBlock], str]:
    """Compile a graphic payload into static SVG/Base64 with 3-level self-healing fallback.

    Level 1: Compile raw payload (or invoke `retry_callback(error)` once; if payload was
             never provided, synthesize from recipe/modeling).
    Level 2: Fall back to `REUSE_CROP` when an image reference resolves cleanly.
    Level 3: Set `has_figure=False` and append a Markdown data table built from
             `original_graphic_modeling` so online & PDF never show broken graphics.
    """
    bp_recipe = original_recipe or (visual_blueprint.original_recipe if visual_blueprint else None)
    bp_strategy = visual_strategy or (visual_blueprint.visual_strategy if visual_blueprint else "ORIGINAL_SYNTHESIS")
    bp_engine = render_engine or (visual_blueprint.target_engine if visual_blueprint else "ECHARTS")
    bp_pos = position or (visual_blueprint.figure_position if visual_blueprint else "BELOW_STEM")
    img_ref = original_image_id or (visual_blueprint.original_image_id if visual_blueprint else None)

    has_explicit_payload = bool((raw_payload or "").strip()) or bool(sub_figures)
    if not has_explicit_payload:
        # 以前的实现会在这里调用 build_recipe_figure_block() 用"信号输入→中间调控节点→效应输出"
        # 这类通用模板硬拼一张图；题目根本不需要图，也会被塞一张与本意无关的框图。
        # 现在：没有模型真给出的载荷就当作"本题不需要配图"，只把建模草稿降级成数据表。
        table_suffix = _modeling_to_markdown_table(original_graphic_modeling)
        updated_stem = f"{stem.rstrip()}{table_suffix}" if table_suffix else stem
        return False, None, updated_stem

    last_err = ""
    try:
        block = _attempt_compile_payload(
            position=bp_pos,
            visual_strategy=bp_strategy,
            original_recipe=bp_recipe,
            render_engine=bp_engine,
            raw_payload=raw_payload,
            sub_figures=sub_figures,
            figure_caption=figure_caption,
            layout_calculation=layout_calculation,
            assets_dir=assets_dir,
            doc_ir=doc_ir,
        )
        return True, block, stem
    except Exception as exc:
        last_err = str(exc)

    # Level 1 retry via Agent 3.5 error-stack callback
    if retry_callback is not None:
        try:
            fixed = retry_callback(last_err) or {}
            block = _attempt_compile_payload(
                position=str(fixed.get("figure_position") or fixed.get("position") or bp_pos),
                visual_strategy=str(fixed.get("visual_strategy") or bp_strategy),
                original_recipe=fixed.get("original_recipe") or bp_recipe,
                render_engine=str(fixed.get("render_engine") or bp_engine),
                raw_payload=str(fixed.get("figure_payload") or fixed.get("raw_payload") or ""),
                sub_figures=fixed.get("sub_figures"),
                figure_caption=str(fixed.get("figure_caption") or figure_caption),
                layout_calculation=str(fixed.get("layout_calculation") or layout_calculation),
                assets_dir=assets_dir,
                doc_ir=doc_ir,
            )
            return True, block, stem
        except Exception as exc2:
            last_err = str(exc2)

    # Level 2: Image reuse fallback
    if img_ref:
        try:
            data_url = compile_reuse_crop(img_ref, assets_dir=assets_dir, doc_ir=doc_ir)
            return (
                True,
                QuestionFigureBlock(
                    position="BELOW_STEM",
                    visual_strategy="IMAGE_REUSE_QUERY_SHIFT",
                    original_recipe=bp_recipe,
                    render_engine="REUSE_CROP",
                    raw_payload=img_ref,
                    compiled_svg_or_base64=data_url,
                    figure_caption=figure_caption or "图 原卷/教材参考配图",
                    sub_figures_compiled=None,
                ),
                stem,
            )
        except Exception:
            pass

    # Level 3: Markdown table smooth fallback (never emit broken figure placeholders)
    table_suffix = _modeling_to_markdown_table(original_graphic_modeling)
    updated_stem = f"{stem.rstrip()}{table_suffix}" if table_suffix else stem
    return False, None, updated_stem


async def async_compile_figure_block_with_fallbacks(
    *,
    stem: str,
    position: str = "BELOW_STEM",
    visual_strategy: str = "ORIGINAL_SYNTHESIS",
    original_recipe: Optional[str] = None,
    render_engine: str = "ECHARTS",
    raw_payload: str = "",
    sub_figures: Optional[Dict[str, str]] = None,
    figure_caption: str = "",
    layout_calculation: str = "",
    original_graphic_modeling: str = "",
    visual_blueprint: Optional[VisualBlueprint] = None,
    original_image_id: Optional[str] = None,
    assets_dir: Optional[Path] = None,
    doc_ir: Optional[DocumentIR] = None,
    async_retry_callback: Optional[Callable[[str], Awaitable[Dict[str, Any]]]] = None,
) -> Tuple[bool, Optional[QuestionFigureBlock], str]:
    """Async sibling of `compile_figure_block_with_fallbacks` supporting async Agent 3.5 retry."""
    ok, block, new_stem = compile_figure_block_with_fallbacks(
        stem=stem,
        position=position,
        visual_strategy=visual_strategy,
        original_recipe=original_recipe,
        render_engine=render_engine,
        raw_payload=raw_payload,
        sub_figures=sub_figures,
        figure_caption=figure_caption,
        layout_calculation=layout_calculation,
        original_graphic_modeling=original_graphic_modeling,
        visual_blueprint=visual_blueprint,
        original_image_id=None,
        assets_dir=assets_dir,
        doc_ir=doc_ir,
        retry_callback=None,
    )
    if ok:
        return ok, block, new_stem

    if async_retry_callback is not None:
        try:
            # Capture the error directly to send to Agent 3.5
            err_msg = ""
            try:
                _attempt_compile_payload(
                    position=position,
                    visual_strategy=visual_strategy,
                    original_recipe=original_recipe,
                    render_engine=render_engine,
                    raw_payload=raw_payload,
                    sub_figures=sub_figures,
                    figure_caption=figure_caption,
                    layout_calculation=layout_calculation,
                    assets_dir=assets_dir,
                    doc_ir=doc_ir,
                )
            except Exception as exc:
                err_msg = str(exc)
            fixed = await async_retry_callback(err_msg) or {}
            block = _attempt_compile_payload(
                position=str(fixed.get("figure_position") or fixed.get("position") or position),
                visual_strategy=str(fixed.get("visual_strategy") or visual_strategy),
                original_recipe=fixed.get("original_recipe") or original_recipe,
                render_engine=str(fixed.get("render_engine") or render_engine),
                raw_payload=str(fixed.get("figure_payload") or fixed.get("raw_payload") or ""),
                sub_figures=fixed.get("sub_figures"),
                figure_caption=str(fixed.get("figure_caption") or figure_caption),
                layout_calculation=str(fixed.get("layout_calculation") or layout_calculation),
                assets_dir=assets_dir,
                doc_ir=doc_ir,
            )
            return True, block, stem
        except Exception:
            pass

    # Retry Level 2 / Level 3 with original_image_id enabled if async retry failed
    return compile_figure_block_with_fallbacks(
        stem=stem,
        position=position,
        visual_strategy=visual_strategy,
        original_recipe=original_recipe,
        render_engine=render_engine,
        raw_payload=raw_payload,
        sub_figures=sub_figures,
        figure_caption=figure_caption,
        layout_calculation=layout_calculation,
        original_graphic_modeling=original_graphic_modeling,
        visual_blueprint=visual_blueprint,
        original_image_id=original_image_id,
        assets_dir=assets_dir,
        doc_ir=doc_ir,
        retry_callback=None,
    )
