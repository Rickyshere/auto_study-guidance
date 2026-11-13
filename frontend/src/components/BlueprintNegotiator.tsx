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
  Minus,
  X,
  Wand2,
} from 'lucide-react';
import {
  DifficultyLevel,
  NotesStyle,
  PresetTemplate,
  QuizMode,
  StudyBlueprint,
} from '../types';
import {
  Spring1D,
  SpringButton,
  SpringSegmentedControl,
  SpringToggleSwitch,
  useSpringTelemetry,
} from '../utils/springPhysics';

interface Props {
  presets: PresetTemplate[];
  blueprint: StudyBlueprint | null;
  onChangeBlueprint: (bp: StudyBlueprint) => void;
  onNegotiate: (presetId: string | undefined, userPrompt: string) => Promise<void>;
  onAiFillParams: () => Promise<void>;
  onConfirmAndGenerate: (bp: StudyBlueprint) => Promise<void>;
  onQuickGenerate: (presetId: string) => Promise<void>;
  negotiating: boolean;
  aiFilling: boolean;
  generating: boolean;
  progressInfo: { percent: number; message: string } | null;
}

const PRESET_ICON: Record<string, React.ReactNode> = {
  zap: <Zap className="w-4 h-4 text-amber-500" />,
  layers: <Layers className="w-4 h-4 text-sky-600" />,
  award: <Award className="w-4 h-4 text-rose-600" />,
  'book-open': <BookOpen className="w-4 h-4 text-emerald-600" />,
  flame: <Flame className="w-4 h-4 text-orange-500" />,
  sparkles: <Sparkles className="w-4 h-4 text-[#007AFF]" />,
};

