import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, Settings, Sparkles, X } from 'lucide-react';
import { SpringButton } from '../utils/springPhysics';

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenFullConfig: () => void;
  onLoadDemo: () => void;
  onEnsureSidebarOpen?: () => void;
}

interface TourStep {
  targetId: string;
  badge: string;
  title: string;
  description: string;
  preferredPlacement: 'right' | 'bottom' | 'bottom-left' | 'inside-bottom';
  tip?: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    targetId: 'upload-panel',
    badge: '步骤 1 / 5 · 资料上传与范围',
    title: '上传课本 / 课件并勾选章节',
    description:
      '在这里拖拽或选择 PDF、PPTX、Word、Markdown 或图片。没有现成文件时，可直接点击「载入示例课件」立刻体验。上传解析后可在下方勾选出题章节范围。',
    preferredPlacement: 'right',
    tip: '提示：多章教材可先勾选 1～2 章测试生成速度。',
  },
  {
    targetId: 'main-workspace',
    badge: '步骤 2 / 5 · OCR 识别与场景定制',
    title: '实时 OCR 进度与 A / B / C 场景设置',
    description:
      '上传资料后这里会实时显示 OCR 识别进度，随后进入「A 入门自学 / B 巩固提高 / C 考前冲刺」场景选择。勾选需要的资料并确认参数后流式生成，生成中可随时二次确认打断。',
    preferredPlacement: 'inside-bottom',
    tip: '支持手动填参或一键「AI 智能填参」。',
  },
  {
    targetId: 'topbar-views',
    badge: '步骤 3 / 5 · 学习成果工作台',
    title: '讲义、单题卡片练习与键盘闪卡',
    description:
      '资料生成后，可在顶部切换讲义、单题卡片式在线练习、键盘控制的 3D 翻转闪卡（← / → 切题、Space 翻转，一轮结束可复习错题或打乱重来）、考前速记与思维导图，全部支持公式渲染与 PDF 导出。',
    preferredPlacement: 'bottom',
  },
  {
    targetId: 'visual-mode-btn',
    badge: '步骤 4 / 5 · 视觉渲染模式',
    title: '标准界面与 Liquid Glass 切换',
    description:
      '首次使用默认采用温和护眼的「标准界面」。若检测到本机配备独立 GPU，可点击此处一键开启具有实时光学折射、色散与磨砂效果的 Liquid Glass 液态玻璃外观。',
    preferredPlacement: 'bottom-left',
  },
  {
    targetId: 'settings-btn',
    badge: '步骤 5 / 5 · 系统设置中心',
    title: 'AI 出题引擎、显存 OCR 与光学调节',
    description:
      '点开设置可执行三项核心配置：① 配置 Magpie + DeepSeek Harness（经您授权后利用本机免费 AI 软件出题）或云端 API；② 按显卡显存一键部署 OCR 引擎；③ 调节 Liquid Glass 的折射率、色散、融合度与磨砂模糊度。',
    preferredPlacement: 'bottom-left',
  },
];

