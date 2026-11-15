# -*- coding: utf-8 -*-
"""Regression tests for table repair and the flashcard extractor quality rules."""
from __future__ import annotations

from app.schemas import DocumentIR, KnowledgeFlashcard, QuizPaper
from app.workflows.generator import (
    extract_knowledge_flashcards,
    normalize_markdown_math,
    repair_pipe_tables,
)

BROKEN_TABLE = (
    "测得二阶微商值如下表：\n"
    "| 滴定剂体积 $V/\\mathrm{mL}$ | 24.90 | 25.00 |\n"
    "| $\\dfrac{\\Delta^2E}{\\Delta V^2}$ | $+0.24$ | $-0.16$ |\n"
    "(1) 计算终点体积；"
)


def test_missing_separator_row_is_repaired() -> None:
    out = normalize_markdown_math(BROKEN_TABLE)
    assert "|---|---|---|" in out
    # 表格块前后必须有空行，否则 GFM 仍会当成段落
    assert "\n\n| 滴定剂体积" in out
    assert "$-0.16$ |\n\n(1)" in out


def test_valid_table_is_untouched() -> None:
    table = "| a | b |\n|---|---|\n| 1 | 2 |"
    assert repair_pipe_tables(table) == table


def test_single_row_and_prose_pipes_are_untouched() -> None:
    assert repair_pipe_tables("| a | b |") == "| a | b |"
    assert repair_pipe_tables("用 | 分隔两个词") == "用 | 分隔两个词"
    assert repair_pipe_tables("| a | b |\n| 1 |") == "| a | b |\n| 1 |"


def _empty_ir() -> DocumentIR:
    return DocumentIR(
        project_id="t",
        filename="t.pdf",
        file_path="t.pdf",
        file_type="pdf",
        total_pages=1,
        chapters=[],
    )


def test_flashcards_skip_layout_labels_and_read_real_tables() -> None:
    notes = (
        "# 第1节 电位分析法总览\n\n"
        "## 1.1 导学与直觉建立\n\n"
        "**生活化类比**：温度计本身不参与烧水，只是把冷热换成水银柱高度。\n\n"
        "**标准定义**：电位分析法是利用电极电位与活度关系进行分析的方法。\n\n"
        "## 1.4 随堂微自测\n\n"
        "**2. 填空题**：$25^\\circ\\mathrm{C}$ 时 $2.303RT/F=$ __________ V。\n"
    )
    cheatsheet = (
        "# 速查表\n\n"
        "**适用对象**：零基础自学者 ｜ **速记密度**：comprehensive\n\n"
        "## 一、核心名词词典\n\n"
        "| 核心术语 | 一句话本质（大白话） | 教材标准定义关键词 |\n"
        "|---|---|---|\n"
        "| 参比电极 | “定盘星”：电位固定不动 | 电位恒定、可逆、不极化 |\n\n"
        "## 二、公式与定理大全\n\n"
        "| 公式名称 | 标准表达式 (LaTeX) | 参数含义与单位 | 适用前提条件 |\n"
        "|---|---|---|---|\n"
        "| Nernst 方程（25 ℃ 实用式） | $E=E^{\\ominus}+\\frac{0.0592}{n}\\lg a$ | $n$：转移电子数 | 25 ℃，可逆电极 |\n"
    )
    cards = extract_knowledge_flashcards(_empty_ir(), notes, cheatsheet, None)

    fronts = " ".join(card.front for card in cards)
    answers = " ".join(card.answer for card in cards)

    # 版式/结构标签不得成为卡片
    for junk in ("适用对象", "生活化类比", "速记密度", "填空题", "标准定义", "Step"):
        assert junk not in fronts, f"junk card leaked: {junk}"
    # 真实知识必须出现
    assert "参比电极" in fronts
    assert "Nernst 方程" in fronts
    assert "0.0592" in answers
    categories = {card.category for card in cards}
    assert "核心概念" in categories and "核心公式" in categories