export const BlueprintNegotiator: React.FC<Props> = ({
  presets,
  blueprint,
  onChangeBlueprint,
  onNegotiate,
  onAiFillParams,
  onConfirmAndGenerate,
  onQuickGenerate,
  negotiating,
  aiFilling,
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
    pWRef.current = new Spring1D({ value: 220, response: 0.25, onUpdate: syncDom });
    pHRef.current = new Spring1D({ value: 112, response: 0.25, onUpdate: syncDom });

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

  const handleSelectPreset = async (preset: PresetTemplate) => {
    setSelectedChipId(preset.preset_id);
    syncPresetFrame(preset.preset_id, false);
    await onNegotiate(preset.preset_id, userPrompt || preset.sample_prompt);
  };

  const updateDeliverableNumber = (
    field: 'mcq_count' | 'fill_blank_count' | 'short_answer_count' | 'suggested_minutes' | 'total_score',
    rawVal: number,
    min: number,
    max: number
  ) => {
    if (!blueprint) return;
    const clamped = Number.isNaN(rawVal) ? min : Math.max(min, Math.min(max, Math.round(rawVal)));
    onChangeBlueprint({
      ...blueprint,
      deliverables: {
        ...blueprint.deliverables,
        [field]: clamped,
      },
    });
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
    <div style={{ maxWidth: '1040px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Stage 1 Header */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
        }}
      >
        <div>
          <h2 className="mac-sp-display" style={{ fontSize: '20px', fontWeight: 700, color: '#1C1C1E' }}>
            阶段 1 · AI 需求解析与方案定制工作台
          </h2>
          <p style={{ fontSize: '12px', color: '#636366', marginTop: '2px' }}>
            选择教学预设或直接输入要求，确认蓝图参数后进入阶段 2 生成完整学习资料
          </p>
        </div>
        <span
          style={{
            borderRadius: '999px',
            backgroundColor: blueprint?.confirmed
              ? 'rgba(52, 199, 89, 0.12)'
              : 'rgba(0, 122, 255, 0.1)',
            color: blueprint?.confirmed ? '#248A3D' : '#007AFF',
            fontSize: '11.5px',
            fontWeight: 700,
            padding: '4px 11px',
          }}
        >
          {blueprint?.confirmed ? '● 已确认并生成' : '● 方案协商微调中'}
        </span>
      </div>

      {/* 1. 6-Preset Physical 2D Spring Matrix */}
      <div
        style={{
          backgroundColor: '#FFFFFF',
          borderRadius: '16px',
          border: '1px solid rgba(60, 60, 67, 0.1)',
          boxShadow: '0 4px 14px -6px rgba(0, 0, 0, 0.05)',
          padding: '14px',
        }}
      >
        <div ref={presetStageRef} style={{ position: 'relative' }}>
          <div
            ref={presetThumbRef}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              borderRadius: '12px',
              background: 'rgba(0, 122, 255, 0.09)',
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
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: '10px',
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
                    borderRadius: '12px',
                    border: isSelected
                      ? '1px solid transparent'
                      : '1px solid rgba(60, 60, 67, 0.1)',
                    backgroundColor: isSelected ? 'transparent' : '#F9F9FB',
                    padding: '11px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '8px',
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
                          gap: '6px',
                          width: '100%',
                          minWidth: 0,
                          fontSize: '13.5px',
                          fontWeight: 700,
                          color: isSelected ? '#007AFF' : '#1C1C1E',
                        }}
                      >
                        <span style={{ flexShrink: 0, display: 'inline-flex' }}>
                          {PRESET_ICON[p.icon] || <Sparkles className="w-4 h-4 text-[#007AFF]" />}
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
                          fontSize: '10px',
                          fontWeight: 600,
                          color: '#636366',
                          backgroundColor: '#FFFFFF',
                          border: '1px solid rgba(60, 60, 67, 0.12)',
                          borderRadius: '999px',
                          padding: '1px 7px',
                        }}
                        title={p.badge}
                      >
                        {p.badge}
                      </span>
                    </div>
                    <p
                      style={{
                        marginTop: '6px',
                        fontSize: '11.5px',
                        color: '#636366',
                        lineHeight: 1.45,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {p.description}
                    </p>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <SpringButton
                      springLabel={`预设:${p.name}`}
                      disabled={negotiating || generating}
                      onClick={() => handleSelectPreset(p)}
                      maxShift={6}
                      style={{
                        flex: 1,
                        borderRadius: '8px',
                        border: '1px solid rgba(60, 60, 67, 0.14)',
                        backgroundColor: '#FFFFFF',
                        color: '#1C1C1E',
                        fontSize: '11.5px',
                        fontWeight: 600,
                        padding: '6px 8px',
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
                          borderRadius: '8px',
                          border: 'none',
                          backgroundColor: '#007AFF',
                          color: '#FFFFFF',
                          fontSize: '11.5px',
                          fontWeight: 600,
                          padding: '6px 10px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px',
                          cursor: negotiating || generating ? 'not-allowed' : 'pointer',
                          opacity: negotiating || generating ? 0.55 : 1,
                        }}
                      >
                        <Zap className="w-3 h-3" />
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

      {/* 2. AI Requirement Negotiation + Direct Numeric Parameter Input */}
      {blueprint && (
        <div
          style={{
            backgroundColor: '#FFFFFF',
            borderRadius: '16px',
            border: '1px solid rgba(60, 60, 67, 0.1)',
            boxShadow: '0 4px 14px -6px rgba(0, 0, 0, 0.05)',
            padding: '16px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          {/* AI Feedback Summary */}
          <div
            style={{
              borderRadius: '12px',
              backgroundColor: '#F2F2F7',
              border: '1px solid rgba(60, 60, 67, 0.08)',
              padding: '12px 14px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12.5px',
                fontWeight: 700,
                color: '#1C1C1E',
                marginBottom: '4px',
              }}
            >
              <MessageSquare className="w-4 h-4 text-[#007AFF] shrink-0" />
              <span>{blueprint.parsed_intent_summary}</span>
            </div>
            <div style={{ fontSize: '12px', color: '#3A3A3C', lineHeight: 1.6, whiteSpace: 'pre-line' }}>
              {blueprint.ai_feedback_message}
            </div>
          </div>

          {/* Natural Language Requirement Bar */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'stretch' }}>
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
                flex: '1 1 420px',
                borderRadius: '11px',
                border: '1px solid rgba(60, 60, 67, 0.16)',
                backgroundColor: '#FAFAFC',
                padding: '9px 12px',
                fontSize: '12.5px',
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
                borderRadius: '11px',
                border: 'none',
                backgroundColor: '#1C1C1E',
                color: '#FFFFFF',
                fontSize: '12px',
                fontWeight: 600,
                padding: '10px 16px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                cursor: negotiating || generating ? 'not-allowed' : 'pointer',
                opacity: negotiating || generating ? 0.6 : 1,
              }}
            >
              <Sparkles className="w-4 h-4" />
              <span>{negotiating ? 'AI 解析中...' : 'AI 解析需求 / 更新方案'}</span>
            </SpringButton>
          </div>

          {/* Switchable Parameters (100% ζ=1.0 Physical Spring Switchers) */}
          <div
            style={{
              borderTop: '1px solid rgba(60, 60, 67, 0.1)',
              paddingTop: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '12.5px',
                  fontWeight: 700,
                  color: '#1C1C1E',
                }}
              >
                <SlidersHorizontal className="w-4 h-4 text-[#007AFF]" />
                <span>方案参数与题量设置（直接输入数值或一键 AI 智能填充）</span>
              </div>

              <SpringButton
                springLabel="一键AI填充参数"
                disabled={aiFilling || negotiating || generating}
                onClick={onAiFillParams}
                maxShift={6}
                style={{
                  borderRadius: '999px',
                  border: '1px solid rgba(0, 122, 255, 0.3)',
                  backgroundColor: 'rgba(0, 122, 255, 0.09)',
                  color: '#007AFF',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  padding: '6px 13px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  cursor: aiFilling ? 'wait' : 'pointer',
                }}
              >
                <Wand2 className="w-3.5 h-3.5" />
                <span>{aiFilling ? 'AI 正在计算最佳配比...' : '✨ 一键 AI 智能填充题量与参数'}</span>
              </SpringButton>
            </div>

            {/* Direct Number Inputs (No Sliders) */}
            <div
              className="mac-sp-tabular"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
                gap: '10px',
              }}
            >
              <NumberFieldStepper
                label="单选题数量"
                accent="#007AFF"
                value={blueprint.deliverables.mcq_count}
                min={0}
                max={50}
                onChange={(v) => updateDeliverableNumber('mcq_count', v, 0, 50)}
              />
              <NumberFieldStepper
                label="填空题数量"
                accent="#34C759"
                value={blueprint.deliverables.fill_blank_count}
                min={0}
                max={40}
                onChange={(v) => updateDeliverableNumber('fill_blank_count', v, 0, 40)}
              />
              <NumberFieldStepper
                label="简答 / 分析题"
                accent="#5856D6"
                value={blueprint.deliverables.short_answer_count}
                min={0}
                max={25}
                onChange={(v) => updateDeliverableNumber('short_answer_count', v, 0, 25)}
              />
              <NumberFieldStepper
                label="建议用时 (分钟)"
                accent="#FF9500"
                value={blueprint.deliverables.suggested_minutes}
                min={5}
                max={180}
                step={5}
                onChange={(v) => updateDeliverableNumber('suggested_minutes', v, 5, 180)}
              />
              <NumberFieldStepper
                label="卷面满分"
                accent="#1C1C1E"
                value={blueprint.deliverables.total_score}
                min={10}
                max={200}
                step={5}
                onChange={(v) => updateDeliverableNumber('total_score', v, 10, 200)}
              />
            </div>

            {/* Spring Segmented Controls for Difficulty, Style, QuizMode */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#636366', minWidth: '64px' }}>
                  目标难度
                </span>
                <SpringSegmentedControl<DifficultyLevel>
                  springLabel="目标难度"
                  compact
                  wrap
                  value={blueprint.target_difficulty}
                  onChange={(val) => onChangeBlueprint({ ...blueprint, target_difficulty: val })}
                  options={[
                    { value: 'beginner', label: '入门预习' },
                    { value: 'intermediate', label: '同步巩固' },
                    { value: 'exam_sprint', label: '期末冲刺' },
                    { value: 'advanced', label: '深度拔高' },
                  ]}
                />
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#636366', minWidth: '64px' }}>
                  笔记风格
                </span>
                <SpringSegmentedControl<NotesStyle>
                  springLabel="笔记风格"
                  compact
                  wrap
                  value={blueprint.deliverables.notes_style}
                  onChange={(val) =>
                    onChangeBlueprint({
                      ...blueprint,
                      deliverables: { ...blueprint.deliverables, notes_style: val },
                    })
                  }
                  options={[
                    { value: 'guided_learning', label: '自学案导学' },
                    { value: 'in_class_recap', label: '随堂速览' },
                    { value: 'concise_outline', label: '提纲梳理' },
                    { value: 'deep_dive', label: '深度推导' },
                  ]}
                />
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#636366', minWidth: '64px' }}>
                  题库模式
                </span>
                <SpringSegmentedControl<QuizMode>
                  springLabel="题库模式"
                  compact
                  wrap
                  value={blueprint.deliverables.quiz_mode}
                  onChange={(val) =>
                    onChangeBlueprint({
                      ...blueprint,
                      deliverables: { ...blueprint.deliverables, quiz_mode: val },
                    })
                  }
                  options={[
                    { value: 'in_class', label: '随堂快速检测' },
                    { value: 'sync_layered', label: '同步三级分层' },
                    { value: 'exam_paper', label: '标准满分自测卷' },
                    { value: 'custom', label: '自由混合' },
                  ]}
                />
              </div>
            </div>

            {/* Deliverable Spring Toggle Switches */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', paddingTop: '2px' }}>
              <SpringToggleSwitch
                checked={blueprint.deliverables.include_study_guide_notes}
                onChange={(val) =>
                  onChangeBlueprint({
                    ...blueprint,
                    deliverables: { ...blueprint.deliverables, include_study_guide_notes: val },
                  })
                }
                label="生成导学精要笔记"
                springLabel="导学笔记开关"
              />
              <SpringToggleSwitch
                checked={blueprint.deliverables.include_cheatsheet}
                onChange={(val) =>
                  onChangeBlueprint({
                    ...blueprint,
                    deliverables: { ...blueprint.deliverables, include_cheatsheet: val },
                  })
                }
                label="生成考前速记表"
                springLabel="速记表开关"
              />
              <SpringToggleSwitch
                checked={blueprint.deliverables.include_mindmap}
                onChange={(val) =>
                  onChangeBlueprint({
                    ...blueprint,
                    deliverables: { ...blueprint.deliverables, include_mindmap: val },
                  })
                }
                label="生成 Mermaid 知识图谱"
                springLabel="知识图谱开关"
              />
            </div>

            {/* Focus Concept Tags */}
            <div>
              <div style={{ fontSize: '11px', color: '#8E8E93', marginBottom: '6px' }}>
                重点考察概念标签（点击 × 删除或输入回车新增）
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
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
                      padding: '3px 9px',
                      fontSize: '11.5px',
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
                    placeholder="+ 新增标签"
                    style={{
                      width: '92px',
                      borderRadius: '999px',
                      border: '1px solid rgba(60, 60, 67, 0.18)',
                      backgroundColor: '#FFFFFF',
                      padding: '3px 9px',
                      fontSize: '11.5px',
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
                      padding: '4px',
                      cursor: 'pointer',
                      display: 'inline-flex',
                    }}
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </SpringButton>
                </div>
              </div>
            </div>
          </div>

          {/* Live SSE Progress */}
          {progressInfo && (
            <div
              style={{
                borderRadius: '11px',
                backgroundColor: 'rgba(0, 122, 255, 0.08)',
                border: '1px solid rgba(0, 122, 255, 0.2)',
                padding: '10px 13px',
              }}
            >
              <div
                className="mac-sp-tabular"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#007AFF',
                  marginBottom: '6px',
                }}
              >
                <span>{progressInfo.message}</span>
                <span>{progressInfo.percent}%</span>
              </div>
              <div
                style={{
                  height: '6px',
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

          {/* Primary Confirm & Generate Prominent Spring Button */}
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
              fontSize: '13.5px',
              fontWeight: 700,
              padding: '12px 18px',
              boxShadow: '0 8px 22px -6px rgba(0, 122, 255, 0.5)',
              cursor:
                generating || negotiating || blueprint.selected_chapter_ids.length === 0
                  ? 'not-allowed'
                  : 'pointer',
              opacity: blueprint.selected_chapter_ids.length === 0 ? 0.45 : 1,
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
            <span
              style={{
                position: 'relative',
                zIndex: 2,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '7px',
              }}
            >
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
                  确认方案并进入 Stage 2 生成全部学习资料
                </>
              )}
            </span>
          </SpringButton>
        </div>
      )}
    </div>
  );
};

