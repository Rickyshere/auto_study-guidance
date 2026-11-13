# Auto Study Guidance · 智能课本/课件学习资料生成系统

位于 `D:\auto_study_guidance` 的全栈 Web 应用：上传课本或 PPTX 课件，通过 **云端 API / 本地模型 (Ollama·LM Studio) / 本地 Agent CLI Harness (`claude`·`codex`·`gemini`)** 路由，结合 **教学预设模板** 与 **“AI 需求解析 → 反馈确认 → 正式生成”** 双阶段工作流，一键生成导学案、精要笔记、考前速记表、在线互动自测题库与 Mermaid 知识图谱。

## 快速启动

在 PowerShell 中运行一键启动脚本：

```powershell
cd D:\auto_study_guidance
.\start.ps1
```

启动后在浏览器访问：
- **前端工作台**：`http://localhost:5173`
- **后端 API 文档**：`http://127.0.0.1:8000/docs`

## 核心特性

1. **多格式课本与课件解析 (`backend/app/parsers/`)**
   - `.pdf`：提取书签目录 / 启发式章节切分、正文、内嵌插图，支持扫描页自动识别与 OCR/VLM 识图。
   - `.pptx`：提取幻灯片标题、多级正文列表、表格（转 Markdown）、演讲者备注（Speaker Notes）及内嵌图片。
   - `.docx` / `.epub` / `.md` / `.txt` / 课件截图 (`.png` / `.jpg` / `.webp`)。
2. **三模路由与 CLI Harness 编排 (`backend/app/router/`)**
   - **单一引擎直连** 或 **多阶段智能 Harness 编排**（按识图、需求解析、笔记生成、题库命制、知识图谱 5 个阶段分别分配引擎）。
   - 支持 **Cloud API**（OpenAI / DeepSeek / OpenRouter / Anthropic）、**本地模型**（Ollama / LM Studio 自动探测）、**本地 CLI Harness**（自动检测本机 `claude`、`codex`、`gemini` CLI 或自定义命令模板），并提供内置智能规则引擎安全回退。
3. **6 大预设模板 + 双阶段需求协商工作流 (`backend/app/workflows/`)**
   - **随堂练习**（10-15分钟当堂检测）
   - **同步练习**（课后巩固 · 基础达标/能力提升/拓展探究三级分层）
   - **自测卷**（100分标准模拟计时卷，支持在线交卷自动判分）
   - **自学案**（预习导学 · 学习目标 + 通俗精讲 + 边学边练）
   - **考前速记包**（高密度双栏速记表 + 易混对比）
   - **自由定制 · AI 需求解析**（自然语言输入需求 → AI 解析反馈方案单 → 用户微调确认 → 流式生成）
