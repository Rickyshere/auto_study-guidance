import React, { useState } from 'react';

type PresetMode = '随堂练习' | '同步练习' | '自测卷' | '自学案';
type StudioSheet = 'proof' | 'notes' | 'quiz' | 'topology';

interface ChapterRow {
  id: string;
  title: string;
  pages: string;
  density: number;
  selected: boolean;
  plate: string;
}

const INITIAL_CHAPTERS: ChapterRow[] = [
  { id: 'c1', title: '第一章 · 神经网络前向传播与非线性激活机制', pages: 'pp. 1–28', density: 84, selected: true, plate: 'Plate I' },
  { id: 'c2', title: '第二章 · 卷积核局部感受野与残差网络退化抑制', pages: 'pp. 29–64', density: 92, selected: true, plate: 'Plate II' },
  { id: 'c3', title: '第三章 · 缩放点积注意力与 Transformer 并行计算', pages: 'pp. 65–108', density: 96, selected: true, plate: 'Plate III' },
  { id: 'c4', title: '第四章 · 泛化误差界、Dropout 与权重衰减调优', pages: 'pp. 109–142', density: 68, selected: false, plate: 'Plate IV' },
];

const PRESET_SPECS: Record<PresetMode, { subtitle: string; mcq: number; fill: number; short: number; mins: number; score: number }> = {
  随堂练习: { subtitle: '15分钟课堂即时巩固 · 侧重核心概念辨析', mcq: 5, fill: 2, short: 1, mins: 15, score: 50 },
  同步练习: { subtitle: '课后三级分层作业 · 基础达标 / 能力提升 / 拓展探究', mcq: 6, fill: 3, short: 2, mins: 35, score: 100 },
  自测卷: { subtitle: '闭卷模拟测评试卷 · 标准分值分布与评分细则', mcq: 8, fill: 4, short: 3, mins: 60, score: 100 },
  自学案: { subtitle: '零基础导学讲义 · 学习目标 / 费曼类比 / 边学边练', mcq: 4, fill: 2, short: 2, mins: 25, score: 60 },
};

