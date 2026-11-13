import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Zap,
  Layers,
  Award,
  BookOpen,
  Flame,
  Sparkles,
  MessageSquare,
  CheckCircle2,
  SlidersHorizontal,
  Play,
  Plus,
  X,
} from 'lucide-react';
import {
  DifficultyLevel,
  PresetTemplate,
  StudyBlueprint,
} from '../types';
import { Spring1D, SpringButton, useSpringTelemetry } from '../utils/springPhysics';

interface Props {
  presets: PresetTemplate[];
  blueprint: StudyBlueprint | null;
  onChangeBlueprint: (bp: StudyBlueprint) => void;
  onNegotiate: (presetId: string | undefined, userPrompt: string) => Promise<void>;
  onConfirmAndGenerate: (bp: StudyBlueprint) => Promise<void>;
  onQuickGenerate: (presetId: string) => Promise<void>;
  negotiating: boolean;
  generating: boolean;
  progressInfo: { percent: number; message: string } | null;
}

const PRESET_ICON: Record<string, React.ReactNode> = {
  zap: <Zap className="w-3.5 h-3.5 text-amber-500" />,
  layers: <Layers className="w-3.5 h-3.5 text-sky-600" />,
  award: <Award className="w-3.5 h-3.5 text-rose-600" />,
  'book-open': <BookOpen className="w-3.5 h-3.5 text-emerald-600" />,
  flame: <Flame className="w-3.5 h-3.5 text-orange-500" />,
  sparkles: <Sparkles className="w-3.5 h-3.5 text-[#007AFF]" />,
};

