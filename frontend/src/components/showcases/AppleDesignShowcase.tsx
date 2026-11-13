import React, { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Check,
  FileText,
  Layers,
  Award,
  Zap,
  Sparkles,
  ChevronUp,
  Cpu,
} from 'lucide-react';

type PresetId = 'in_class' | 'sync' | 'exam' | 'guide';
type RouteId = 'claude' | 'deepseek' | 'ollama';

const PRESETS: {
  id: PresetId;
  name: string;
  subtitle: string;
  mins: number;
  score: number;
  mcq: number;
  fill: number;
  short: number;
  accent: string;
  icon: React.ReactNode;
}[] = [
  {
    id: 'in_class',
    name: '随堂练习',
    subtitle: '15 分钟即时检测 · 当堂核心概念辨析',
    mins: 15,
    score: 50,
    mcq: 5,
    fill: 2,
    short: 1,
    accent: '#FF9500',
    icon: <Zap className="w-4 h-4" />,
  },
  {
    id: 'sync',
    name: '同步练习',
    subtitle: '课后三级分层作业 · 基础 / 提升 / 探究',
    mins: 35,
    score: 100,
    mcq: 6,
    fill: 3,
    short: 2,
    accent: '#007AFF',
    icon: <Layers className="w-4 h-4" />,
  },
  {
    id: 'exam',
    name: '自测卷',
    subtitle: '标准 100 分闭卷测评 · 计时交卷判分',
    mins: 60,
    score: 100,
    mcq: 8,
    fill: 4,
    short: 3,
    accent: '#FF3B30',
    icon: <Award className="w-4 h-4" />,
  },
  {
    id: 'guide',
    name: '自学案',
    subtitle: '零基础预习导学 · 费曼类比 + 边学边练',
    mins: 25,
    score: 60,
    mcq: 4,
    fill: 2,
    short: 2,
    accent: '#34C759',
    icon: <BookOpen className="w-4 h-4" />,
  },
];

// Apple rubber-band equation (§9 of apple-design skill)
function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

// Apple exponential-decay momentum projection (§6 of apple-design skill)
function projectMomentum(velocityPxPerSec: number, decelerationRate = 0.998): number {
  return ((velocityPxPerSec / 1000) * decelerationRate) / (1 - decelerationRate);
}

/**
 * Real rAF critically-damped / under-damped spring driver using Apple's
 * (dampingRatio, responseSeconds) parameterization — interruptible at any frame.
 */