function NumberFieldStepper({
  label,
  value,
  min,
  max,
  step = 1,
  accent,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  accent: string;
  onChange: (val: number) => void;
}) {
  return (
    <div
      style={{
        borderRadius: '11px',
        backgroundColor: '#F9F9FB',
        border: '1px solid rgba(60, 60, 67, 0.1)',
        padding: '9px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      }}
    >
      <div style={{ fontSize: '11px', fontWeight: 600, color: '#636366' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <SpringButton
          springLabel={`减少:${label}`}
          onClick={() => onChange(value - step)}
          maxShift={3}
          style={{
            width: '26px',
            height: '26px',
            borderRadius: '8px',
            border: '1px solid rgba(60, 60, 67, 0.14)',
            backgroundColor: '#FFFFFF',
            color: '#1C1C1E',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <Minus className="w-3.5 h-3.5" />
        </SpringButton>
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{
            width: '100%',
            minWidth: 0,
            textAlign: 'center',
            borderRadius: '8px',
            border: '1px solid rgba(60, 60, 67, 0.16)',
            backgroundColor: '#FFFFFF',
            padding: '4px 6px',
            fontSize: '13.5px',
            fontWeight: 700,
            color: accent,
            outline: 'none',
          }}
        />
        <SpringButton
          springLabel={`增加:${label}`}
          onClick={() => onChange(value + step)}
          maxShift={3}
          style={{
            width: '26px',
            height: '26px',
            borderRadius: '8px',
            border: '1px solid rgba(60, 60, 67, 0.14)',
            backgroundColor: '#FFFFFF',
            color: '#1C1C1E',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <Plus className="w-3.5 h-3.5" />
        </SpringButton>
      </div>
    </div>
  );
}
