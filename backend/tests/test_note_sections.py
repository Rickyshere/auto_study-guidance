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


C_MODE_NOTES = """# 第05章 分子荧光分析法 · 考前80/20必考核心浓缩

## 0. 考前3分钟：底层原理一条线

荧光就是分子吃光掉到最低跳板再发光跳下的过程，先记住这条线。

## 1. 必考核心考点 Top 10

### 考点1 荧光与磷光的产生

单重态到三重态要经过体系间跨越，这一步是判断荧光还是磷光的分水岭。

### 考点2 两种特征光谱

激发光谱与发射光谱互为镜像，镜像关系来自振动能级结构相似。

## 2. 必考母图挖空预警

图5-1 基态与激发态示意图，考试常让你填箭头方向和能量高低。

## 3. 全书核心公式一页纸汇总

F = Kc，线性范围由吸光度上限决定，超过 0.05 就偏离。

## 4. 零基础典型例题

例题1：简述荧光与磷光的区别，答题要点是先说跃迁类型再说寿命。

## 5. 同步练习（循序渐进）

一、填空题：荧光效率的符号是 __________。

## 6. 单元检测卷（30分钟，100分）

一、填空（每空2分）：荧光猝灭的常见原因有 __________。

# 参考答案与采分点

## 同步练习答案

A 组：1. φ_f 2. 磷光
"""


def test_c_mode_handout_splits_by_its_own_blocks_not_one_giant_section():
    """C 模式讲义是「1. 考点块 / 2. 母图 / 3. 一页纸 …」而不是「第 N 节」，
    以前整篇会被当成一节，现在要按它自己的分块切开。"""
    sections = extract_note_sections(C_MODE_NOTES)
    titles = [s["title"] for s in sections]
    assert len(sections) >= 5
    assert titles[0].startswith("0. 考前3分钟")
    assert "1. 必考核心考点 Top 10" in titles
    assert not any("参考答案" in t for t in titles)
    # 每一节只带自己的正文，不把别的块吞进来
    top10 = next(s for s in sections if s["title"].startswith("1. 必考核心考点"))
    assert "考点1" in top10["markdown"] and "考点2" in top10["markdown"]
    assert "母图挖空" not in top10["markdown"]


def test_c_mode_read_only_blocks_do_not_force_practice():
    sections = {s["title"]: s for s in extract_note_sections(C_MODE_NOTES)}
    assert sections["3. 全书核心公式一页纸汇总"]["practice_required"] is False
    assert sections["4. 零基础典型例题"]["practice_required"] is False
    assert sections["5. 同步练习（循序渐进）"]["practice_required"] is False
    assert sections["1. 必考核心考点 Top 10"]["practice_required"] is True


# --------------------------------------------------------------- 分节练习预热


def test_practice_plan_skips_read_only_sections(monkeypatch):
    """讲义一落地就自动预热练习：只给要出题的小节排队。"""
    from pathlib import Path

    import app.main as main

    class _Pkg:
        study_notes_markdown = NOTES

    monkeypatch.setattr(main, "_load_package", lambda _pid: _Pkg())
    monkeypatch.setattr(main, "load_section_practice_cache", lambda _d, _fp: {})
    monkeypatch.setattr(main, "_safe_project_dir", lambda _pid: Path("."))

    sections, fingerprint, cached = main._section_practice_plan("proj_x")
    titles = [s["title"] for s in sections]
    assert titles == ["第 1 节 荧光从哪里来", "第 2 节 两种特征光谱"]
    assert fingerprint
    assert cached == {}


def test_prewarm_only_queues_sections_without_practice(monkeypatch):
    import app.main as main

    queued: list = []
    monkeypatch.setattr(
        main,
        "_section_practice_plan",
        lambda _pid: (
            [{"section_id": "sec_a"}, {"section_id": "sec_b"}],
            "fp",
            {"sec_a": {"paper_id": "section:sec_a"}},
        ),
    )
    monkeypatch.setattr(
        main, "_start_section_practice_job", lambda pid, sid: queued.append((pid, sid))
    )

    assert main.prewarm_section_practices("proj_x") == 1
    assert queued == [("proj_x", "sec_b")]
