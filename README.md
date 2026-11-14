# Auto Study Guidance v1.0.0

AI 驱动的学习资料整理、互动练习与多格式导出工作台。上传教材、课件或讲义截图后，按学习阶段自动生成讲义、练习题库、速记卡片与思维导图，支持实时公式渲染与 PDF 打印导出。

---

## 快速启动

### 开发模式（前后端热重载）

在 PowerShell 中运行：

```powershell
cd D:\auto_study_guidance
.\start.ps1
```

脚本会后台静默拉起服务并在浏览器打开工作台，关闭全部终端窗口可用 `.\stop_silent.ps1`：

- **前端工作台**：`http://localhost:5173`
- **后端 API 与 Swagger 文档**：`http://127.0.0.1:8000/docs`

### 单文件桌面版

构建产物位于根目录 [AutoStudyGuidance.exe](AutoStudyGuidance.exe)（基于 WebView2 + 内置 FastAPI 后端）；如需重新构建：

```powershell
cd D:\auto_study_guidance\desktop
.\build_exe.ps1
```

---

## 核心工作流与功能

### 1. 三步学习资料生成流程

1. **资料上传与章节切分**
   支持 `.pdf`、`.pptx`、`.docx`、`.epub`、`.md`、`.txt` 以及讲义截图（`.png` / `.jpg` / `.webp`），解析后在左侧栏展示章节目录并支持勾选出题范围；也可一键载入内置《梯度下降与深度学习》示例课件。
2. **实时 OCR 识别与显存分级部署**
   上传与识别阶段实时推送解析进度，并自动探测本机 NVIDIA 显卡显存分档推荐 OCR 引擎（支持在设置内一键下载并启动）：
   - **`≤ 8 GB` 显存 / 无独显**：MinerU 2 Pipeline / SoMark Free-OXR 开放 API / PaddleOCR
   - **`8 – 48 GB` 显存**：MinerU 2 VLM 全量本地
   - **`≥ 48 GB` 显存**：SoMark OXR Full / MinerU 全量
3. **A / B / C 学习场景选择与流式生成**
   - **A · 入门/零基础学习**：详细自学案（附带例题）、同步练习（作业）、单元检测卷、考前速记（知识点与公式）、MindMap
   - **B · 巩固提高**：分章节巩固卷、综合检测卷、考前速记、MindMap
   - **C · 考前冲刺（抱佛脚）**：重要知识提取、考前速记、考前冲刺卷
   支持手动填写题量/难度/自定义要求，或点击「AI 智能填写参数」自动评估文档密度；点击生成后可流式观察实时进度，并支持带二次确认弹窗的安全打断。

### 2. 双 AI 出题引擎

可在右上角「**设置 → AI 模型通道**」切换与测试连通性：

- **Magpie + DeepSeek Harness (`dsh`)**：一键检测、安装与配置本地 Magpie 反代网关和 `dsh` 命令行运行时；需经用户明确授权确认后，通过本机已安装的免费 AI 软件（**Qoder CN / WorkBuddy / Trae CN**）反代出题。
- **云端大模型 API**：支持 DeepSeek、OpenAI 及兼容 OpenAI/Anthropic 协议的自定义 Base URL 与 API Key。

### 3. 互动练习、键盘闪卡与导出

- **单题卡片式在线练习**：逐题切换作答，选择后即时判分并展开解析抽屉，支持按知识点一键生成同考点变式题。
- **桌面端键盘控制 3D 闪卡**：支持 `←` / `→` 切换正反卡、`Space` / `Enter` 翻转查看答案与解析；一轮结束提供「只复习标记卡片」与「打乱顺序从头开始」。
- **KaTeX 公式与多格式导出**：全链路渲染数学、物理与化学 LaTeX 公式，思维导图基于 Mermaid 渲染，讲义、速记卡、试卷均支持 Markdown 导出与 A4 / A3 PDF 打印排版。

### 4. 外观与新手指引

- **标准界面 & Liquid Glass 液态玻璃**：首次使用默认启用「标准界面」以保证阅读舒适度与兼容性；当本机具备独立 GPU 与 WebGL 硬件加速时，可随时切换为实时光学折射、色散、融合柔边与磨砂模糊的 Liquid Glass 效果（无 GPU 时自动降级回标准界面），并在「**设置 → 界面外观与光学**」调节折射率（IOR）、色散、融合度（Smooth K）与磨砂模糊参数。
- **交互式聚光灯新手指引**：点击顶栏帮助图标（`?`）可分 5 步直接在当前界面上框选对应功能栏与按钮说明用法。

---

## 目录结构

```text
auto_study_guidance/
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI 接口与静态站点托管
│   │   ├── config.py                # 设置持久化与迁移（默认绑定 dsh）
│   │   ├── schemas.py               # 数据模型与 A/B/C 场景结构定义
│   │   ├── parsers/                 # PDF/PPTX/DOCX/图片解析与显存分级 OCR
│   │   ├── router/                  # Magpie+DSH 运行时与云端 API 路由
│   │   └── workflows/               # 场景预设、参数评估、流式生成与 PDF 导出
│   └── data/                        # 本地设置与项目工作区数据
├── frontend/
│   └── src/
│       ├── App.tsx                  # 主工作台布局与视觉/流式状态管理
│       └── components/
│           ├── LiquidGlassCanvas.tsx # WebGL 实时液态玻璃面板折射渲染
│           ├── RouterConfigModal.tsx # 左右分栏系统设置（AI/OCR/外观光学）
│           ├── OnboardingGuideModal.tsx # 界面框选引导式新手教程
│           ├── UploadAndTocPanel.tsx # 左侧资料上传、章节范围与历史项目
│           ├── BlueprintNegotiator.tsx # 3 步流程条、OCR 进度与 A/B/C 参数门控
│           └── StudyStudio.tsx      # 讲义、单题练习、键盘闪卡、速记与导出
└── desktop/                         # WebView2 桌面壳打包脚本 (build_exe.ps1)
```