function useAppleSpring(
  target: number,
  options: { damping?: number; response?: number } = {}
) {
  const damping = options.damping ?? 1.0;
  const response = options.response ?? 0.35;

  const [value, setValue] = useState(target);
  const stateRef = useRef({ pos: target, vel: 0, target });
  const rafRef = useRef<number | null>(null);
  const draggingRef = useRef(false);

  const stepLoop = () => {
    const stiffness = Math.pow((2 * Math.PI) / response, 2);
    const dampingCoeff = (4 * Math.PI * damping) / response;
    let lastTime = performance.now();

    const tick = (now: number) => {
      if (draggingRef.current) {
        rafRef.current = null;
        return;
      }
      const dt = Math.min(0.032, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;

      const s = stateRef.current;
      const force = -stiffness * (s.pos - s.target);
      const damper = -dampingCoeff * s.vel;
      const accel = force + damper;
      s.vel += accel * dt;
      s.pos += s.vel * dt;

      setValue(s.pos);

      if (Math.abs(s.vel) < 0.08 && Math.abs(s.target - s.pos) < 0.08) {
        s.pos = s.target;
        s.vel = 0;
        setValue(s.target);
        rafRef.current = null;
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    stateRef.current.target = target;
    if (!draggingRef.current) {
      stepLoop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, damping, response]);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const setImmediate = (pos: number) => {
    draggingRef.current = true;
    stateRef.current.pos = pos;
    stateRef.current.vel = 0;
    setValue(pos);
  };

  const releaseWithVelocity = (newTarget: number, velocityPxPerSec: number) => {
    draggingRef.current = false;
    stateRef.current.target = newTarget;
    stateRef.current.vel = velocityPxPerSec;
    stepLoop();
  };

  return { value, setImmediate, releaseWithVelocity };
}

export const AppleDesignShowcase: React.FC = () => {
  const [preset, setPreset] = useState<PresetId>('guide');
  const [route, setRoute] = useState<RouteId>('claude');
  const [islandExpanded, setIslandExpanded] = useState(false);

  // Draggable fluid sheet: 0 = fully open (top), 420 = collapsed peek
  const SHEET_OPEN_Y = 0;
  const SHEET_PEEK_Y = 390;
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetSpring = useAppleSpring(sheetOpen ? SHEET_OPEN_Y : SHEET_PEEK_Y, {
    damping: 0.84,
    response: 0.34,
  });

  // Pointer tracking for 1:1 drag + velocity history
  const dragRef = useRef<{
    active: boolean;
    startY: number;
    startPos: number;
    history: { y: number; t: number }[];
  }>({ active: false, startY: 0, startPos: SHEET_PEEK_Y, history: [] });

  // Rubber-band card swipe horizontal drag
  const [cardOffsetX, setCardOffsetX] = useState(0);
  const cardSpring = useAppleSpring(cardOffsetX, { damping: 0.8, response: 0.32 });
  const cardDragRef = useRef<{ active: boolean; startX: number; history: { x: number; t: number }[] }>({
    active: false,
    startX: 0,
    history: [],
  });

  // Selected chapters & quiz answer
  const [selectedChapters, setSelectedChapters] = useState<number[]>([1, 2, 3]);
  const [pickedOpt, setPickedOpt] = useState<string>('B');
  const [approved, setApproved] = useState(false);

  const currentPreset = PRESETS.find((p) => p.id === preset)!;
  const sheetProgress = Math.max(
    0,
    Math.min(1, 1 - sheetSpring.value / SHEET_PEEK_Y)
  );

  // Pointer handlers for Fluid Sheet (1:1 tracking + rubber-band + momentum projection)
  const onSheetPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const now = performance.now();
    dragRef.current = {
      active: true,
      startY: e.clientY,
      startPos: sheetSpring.value,
      history: [{ y: e.clientY, t: now }],
    };
  };

  const onSheetPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    const rawY = dragRef.current.startPos + (e.clientY - dragRef.current.startY);
    let nextY = rawY;
    if (rawY < SHEET_OPEN_Y) {
      // Soft boundary rubber-banding at top
      nextY = SHEET_OPEN_Y - rubberband(SHEET_OPEN_Y - rawY, 320, 0.55);
    } else if (rawY > SHEET_PEEK_Y) {
      nextY = SHEET_PEEK_Y + rubberband(rawY - SHEET_PEEK_Y, 260, 0.55);
    }
    sheetSpring.setImmediate(nextY);
    const now = performance.now();
    dragRef.current.history.push({ y: e.clientY, t: now });
    if (dragRef.current.history.length > 5) dragRef.current.history.shift();
  };

  const onSheetPointerUp = () => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    const hist = dragRef.current.history;
    let vel = 0;
    if (hist.length >= 2) {
      const first = hist[0];
      const last = hist[hist.length - 1];
      const dt = Math.max(0.016, (last.t - first.t) / 1000);
      vel = (last.y - first.y) / dt;
    }
    const projected = sheetSpring.value + projectMomentum(vel, 0.996);
    const open = projected < SHEET_PEEK_Y * 0.5;
    setSheetOpen(open);
    sheetSpring.releaseWithVelocity(open ? SHEET_OPEN_Y : SHEET_PEEK_Y, vel);
  };

  // Horizontal swipe gesture for switching presets with rubber-banding
  const onCardPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    cardDragRef.current = {
      active: true,
      startX: e.clientX,
      history: [{ x: e.clientX, t: performance.now() }],
    };
  };

  const onCardPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!cardDragRef.current.active) return;
    const dx = e.clientX - cardDragRef.current.startX;
    const damped = dx >= 0 ? rubberband(dx, 280, 0.55) : -rubberband(-dx, 280, 0.55);
    cardSpring.setImmediate(damped);
    cardDragRef.current.history.push({ x: e.clientX, t: performance.now() });
    if (cardDragRef.current.history.length > 5) cardDragRef.current.history.shift();
  };

  const onCardPointerUp = () => {
    if (!cardDragRef.current.active) return;
    cardDragRef.current.active = false;
    const hist = cardDragRef.current.history;
    let vel = 0;
    if (hist.length >= 2) {
      const dt = Math.max(0.016, (hist[hist.length - 1].t - hist[0].t) / 1000);
      vel = (hist[hist.length - 1].x - hist[0].x) / dt;
    }
    const curIdx = PRESETS.findIndex((p) => p.id === preset);
    if (cardSpring.value < -36 && curIdx < PRESETS.length - 1) {
      setPreset(PRESETS[curIdx + 1].id);
    } else if (cardSpring.value > 36 && curIdx > 0) {
      setPreset(PRESETS[curIdx - 1].id);
    }
    setCardOffsetX(0);
    cardSpring.releaseWithVelocity(0, vel);
  };

  return (
    <div
      className="relative min-h-screen overflow-x-hidden pb-36"
      style={{
        background:
          'radial-gradient(circle at 18% 12%, #E8F1FF 0%, #F5F5F7 42%, #ECECF2 100%)',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "PingFang SC", sans-serif',
      }}
    >
      <style>{`
        .apple-btn {
          transition: transform 100ms ease-out, opacity 120ms ease;
        }
        .apple-btn:active {
          transform: scale(0.96);
          opacity: 0.85;
        }
        .apple-material {
          background: rgba(255, 255, 255, 0.68);
          backdrop-filter: blur(24px) saturate(180%);
          -webkit-backdrop-filter: blur(24px) saturate(180%);
          border: 1px solid rgba(255, 255, 255, 0.65);
          box-shadow: 0 12px 32px rgba(15, 23, 42, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.85);
        }
        @media (prefers-reduced-motion: reduce) {
          .apple-btn, .apple-reduced {
            transition: opacity 200ms ease !important;
            transform: none !important;
          }
        }
        @media (prefers-reduced-transparency: reduce) {
          .apple-material {
            background: #FFFFFF !important;
            backdrop-filter: none !important;
          }
        }
      `}</style>

      {/* Translucent Floating Navigation Bar with Specular Top Highlight */}
      <header className="sticky top-0 z-20 apple-material border-x-0 border-t-0 px-6 py-3">
        <div className="mx-auto max-w-[1160px] flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1
              className="text-lg font-bold text-[#1D1D1F]"
              style={{ letterSpacing: '-0.022em', lineHeight: 1.15 }}
            >
              StudyFlow · Apple Fluid Design 示范版
            </h1>
            <p className="text-[11px] text-[#6E6E73]" style={{ letterSpacing: '0.01em' }}>
              物理弹簧阻尼 · 1:1 指针拖拽与橡皮筋边界 · 动量投影 · 灵动岛路由胶囊
            </p>
          </div>

          {/* Dynamic Island-inspired Interactive Router Capsule */}
          <div className="relative">
            <button
              onPointerDown={() => {}}
              onClick={() => setIslandExpanded((v) => !v)}
              className="apple-btn flex items-center gap-2.5 rounded-full bg-[#1D1D1F] text-white px-4 py-2 text-xs font-medium shadow-[0_8px_20px_rgba(0,0,0,0.18)]"
            >
              <span className="h-2 w-2 rounded-full bg-[#34C759]" />
              <span>
                {route === 'claude'
                  ? 'Claude Code CLI'
                  : route === 'deepseek'
                  ? 'DeepSeek R1 API'
                  : 'Ollama Local'}
              </span>
              <span className="text-[10px] text-white/60">点击展开路由胶囊</span>
            </button>

            {islandExpanded && (
              <div
                className="absolute right-0 top-12 w-72 rounded-3xl bg-[#1D1D1F]/95 text-white p-3 shadow-2xl border border-white/15 z-30"
                style={{
                  backdropFilter: 'blur(24px)',
                  transformOrigin: 'top right',
                }}
              >
                <div className="px-2 py-1 text-[11px] text-white/55 font-medium flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5" /> 多模 Harness 智能路由
                </div>
                {[
                  { id: 'claude' as RouteId, title: 'Claude Code CLI Harness', desc: '本地进程直连 · 免配 Key' },
                  { id: 'deepseek' as RouteId, title: 'DeepSeek Cloud API', desc: '云端推理模型 · 高性价比' },
                  { id: 'ollama' as RouteId, title: 'Ollama 本地模型', desc: '完全离线隐私 · 127.0.0.1' },
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      setRoute(item.id);
                      setIslandExpanded(false);
                    }}
                    className="apple-btn w-full text-left rounded-2xl px-3 py-2.5 mt-1 flex items-center justify-between hover:bg-white/10"
                  >
                    <div>
                      <div className="text-xs font-semibold">{item.title}</div>
                      <div className="text-[10px] text-white/60">{item.desc}</div>
                    </div>
                    {route === item.id && <Check className="w-4 h-4 text-[#34C759]" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Background Workspace Canvas (Scales back smoothly when Fluid Sheet rises!) */}
      <main
        className="mx-auto max-w-[1160px] px-5 pt-7 space-y-6 origin-top"
        style={{
          transform: `scale(${1 - sheetProgress * 0.03})`,
          opacity: 1 - sheetProgress * 0.18,
        }}
      >
        {/* Hero Optical Typography Header + Swipeable Preset Selector */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Source Textbook & Chapter Selection */}
          <div className="lg:col-span-5 apple-material rounded-[28px] p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-2xl bg-[#007AFF]/12 text-[#007AFF] flex items-center justify-center shrink-0">
                <FileText className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[#1D1D1F] truncate">
                  深度学习核心架构讲义.pptx
                </div>
                <div className="text-xs text-[#6E6E73] tabular-nums">
                  38 张幻灯片 · 含备注与 6 幅图表
                </div>
              </div>
            </div>

            <div className="space-y-2 pt-1">
              <div className="flex justify-between text-xs text-[#6E6E73] px-1">
                <span>选择覆盖章节</span>
                <span className="tabular-nums font-medium text-[#1D1D1F]">
                  已选 {selectedChapters.length} / 4
                </span>
              </div>
              {[
                { id: 1, title: '第 1 章 · 神经网络基础与反向传播', meta: 'Slide 1–9' },
                { id: 2, title: '第 2 章 · 卷积感受野与 ResNet 残差', meta: 'Slide 10–19' },
                { id: 3, title: '第 3 章 · 注意力机制与 Transformer', meta: 'Slide 20–31' },
                { id: 4, title: '第 4 章 · 泛化、Dropout 与正则化', meta: 'Slide 32–38' },
              ].map((ch) => {
                const on = selectedChapters.includes(ch.id);
                return (
                  <button
                    key={ch.id}
                    onClick={() =>
                      setSelectedChapters((prev) =>
                        prev.includes(ch.id) ? prev.filter((x) => x !== ch.id) : [...prev, ch.id]
                      )
                    }
                    className={`apple-btn w-full text-left rounded-2xl px-3.5 py-2.5 flex items-center justify-between border ${
                      on
                        ? 'bg-white/90 border-[#007AFF]/30 text-[#1D1D1F] shadow-xs'
                        : 'bg-white/30 border-transparent text-[#6E6E73]'
                    }`}
                  >
                    <div>
                      <div className="text-xs font-semibold">{ch.title}</div>
                      <div className="text-[11px] opacity-70 tabular-nums">{ch.meta}</div>
                    </div>
                    <div
                      className={`h-5 w-5 rounded-full flex items-center justify-center ${
                        on ? 'bg-[#007AFF] text-white' : 'bg-black/10'
                      }`}
                    >
                      {on && <Check className="w-3 h-3" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: Rubber-band Swipeable Preset Card + Instant Preview */}
          <div className="lg:col-span-7 space-y-5">
            <div
              onPointerDown={onCardPointerDown}
              onPointerMove={onCardPointerMove}
              onPointerUp={onCardPointerUp}
              style={{
                transform: `translate3d(${cardSpring.value}px, 0, 0)`,
                touchAction: 'pan-y',
              }}
              className="apple-material rounded-[28px] p-6 cursor-grab active:cursor-grabbing select-none space-y-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2
                    className="text-2xl font-bold text-[#1D1D1F]"
                    style={{ letterSpacing: '-0.025em', lineHeight: 1.08 }}
                  >
                    {currentPreset.name}
                  </h2>
                  <p className="text-xs text-[#6E6E73] mt-1">{currentPreset.subtitle}</p>
                </div>
                <span
                  className="rounded-full px-3 py-1 text-xs font-semibold text-white tabular-nums"
                  style={{ backgroundColor: currentPreset.accent }}
                >
                  {currentPreset.score} 分 · {currentPreset.mins} 分钟
                </span>
              </div>

              {/* Tactile Segmented Preset Pills */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {PRESETS.map((p) => {
                  const active = p.id === preset;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setPreset(p.id)}
                      className={`apple-btn rounded-2xl px-3 py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5 ${
                        active
                          ? 'bg-[#1D1D1F] text-white shadow-md'
                          : 'bg-white/60 text-[#1D1D1F] hover:bg-white/90'
                      }`}
                    >
                      {p.icon}
                      <span>{p.name}</span>
                    </button>
                  );
                })}
              </div>

              <div className="rounded-2xl bg-white/70 border border-white/80 p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-[#1D1D1F] tabular-nums">
                  当前配比：<strong>{currentPreset.mcq} 单选</strong> ·{' '}
                  <strong>{currentPreset.fill} 填空</strong> ·{' '}
                  <strong>{currentPreset.short} 简答</strong>
                  <span className="block text-[11px] text-[#6E6E73] mt-0.5">
                    提示：可左右拖拽此卡片感受橡皮筋阻力，或上拉底部“AI 需求解析抽屉”
                  </span>
                </div>
                <button
                  onClick={() => {
                    setSheetOpen(true);
                  }}
                  className="apple-btn inline-flex items-center gap-1.5 rounded-full bg-[#007AFF] px-4 py-2 text-xs font-semibold text-white shadow-sm"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  打开 AI 方案确认抽屉
                </button>
              </div>
            </div>

            {/* Interactive Quiz Card Preview */}
            <div className="apple-material rounded-[28px] p-6 space-y-3">
              <div className="flex items-center justify-between">
                <h3
                  className="text-base font-bold text-[#1D1D1F]"
                  style={{ letterSpacing: '-0.018em' }}
                >
                  精选交互样题 · {currentPreset.name}
                </h3>
                {approved && (
                  <span className="rounded-full bg-[#34C759]/15 text-[#1B7A34] px-2.5 py-0.5 text-[11px] font-semibold">
                    已按确认方案生成
                  </span>
                )}
              </div>
              <p className="text-xs text-[#1D1D1F] leading-relaxed">
                在 Transformer 缩放点积注意力机制中，计算 Q 与 K 转置的点积后除以 √d_k 的核心目的是？
              </p>
              <div className="space-y-2">
                {[
                  { k: 'A', t: '压缩注意力矩阵维度，减少显存消耗' },
                  { k: 'B', t: '保持点积方差为 1，避免 Softmax 梯度消失' },
                  { k: 'C', t: '替代残差连接以加速深层网络收敛' },
                ].map((opt) => (
                  <button
                    key={opt.k}
                    onClick={() => setPickedOpt(opt.k)}
                    className={`apple-btn w-full text-left rounded-2xl px-4 py-2.5 text-xs flex items-center justify-between border ${
                      pickedOpt === opt.k
                        ? 'bg-white border-[#007AFF] font-semibold text-[#1D1D1F] shadow-xs'
                        : 'bg-white/45 border-white/60 text-[#48484A]'
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

      {/* Dimming Scrim when Sheet rises */}
      {sheetProgress > 0.05 && (
        <div
          onClick={() => setSheetOpen(false)}
          className="fixed inset-0 z-30 bg-black pointer-events-auto"
          style={{ opacity: sheetProgress * 0.28 }}
        />
      )}

      {/* Draggable Fluid Sheet (1:1 Pointer Tracking + Rubber-banding + Spring Velocity Handoff) */}
      <div
        style={{
          transform: `translate3d(0, ${sheetSpring.value}px, 0)`,
        }}
        className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-[920px] px-3 sm:px-6 pointer-events-none"
      >
        <div className="pointer-events-auto apple-material rounded-t-[32px] shadow-[0_-16px_48px_rgba(0,0,0,0.14)] overflow-hidden">
          {/* Grab Handle — 1:1 Pointer Capture Drag Zone */}
          <div
            onPointerDown={onSheetPointerDown}
            onPointerMove={onSheetPointerMove}
            onPointerUp={onSheetPointerUp}
            onClick={() => {
              if (!dragRef.current.active) setSheetOpen((v) => !v);
            }}
            style={{ touchAction: 'none' }}
            className="cursor-grab active:cursor-grabbing px-6 pt-3 pb-4 border-b border-black/[0.06] select-none"
          >
            <div className="mx-auto h-1.5 w-11 rounded-full bg-black/20 mb-3" />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#007AFF]" />
                <span className="text-sm font-bold text-[#1D1D1F]">
                  阶段一：AI 需求解析与确认抽屉（可随手指 1:1 上拉/下拉）
                </span>
              </div>
              <span className="inline-flex items-center gap-1 text-xs font-medium text-[#007AFF]">
                {sheetOpen ? '收起' : '上拉展开'}
                <ChevronUp
                  className={`w-4 h-4 transition-transform ${sheetOpen ? 'rotate-180' : ''}`}
                />
              </span>
            </div>
          </div>

          {/* Sheet Body */}
          <div className="p-6 space-y-4 bg-white/60">
            <div className="rounded-2xl bg-white/85 border border-black/[0.06] p-4 text-xs text-[#1D1D1F] leading-relaxed">
              <strong>AI 需求解析反馈：</strong>
              已根据您选中的 <strong>{selectedChapters.length} 个章节</strong> 与预设体裁【
              <strong>{currentPreset.name}</strong>】生成学习资料编排单，路由引擎当前绑定为{' '}
              <strong>{route.toUpperCase()}</strong>。您可以随时拖拽本抽屉中断或反向收回。
            </div>

            <div className="grid grid-cols-3 gap-3 text-center tabular-nums">
              <div className="rounded-2xl bg-white/80 p-3 border border-black/[0.05]">
                <div className="text-lg font-bold text-[#1D1D1F]">{currentPreset.mcq}</div>
                <div className="text-[11px] text-[#6E6E73]">单选题</div>
              </div>
              <div className="rounded-2xl bg-white/80 p-3 border border-black/[0.05]">
                <div className="text-lg font-bold text-[#1D1D1F]">{currentPreset.fill}</div>
                <div className="text-[11px] text-[#6E6E73]">填空题</div>
              </div>
              <div className="rounded-2xl bg-white/80 p-3 border border-black/[0.05]">
                <div className="text-lg font-bold text-[#1D1D1F]">{currentPreset.short}</div>
                <div className="text-[11px] text-[#6E6E73]">简答分析题</div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-1">
              <button
                onClick={() => setSheetOpen(false)}
                className="apple-btn rounded-full px-4 py-2 text-xs font-medium text-[#6E6E73] hover:bg-black/5"
              >
                稍后调整
              </button>
              <button
                onClick={() => {
                  setApproved(true);
                  setSheetOpen(false);
                }}
                className="apple-btn rounded-full bg-[#34C759] px-6 py-2.5 text-xs font-bold text-white shadow-sm"
              >
                确认方案并生成学习资料
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
