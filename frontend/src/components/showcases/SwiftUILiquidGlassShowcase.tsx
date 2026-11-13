import React, { useState } from 'react';
import {
  BookOpen,
  Check,
  Sparkles,
  Zap,
  Layers,
  Award,
  Plus,
  Terminal,
  Columns2,
  Smartphone,
  Tablet,
} from 'lucide-react';

type PresetId = 'in_class' | 'sync' | 'exam' | 'guide';
type DuoPose = 'duo_spread' | 'split_medium' | 'compact';
type RouteId = 'claude' | 'deepseek' | 'ollama';

const PRESETS: {
  id: PresetId;
  name: string;
  badge: string;
  mcq: number;
  fill: number;
  short: number;
  score: number;
  mins: number;
  icon: React.ReactNode;
}[] = [
  { id: 'in_class', name: '随堂练习', badge: '15m', mcq: 5, fill: 2, short: 1, score: 50, mins: 15, icon: <Zap className="w-4 h-4" /> },
  { id: 'sync', name: '同步练习', badge: '分层', mcq: 6, fill: 3, short: 2, score: 100, mins: 35, icon: <Layers className="w-4 h-4" /> },
  { id: 'exam', name: '自测卷', badge: '100分', mcq: 8, fill: 4, short: 3, score: 100, mins: 60, icon: <Award className="w-4 h-4" /> },
  { id: 'guide', name: '自学案', badge: '导学', mcq: 4, fill: 2, short: 2, score: 60, mins: 25, icon: <BookOpen className="w-4 h-4" /> },
];

const CHAPTERS = [
  { id: '1', title: '第 1 章 · 神经网络与激活函数', meta: 'Slide 1–9 · 3.2k 字' },
  { id: '2', title: '第 2 章 · 卷积感受野与 ResNet 残差', meta: 'Slide 10–19 · 4.1k 字' },
  { id: '3', title: '第 3 章 · 注意力机制与 Transformer', meta: 'Slide 20–31 · 5.4k 字' },
  { id: '4', title: '第 4 章 · 泛化误差与正则化调优', meta: 'Slide 32–38 · 2.8k 字' },
];

