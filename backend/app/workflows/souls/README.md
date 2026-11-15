# `souls/` —— 生成资料的人格（Soul）单一事实源

本目录里的 `.md` 文件**就是**运行时下发给模型的 prompt 文本。改这里的文件即改线上行为，不需要动 Python。

## 目录结构

```
souls/
├── sayalive_writing_soul.md        通用写作声音规范（去 AI 腔），由 build_courseware_deliverable_soul() 追加到每份 prompt
└── courseware/
    ├── protocols.md                全局协议：PDF/PPTX 清洗规则 + 打印/导出排版硬性规范（三场景共用）
    ├── mode_a.md                   Mode A · 零基础入门导师（The Patient Tutor）
    ├── mode_b.md                   Mode B · 进阶提分教练（The Strict Coach）
    ├── mode_c.md                   Mode C · 考前急救与押题专家（The Exam Hacker）
    └── deliverables/
        ├── A_beginner/{detailed_study_guide,sync_homework,unit_test_paper,cheatsheet,mindmap}.md
        ├── B_consolidate/{detailed_study_guide,chapter_consolidation_paper,comprehensive_test_paper,cheatsheet,mindmap}.md
        └── C_sprint/{key_knowledge_extraction,cheatsheet,cram_exam_paper,mindmap}.md
```

文件名即 `deliverable_id`（去掉 `.md`），目录名即 `scenario_type`。新增交付物 = 放一个新 md 进去；`soul_registry` 启动时按目录扫描，无需改代码。

## 最终 system prompt 的拼装顺序

```
mode_{a,b,c}.md
  ── \n\n---\n\n ──
protocols.md
  ── \n\n---\n\n ──
sayalive_writing_soul.md
  ── \n\n---\n\n ──
deliverables/<scenario>/<deliverable_id>.md
```

这段文本由 `build_courseware_deliverable_soul()` 拼好，作为 **system messages** 下发（`dsh` 通道走 `--soul-file` → dsh_cli 的 `role: system`；云端通道走 `messages[0].role=system`）。任务描述（文档名/章节/原文）作为 **user message** 下发。

试卷链路（`exam_agents/soul_*.md`）是另一套：它们是 `{{变量}}` 模板，渲染后整份作为 **user message** 下发，不再额外挂 system。

## 已明确废弃的旧条款（不要再写回 prompt）

历史设计稿（`backend/docs/design/soul_md.md`）里有几条要求，因为当前渲染器不支持或已被更好的机制取代，此处**有意不实现**。写回 prompt 会造成可见的排版事故：

| 旧条款 | 现状 | 原因 |
| :-- | :-- | :-- |
| `<div class="page-break"></div>` 强制分页 | **已支持** | v1.2.0 起 `generator.normalize_page_breaks()` 把它统一成 `@@ASG_PAGE_BREAK@@`，`pdf_exporter` 与前端 `mathMarkdown.ts` 都识别该 token 并真正分页。讲义可用它把「参考答案」与正文隔开。 |
| `<div class="answer-box" style="height:120px">` 答题框 | 废弃 | 没有任何渲染器实现该 class；`_format_inline_text` 会对正文做 `html.escape`，会**原样印成文字**。 |
| 其它 HTML 标签（`<br>`、`<div style="…">` 等） | 废弃 | 同上，除分页标记外一律禁止输出。 |
| `[书写答题区：请在此处作答，预留 6 行]` 标记 | 改为纯文本提示 | 无 CSS 渲染该标记；改为 `（作答区：预留 6 行）` 纯文本，打印出来就是一句人话。 |
| 同步练习「共 10~15 题」 | 废弃 | 题量改由 `DeliverableConfig.mcq_count/fill_blank_count/short_answer_count` 契约控制（用户可勾选）。 |
| 单元卷「满分 100 分」 | 废弃 | 总分由 `DeliverableConfig.total_score` 决定，且 `_compute_quiz_allocation` 会强制配平到该分数。 |
| MindMap 同时输出「Mermaid + 多级 Markdown 列表树」 | 废弃 | 管线只保留 Mermaid 代码块（`_sanitize_mermaid_code`），列表树会被丢弃；改由前端根据导图数据渲染。 |
| 卷首信息栏（姓名/日期/得分） | **已补回** | 以 `instructions` 字段承载（见 `deliverables/A_beginner/unit_test_paper.md`），导出器会把它排版到卷首。 |

## 修改后如何自检

```powershell
cd D:\auto_study_guidance\backend
$env:PYTHONIOENCODING='utf-8'
& .\.venv\Scripts\python.exe -m pytest tests -q
```

`tests/test_pipeline.py::test_refined_quiz_and_cli_prompts_and_latex_json_parsing` 会校验 mode/task 关键标签是否还在；若你改了 `deliverables/A_beginner/detailed_study_guide.md` 的小节标题，记得同步该测试的断言。

每次生成后，`study_package.json` 的 `routing_trace` 会记录每个 stage 的 **system/task 字节数与 SHA-256 前 12 位**，可用来确认线上到底下发了哪一版 soul；设置环境变量 `ASG_PROMPT_SNAPSHOT_DIR=<目录>` 可把完整 prompt 落盘。
