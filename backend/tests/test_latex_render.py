# -*- coding: utf-8 -*-
"""Regression tests for the print-math renderer and the image-free hand-out policy."""

from __future__ import annotations

import re

from app.workflows.generator import strip_document_images
from app.workflows.latex_render import render_math
from app.workflows.pdf_exporter import _mermaid_to_outline_html

_ARTIFACT_RE = re.compile(r"\\[A-Za-z]{2,}|\^|(?<![A-Za-z])_[A-Za-z{]")


def _plain(html_text: str) -> str:
    return re.sub(r"<[^>]+>", "", html_text)


def test_equilibrium_arrow_is_not_leaked() -> None:
    out = render_math(r"\mathrm{Ox}+ne^-\rightleftharpoons \mathrm{Red}")
    assert "leftharpoons" not in out
    assert "⇌" in out
    assert "<sup>-</sup>" in out


def test_standard_potential_uses_degree_sign() -> None:
    out = render_math(r"E=E^\circ+\frac{0.0592}{n}\lg a_{\mathrm{Ox}}")
    assert "°" in out
    assert "circ" not in out
    assert "<sup>c</sup>" not in out


def test_nernst_fraction_stays_readable() -> None:
    out = render_math(r"E=E^\circ+\frac{0.0592}{n}\log\frac{a_{\mathrm{Ox}}}{a_{\mathrm{Red}}}")
    text = _plain(out)
    assert text == "E=E°+0.0592/n log aOx/aRed"


def test_subscripts_and_units() -> None:
    out = render_math(r"\mathrm{Hg_2Cl_2}+2e^- \rightleftharpoons 2\mathrm{Hg}+2\mathrm{Cl^-}")
    assert "Hg<sub>2</sub>Cl<sub>2</sub>" in out
    assert "Cl<sup>-</sup>" in out


def test_unknown_command_does_not_emit_backslash() -> None:
    out = render_math(r"a \weirdcommand b")
    assert "\\" not in out
    assert "weirdcommand" in out


def test_boxed_keeps_content_without_the_command_word() -> None:
    out = render_math(r"\boxed{\varphi=\varphi^\ominus+\frac{0.0592}{n}\lg a}")
    assert "boxed" not in out
    assert "φ" in out
    assert "⊖" in out


def test_no_latex_artifacts_in_typical_formulas() -> None:
    samples = [
        r"E_{\mathrm{SCE}}=0.241\ \mathrm{V}",
        r"[\mathrm{Fe^{3+}}]=0.010\,\mathrm{mol/L}",
        r"\Delta E/\Delta V",
        r"\varphi=\varphi^\ominus+\frac{0.0592}{z}\lg a",
        r"K_{\mathrm{H^+,Na^+}}=10^{-11}",
        r"c(\mathrm{Cl^-})=\frac{5.025\times10^{-4}}{25.00\times10^{-3}}",
    ]
    for expr in samples:
        out = render_math(expr, display=True)
        assert not _ARTIFACT_RE.search(out), f"{expr} -> {out}"


def test_strip_document_images() -> None:
    md = "# 标题\n\n![第 1 页插图 1](/api/projects/p/assets/pdf_p1_img1.jpeg)\n\n正文。\n"
    cleaned = strip_document_images(md)
    assert "![" not in cleaned
    assert "正文。" in cleaned
    assert "\n\n\n" not in cleaned


def test_mermaid_becomes_outline() -> None:
    code = "\n".join(
        [
            "flowchart LR",
            "    A[化学电池与电动势] --> B[Nernst 方程]",
            '    B --> C["参比电极<br/>电位恒定"]',
        ]
    )
    html_out = _mermaid_to_outline_html(code)
    assert "化学电池与电动势" in html_out
    assert "Nernst 方程" in html_out
    assert "参比电极 电位恒定" in html_out
    assert "<ul" in html_out
    assert "flowchart" not in html_out