export const BlueprintNegotiator: React.FC<Props> = ({
  presets,
  blueprint,
  onChangeBlueprint,
  onNegotiate,
  onConfirmAndGenerate,
  onQuickGenerate,
  negotiating,
  generating,
  progressInfo,
}) => {
  const [userPrompt, setUserPrompt] = useState('');
  const [newTag, setNewTag] = useState('');
  const [selectedChipId, setSelectedChipId] = useState<string>(
    blueprint?.preset_id || 'self_study_guide'
  );

  // Asymmetric Press-and-Hold Confirm State (also supports quick tap <220ms)
  const [holdPct, setHoldPct] = useState(0);
  const [isHolding, setIsHolding] = useState(false);
  const holdRafRef = useRef<number | null>(null);
  const holdStartRef = useRef(0);

  const reportPhysics = useSpringTelemetry();

  const activePresetId = blueprint?.preset_id || selectedChipId;

  useEffect(() => {
    if (blueprint?.preset_id) {
      setSelectedChipId(blueprint.preset_id);
    }
  }, [blueprint?.preset_id]);

  // 2D ζ=1.0 Critically-Damped Floating Preset Frame
  const presetStageRef = useRef<HTMLDivElement | null>(null);
  const presetThumbRef = useRef<HTMLDivElement | null>(null);
  const presetBtnRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const pXRef = useRef<Spring1D | null>(null);
  const pYRef = useRef<Spring1D | null>(null);
  const pWRef = useRef<Spring1D | null>(null);
  const pHRef = useRef<Spring1D | null>(null);

  const syncPresetFrame = useCallback(
    (id: string, instant: boolean, boostVx: number | null = null, boostVy: number | null = null) => {
      const chip = presetBtnRefs.current[id];
      const stageEl = presetStageRef.current;
      if (!chip || !stageEl || !pXRef.current || !pYRef.current || !pWRef.current || !pHRef.current) {
        return;
      }
      pXRef.current.bounds = [0, Math.max(0, stageEl.clientWidth - chip.offsetWidth)];
      pYRef.current.bounds = [0, Math.max(0, stageEl.clientHeight - chip.offsetHeight)];
      if (instant) {
        pXRef.current.setImmediate(chip.offsetLeft);
        pYRef.current.setImmediate(chip.offsetTop);
        pWRef.current.setImmediate(chip.offsetWidth);
        pHRef.current.setImmediate(chip.offsetHeight);
      } else {
        pXRef.current.setTarget(chip.offsetLeft, boostVx);
        pYRef.current.setTarget(chip.offsetTop, boostVy);
        pWRef.current.setTarget(chip.offsetWidth);
        pHRef.current.setTarget(chip.offsetHeight);
      }
    },
    []
  );

  useEffect(() => {
    const syncDom = () => {
      if (
        !presetThumbRef.current ||
        !pXRef.current ||
        !pYRef.current ||
        !pWRef.current ||
        !pHRef.current
      ) {
        return;
      }
      presetThumbRef.current.style.transform = `translate3d(${pXRef.current.value.toFixed(2)}px, ${pYRef.current.value.toFixed(2)}px, 0)`;
      presetThumbRef.current.style.width = `${pWRef.current.value.toFixed(2)}px`;
      presetThumbRef.current.style.height = `${pHRef.current.value.toFixed(2)}px`;
    };

    pXRef.current = new Spring1D({
      value: 0,
      response: 0.25,
      bounceFactor: 0.6,
      onUpdate: syncDom,
      onRebound: (v) => reportPhysics(v, 0, '预设选框撞击边界回弹'),
    });
    pYRef.current = new Spring1D({
      value: 0,
      response: 0.25,
      bounceFactor: 0.6,
      onUpdate: syncDom,
      onRebound: (v) => reportPhysics(0, v, '预设选框撞击边界回弹'),
    });
    pWRef.current = new Spring1D({ value: 165, response: 0.25, onUpdate: syncDom });
    pHRef.current = new Spring1D({ value: 76, response: 0.25, onUpdate: syncDom });

    const rafId = requestAnimationFrame(() => syncPresetFrame(activePresetId, true));
    const onResize = () => syncPresetFrame(activePresetId, true);
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      pXRef.current?.stop();
      pYRef.current?.stop();
      pWRef.current?.stop();
      pHRef.current?.stop();
    };
  }, [reportPhysics, syncPresetFrame, presets.length]);

  useEffect(() => {
    syncPresetFrame(activePresetId, false);
  }, [activePresetId, syncPresetFrame, presets.length]);

  const handleSelectPreset = async (
    preset: PresetTemplate,
    boostVx: number | null = null,
    boostVy: number | null = null
  ) => {
    setSelectedChipId(preset.preset_id);
    syncPresetFrame(preset.preset_id, false, boostVx, boostVy);
    await onNegotiate(preset.preset_id, userPrompt || preset.sample_prompt);
  };

  const addFocusTag = () => {
    if (!blueprint || !newTag.trim()) return;
    if (!blueprint.focus_topics.includes(newTag.trim())) {
      onChangeBlueprint({
        ...blueprint,
        focus_topics: [...blueprint.focus_topics, newTag.trim()],
      });
    }
    setNewTag('');
  };

  const removeFocusTag = (tag: string) => {
    if (!blueprint) return;
    onChangeBlueprint({
      ...blueprint,
      focus_topics: blueprint.focus_topics.filter((t) => t !== tag),
    });
  };

  const triggerConfirm = () => {
    if (!blueprint || generating || negotiating || blueprint.selected_chapter_ids.length === 0) {
      return;
    }
    onConfirmAndGenerate(blueprint);
  };

  const beginHold = () => {
    if (!blueprint || generating || negotiating || blueprint.selected_chapter_ids.length === 0) {
      return;
    }
    setIsHolding(true);
    holdStartRef.current = performance.now();
    const tick = (now: number) => {
      const pct = Math.min(1, (now - holdStartRef.current) / 850);
      setHoldPct(pct);
      if (pct >= 1) {
        setIsHolding(false);
        holdRafRef.current = null;
        setHoldPct(0);
        triggerConfirm();
      } else {
        holdRafRef.current = requestAnimationFrame(tick);
      }
    };
    holdRafRef.current = requestAnimationFrame(tick);
  };

  const finishHold = (allowQuickTap: boolean) => {
    if (holdRafRef.current !== null) {
      cancelAnimationFrame(holdRafRef.current);
      holdRafRef.current = null;
    }
    if (isHolding) {
      const elapsed = performance.now() - holdStartRef.current;
      setIsHolding(false);
      setHoldPct(0);
      if (allowQuickTap && elapsed < 220) {
        triggerConfirm();
      }
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Stage 1 Header Label */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 4px',
        }}
      >
        <span style={{ fontSize: '11px', fontWeight: 600, color: '#636366' }}>
          阶段 1 · 预设模板矩阵 (ζ = 1.0 物理选框)
        </span>
        <span
          style={{
            fontSize: '10.5px',
            fontWeight: 600,
            color: blueprint?.confirmed ? '#34C759' : '#007AFF',
          }}
        >
          {blueprint?.confirmed ? '● 已确认生成' : '● 方案协商微调中'}
        </span>
      </div>

      {/* 1. 6-Preset Physical 2D Spring Selector Card */}
      <div
        style={{
          backgroundColor: '#FFFFFF',
          borderRadius: '14px',
          border: '1px solid rgba(60, 60, 67, 0.08)',
          boxShadow: '0 2px 8px -4px rgba(0, 0, 0, 0.04)',
          padding: '12px',
        }}
      >
        <div
          ref={presetStageRef}
          style={{ position: 'relative' }}
        >
          <div
            ref={presetThumbRef}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              borderRadius: '11px',
              background: 'rgba(0, 122, 255, 0.1)',
              border: '1.5px solid #007AFF',
              pointerEvents: 'none',
              willChange: 'transform, width, height',
              zIndex: 1,
            }}
          />
          <div
            style={{
              position: 'relative',
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: '8px',
              zIndex: 2,
            }}
          >
            {presets.map((p) => {
              const isSelected = activePresetId === p.preset_id;
              return (
                <div
                  key={p.preset_id}
                  ref={(el) => {
                    presetBtnRefs.current[p.preset_id] = el;
                  }}
                  style={{
                    position: 'relative',
                    zIndex: 2,
                    minWidth: 0,
                    overflow: 'hidden',
                    borderRadius: '11px',
                    border: isSelected
                      ? '1px solid transparent'
                      : '1px solid rgba(60, 60, 67, 0.1)',
                    backgroundColor: isSelected ? 'transparent' : '#F9F9FB',
                    padding: '9px 10px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '6px',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: '4px',
                        minWidth: 0,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '5px',
                          width: '100%',
                          minWidth: 0,
                          fontSize: '12.5px',
                          fontWeight: 700,
                          color: isSelected ? '#007AFF' : '#1C1C1E',
                        }}
                      >
                        <span style={{ flexShrink: 0, display: 'inline-flex' }}>
                          {PRESET_ICON[p.icon] || <Sparkles className="w-3.5 h-3.5 text-[#007AFF]" />}
                        </span>
                        <span
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={p.name}
                        >
                          {p.name}
                        </span>
                      </div>
                      <span
                        style={{
                          display: 'inline-block',
                          maxWidth: '100%',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontSize: '9.5px',
                          fontWeight: 600,
                          color: '#636366',
                          backgroundColor: '#FFFFFF',
                          border: '1px solid rgba(60, 60, 67, 0.12)',
                          borderRadius: '999px',
                          padding: '1px 6px',
                        }}
                        title={p.badge}
                      >
                        {p.badge}
                      </span>
                    </div>
                    <p
                      style={{
                        marginTop: '4px',
                        fontSize: '10.5px',
                        color: '#636366',
                        lineHeight: 1.4,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {p.description}
                    </p>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '2px' }}>
                    <SpringButton
                      springLabel={`预设:${p.name}`}
                      disabled={negotiating || generating}
                      onClick={() => handleSelectPreset(p)}
                      maxShift={6}
                      style={{
                        flex: 1,
                        borderRadius: '7px',
                        border: '1px solid rgba(60, 60, 67, 0.14)',
                        backgroundColor: '#FFFFFF',
                        color: '#1C1C1E',
                        fontSize: '10.5px',
                        fontWeight: 600,
                        padding: '4px 6px',
                        cursor: negotiating || generating ? 'not-allowed' : 'pointer',
                        opacity: negotiating || generating ? 0.55 : 1,
                      }}
                    >
                      AI 解析微调
                    </SpringButton>
                    {p.preset_id !== 'custom' && (
                      <SpringButton
                        springLabel={`一键生成:${p.name}`}
                        disabled={negotiating || generating}
                        onClick={() => {
                          setSelectedChipId(p.preset_id);
                          syncPresetFrame(p.preset_id, false);
                          onQuickGenerate(p.preset_id);
                        }}
                        maxShift={5}
                        style={{
                          borderRadius: '7px',
                          border: 'none',
                          backgroundColor: '#007AFF',
                          color: '#FFFFFF',
                          fontSize: '10.5px',
                          fontWeight: 600,
                          padding: '4px 7px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '2px',
                          cursor: negotiating || generating ? 'not-allowed' : 'pointer',
                          opacity: negotiating || generating ? 0.55 : 1,
                        }}
                      >
                        <Zap className="w-2.5 h-2.5" />
                        直出
                      </SpringButton>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 2. Stage 1 AI Requirement Negotiation & Parameter Inspector */}
      {blueprint && (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 4px',
              marginTop: '2px',
            }}
          >
            <span style={{ fontSize: '11px', fontWeight: 600, color: '#636366' }}>
              AI 解析需求 → 反馈确认方案 ({blueprint.preset_name})
            </span>
          </div>

          <div
            style={{
              backgroundColor: '#FFFFFF',
              borderRadius: '14px',
              border: '1px solid rgba(60, 60, 67, 0.08)',
              boxShadow: '0 2px 8px -4px rgba(0, 0, 0, 0.04)',
              padding: '13px',
              display: 'flex',
              flexDirection: 'column',
              gap: '11px',
            }}
          >
            {/* AI Intent Summary + Feedback Bubble */}
            <div
              style={{
                borderRadius: '10px',
                backgroundColor: '#F2F2F7',
                border: '1px solid rgba(60, 60, 67, 0.08)',
                padding: '10px 11px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  color: '#1C1C1E',
                  marginBottom: '4px',
                }}
              >
                <MessageSquare className="w-3.5 h-3.5 text-[#007AFF] shrink-0" />
                <span>{blueprint.parsed_intent_summary}</span>
              </div>
              <div
                style={{
                  fontSize: '11.5px',
                  color: '#3A3A3C',
                  lineHeight: 1.55,
                  whiteSpace: 'pre-line',
                }}
              >
                {blueprint.ai_feedback_message}
              </div>
            </div>

            {/* Natural Language Prompt Box */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
              <textarea
                rows={2}
                value={userPrompt}
                onChange={(e) => setUserPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !negotiating) {
                    onNegotiate(blueprint.preset_id, userPrompt);
                  }
                }}
                placeholder="输入补充需求或教师修改意见（如：重点考第2章，出8道单选和2道计算分析题，增加易错点对比）..."
                style={{
                  width: '100%',
                  borderRadius: '10px',
                  border: '1px solid rgba(60, 60, 67, 0.16)',
                  backgroundColor: '#FAFAFC',
                  padding: '8px 10px',
                  fontSize: '12px',
                  color: '#1C1C1E',
                  lineHeight: 1.5,
                  resize: 'vertical',
                  outline: 'none',
                }}
              />
              <SpringButton
                springLabel="AI解析需求"
                disabled={negotiating || generating}
                onClick={() => onNegotiate(blueprint.preset_id, userPrompt)}
                maxShift={6}
                style={{
                  width: '100%',
                  borderRadius: '10px',
                  border: '1px solid rgba(60, 60, 67, 0.14)',
                  backgroundColor: '#1C1C1E',
                  color: '#FFFFFF',
                  fontSize: '12px',
                  fontWeight: 600,
                  padding: '8px 12px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  cursor: negotiating || generating ? 'not-allowed' : 'pointer',
                  opacity: negotiating || generating ? 0.6 : 1,
                }}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{negotiating ? 'AI 正在解析并更新方案...' : 'AI 解析需求 / 更新方案 (Ctrl+Enter)'}</span>
              </SpringButton>
            </div>

            {/* Interactive Parameter Specification */}
            <div
              style={{
                borderTop: '1px solid rgba(60, 60, 67, 0.1)',
                paddingTop: '10px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  color: '#1C1C1E',
                }}
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-[#007AFF]" />
                <span>方案规格微调（所见即所得）</span>
              </div>

              {/* 3 Dropdowns */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '7px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                  <label style={{ fontSize: '11px', color: '#636366', whiteSpace: 'nowrap' }}>
                    目标难度
                  </label>
                  <select
                    value={blueprint.target_difficulty}
                    onChange={(e) =>
                      onChangeBlueprint({
                        ...blueprint,
                        target_difficulty: e.target.value as DifficultyLevel,
                      })
                    }
                    style={{
                      flex: 1,
                      maxWidth: '235px',
                      borderRadius: '8px',
                      border: '1px solid rgba(60, 60, 67, 0.16)',
                      backgroundColor: '#F9F9FB',
                      padding: '5px 8px',
                      fontSize: '11.5px',
                      color: '#1C1C1E',
                    }}
                  >
                    <option value="beginner">零基础入门 / 预习</option>
                    <option value="intermediate">同步进阶 / 课后巩固</option>
                    <option value="exam_sprint">期末冲刺 / 模拟测评</option>
                    <option value="advanced">深度拔高 / 考研竞赛</option>
                  </select>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                  <label style={{ fontSize: '11px', color: '#636366', whiteSpace: 'nowrap' }}>
                    笔记风格
                  </label>
                  <select
                    value={blueprint.deliverables.notes_style}
                    onChange={(e) =>
                      onChangeBlueprint({
                        ...blueprint,
                        deliverables: {
                          ...blueprint.deliverables,
                          notes_style: e.target.value as any,
                        },
                      })
                    }
                    style={{
                      flex: 1,
                      maxWidth: '235px',
                      borderRadius: '8px',
                      border: '1px solid rgba(60, 60, 67, 0.16)',
                      backgroundColor: '#F9F9FB',
                      padding: '5px 8px',
                      fontSize: '11.5px',
                      color: '#1C1C1E',
                    }}
                  >
                    <option value="guided_learning">自学案导学风格（目标+类比+精讲）</option>
                    <option value="in_class_recap">随堂要点速览（精简课堂复盘）</option>
                    <option value="concise_outline">章节提纲梳理（考前/同步结构化）</option>
                    <option value="deep_dive">深度推导与原理剖析</option>
                  </select>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                  <label style={{ fontSize: '11px', color: '#636366', whiteSpace: 'nowrap' }}>
                    题库模式
                  </label>
                  <select
                    value={blueprint.deliverables.quiz_mode}
                    onChange={(e) =>
                      onChangeBlueprint({
                        ...blueprint,
                        deliverables: {
                          ...blueprint.deliverables,
                          quiz_mode: e.target.value as any,
                        },
                      })
                    }
                    style={{
                      flex: 1,
                      maxWidth: '235px',
                      borderRadius: '8px',
                      border: '1px solid rgba(60, 60, 67, 0.16)',
                      backgroundColor: '#F9F9FB',
                      padding: '5px 8px',
                      fontSize: '11.5px',
                      color: '#1C1C1E',
                    }}
                  >
                    <option value="in_class">随堂练习（快速检测）</option>
                    <option value="sync_layered">同步练习（三级分层训练）</option>
                    <option value="exam_paper">自测卷（标准满分计时卷）</option>
                    <option value="custom">自定义混合题库</option>
                  </select>
                </div>
              </div>

              {/* Question Counts (tabular-nums) */}
              <div
                className="mac-sp-tabular"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '8px',
                  backgroundColor: '#F9F9FB',
                  borderRadius: '10px',
                  padding: '9px',
                  border: '1px solid rgba(60, 60, 67, 0.08)',
                }}
              >
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '10.5px',
                      color: '#636366',
                      marginBottom: '4px',
                    }}
                  >
                    <span>单选题</span>
                    <strong style={{ color: '#007AFF' }}>{blueprint.deliverables.mcq_count}</strong>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={20}
                    value={blueprint.deliverables.mcq_count}
                    onChange={(e) =>
                      onChangeBlueprint({
                        ...blueprint,
                        deliverables: {
                          ...blueprint.deliverables,
                          mcq_count: Number(e.target.value),
                        },
                      })
                    }
                    style={{ width: '100%', accentColor: '#007AFF' }}
                  />
                </div>
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '10.5px',
                      color: '#636366',
                      marginBottom: '4px',
                    }}
                  >
                    <span>填空题</span>
                    <strong style={{ color: '#34C759' }}>
                      {blueprint.deliverables.fill_blank_count}
                    </strong>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={15}
                    value={blueprint.deliverables.fill_blank_count}
                    onChange={(e) =>
                      onChangeBlueprint({
                        ...blueprint,
                        deliverables: {
                          ...blueprint.deliverables,
                          fill_blank_count: Number(e.target.value),
                        },
                      })
                    }
                    style={{ width: '100%', accentColor: '#34C759' }}
                  />
                </div>
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '10.5px',
                      color: '#636366',
                      marginBottom: '4px',
                    }}
                  >
                    <span>简答题</span>
                    <strong style={{ color: '#5856D6' }}>
                      {blueprint.deliverables.short_answer_count}
                    </strong>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={10}
                    value={blueprint.deliverables.short_answer_count}
                    onChange={(e) =>
                      onChangeBlueprint({
                        ...blueprint,
                        deliverables: {
                          ...blueprint.deliverables,
                          short_answer_count: Number(e.target.value),
                        },
                      })
                    }
                    style={{ width: '100%', accentColor: '#5856D6' }}
                  />
                </div>
              </div>

              {/* Deliverables Checkboxes */}
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '10px',
                  fontSize: '11.5px',
                  color: '#3A3A3C',
                }}
              >
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={blueprint.deliverables.include_study_guide_notes}
                    onChange={(e) =>
                      onChangeBlueprint({
                        ...blueprint,
                        deliverables: {
                          ...blueprint.deliverables,
                          include_study_guide_notes: e.target.checked,
                        },
                      })
                    }
                    style={{ accentColor: '#007AFF' }}
                  />
                  导学笔记
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={blueprint.deliverables.include_cheatsheet}
                    onChange={(e) =>
                      onChangeBlueprint({
                        ...blueprint,
                        deliverables: {
                          ...blueprint.deliverables,
                          include_cheatsheet: e.target.checked,
                        },
                      })
                    }
                    style={{ accentColor: '#007AFF' }}
                  />
                  考前速记表
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={blueprint.deliverables.include_mindmap}
                    onChange={(e) =>
                      onChangeBlueprint({
                        ...blueprint,
                        deliverables: {
                          ...blueprint.deliverables,
                          include_mindmap: e.target.checked,
                        },
                      })
                    }
                    style={{ accentColor: '#007AFF' }}
                  />
                  知识图谱
                </label>
              </div>

              {/* Focus Concept Tags */}
              <div>
                <div style={{ fontSize: '10.5px', color: '#8E8E93', marginBottom: '5px' }}>
                  重点考察概念标签（点击 × 删除或输入回车新增）
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '5px' }}>
                  {blueprint.focus_topics.map((tag) => (
                    <span
                      key={tag}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        borderRadius: '999px',
                        backgroundColor: 'rgba(0, 122, 255, 0.1)',
                        color: '#007AFF',
                        padding: '2px 8px',
                        fontSize: '11px',
                        fontWeight: 600,
                      }}
                    >
                      {tag}
                      <button
                        onClick={() => removeFocusTag(tag)}
                        style={{
                          border: 'none',
                          background: 'transparent',
                          padding: 0,
                          cursor: 'pointer',
                          color: '#007AFF',
                          display: 'inline-flex',
                        }}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <input
                      type="text"
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') addFocusTag();
                      }}
                      placeholder="+ 标签"
                      style={{
                        width: '74px',
                        borderRadius: '999px',
                        border: '1px solid rgba(60, 60, 67, 0.18)',
                        backgroundColor: '#FFFFFF',
                        padding: '2px 8px',
                        fontSize: '11px',
                        outline: 'none',
                      }}
                    />
                    <SpringButton
                      springLabel="添加重点标签"
                      onClick={addFocusTag}
                      maxShift={4}
                      style={{
                        borderRadius: '999px',
                        border: 'none',
                        backgroundColor: '#E5E5EA',
                        color: '#1C1C1E',
                        padding: '3px',
                        cursor: 'pointer',
                        display: 'inline-flex',
                      }}
                    >
                      <Plus className="w-3 h-3" />
                    </SpringButton>
                  </div>
                </div>
              </div>
            </div>

            {/* Live SSE Progress */}
            {progressInfo && (
              <div
                style={{
                  borderRadius: '10px',
                  backgroundColor: 'rgba(0, 122, 255, 0.08)',
                  border: '1px solid rgba(0, 122, 255, 0.2)',
                  padding: '9px 11px',
                }}
              >
                <div
                  className="mac-sp-tabular"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '11px',
                    fontWeight: 600,
                    color: '#007AFF',
                    marginBottom: '5px',
                  }}
                >
                  <span>{progressInfo.message}</span>
                  <span>{progressInfo.percent}%</span>
                </div>
                <div
                  style={{
                    height: '5px',
                    width: '100%',
                    borderRadius: '999px',
                    backgroundColor: 'rgba(0, 122, 255, 0.15)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${progressInfo.percent}%`,
                      backgroundColor: '#007AFF',
                      borderRadius: '999px',
                    }}
                  />
                </div>
              </div>
            )}

            {/* Primary Stage 1 -> Stage 2 Button (Liquid Glass Prominent Pill + Asymmetric Hold or Quick Tap) */}
            <SpringButton
              springLabel="确认方案生成"
              disabled={
                generating || negotiating || blueprint.selected_chapter_ids.length === 0
              }
              onPointerDown={beginHold}
              onPointerUp={() => finishHold(true)}
              onPointerLeave={() => finishHold(false)}
              onPointerCancel={() => finishHold(false)}
              maxShift={6}
              style={{
                position: 'relative',
                overflow: 'hidden',
                width: '100%',
                borderRadius: '999px',
                border: 'none',
                backgroundColor: generating ? '#34C759' : '#007AFF',
                color: '#FFFFFF',
                fontSize: '12.5px',
                fontWeight: 700,
                padding: '11px 16px',
                boxShadow: '0 8px 20px -6px rgba(0, 122, 255, 0.5)',
                cursor:
                  generating || negotiating || blueprint.selected_chapter_ids.length === 0
                    ? 'not-allowed'
                    : 'pointer',
                opacity:
                  blueprint.selected_chapter_ids.length === 0 ? 0.45 : 1,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '7px',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: `${Math.round(holdPct * 100)}%`,
                  background: 'rgba(255, 255, 255, 0.24)',
                  pointerEvents: 'none',
                }}
              />
              <span style={{ position: 'relative', zIndex: 2, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                {generating ? (
                  <>
                    <Play className="w-4 h-4 animate-pulse" />
                    正在流式生成全套学习资料...
                  </>
                ) : isHolding ? (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    按住确认正式生成 ({Math.round(holdPct * 100)}%)
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    确认定制方案并正式生成学习资料
                  </>
                )}
              </span>
            </SpringButton>
          </div>
        </>
      )}
    </div>
  );
};