interface HighlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const OnboardingGuideModal: React.FC<Props> = ({
  open,
  onClose,
  onOpenFullConfig,
  onLoadDemo,
  onEnsureSidebarOpen,
}) => {
  const [stepIdx, setStepIdx] = useState(0);
  const [targetRect, setTargetRect] = useState<HighlightRect | null>(null);

  const currentStep = TOUR_STEPS[stepIdx];

  const markSeenAndClose = useCallback(() => {
    try {
      localStorage.setItem('asg_onboarding_seen_v1', '1');
    } catch {
      // ignore storage errors
    }
    onClose();
  }, [onClose]);

  const measureTarget = useCallback(() => {
    if (!open) return;
    const step = TOUR_STEPS[stepIdx];
    const el = document.querySelector<HTMLElement>(`[data-tour-id="${step.targetId}"]`);
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width > 8 && r.height > 8) {
        setTargetRect({
          left: r.left,
          top: r.top,
          width: r.width,
          height: r.height,
        });
        return;
      }
    }
    setTargetRect(null);
  }, [open, stepIdx]);

  useEffect(() => {
    if (!open) return;
    setStepIdx(0);
    onEnsureSidebarOpen?.();
  }, [open, onEnsureSidebarOpen]);

  useEffect(() => {
    if (!open) return;
    if (stepIdx === 0) {
      onEnsureSidebarOpen?.();
    }
    const raf = requestAnimationFrame(measureTarget);
    const timer = window.setTimeout(measureTarget, 120);
    window.addEventListener('resize', measureTarget);
    window.addEventListener('scroll', measureTarget, true);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      window.removeEventListener('resize', measureTarget);
      window.removeEventListener('scroll', measureTarget, true);
    };
  }, [open, stepIdx, measureTarget, onEnsureSidebarOpen]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        markSeenAndClose();
      } else if (e.key === 'ArrowRight') {
        setStepIdx((i) => (i < TOUR_STEPS.length - 1 ? i + 1 : i));
      } else if (e.key === 'ArrowLeft') {
        setStepIdx((i) => (i > 0 ? i - 1 : i));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, markSeenAndClose]);

  if (!open) return null;

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const pad = 6;
  const cardWidth = Math.min(360, vw - 32);
  const estCardHeight = 250;

  const box: HighlightRect = targetRect
    ? {
        left: Math.max(4, targetRect.left - pad),
        top: Math.max(4, targetRect.top - pad),
        width: Math.min(vw - 8, targetRect.width + pad * 2),
        height: Math.min(vh - 8, targetRect.height + pad * 2),
      }
    : {
        left: vw * 0.5 - 160,
        top: vh * 0.5 - 90,
        width: 320,
        height: 180,
      };

  // Compute callout position strictly within viewport
  let cardLeft = vw * 0.5 - cardWidth * 0.5;
  let cardTop = vh * 0.5 - estCardHeight * 0.5;

  if (targetRect) {
    if (currentStep.preferredPlacement === 'right') {
      cardLeft = box.left + box.width + 18;
      cardTop = Math.max(24, box.top + 16);
      if (cardLeft + cardWidth > vw - 16) {
        cardLeft = Math.max(16, vw - cardWidth - 16);
      }
    } else if (currentStep.preferredPlacement === 'inside-bottom') {
      cardLeft = box.left + Math.max(16, (box.width - cardWidth) * 0.5);
      cardTop = Math.min(vh - estCardHeight - 24, box.top + box.height * 0.42);
    } else if (currentStep.preferredPlacement === 'bottom-left') {
      cardLeft = Math.max(16, box.left + box.width - cardWidth);
      cardTop = box.top + box.height + 14;
    } else {
      cardLeft = box.left + (box.width - cardWidth) * 0.5;
      cardTop = box.top + box.height + 14;
    }
  }

  cardLeft = Math.max(16, Math.min(vw - cardWidth - 16, cardLeft));
  cardTop = Math.max(16, Math.min(vh - estCardHeight - 16, cardTop));

  const isLast = stepIdx === TOUR_STEPS.length - 1;

  return (
    <div
      className="no-print fixed inset-0 z-[80]"
      role="dialog"
      aria-modal="true"
      aria-label="新手指引"
    >
      {/* Dimmed Backdrop with Rounded Spotlight Cutout */}
      <svg
        className="fixed inset-0 w-full h-full pointer-events-none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <mask id="asg-tour-spotlight-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {targetRect && (
              <rect
                x={box.left}
                y={box.top}
                width={box.width}
                height={box.height}
                rx="16"
                ry="16"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(15, 23, 42, 0.56)"
          mask="url(#asg-tour-spotlight-mask)"
        />
      </svg>

      {/* Highlight Frame Outline around Target UI Region */}
      {targetRect && (
        <div
          aria-hidden="true"
          className="fixed pointer-events-none transition-all duration-300"
          style={{
            left: `${box.left}px`,
            top: `${box.top}px`,
            width: `${box.width}px`,
            height: `${box.height}px`,
            borderRadius: '16px',
            border: '2px solid #3B5BDB',
            boxShadow: '0 0 0 4px rgba(59, 91, 219, 0.25), 0 0 24px rgba(59, 91, 219, 0.35)',
          }}
        />
      )}

      {/* Floating Explanation Callout Card */}
      <div
        className="asg-card fixed p-4 space-y-3 asg-drawer-enter shadow-2xl"
        style={{
          left: `${cardLeft}px`,
          top: `${cardTop}px`,
          width: `${cardWidth}px`,
          backgroundColor: 'var(--bg-surface)',
          color: 'var(--text-primary)',
          borderColor: '#3B5BDB',
          boxShadow: '0 18px 42px rgba(15, 23, 42, 0.28)',
          transition: 'left 0.28s var(--spring-drawer), top 0.28s var(--spring-drawer)',
        }}
      >
        {/* Top Row: Step Badge + Close */}
        <div className="flex items-center justify-between gap-2">
          <span
            className="text-[11px] font-bold px-2.5 py-0.5 rounded-full"
            style={{ backgroundColor: 'var(--brand-tint)', color: '#3B5BDB' }}
          >
            {currentStep.badge}
          </span>
          <button
            type="button"
            onClick={markSeenAndClose}
            className="p-1 rounded-lg hover:bg-black/5 transition flex items-center gap-1 text-[11px]"
            style={{ color: 'var(--text-secondary)' }}
            title="跳过指引 (Esc)"
          >
            <span>跳过</span>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Title & Explanation */}
        <div className="space-y-1.5">
          <h3 className="text-sm font-bold leading-snug">{currentStep.title}</h3>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {currentStep.description}
          </p>
          {currentStep.tip && (
            <div
              className="text-[11px] px-2.5 py-1.5 rounded-lg font-medium"
              style={{ backgroundColor: 'var(--bg-subtle)', color: '#3B5BDB' }}
            >
              {currentStep.tip}
            </div>
          )}
        </div>

        {/* Progress Dots */}
        <div className="flex items-center gap-1.5 pt-0.5">
          {TOUR_STEPS.map((st, idx) => (
            <button
              key={st.targetId}
              type="button"
              onClick={() => setStepIdx(idx)}
              aria-label={`跳转到${st.badge}`}
              className="h-1.5 rounded-full transition-all"
              style={{
                width: idx === stepIdx ? '20px' : '7px',
                backgroundColor: idx === stepIdx ? '#3B5BDB' : 'var(--border-default)',
                cursor: 'pointer',
              }}
            />
          ))}
        </div>

        {/* Action Buttons */}
        <div
          className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t"
          style={{ borderColor: 'var(--border-default)' }}
        >
          <button
            type="button"
            disabled={stepIdx === 0}
            onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
            className="px-2.5 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1"
            style={{
              borderColor: 'var(--border-default)',
              backgroundColor: 'var(--bg-subtle)',
              opacity: stepIdx === 0 ? 0.45 : 1,
              cursor: stepIdx === 0 ? 'default' : 'pointer',
            }}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>上一步</span>
          </button>

          <div className="flex items-center gap-1.5">
            {isLast ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    markSeenAndClose();
                    onOpenFullConfig();
                  }}
                  className="px-2.5 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1"
                  style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-subtle)' }}
                >
                  <Settings className="w-3.5 h-3.5 text-[#3B5BDB]" />
                  <span>打开设置</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    markSeenAndClose();
                    onLoadDemo();
                  }}
                  className="px-2.5 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1"
                  style={{
                    borderColor: '#3B5BDB',
                    backgroundColor: 'var(--brand-tint)',
                    color: '#3B5BDB',
                  }}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>示例课件</span>
                </button>
                <SpringButton
                  springLabel="完成引导"
                  onClick={markSeenAndClose}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold text-white flex items-center gap-1"
                  style={{ backgroundColor: '#2B8A3E', cursor: 'pointer' }}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>开始使用</span>
                </SpringButton>
              </>
            ) : (
              <SpringButton
                springLabel="下一步引导"
                onClick={() => setStepIdx((i) => Math.min(TOUR_STEPS.length - 1, i + 1))}
                className="px-3.5 py-1.5 rounded-lg text-xs font-bold text-white flex items-center gap-1"
                style={{ backgroundColor: '#3B5BDB', cursor: 'pointer' }}
              >
                <span>下一步 ({stepIdx + 1}/{TOUR_STEPS.length})</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </SpringButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
