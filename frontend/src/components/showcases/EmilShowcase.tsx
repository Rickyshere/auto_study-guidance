import React, { useEffect, useState } from 'react';
import {
  Check,
  Command,
  FileText,
  Layers,
  Sparkles,
  Terminal,
  Zap,
  Award,
  BookOpen,
  ChevronRight,
} from 'lucide-react';

type PresetId = 'in_class' | 'sync' | 'exam' | 'guide';
type StageTab = 'negotiate' | 'studio';

interface ToastItem {
  id: number;
  title: string;
  detail: string;
}

const PRESETS: { id: PresetId; name: string; tag: string; mcq: number; fill: number; short: number; mins: number; icon: React.ReactNode }[] = [
  { id: 'in_class', name: '随堂练习', tag: '15m', mcq: 5, fill: 2, short: 1, mins: 15, icon: <Zap className="w-3.5 h-3.5" /> },
  { id: 'sync', name: '同步练习', tag: '分层', mcq: 6, fill: 3, short: 2, mins: 35, icon: <Layers className="w-3.5 h-3.5" /> },
  { id: 'exam', name: '自测卷', tag: '100分', mcq: 8, fill: 4, short: 3, mins: 60, icon: <Award className="w-3.5 h-3.5" /> },
  { id: 'guide', name: '自学案', tag: '导学', mcq: 4, fill: 2, short: 2, mins: 25, icon: <BookOpen className="w-3.5 h-3.5" /> },
];

const CHAPTERS = [
  { id: '1', title: '第1章 神经网络与激活函数', pages: 'Slide 1–9', chars: '3.2k' },
  { id: '2', title: '第2章 卷积局部感受野与 ResNet', pages: 'Slide 10–19', chars: '4.1k' },
  { id: '3', title: '第3章 注意力机制与 Transformer', pages: 'Slide 20–31', chars: '5.4k' },
  { id: '4', title: '第4章 泛化、Dropout 与正则调优', pages: 'Slide 32–38', chars: '2.8k' },
];

