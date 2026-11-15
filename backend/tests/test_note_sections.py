"""讲义分节：后端切分是唯一来源，逐节学习与分节练习必须一一对应。"""

from __future__ import annotations

from app.workflows.section_practice import extract_note_sections

NOTES = """# 第5章 分子荧光分析法 · 零基础详细自学案

## 本章学习地图

本章一共七节，先看图再看公式，最后做题。

## 第 1 节 荧光从哪里来

### 【导学与直觉建立】

分子吸收光之后会发生一系列去活化过程，这是全章的基础。

## 第 2 节 两种特征光谱

### 【导学与直觉建立】

激发光谱与发射光谱是同一个分子的两种面孔，很容易混。

## 单元基本功检测卷（打印版）

1. 选择题：以下哪个不是去活化途径？

## 参考答案与解析

### 随堂微自测 1

答案：B。
"""


def test_sections_are_the_real_teaching_units():
    sections = extract_note_sections(NOTES)
    titles = [s["title"] for s in sections]
    assert titles == ["本章学习地图", "第 1 节 荧光从哪里来", "第 2 节 两种特征光谱"]
    # 检测卷与答案不进逐节学习（它们已经是独立的单元检测卷/解析）
    assert not any("检测卷" in t or "参考答案" in t for t in titles)


def test_each_section_carries_its_own_markdown_and_practice_flag():
    sections = {s["title"]: s for s in extract_note_sections(NOTES)}
    guide = sections["本章学习地图"]
    assert guide["practice_required"] is False  # 导览页读完就放行
    assert guide["markdown"].startswith("## 本章学习地图")

    first = sections["第 1 节 荧光从哪里来"]
    assert first["practice_required"] is True
    assert first["markdown"].startswith("## 第 1 节 荧光从哪里来")
    assert "去活化" in first["markdown"]
    # 本节正文不能串到下一节
    assert "激发光谱" not in first["markdown"]


def test_section_ids_are_unique_and_stable():
    once = [s["section_id"] for s in extract_note_sections(NOTES)]
    twice = [s["section_id"] for s in extract_note_sections(NOTES)]
    assert once == twice
    assert len(set(once)) == len(once)


def test_markdown_without_headings_yields_no_sections():
    assert extract_note_sections("只有一段没有标题的正文内容，长度随便多少都行。") == []