export const ImpeccableShowcase: React.FC = () => {
  const [chapters, setChapters] = useState<ChapterRow[]>(INITIAL_CHAPTERS);
  const [preset, setPreset] = useState<PresetMode>('自学案');
  const [sheet, setSheet] = useState<StudioSheet>('proof');
  const [approved, setApproved] = useState(false);
  const [routeTarget, setRouteTarget] = useState<'claude-cli' | 'cloud-r1' | 'ollama-qwen'>('claude-cli');
  const [selectedAns, setSelectedAns] = useState<string>('B');
  const [promptText, setPromptText] = useState(
    '下周考前三章，概念辨析容易混淆，请重点解析缩放因子 sqrt(d_k) 的物理意义并生成导学案与自测题。'
  );

  const spec = PRESET_SPECS[preset];
  const selectedCount = chapters.filter((c) => c.selected).length;

  const toggleChapter = (id: string) => {
    setChapters((prev) => prev.map((c) => (c.id === id ? { ...c, selected: !c.selected } : c)));
    setApproved(false);
  };

  return (
    <div
      className="min-h-screen text-[#141413] selection:bg-[#C83E1D] selection:text-[#F6F3EC]"
      style={{
        backgroundColor: '#F6F3EC',
        fontFamily: '"Noto Serif SC", "Source Han Serif SC", Georgia, "Times New Roman", serif',
      }}
    >
      {/* Top Architectural Ledger Bar */}
      <header className="border-b border-[#141413]/20 bg-[#F6F3EC]">
        <div className="mx-auto max-w-[1380px] px-6 py-4 flex flex-wrap items-baseline justify-between gap-4">
          <div className="flex items-baseline gap-4">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-[-0.03em] text-[#141413]">
              Auto Study Folio
            </h1>
            <span className="text-xs text-[#57534E] font-sans">
              学术典藏版示范界面 · Impeccable Editorial Craft
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-6 text-xs font-sans">
            <div className="flex items-center gap-2">
              <span className="text-[#57534E]">路由通道</span>
              <div className="inline-flex border border-[#141413]/25 divide-x divide-[#141413]/20">
                {[
                  { id: 'claude-cli', label: 'Claude CLI Harness' },
                  { id: 'cloud-r1', label: 'DeepSeek Cloud API' },
                  { id: 'ollama-qwen', label: 'Ollama 本地模型' },
                ].map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setRouteTarget(r.id as any)}
                    className={`px-2.5 py-1 transition-colors ${
                      routeTarget === r.id
                        ? 'bg-[#141413] text-[#F6F3EC] font-medium'
                        : 'bg-transparent text-[#57534E] hover:text-[#141413]'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="font-mono tabular-nums text-[11px] text-[#1F4E3D] border border-[#1F4E3D]/30 px-2.5 py-1">
              STAGE ROUTER · ACTIVE ({routeTarget.toUpperCase()})
            </div>
          </div>
        </div>
      </header>

      {/* Main Asymmetric Broadsheet */}
      <div className="mx-auto max-w-[1380px] px-6 grid grid-cols-1 lg:grid-cols-12 border-x border-[#141413]/15">
        {/* Left Ledger: Source Folio & Chapter Index */}
        <aside className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-[#141413]/15 py-6 lg:pr-6 space-y-6 font-sans">
          <div className="border-b border-[#141413]/15 pb-5">
            <h2
              className="text-lg font-bold tracking-[-0.02em] text-[#141413]"
              style={{ fontFamily: 'Georgia, "Noto Serif SC", serif' }}
            >
              文献来源与章节索引
            </h2>
            <div className="mt-3 border border-[#141413]/20 bg-[#EFECE3]/60 p-3.5 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-semibold text-[#141413] leading-snug">
                  深度学习与神经网络导论（第三版）.pdf
                </div>
                <span className="font-mono tabular-nums text-[11px] text-[#C83E1D] shrink-0">
                  142 pp
                </span>
              </div>
              <div className="text-xs text-[#57534E]">
                同时已关联课件：《Transformer_Core.pptx》（38 张幻灯片 · 含演讲者备注与 6 幅插图）
              </div>
              <div className="pt-2 flex items-center gap-3 text-[11px]">
                <span className="underline underline-offset-4 decoration-[#C83E1D] text-[#141413] cursor-pointer">
                  替换或追加 PDF / PPTX
                </span>
                <span className="text-[#57534E]">·</span>
                <span className="text-[#57534E]">OCR 扫描识图已就绪</span>
              </div>
            </div>
          </div>

          {/* Hairline Chapter Index Table */}
          <div>
            <div className="flex items-baseline justify-between mb-3">
              <h3
                className="text-base font-semibold text-[#141413]"
                style={{ fontFamily: 'Georgia, "Noto Serif SC", serif' }}
              >
                章节目录清单
              </h3>
              <span className="font-mono tabular-nums text-[11px] text-[#57534E]">
                已选 {selectedCount} / {chapters.length}
              </span>
            </div>

            <div className="divide-y divide-[#141413]/15 border-y border-[#141413]/20">
              {chapters.map((ch) => (
                <button
                  key={ch.id}
                  onClick={() => toggleChapter(ch.id)}
                  className="w-full text-left py-3 flex items-start gap-3 group hover:bg-[#EFECE3]/70 px-1.5 transition-colors"
                >
                  <span
                    className={`mt-1 h-3.5 w-3.5 border flex items-center justify-center shrink-0 ${
                      ch.selected
                        ? 'border-[#141413] bg-[#141413] text-[#F6F3EC]'
                        : 'border-[#141413]/40 bg-transparent'
                    }`}
                  >
                    {ch.selected && (
                      <svg className="w-2.5 h-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M2 6l3 3 5-5" />
                      </svg>
                    )}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className={`text-xs leading-relaxed ${ch.selected ? 'font-semibold text-[#141413]' : 'text-[#57534E]'}`}>
                      {ch.title}
                    </div>
                    <div className="mt-1 flex items-center justify-between font-mono tabular-nums text-[11px] text-[#57534E]">
                      <span>{ch.pages}</span>
                      <span>{ch.plate} · 密度 {ch.density}%</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Extracted Figure Specimen */}
          <div className="pt-1">
            <h3
              className="text-base font-semibold text-[#141413] mb-2.5"
              style={{ fontFamily: 'Georgia, "Noto Serif SC", serif' }}
            >
              提取原书图版样本
            </h3>
            <div className="border border-[#141413]/20 p-3 bg-[#FBF9F4]">
              <svg viewBox="0 0 320 96" className="w-full h-auto text-[#141413]">
                <rect x="8" y="24" width="76" height="44" fill="none" stroke="currentColor" strokeWidth="1.2" />
                <text x="46" y="44" textAnchor="middle" fontSize="9" fill="currentColor">Input + Pos</text>
                <text x="46" y="57" textAnchor="middle" fontSize="8" fill="#57534E">Embedding</text>
                <line x1="84" y1="46" x2="112" y2="46" stroke="currentColor" strokeWidth="1.2" />
                <rect x="112" y="20" width="96" height="52" fill="#EFECE3" stroke="#C83E1D" strokeWidth="1.4" />
                <text x="160" y="43" textAnchor="middle" fontSize="9" fontWeight="bold" fill="#C83E1D">Multi-Head</text>
                <text x="160" y="57" textAnchor="middle" fontSize="8" fill="#141413">Self-Attention</text>
                <line x1="208" y1="46" x2="236" y2="46" stroke="currentColor" strokeWidth="1.2" />
                <rect x="236" y="24" width="76" height="44" fill="none" stroke="currentColor" strokeWidth="1.2" />
                <text x="274" y="44" textAnchor="middle" fontSize="9" fill="currentColor">Add &amp; Norm</text>
                <text x="274" y="57" textAnchor="middle" fontSize="8" fill="#57534E">Feed Forward</text>
              </svg>
              <div className="mt-2 flex justify-between text-[11px] text-[#57534E] font-mono tabular-nums">
                <span>Plate III · Slide 18</span>
                <span>已自动关联至讲义正文</span>
              </div>
            </div>
          </div>
        </aside>

        {/* Right Editorial Broadsheet: Presets, Blueprint Proof & Typeset Output */}
        <section className="lg:col-span-8 py-6 lg:pl-8 space-y-8 font-sans">
          {/* Preset Ledger Strip */}
          <div className="border-b border-[#141413]/20 pb-5">
            <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
              <h2
                className="text-xl font-bold tracking-[-0.02em] text-[#141413]"
                style={{ fontFamily: 'Georgia, "Noto Serif SC", serif' }}
              >
                资料体裁预设与双阶段方案编排
              </h2>
              <span className="text-xs text-[#57534E]">
                先由模型解析需求并反馈校对单，确认后排印输出
              </span>
            </div>

            <div className="flex flex-wrap border border-[#141413]/25 divide-x divide-[#141413]/20 bg-[#FBF9F4]">
              {(['随堂练习', '同步练习', '自测卷', '自学案'] as PresetMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setPreset(m);
                    setApproved(false);
                  }}
                  className={`flex-1 min-w-[110px] py-2.5 px-3 text-xs transition-colors ${
                    preset === m
                      ? 'bg-[#C83E1D] text-[#F6F3EC] font-semibold'
                      : 'text-[#141413] hover:bg-[#EFECE3]'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <p className="mt-2.5 text-xs text-[#57534E] max-w-[68ch] leading-relaxed">
              当前体裁：<strong className="text-[#141413]">{preset}</strong> — {spec.subtitle}
            </p>
          </div>

          {/* Output Sheet Navigation Tabs */}
          <div className="flex items-center justify-between border-b border-[#141413]/20">
            <div className="flex gap-6 text-xs">
              {[
                { key: 'proof' as StudioSheet, label: '一、AI 需求解析校对单' },
                { key: 'notes' as StudioSheet, label: '二、导学案精要讲义' },
                { key: 'quiz' as StudioSheet, label: '三、分层题库与自测卷' },
                { key: 'topology' as StudioSheet, label: '四、知识拓扑图谱' },
              ].map((t) => (
                <button
                  key={t.key}
                  onClick={() => setSheet(t.key)}
                  className={`pb-2.5 border-b-2 transition-colors ${
                    sheet === t.key
                      ? 'border-[#C83E1D] text-[#141413] font-semibold'
                      : 'border-transparent text-[#57534E] hover:text-[#141413]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <span className="font-mono tabular-nums text-[11px] text-[#57534E] pb-2">
              {approved ? 'STATUS: APPROVED' : 'STATUS: AWAITING REVIEW'}
            </span>
          </div>

          {/* Sheet 1: AI Requirement Proof Sheet */}
          {sheet === 'proof' && (
            <div className="space-y-6">
              <div>
                <label className="block text-xs font-semibold text-[#141413] mb-1.5">
                  学习诉求与定制指令
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={promptText}
                    onChange={(e) => {
                      setPromptText(e.target.value);
                      setApproved(false);
                    }}
                    className="flex-1 border border-[#141413]/30 bg-[#FBF9F4] px-3 py-2 text-xs text-[#141413] focus:border-[#C83E1D] focus:outline-none"
                  />
                  <button
                    onClick={() => setApproved(false)}
                    className="border border-[#141413] bg-transparent px-4 py-2 text-xs font-semibold text-[#141413] hover:bg-[#141413] hover:text-[#F6F3EC] transition-colors shrink-0"
                  >
                    重新解析诉求
                  </button>
                </div>
              </div>

              {/* Editorial Proof Ledger Table */}
              <div className="border border-[#141413]/25 bg-[#FBF9F4] p-5 space-y-4">
                <div className="flex items-baseline justify-between border-b border-[#141413]/15 pb-3">
                  <h3
                    className="text-lg font-bold text-[#141413]"
                    style={{ fontFamily: 'Georgia, "Noto Serif SC", serif' }}
                  >
                    生成方案校对单 · {preset}
                  </h3>
                  <span className="font-mono tabular-nums text-[11px] text-[#1F4E3D]">
                    {selectedCount} 章入选 · 约 {spec.mins} 分钟
                  </span>
                </div>

                <p className="text-xs text-[#141413]/85 leading-relaxed max-w-[68ch]">
                  模型已比对《深度学习与神经网络导论》前 {selectedCount} 章目录与您的备考需求：将着重辨析
                  <strong className="underline underline-offset-4 decoration-[#C83E1D]/60 mx-1">
                    Sigmoid 梯度消失 vs ReLU 死区
                  </strong>
                  、
                  <strong className="underline underline-offset-4 decoration-[#C83E1D]/60 mx-1">
                    缩放因子 1/√d_k 的方差归一化作用
                  </strong>
                  ，并同步嵌入第 3 章注意力机制原书图版（Plate III）。
                </p>

                <table className="w-full text-xs border-t border-b border-[#141413]/20">
                  <thead>
                    <tr className="border-b border-[#141413]/15 text-[#57534E]">
                      <th className="py-2 text-left font-medium">产出模块</th>
                      <th className="py-2 text-left font-medium">编排规格</th>
                      <th className="py-2 text-right font-medium">路由分配</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#141413]/10 font-mono tabular-nums">
                    <tr>
                      <td className="py-2.5 font-sans font-medium text-[#141413]">章节精要讲义</td>
                      <td className="py-2.5 font-sans text-[#57534E]">
                        {preset === '自学案' ? '学习目标 + 费曼类比 + 例题剖析' : '核心要点与易错概念辨析'}
                      </td>
                      <td className="py-2.5 text-right text-[#1F4E3D]">{routeTarget}</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 font-sans font-medium text-[#141413]">分层练习题库</td>
                      <td className="py-2.5 font-sans text-[#57534E]">
                        单选 {spec.mcq} 题 · 填空 {spec.fill} 题 · 简答 {spec.short} 题（共 {spec.score} 分）
                      </td>
                      <td className="py-2.5 text-right text-[#1F4E3D]">{routeTarget}</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 font-sans font-medium text-[#141413]">知识拓扑图谱</td>
                      <td className="py-2.5 font-sans text-[#57534E]">3 层概念因果关联图（支持 SVG 导出）</td>
                      <td className="py-2.5 text-right text-[#57534E]">ollama-qwen</td>
                    </tr>
                  </tbody>
                </table>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <span className="text-[11px] text-[#57534E]">
                    核对无误后点击右侧按钮确认，系统将切换至排印预览
                  </span>
                  <button
                    onClick={() => {
                      setApproved(true);
                      setSheet('notes');
                    }}
                    className="bg-[#1F4E3D] text-[#F6F3EC] px-5 py-2.5 text-xs font-semibold tracking-wide hover:bg-[#16392C] transition-colors"
                  >
                    批准方案并排印生成 →
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Sheet 2: Editorial Monograph Notes */}
          {sheet === 'notes' && (
            <article className="space-y-6 max-w-[68ch]">
              <h3
                className="text-2xl font-bold tracking-[-0.02em] text-[#141413]"
                style={{ fontFamily: 'Georgia, "Noto Serif SC", serif' }}
              >
                第三章自学案：缩放点积注意力机制的数学直觉
              </h3>
              <p className="text-sm leading-7 text-[#141413]/90">
                在传统循环神经网络（RNN）中，序列信息必须沿时间步逐次传递，导致长距离依赖出现梯度衰减。
                Transformer 彻底摒弃了递归结构，转而通过计算任意两个词元之间的点积相似度，实现全序列并行交互。
              </p>

              <div className="border-y border-[#141413]/20 py-4 grid grid-cols-1 sm:grid-cols-3 gap-4 bg-[#FBF9F4]/60 px-4">
                <div className="sm:col-span-2 space-y-2">
                  <div className="text-xs font-bold text-[#141413]">
                    核心公式推导：为何除以 √d_k？
                  </div>
                  <p className="text-xs text-[#57534E] leading-relaxed">
                    假设 Query 与 Key 的各个分量相互独立且服从均值为 0、方差为 1 的标准正态分布，则它们的点积方差会随维度 d_k 线性放大至 d_k。
                    若不进行缩放，点积绝对值过大将把 Softmax 推入梯度极小的饱和区。除以 √d_k 可使点积方差重新稳定为 1。
                  </p>
                </div>
                <div className="border-t sm:border-t-0 sm:border-l border-[#141413]/15 pt-2 sm:pt-0 sm:pl-4 text-[11px] text-[#C83E1D] leading-relaxed">
                  <strong>旁注 · 考前易错提醒</strong>
                  <p className="mt-1 text-[#57534E]">
                    位置编码（Positional Encoding）直接与词嵌入相加而非拼接，以保持特征维度 d_model 不变。
                  </p>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={() => setSheet('quiz')}
                  className="text-xs font-semibold text-[#C83E1D] underline underline-offset-4"
                >
                  前往配套{preset}测试题 →
                </button>
              </div>
            </article>
          )}

          {/* Sheet 3: Interactive Quiz Ledger */}
          {sheet === 'quiz' && (
            <div className="space-y-5 max-w-[68ch]">
              <div className="flex items-baseline justify-between border-b border-[#141413]/20 pb-3">
                <h3
                  className="text-xl font-bold text-[#141413]"
                  style={{ fontFamily: 'Georgia, "Noto Serif SC", serif' }}
                >
                  {preset} · 样题与解析校样
                </h3>
                <span className="font-mono tabular-nums text-xs text-[#57534E]">
                  第 1 题 / 共 {spec.mcq + spec.fill + spec.short} 题
                </span>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-3 font-mono tabular-nums text-[11px] text-[#57534E]">
                  <span className="border border-[#141413]/30 px-2 py-0.5 text-[#141413]">单选题</span>
                  <span>能力提升</span>
                  <span>5 分</span>
                  <span>出处：第 3 章 · p. 74</span>
                </div>
                <p className="text-sm font-medium text-[#141413] leading-relaxed">
                  在 Scaled Dot-Product Attention 计算中，将 QK^T 除以 √d_k 的主要目的是什么？
                </p>
                <div className="divide-y divide-[#141413]/15 border border-[#141413]/25 bg-[#FBF9F4]">
                  {[
                    { k: 'A', t: '降低矩阵乘法的空间复杂度，减少显存占用' },
                    { k: 'B', t: '维持点积方差为 1，防止 Softmax 进入梯度极小的饱和区' },
                    { k: 'C', t: '替代位置编码，为序列注入绝对位置信息' },
                    { k: 'D', t: '强制注意力权重矩阵满足正交约束' },
                  ].map((opt) => (
                    <button
                      key={opt.k}
                      onClick={() => setSelectedAns(opt.k)}
                      className={`w-full text-left px-4 py-2.5 text-xs flex items-center justify-between transition-colors ${
                        selectedAns === opt.k ? 'bg-[#EFECE3] font-semibold text-[#141413]' : 'hover:bg-[#F6F3EC]'
                      }`}
                    >
                      <span>
                        <strong className="font-mono mr-2">{opt.k}.</strong>
                        {opt.t}
                      </span>
                      {opt.k === 'B' && selectedAns === 'B' && (
                        <span className="text-[#1F4E3D] font-mono text-[11px]">✓ 正确</span>
                      )}
                    </button>
                  ))}
                </div>
                <div className="border border-[#1F4E3D]/30 bg-[#1F4E3D]/5 p-3.5 text-xs text-[#141413] leading-relaxed">
                  <strong className="text-[#1F4E3D]">解析：</strong>
                  当维度 d_k 较大时，点积方差线性增长，导致 Softmax 输出趋近于 One-hot 分布，反向传播梯度趋近于 0。
                </div>
              </div>
            </div>
          )}

          {/* Sheet 4: Topology Preview */}
          {sheet === 'topology' && (
            <div className="border border-[#141413]/25 bg-[#FBF9F4] p-6 space-y-4">
              <div className="flex items-baseline justify-between">
                <h3
                  className="text-lg font-bold text-[#141413]"
                  style={{ fontFamily: 'Georgia, "Noto Serif SC", serif' }}
                >
                  知识拓扑结构图（第 1–3 章）
                </h3>
                <span className="font-mono text-[11px] text-[#57534E]">SVG VECTOR GRAPH</span>
              </div>
              <svg viewBox="0 0 680 220" className="w-full h-auto">
                <rect x="20" y="85" width="140" height="44" fill="#141413" />
                <text x="90" y="111" textAnchor="middle" fontSize="12" fill="#F6F3EC" fontWeight="bold">
                  深度学习核心架构
                </text>
                <path d="M160 107 C210 107, 210 42, 260 42" fill="none" stroke="#141413" strokeWidth="1.2" />
                <path d="M160 107 L260 107" fill="none" stroke="#141413" strokeWidth="1.2" />
                <path d="M160 107 C210 107, 210 172, 260 172" fill="none" stroke="#C83E1D" strokeWidth="1.4" />

                <rect x="260" y="22" width="160" height="38" fill="#F6F3EC" stroke="#141413" strokeWidth="1.2" />
                <text x="340" y="45" textAnchor="middle" fontSize="11" fill="#141413">1. 前馈网络与激活</text>

                <rect x="260" y="88" width="160" height="38" fill="#F6F3EC" stroke="#141413" strokeWidth="1.2" />
                <text x="340" y="111" textAnchor="middle" fontSize="11" fill="#141413">2. 卷积与残差连接</text>

                <rect x="260" y="153" width="160" height="38" fill="#EFECE3" stroke="#C83E1D" strokeWidth="1.5" />
                <text x="340" y="176" textAnchor="middle" fontSize="11" fill="#C83E1D" fontWeight="bold">3. 注意力与 Transformer</text>

                <line x1="420" y1="41" x2="470" y2="41" stroke="#57534E" strokeWidth="1" />
                <text x="480" y="45" fontSize="11" fill="#57534E">ReLU / 链式反向传播</text>

                <line x1="420" y1="107" x2="470" y2="107" stroke="#57534E" strokeWidth="1" />
                <text x="480" y="111" fontSize="11" fill="#57534E">感受野 / y = F(x) + x</text>

                <line x1="420" y1="172" x2="470" y2="172" stroke="#C83E1D" strokeWidth="1.2" />
                <text x="480" y="176" fontSize="11" fill="#141413" fontWeight="bold">QKV / 缩放 √d_k / 位置编码</text>
              </svg>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