export const EmilShowcase: React.FC = () => {
  const [preset, setPreset] = useState<PresetId>('guide');
  const [stageTab, setStageTab] = useState<StageTab>('negotiate');
  const [morphingBlur, setMorphingBlur] = useState(false);

  const [selectedCh, setSelectedCh] = useState<string[]>(['1', '2', '3']);
  const [mcqCount, setMcqCount] = useState(4);
  const [fillCount, setFillCount] = useState(2);
  const [shortCount, setShortCount] = useState(2);

  // Origin-aware popover state
  const [routerOpen, setRouterOpen] = useState(false);
  const [routeEngine, setRouteEngine] = useState<'claude' | 'deepseek' | 'ollama'>('claude');

  // Keyboard-initiated Command Palette (0ms animation per Emil's rule!)
  const [cmdOpen, setCmdOpen] = useState(false);

  // Button state morphing + Sonner-style toast stack
  const [genState, setGenState] = useState<'idle' | 'working' | 'ready'>('idle');
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  // Interactive Quiz Answer state
  const [pickedOption, setPickedOption] = useState<string>('B');

  const pushToast = (title: string, detail: string) => {
    const id = Date.now();
    setToasts((prev) => [...prev.slice(-2), { id, title, detail }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  };

  // Blur-bridged view transition (Emil's blur-mask technique)
  const switchStage = (next: StageTab) => {
    if (next === stageTab) return;
    setMorphingBlur(true);
    setTimeout(() => {
      setStageTab(next);
      setMorphingBlur(false);
    }, 140);
  };

  const applyPreset = (p: (typeof PRESETS)[number]) => {
    setPreset(p.id);
    setMcqCount(p.mcq);
    setFillCount(p.fill);
    setShortCount(p.short);
    setGenState('idle');
    pushToast(`已加载预设：${p.name}`, `题量已同步为 ${p.mcq}单选 · ${p.fill}填空 · ${p.short}简答`);
  };

  const handleConfirmGenerate = () => {
    setGenState('working');
    setTimeout(() => {
      setGenState('ready');
      switchStage('studio');
      pushToast('学习资料已排布完成', `通过 ${routeEngine.toUpperCase()} 路由生成完毕`);
    }, 650);
  };

  // Keyboard shortcut Cmd+K / Ctrl+K -> Instant 0ms open (no animation!)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setCmdOpen(false);
        setRouterOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const currentPresetObj = PRESETS.find((p) => p.id === preset)!;

  return (
    <div
      className="min-h-screen bg-[#FAFAFA] text-[#111111]"
      style={
        {
          '--ease-out': 'cubic-bezier(0.23, 1, 0.32, 1)',
          '--ease-in-out': 'cubic-bezier(0.77, 0, 0.175, 1)',
        } as React.CSSProperties
      }
    >
      <style>{`
        .emil-press {
          transition: transform 150ms cubic-bezier(0.23, 1, 0.32, 1), background-color 160ms ease, border-color 160ms ease;
        }
        .emil-press:active {
          transform: scale(0.97);
        }
        .emil-stagger-item {
          opacity: 0;
          transform: translateY(6px) scale(0.985);
          animation: emilEnter 240ms cubic-bezier(0.23, 1, 0.32, 1) forwards;
        }
        @keyframes emilEnter {
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        .emil-popover {
          transform-origin: top right;
          transition: transform 180ms cubic-bezier(0.23, 1, 0.32, 1), opacity 160ms cubic-bezier(0.23, 1, 0.32, 1);
        }
        .emil-toast {
          animation: emilToastIn 240ms cubic-bezier(0.23, 1, 0.32, 1) forwards;
        }
        @keyframes emilToastIn {
          from {
            opacity: 0;
            transform: translateY(100%) scale(0.96);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        .emil-blur-bridge {
          transition: filter 150ms ease, opacity 150ms ease, transform 180ms cubic-bezier(0.23, 1, 0.32, 1);
        }
      `}</style>

      {/* Precision Top Bar */}
      <header className="sticky top-0 z-20 border-b border-black/[0.07] bg-white/90 backdrop-blur-md">
        <div className="mx-auto max-w-[1280px] px-5 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-7 w-7 rounded-lg bg-[#111111] text-white flex items-center justify-center shadow-xs">
              <Sparkles className="w-3.5 h-3.5" />
            </div>
            <div>
              <div className="text-[13px] font-semibold tracking-[-0.02em] text-[#111111]">
                StudyCraft · Emil Kowalski 精工微交互示范版
              </div>
              <div className="text-[11px] text-[#666666]">
                ease-out 曲线 · scale(0.97) 触感反馈 · Blur 过渡遮罩 · ⌘K 零动画快开
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 relative">
            {/* Instant Keyboard Trigger */}
            <button
              onClick={() => setCmdOpen(true)}
              className="emil-press inline-flex items-center gap-2 rounded-lg border border-black/[0.09] bg-[#F4F4F5] px-2.5 py-1.5 text-xs text-[#52525B] hover:text-[#111111]"
            >
              <Command className="w-3.5 h-3.5" />
              <span>快速切换预设 / 路由</span>
              <kbd className="rounded bg-white px-1.5 py-0.5 text-[10px] font-mono border border-black/[0.08]">
                ⌘K
              </kbd>
            </button>

            {/* Origin-Aware Harness Popover Trigger */}
            <button
              onClick={() => setRouterOpen((v) => !v)}
              className="emil-press inline-flex items-center gap-2 rounded-lg border border-black/[0.09] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
            >
              <Terminal className="w-3.5 h-3.5 text-emerald-600" />
              <span>路由：{routeEngine === 'claude' ? 'Claude CLI' : routeEngine === 'deepseek' ? 'DeepSeek API' : 'Ollama'}</span>
            </button>

            {/* Origin-aware Popover (scales from top-right trigger, never scale(0)) */}
            <div
              className={`emil-popover absolute right-0 top-11 w-72 rounded-xl border border-black/[0.08] bg-white p-2 shadow-[0_12px_32px_rgba(0,0,0,0.08)] z-30 ${
                routerOpen
                  ? 'opacity-100 scale-100 pointer-events-auto'
                  : 'opacity-0 scale-95 pointer-events-none'
              }`}
            >
              <div className="px-2.5 py-1.5 text-[11px] font-medium text-[#71717A]">
                选择模型 / Harness 路由引擎
              </div>
              {[
                { id: 'claude', name: 'Claude Code CLI Harness', sub: '本地进程直连 · claude -p' },
                { id: 'deepseek', name: 'DeepSeek R1 Cloud API', sub: '云端高推理模型 · OpenAI 兼容' },
                { id: 'ollama', name: 'Ollama qwen2.5:14b', sub: '本地离线模型 · 127.0.0.1:11434' },
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setRouteEngine(item.id as any);
                    setRouterOpen(false);
                    pushToast('路由引擎已切换', item.name);
                  }}
                  className="emil-press w-full text-left rounded-lg px-2.5 py-2 flex items-center justify-between hover:bg-[#F4F4F5]"
                >
                  <div>
                    <div className="text-xs font-medium text-[#111111]">{item.name}</div>
                    <div className="text-[11px] text-[#71717A]">{item.sub}</div>
                  </div>
                  {routeEngine === item.id && <Check className="w-3.5 h-3.5 text-[#111111]" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* Workspace Grid */}
      <main className="mx-auto max-w-[1280px] px-5 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Rail: Uploaded Textbook + Staggered Chapters */}
        <aside className="lg:col-span-4 space-y-4">
          <div className="rounded-2xl border border-black/[0.08] bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-[#F4F4F5] border border-black/[0.06] flex items-center justify-center shrink-0">
                  <FileText className="w-4 h-4 text-[#111111]" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[#111111] truncate">
                    Transformer架构精讲.pptx
                  </div>
                  <div className="text-[11px] text-[#71717A] tabular-nums">
                    38 张幻灯片 · 15.5k 字 · 6 张配图
                  </div>
                </div>
              </div>
              <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                已解析
              </span>
            </div>

            <div className="mt-4 pt-3 border-t border-black/[0.06] space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-[#71717A] mb-2">
                <span>章节范围勾选</span>
                <span className="tabular-nums font-medium text-[#111111]">
                  {selectedCh.length} / {CHAPTERS.length}
                </span>
              </div>

              {CHAPTERS.map((ch, i) => {
                const active = selectedCh.includes(ch.id);
                return (
                  <button
                    key={ch.id}
                    style={{ animationDelay: `${i * 45}ms` }}
                    onClick={() =>
                      setSelectedCh((prev) =>
                        prev.includes(ch.id) ? prev.filter((x) => x !== ch.id) : [...prev, ch.id]
                      )
                    }
                    className={`emil-stagger-item emil-press w-full text-left rounded-xl px-3 py-2.5 border flex items-center justify-between gap-2 ${
                      active
                        ? 'border-black/[0.18] bg-[#F4F4F5]/90 text-[#111111]'
                        : 'border-transparent bg-transparent text-[#71717A] hover:bg-[#F4F4F5]/50'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">{ch.title}</div>
                      <div className="text-[10px] text-[#71717A] tabular-nums mt-0.5">
                        {ch.pages} · {ch.chars}
                      </div>
                    </div>
                    <div
                      className={`h-4 w-4 rounded-md border flex items-center justify-center shrink-0 transition-colors duration-150 ${
                        active ? 'bg-[#111111] border-[#111111] text-white' : 'border-black/20 bg-white'
                      }`}
                    >
                      {active && <Check className="w-2.5 h-2.5" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Preset Tactile Selector */}
          <div className="rounded-2xl border border-black/[0.08] bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.03)] space-y-3">
            <div className="text-xs font-semibold text-[#111111]">
              教学预设模板（点击即时同步规格）
            </div>
            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map((p) => {
                const active = preset === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => applyPreset(p)}
                    className={`emil-press rounded-xl border p-2.5 text-left ${
                      active
                        ? 'border-[#111111] bg-[#111111] text-white shadow-xs'
                        : 'border-black/[0.08] bg-[#FAFAFA] text-[#111111] hover:bg-[#F4F4F5]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold flex items-center gap-1.5">
                        {p.icon}
                        {p.name}
                      </span>
                      <span
                        className={`text-[10px] tabular-nums px-1.5 py-0.5 rounded ${
                          active ? 'bg-white/20 text-white' : 'bg-black/[0.05] text-[#52525B]'
                        }`}
                      >
                        {p.tag}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        {/* Right Stage: Segmented Control + Blur-Bridged Crossfade */}
        <section className="lg:col-span-8 space-y-4">
          {/* Segmented Switcher */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-xl bg-[#EFEFEF] p-1 border border-black/[0.05]">
              {[
                { id: 'negotiate' as StageTab, label: '阶段一：AI 需求解析与确认单' },
                { id: 'studio' as StageTab, label: `阶段二：${currentPresetObj.name}工作台` },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => switchStage(t.id)}
                  className={`emil-press rounded-lg px-3.5 py-1.5 text-xs font-medium ${
                    stageTab === t.id
                      ? 'bg-white text-[#111111] shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
                      : 'text-[#666666] hover:text-[#111111]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <span className="text-[11px] text-[#71717A] tabular-nums">
              {selectedCh.length} 章 · 共 {mcqCount + fillCount + shortCount} 题 · 预计 {currentPresetObj.mins} 分钟
            </span>
          </div>

          {/* Blur-Bridged Stage Container */}
          <div
            className={`emil-blur-bridge rounded-2xl border border-black/[0.08] bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.03)] ${
              morphingBlur ? 'blur-[2px] opacity-60 scale-[0.99]' : 'blur-0 opacity-100 scale-100'
            }`}
          >
            {stageTab === 'negotiate' ? (
              <div className="space-y-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-base font-semibold tracking-[-0.02em] text-[#111111]">
                      AI 需求解析反馈 · {currentPresetObj.name}方案
                    </h2>
                    <p className="mt-1 text-xs text-[#666666] max-w-[65ch] leading-relaxed">
                      模型已结合您选中的 {selectedCh.length} 个章节与“考前辨析重点”诉求，为您生成如下规格确认单；拖动滑块时数字采用 <code className="text-[11px]">tabular-nums</code> 等宽防抖渲染。
                    </p>
                  </div>
                </div>

                {/* Tactile Sliders */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 rounded-xl bg-[#FAFAFA] border border-black/[0.06] p-4">
                  {[
                    { label: '单选题', val: mcqCount, set: setMcqCount, max: 15 },
                    { label: '填空题', val: fillCount, set: setFillCount, max: 10 },
                    { label: '简答分析题', val: shortCount, set: setShortCount, max: 8 },
                  ].map((s) => (
                    <div key={s.label} className="space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <span className="text-[#52525B]">{s.label}</span>
                        <span className="font-semibold tabular-nums text-[#111111]">{s.val} 题</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={s.max}
                        value={s.val}
                        onChange={(e) => s.set(Number(e.target.value))}
                        className="w-full accent-[#111111] cursor-pointer"
                      />
                    </div>
                  ))}
                </div>

                {/* Parsed Key Focus Pills */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {['Scaled Dot-Product Attention', '1/√d_k 方差稳定', '残差连接 y=F(x)+x', '位置编码相加机制'].map(
                    (tag, idx) => (
                      <span
                        key={tag}
                        style={{ animationDelay: `${idx * 40}ms` }}
                        className="emil-stagger-item rounded-full border border-black/[0.08] bg-[#F4F4F5] px-2.5 py-1 text-[11px] font-medium text-[#27272A]"
                      >
                        {tag}
                      </span>
                    )
                  )}
                </div>

                <div className="pt-2 flex items-center justify-between border-t border-black/[0.06]">
                  <span className="text-xs text-[#71717A]">
                    点击确认后触发 Blur-Masked 状态切换至学习工作台
                  </span>
                  <button
                    onClick={handleConfirmGenerate}
                    className="emil-press inline-flex items-center gap-2 rounded-xl bg-[#111111] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#27272A]"
                  >
                    {genState === 'working' ? (
                      <>
                        <span className="h-3 w-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                        <span>正在调度 {routeEngine} 生成...</span>
                      </>
                    ) : (
                      <>
                        <span>确认方案并生成</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex items-center justify-between border-b border-black/[0.06] pb-3">
                  <div>
                    <h2 className="text-base font-semibold tracking-[-0.02em] text-[#111111]">
                      {currentPresetObj.name} · 互动学习预览
                    </h2>
                    <p className="text-xs text-[#71717A] tabular-nums mt-0.5">
                      单选 {mcqCount} 题 · 填空 {fillCount} 题 · 简答 {shortCount} 题
                    </p>
                  </div>
                  <button
                    onClick={() => switchStage('negotiate')}
                    className="emil-press rounded-lg border border-black/[0.09] px-3 py-1.5 text-xs font-medium text-[#52525B] hover:text-[#111111]"
                  >
                    返回微调方案
                  </button>
                </div>

                <div className="rounded-xl border border-black/[0.07] bg-[#FAFAFA] p-4 space-y-2">
                  <div className="text-xs font-semibold text-[#111111]">
                    导学精要卡片 · Multi-Head Attention
                  </div>
                  <p className="text-xs text-[#52525B] max-w-[65ch] leading-relaxed">
                    多头注意力将 d_model 维度的 Query、Key、Value 线性投影到 h 个不同子空间，使模型能够同时关注来自不同位置的不同语义表征子空间。
                  </p>
                </div>

                <div className="space-y-2.5">
                  <div className="text-xs font-semibold text-[#111111]">
                    样题即时体验（点击选项感受 150ms scale(0.97) 触感反馈）
                  </div>
                  {[
                    { k: 'A', t: '使用 1x1 卷积替代所有线性层以减少参数' },
                    { k: 'B', t: '通过除以 √d_k 防止内积过大导致 Softmax 梯度消失' },
                    { k: 'C', t: '仅在解码器中引入位置编码，编码器无需位置信息' },
                  ].map((opt) => (
                    <button
                      key={opt.k}
                      onClick={() => {
                        setPickedOption(opt.k);
                        if (opt.k === 'B') pushToast('回答正确', '已记录至掌握度统计');
                      }}
                      className={`emil-press w-full text-left rounded-xl border px-3.5 py-2.5 text-xs flex items-center justify-between ${
                        pickedOption === opt.k
                          ? 'border-[#111111] bg-[#F4F4F5] font-medium text-[#111111]'
                          : 'border-black/[0.07] bg-white text-[#52525B] hover:bg-[#FAFAFA]'
                      }`}
                    >
                      <span>
                        <strong className="mr-2 font-mono">{opt.k}.</strong>
                        {opt.t}
                      </span>
                      {pickedOption === opt.k && opt.k === 'B' && (
                        <span className="text-[11px] font-medium text-emerald-700">✓ 正确</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Instant 0ms Keyboard Command Palette (Never animate keyboard-initiated actions!) */}
      {cmdOpen && (
        <div
          onClick={() => setCmdOpen(false)}
          className="fixed inset-0 z-50 bg-black/25 flex items-start justify-center pt-24 px-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-black/[0.1] bg-white shadow-2xl overflow-hidden"
          >
            <div className="border-b border-black/[0.06] px-4 py-3 flex items-center justify-between">
              <span className="text-xs font-semibold text-[#111111]">
                快速命令面板（键盘触发 · 0ms 零动画直出）
              </span>
              <kbd className="text-[10px] font-mono text-[#71717A] border border-black/10 px-1.5 py-0.5 rounded">
                ESC
              </kbd>
            </div>
            <div className="p-2 space-y-1">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    applyPreset(p);
                    setCmdOpen(false);
                  }}
                  className="w-full text-left rounded-lg px-3 py-2 text-xs flex items-center justify-between hover:bg-[#F4F4F5]"
                >
                  <span className="font-medium text-[#111111]">切换至预设：{p.name}</span>
                  <span className="text-[11px] text-[#71717A] tabular-nums">{p.tag}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Sonner-style Spatial Toast Stack */}
      <div className="fixed bottom-5 right-5 z-40 flex flex-col gap-2 w-80 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="emil-toast pointer-events-auto rounded-xl border border-black/[0.08] bg-white px-4 py-3 shadow-[0_8px_24px_rgba(0,0,0,0.08)]"
          >
            <div className="text-xs font-semibold text-[#111111]">{t.title}</div>
            <div className="text-[11px] text-[#71717A] mt-0.5">{t.detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
};