export const SwiftUILiquidGlassShowcase: React.FC = () => {
  const [pose, setPose] = useState<DuoPose>('duo_spread');
  const [preset, setPreset] = useState<PresetId>('guide');
  const [route, setRoute] = useState<RouteId>('claude');
  const [selectedChapters, setSelectedChapters] = useState<string[]>(['1', '2', '3']);
  const [approved, setApproved] = useState(false);
  const [pickedOpt, setPickedOpt] = useState('B');
  const [userNote, setUserNote] = useState('重点解析缩放点积注意力 1/√d_k 的方差意义，附导学类比');

  const currentPreset = PRESETS.find((p) => p.id === preset)!;

  const toggleChapter = (id: string) => {
    setSelectedChapters((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
    setApproved(false);
  };

  return (
    <div
      className="relative min-h-screen pb-28 overflow-x-hidden"
      style={{
        // Background spans the fold smoothly ("Treat the fold like the spine of a book")
        background:
          'linear-gradient(135deg, #DCEBFF 0%, #EFF4FA 38%, #E7F0F9 68%, #DCE7F5 100%)',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "PingFang SC", sans-serif',
      }}
    >
      <style>{`
        /* iOS 26+ Liquid Glass surface for floating toolbars & safeAreaBar ONLY (never inside ScrollView/List) */
        .lg-glass-container {
          background: linear-gradient(180deg, rgba(255,255,255,0.68) 0%, rgba(255,255,255,0.44) 100%);
          backdrop-filter: blur(28px) saturate(190%);
          -webkit-backdrop-filter: blur(28px) saturate(190%);
          border: 1px solid rgba(255, 255, 255, 0.78);
          box-shadow:
            0 10px 30px rgba(15, 23, 42, 0.08),
            inset 0 1.5px 0 rgba(255, 255, 255, 0.95),
            inset 0 -1px 0 rgba(255, 255, 255, 0.35);
        }
        .lg-btn-glass {
          background: rgba(255, 255, 255, 0.56);
          backdrop-filter: blur(18px) saturate(180%);
          -webkit-backdrop-filter: blur(18px) saturate(180%);
          border: 1px solid rgba(255, 255, 255, 0.8);
          box-shadow: 0 3px 12px rgba(15, 23, 42, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.9);
          padding: 10px 18px; /* ~13pt internal liquid glass padding rule */
          transition: transform 130ms cubic-bezier(0.23, 1, 0.32, 1), background-color 150ms ease;
        }
        .lg-btn-glass:active {
          transform: scale(0.96);
        }
        /* .buttonStyle(.glassProminent).tint(solidColor) - strictly solid tint, NEVER gradient */
        .lg-btn-prominent {
          background-color: #007AFF;
          color: #FFFFFF;
          border: 1px solid rgba(255, 255, 255, 0.45);
          box-shadow: 0 8px 20px rgba(0, 122, 255, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.45);
          padding: 10px 20px;
          transition: transform 130ms cubic-bezier(0.23, 1, 0.32, 1), filter 150ms ease;
        }
        .lg-btn-prominent:active {
          transform: scale(0.96);
          filter: brightness(0.95);
        }
        /* Book-spine fold shadow for Duo spread */
        .duo-spine {
          background: linear-gradient(
            90deg,
            rgba(15, 23, 42, 0.04) 0%,
            rgba(15, 23, 42, 0.14) 48%,
            rgba(255, 255, 255, 0.65) 52%,
            rgba(15, 23, 42, 0.03) 100%
          );
        }
      `}</style>

      {/* Top Navigation Toolbar: sharedBackgroundVisibility(.hidden) on plain label, GlassEffectContainer on controls */}
      <header className="sticky top-0 z-20 px-5 pt-4 pb-3">
        <div className="mx-auto max-w-[1260px] flex flex-wrap items-center justify-between gap-3">
          {/* Plain toolbar item without glass capsule (.sharedBackgroundVisibility(.hidden)) */}
          <div className="px-1">
            <h1 className="text-lg font-bold tracking-[-0.02em] text-[#0F172A]">
              StudyBook · SwiftUI Liquid Glass &amp; iPhone Duo 示范版
            </h1>
            <p className="text-[11px] text-[#475569]">
              GlassEffectContainer 液态玻璃胶囊 · ScrollView 内纯实色分组表 · Book-Spine 双页折叠自适应
            </p>
          </div>

          {/* Grouped Glass Controls inside GlassEffectContainer */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Container Space Pose Switcher (Duo Adaptability Demo) */}
            <div className="lg-glass-container rounded-full p-1 flex items-center gap-1">
              {[
                { id: 'duo_spread' as DuoPose, label: 'Duo 展开双页', icon: <Columns2 className="w-3.5 h-3.5" /> },
                { id: 'split_medium' as DuoPose, label: '中等分栏', icon: <Tablet className="w-3.5 h-3.5" /> },
                { id: 'compact' as DuoPose, label: '紧凑单页', icon: <Smartphone className="w-3.5 h-3.5" /> },
              ].map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPose(p.id)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium inline-flex items-center gap-1.5 transition ${
                    pose === p.id
                      ? 'bg-[#0F172A] text-white shadow-xs'
                      : 'text-[#334155] hover:bg-white/60'
                  }`}
                >
                  {p.icon}
                  <span>{p.label}</span>
                </button>
              ))}
            </div>

            {/* Route Capsule (.buttonStyle(.glass)) with plain unenclosed symbol */}
            <button
              onClick={() =>
                setRoute((r) => (r === 'claude' ? 'deepseek' : r === 'deepseek' ? 'ollama' : 'claude'))
              }
              className="lg-btn-glass rounded-full text-xs font-semibold text-[#0F172A] inline-flex items-center gap-2"
            >
              <Terminal className="w-4 h-4 text-[#007AFF]" />
              <span>
                路由：{route === 'claude' ? 'Claude CLI' : route === 'deepseek' ? 'DeepSeek API' : 'Ollama'}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Adaptive Container (Preserves all state across Duo spread -> Medium -> Compact) */}
      <main
        className={`mx-auto px-4 sm:px-6 pt-2 transition-all duration-300 ${
          pose === 'compact'
            ? 'max-w-[460px]'
            : pose === 'split_medium'
            ? 'max-w-[960px]'
            : 'max-w-[1260px]'
        }`}
      >
        <div
          className={`rounded-[32px] border border-white/80 bg-[#F2F2F7]/92 shadow-[0_24px_60px_rgba(15,23,42,0.10)] overflow-hidden ${
            pose === 'compact'
              ? 'grid grid-cols-1 divide-y divide-black/10'
              : 'grid grid-cols-1 lg:grid-cols-[1fr_14px_1fr]'
          }`}
        >
          {/* LEFT PAGE: Scrollable Content — Strictly NO Liquid Glass inside ScrollView/List! */}
          <div className="p-6 space-y-5 max-h-[680px] overflow-y-auto bg-[#F2F2F7]">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-[#1C1C1E]">
                左页：课本目录与 AI 需求解析单
              </h2>
              <span className="text-xs font-mono tabular-nums text-[#636366]">
                已选 {selectedChapters.length}/{CHAPTERS.length} 章
              </span>
            </div>

            {/* Solid iOS Grouped Inset List (no glass inside scroll!) */}
            <div className="rounded-2xl bg-white divide-y divide-[#E5E5EA] overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
              <div className="px-4 py-3 flex items-center justify-between bg-[#FAFAFC]">
                <div>
                  <div className="text-xs font-semibold text-[#1C1C1E]">
                    Transformer核心架构精讲.pptx
                  </div>
                  <div className="text-[11px] text-[#8E8E93]">38 页幻灯片 · 含备注与插图</div>
                </div>
                <span className="text-[11px] font-semibold text-[#007AFF]">已解析</span>
              </div>

              {CHAPTERS.map((ch) => {
                const on = selectedChapters.includes(ch.id);
                return (
                  <button
                    key={ch.id}
                    onClick={() => toggleChapter(ch.id)}
                    className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-[#F9F9FB] transition-colors"
                  >
                    <div>
                      <div className={`text-xs ${on ? 'font-semibold text-[#1C1C1E]' : 'text-[#636366]'}`}>
                        {ch.title}
                      </div>
                      <div className="text-[11px] text-[#8E8E93] tabular-nums mt-0.5">{ch.meta}</div>
                    </div>
                    <span
                      className={`h-5 w-5 rounded-full flex items-center justify-center ${
                        on ? 'bg-[#007AFF] text-white' : 'bg-[#E5E5EA] text-transparent'
                      }`}
                    >
                      <Check className="w-3 h-3" />
                    </span>
                  </button>
                );
              })}
            </div>

            {/* AI Requirement Negotiation Proof (Solid Card in ScrollView) */}
            <div className="rounded-2xl bg-white p-4 space-y-3 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#1C1C1E] flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-[#007AFF]" />
                  阶段一：AI 需求解析反馈
                </span>
                <span className="text-[11px] font-semibold text-[#34C759]">
                  {approved ? '已确认方案' : '待您确认'}
                </span>
              </div>
              <input
                type="text"
                value={userNote}
                onChange={(e) => {
                  setUserNote(e.target.value);
                  setApproved(false);
                }}
                className="w-full rounded-xl bg-[#F2F2F7] px-3 py-2 text-xs text-[#1C1C1E] border border-transparent focus:border-[#007AFF] focus:bg-white focus:outline-hidden"
              />
              <p className="text-xs text-[#48484A] leading-relaxed">
                将按 <strong>【{currentPreset.name}】</strong> 规格为选中的{' '}
                <strong>{selectedChapters.length} 个章节</strong> 生成：单选 {currentPreset.mcq} 题 ·
                填空 {currentPreset.fill} 题 · 简答 {currentPreset.short} 题（共 {currentPreset.score} 分，
                建议 {currentPreset.mins} 分钟）。
              </p>
            </div>
          </div>

          {/* BOOK SPINE FOLD CREASE (Nothing centered across the fold!) */}
          {pose !== 'compact' && (
            <div className="hidden lg:block duo-spine w-[14px] h-full" aria-hidden="true" />
          )}

          {/* RIGHT PAGE: Generated Study Guide & Quiz Detail */}
          <div className="p-6 space-y-5 max-h-[680px] overflow-y-auto bg-[#FFFFFF]">
            <div className="flex items-center justify-between border-b border-[#E5E5EA] pb-3">
              <div>
                <h2 className="text-base font-bold text-[#1C1C1E]">
                  右页：{currentPreset.name} · 排印预览
                </h2>
                <p className="text-[11px] text-[#8E8E93] tabular-nums">
                  路由通道：{route.toUpperCase()} · 满分 {currentPreset.score} 分
                </p>
              </div>
              <span className="rounded-lg bg-[#F2F2F7] px-2.5 py-1 text-[11px] font-semibold text-[#1C1C1E] tabular-nums">
                {currentPreset.mins} min
              </span>
            </div>

            {/* Study Guide Excerpt */}
            <div className="rounded-2xl bg-[#F2F2F7] p-4 space-y-2">
              <div className="text-xs font-bold text-[#1C1C1E]">
                核心概念导读 · Scaled Dot-Product Attention
              </div>
              <p className="text-xs text-[#3A3A3C] leading-relaxed max-w-[65ch]">
                当向量维度 d_k 增大时，Query 与 Key 的点积方差同步放大为 d_k，容易使 Softmax 进入梯度极小的饱和区。通过除以 √d_k 进行方差归一化，可保证反向传播梯度稳定。
              </p>
            </div>

            {/* Quiz Section inside ScrollView (Clean solid surface, no glass) */}
            <div className="space-y-2.5">
              <div className="text-xs font-bold text-[#1C1C1E]">
                样题自测（第 1 / {currentPreset.mcq + currentPreset.fill + currentPreset.short} 题）
              </div>
              <p className="text-xs text-[#1C1C1E] leading-relaxed">
                为什么 Transformer 在计算点积注意力时需要除以缩放因子 √d_k？
              </p>
              <div className="rounded-2xl border border-[#E5E5EA] divide-y divide-[#E5E5EA] overflow-hidden">
                {[
                  { k: 'A', t: '降低自注意力矩阵的显存占用' },
                  { k: 'B', t: '稳定点积方差为 1，防止 Softmax 梯度消失' },
                  { k: 'C', t: '为词元注入绝对位置编码信息' },
                ].map((opt) => (
                  <button
                    key={opt.k}
                    onClick={() => setPickedOpt(opt.k)}
                    className={`w-full text-left px-4 py-3 text-xs flex items-center justify-between transition-colors ${
                      pickedOpt === opt.k ? 'bg-[#EBF4FF] font-semibold text-[#007AFF]' : 'bg-white text-[#1C1C1E] hover:bg-[#F9F9FB]'
                    }`}
                  >
                    <span>
                      <strong className="mr-2">{opt.k}.</strong>
                      {opt.t}
                    </span>
                    {pickedOpt === opt.k && opt.k === 'B' && (
                      <span className="text-[#34C759] font-semibold">✓ 正确</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Bottom Floating .safeAreaBar(.bottom) with GlassEffectContainer & Unenclosed SF-style Symbols */}
      <div className="fixed inset-x-0 bottom-4 z-30 px-4 flex justify-center pointer-events-none">
        <div className="pointer-events-auto lg-glass-container rounded-full p-2 flex flex-wrap items-center justify-center gap-2 max-w-full">
          {/* Grouped Preset Glass Pills */}
          {PRESETS.map((p) => {
            const active = preset === p.id;
            return (
              <button
                key={p.id}
                onClick={() => {
                  setPreset(p.id);
                  setApproved(false);
                }}
                className={`rounded-full text-xs font-semibold inline-flex items-center gap-1.5 transition ${
                  active
                    ? 'bg-[#1C1C1E] text-white px-4 py-2.5 shadow-sm'
                    : 'lg-btn-glass text-[#1C1C1E]'
                }`}
              >
                {p.icon}
                <span>{p.name}</span>
              </button>
            );
          })}

          {/* Primary Tinted Prominent Liquid Glass Action (.buttonStyle(.glassProminent).tint(.blue)) */}
          <button
            onClick={() => setApproved(true)}
            className="lg-btn-prominent rounded-full text-xs font-bold inline-flex items-center gap-1.5"
          >
            {approved ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            <span>{approved ? '已确认生成' : '确认方案并生成'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
