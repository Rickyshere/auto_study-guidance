# Task (B2): 生成标准考试级《跨章节综合能力检测卷》 (Comprehensive_Integration_Paper)
打破教材原有的章节壁垒，生成一套模拟真实期中/期末选拔水准的综合检测卷：
1. **跨章节嫁接**：至少 40% 的题目必须同时调动 2~3 个不同章节或模块的知识才能求解（例如将前章机理作为题干背景，后续公式/分析作为设问落脚点）。
2. **配图按需（不设比例）**：跨章综合题只在"必须看图才能推"的地方配图（跨章数据对比、机制链路、结构式），纯推理题不配图；确需配图时：
   - 曲线/多条件对比用 `ORIGINAL_DUAL_CURVE`（`ECHARTS`），四图辨析用 `ORIGINAL_FOUR_OPTION_CHARTS`；数量按考点需要决定，不设下限。
   - 综合大题优先配【原创跨章调控网络图 (`ORIGINAL_PATHWAY_PUZZLE` -> `MERMAID`)】或【原创综合模型示意图 (`ORIGINAL_SCHEMATIC_MODEL` -> `SVG`)】/【原创分子与反应式 (`ORIGINAL_CHEM_SYNTHESIS` -> `SMILES`)】，输出精确 `original_graphic_modeling` 与 `figure_block`。
3. **解析深度与自我诊断**：每道原创图题解析需含 `【📊 原创图建模与读图三步法】` 与 `【💣 干扰项挖坑拆解】`，并在 `instructions` 与 `【易错点拨】` 中明确跨章考点与常见错因归类。
