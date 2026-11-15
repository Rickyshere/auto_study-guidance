import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Award,
  BookOpen,
  CheckCircle2,
  CheckSquare,
  Download,
  FileCheck2,
  Flame,
  Layers,
  Loader2,
  ScanText,
  Settings,
  ShieldAlert,
  Sparkles,
  Square,
  StopCircle,
  Wand2,
} from 'lucide-react';
import { api } from '../api';
import {
  DifficultyLevel,
  DocumentIR,
  PresetTemplate,
  ProviderStatusResponse,
  ScenarioType,
  StudyBlueprint,
} from '../types';
import { SpringButton } from '../utils/springPhysics';

interface Props {
  documentIr: DocumentIR | null;
  workflowStep: 1 | 2 | 3;
  onChangeWorkflowStep: (step: 1 | 2 | 3) => void;
  ocrProgress: {
    active: boolean;
    percent: number;
    stage: string;
    message: string;
    logs: string[];
  } | null;
  presets: PresetTemplate[];
  blueprint: StudyBlueprint | null;
  providerStatus: ProviderStatusResponse | null;
  onChangeBlueprint: (bp: StudyBlueprint) => void;
  onAiFillParams: () => Promise<void>;
  onConfirmAndGenerate: (bp: StudyBlueprint) => Promise<void>;
  onCancelGenerate: () => void;
  onOpenSettings: () => void;
  onRefreshProviderStatus: () => Promise<void>;
  aiFilling: boolean;
  generating: boolean;
  progressInfo: { percent: number; message: string; logs?: string[] } | null;
}

const SCENARIO_CARDS: {
  id: ScenarioType;
  badge: string;
  title: string;
  subtitle: string;
  accent: string;
  icon: React.ReactNode;
}[] = [
  {
    id: 'A_beginner',
    badge: 'Scenario A · 入门零基础',
    title: 'A · 入门 / 零基础学习',
    subtitle: '详细自学案（附例题）+ 同步作业 + 单元检测卷 + 考前速记 + MindMap，全面打牢地基',
    accent: '#2B8A3E',
    icon: <BookOpen className="w-5 h-5" />,
  },
  {
    id: 'B_consolidate',
    badge: 'Scenario B · 巩固提高',
    title: 'B · 巩固提高',
    subtitle: '分章节巩固卷 + 综合检测卷 + 核心知识点速记 + MindMap，精准扫盲拔高',
    accent: '#3B5BDB',
    icon: <Layers className="w-5 h-5" />,
  },
  {
    id: 'C_sprint',
    badge: 'Scenario C · 考前抱佛脚',
    title: 'C · 考前冲刺（抱佛脚）',
    subtitle: '重要知识提取 + 考前速记 + 佛教卷（考前冲刺突击卷），直击高频必考得分点',
    accent: '#D97706',
    icon: <Flame className="w-5 h-5" />,
  },
];

export const BlueprintNegotiator: React.FC<Props> = ({
  documentIr,
  workflowStep,
  onChangeWorkflowStep,
  ocrProgress,
  presets,
  blueprint,
  providerStatus,
  onChangeBlueprint,
  onAiFillParams,
  onConfirmAndGenerate,
  onCancelGenerate,
  onOpenSettings,
  onRefreshProviderStatus,
  aiFilling,
  generating,
  progressInfo,
}) => {
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [ocrSetupState, setOcrSetupState] = useState<{
    running: boolean;
    percent: number;
    message: string;
  } | null>(null);

  const activeScenario: ScenarioType = blueprint?.scenario_type || blueprint?.deliverables.scenario_type || 'A_beginner';

  const currentPreset = useMemo(
    () => presets.find((p) => p.scenario_type === activeScenario || p.preset_id === activeScenario) || presets[0],
    [presets, activeScenario]
  );

  const selectScenario = (scenarioId: ScenarioType) => {
    if (!blueprint) return;
    const preset = presets.find((p) => p.scenario_type === scenarioId || p.preset_id === scenarioId);
    if (!preset) return;
    const defaultItems = preset.available_items.map((i) => i.item_id);
    onChangeBlueprint({
      ...blueprint,
      scenario_type: scenarioId,
      preset_id: preset.preset_id,
      preset_name: preset.name,
      target_difficulty: preset.target_difficulty,
      deliverables: {
        ...preset.default_deliverables,
        scenario_type: scenarioId,
        selected_items: defaultItems,
      },
      custom_instructions: blueprint.custom_instructions || preset.sample_prompt,
      confirmed: false,
    });
  };

  const toggleDeliverableItem = (itemId: string) => {
    if (!blueprint) return;
    const prev = blueprint.deliverables.selected_items || [];
    const exists = prev.includes(itemId);
    const next = exists ? prev.filter((x) => x !== itemId) : [...prev, itemId];
    onChangeBlueprint({
      ...blueprint,
      deliverables: {
        ...blueprint.deliverables,
        selected_items: next,
        include_study_guide_notes: next.some((i) => i === 'detailed_study_guide' || i === 'key_knowledge_extraction'),
        include_cheatsheet: next.includes('cheatsheet'),
        include_mindmap: next.includes('mindmap'),
        include_quiz: next.some((i) =>
          ['sync_homework', 'unit_test_paper', 'chapter_consolidation_paper', 'comprehensive_test_paper', 'cram_exam_paper'].includes(i)
        ),
      },
      confirmed: false,
    });
  };

  const handleQuickDownloadOcr = async () => {
    const recId = providerStatus?.gpu_vram.recommended_ocr_engine || 'mineru_pipeline';
    setOcrSetupState({ running: true, percent: 8, message: `正在根据显存推荐一键下载安装 ${recId}...` });
    try {
      await api.setupOcrEngineStream(recId, 'install_and_start', (evt) => {
        setOcrSetupState({
          running: evt.type !== 'complete' && evt.type !== 'error',
          percent: Number(evt.percent ?? 50),
          message: evt.message || '正在下载部署 OCR...',
        });
      });
      await onRefreshProviderStatus();
    } catch (e: any) {
      setOcrSetupState({ running: false, percent: 100, message: e?.message || 'OCR 一键安装提示' });
    }
  };

  const selectedItems = blueprint?.deliverables.selected_items || [];
  const hasQuizPaperSelected = selectedItems.some((i) =>
    ['sync_homework', 'unit_test_paper', 'chapter_consolidation_paper', 'comprehensive_test_paper', 'cram_exam_paper'].includes(i)
  );
  const activeEngine = providerStatus?.settings.active_provider || 'harness';
  const freeAuthorized = Boolean(providerStatus?.settings.free_ai_auth?.authorized_use_local_ai);
  const freeModel = providerStatus?.settings.free_ai_auth?.selected_free_model || 'qoder-cn/fast';
  const cloudConfigured = Boolean(providerStatus?.settings.cloud_config?.api_key);

  return (
    <div className="max-w-[780px] mx-auto space-y-5 pb-16">
      {/* 3-Step Visual Stepper Header */}
      <div
        data-glass-panel="true"
        className="asg-card p-3.5 flex flex-wrap items-center justify-between gap-2"
      >
        {[
          { step: 1 as const, label: '1. 资料上传与 OCR', done: Boolean(documentIr) },
          { step: 2 as const, label: '2. 识别结果确认', done: Boolean(documentIr?.ocr_confirmed) },
          { step: 3 as const, label: '3. 场景选择与生成', done: Boolean(blueprint?.confirmed) },
        ].map((item, idx) => {
          const active = workflowStep === item.step;
          const canClick = item.step > 1 && Boolean(documentIr);
          return (
            <React.Fragment key={item.step}>
              <button
                type="button"
                disabled={!canClick}
                onClick={() => canClick && onChangeWorkflowStep(item.step)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold transition"
                style={{
                  backgroundColor: active
                    ? '#3B5BDB'
                    : item.done
                    ? 'var(--semantic-success-tint)'
                    : 'var(--bg-subtle)',
                  color: active ? '#FFFFFF' : item.done ? 'var(--semantic-success)' : 'var(--text-secondary)',
                  cursor: canClick ? 'pointer' : 'default',
                }}
              >
                {item.done && !active ? <CheckCircle2 className="w-3.5 h-3.5" /> : null}
                <span>{item.label}</span>
              </button>
              {idx < 2 && <ArrowRight className="w-3.5 h-3.5 opacity-40 hidden sm:inline" />}
            </React.Fragment>
          );
        })}
      </div>

      {/* 第二步「识别结果确认」由 OcrReviewStep 整屏接管；这里只保留上传/识别进度 */}
      {ocrProgress?.active && (
        <div data-glass-panel="true" className="asg-card p-6 space-y-4 asg-drawer-enter">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <span
                className="text-[11px] font-bold px-2.5 py-0.5 rounded-full"
                style={{ backgroundColor: 'var(--brand-tint)', color: '#3B5BDB' }}
              >
                第二步 · 文档解析与文本识别
              </span>
              <h2 className="text-lg font-bold mt-2 flex items-center gap-2">
                <ScanText className="w-5 h-5 text-[#3B5BDB]" />
                <span>
                  {ocrProgress?.active
                    ? '正在执行实时 OCR 文本与公式识别...'
                    : `资料识别完成：${documentIr?.filename || ''}`}
                </span>
              </h2>
            </div>
            <SpringButton
              springLabel="详细 OCR 设置"
              onClick={onOpenSettings}
              className="px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5"
              style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-subtle)' }}
            >
              <Settings className="w-3.5 h-3.5" />
              切换 / 配置 OCR
            </SpringButton>
          </div>

          {/* Live OCR Progress Bar & Log Stream */}
          {ocrProgress && (
            <div
              className="p-4 rounded-xl border space-y-2.5"
              style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-subtle)' }}
            >
              <div className="flex items-center justify-between text-xs font-bold">
                <span className="flex items-center gap-1.5 text-[#3B5BDB]">
                  {ocrProgress.active ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#2B8A3E]" />
                  )}
                  <span>{ocrProgress.message}</span>
                </span>
                <span className="font-mono">{ocrProgress.percent}%</span>
              </div>
              <div className="w-full h-2 rounded-full bg-black/10 overflow-hidden">
                <div
                  className="h-full transition-all duration-300"
                  style={{
                    width: `${Math.max(5, Math.min(100, ocrProgress.percent))}%`,
                    backgroundColor: ocrProgress.active ? '#3B5BDB' : '#2B8A3E',
                  }}
                />
              </div>
              {ocrProgress.logs.length > 0 && (
                <div className="max-h-24 overflow-y-auto text-[11px] font-mono space-y-0.5" style={{ color: 'var(--text-secondary)' }}>
                  {ocrProgress.logs.map((ln, idx) => (
                    <div key={idx}>• {ln}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* VRAM Classification & One-Click Download Card */}
          {providerStatus && (
            <div
              className="p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
            >
              <div className="space-y-1">
                <div className="text-xs font-bold flex flex-wrap items-center gap-2">
                  <span>{providerStatus.gpu_vram.gpu_name}</span>
                  <span
                    className="px-2 py-0.5 rounded-full text-[11px]"
                    style={{ backgroundColor: 'var(--brand-tint)', color: '#3B5BDB' }}
                  >
                    {providerStatus.gpu_vram.detected_vram_gb > 0
                      ? `${providerStatus.gpu_vram.detected_vram_gb} GB VRAM`
                      : 'CPU / 无独立显卡'}
                  </span>
                </div>
                {/* 先把「现在实际用谁、能不能用」说清楚，再谈硬件推荐，避免用户以为自己选的和实际用的不是一回事 */}
                {providerStatus.ocr_summary && (
                  <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                    当前识别引擎：{providerStatus.ocr_summary.effective_label}
                    {providerStatus.ocr_summary.effective_ready
                      ? ` · ${providerStatus.ocr_summary.effective_status_text}`
                      : ` · 不可用（${providerStatus.ocr_summary.effective_status_text}）`}
                  </p>
                )}
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  硬件推荐：<strong>{providerStatus.gpu_vram.recommended_ocr_engine}</strong> —{' '}
                  {providerStatus.gpu_vram.recommendation_reason}
                </p>
              </div>
              {!providerStatus.ocr_summary?.effective_ready && (
                <SpringButton
                  springLabel="一键下载安装推荐 OCR"
                  disabled={Boolean(ocrSetupState?.running)}
                  onClick={handleQuickDownloadOcr}
                  className="shrink-0 px-3.5 py-2 rounded-xl text-xs font-bold text-white flex items-center gap-1.5"
                  style={{ backgroundColor: '#3B5BDB', cursor: ocrSetupState?.running ? 'wait' : 'pointer' }}
                >
                  {ocrSetupState?.running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  <span>一键下载/启动 OCR</span>
                </SpringButton>
              )}
            </div>
          )}

          {ocrSetupState && (
            <div className="text-xs font-medium px-3 py-2 rounded-xl" style={{ backgroundColor: 'var(--bg-subtle)' }}>
              {ocrSetupState.percent}% — {ocrSetupState.message}
            </div>
          )}

          {/* Extracted Document Summary */}
          {documentIr && !ocrProgress?.active && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                已识别 <strong>{documentIr.chapters.length}</strong> 个章节，共{' '}
                <strong>{documentIr.total_chars.toLocaleString()}</strong> 字、{' '}
                <strong>{documentIr.all_assets.length}</strong> 张图表，可在左侧栏勾选具体出题章节。
              </div>
              <SpringButton
                springLabel="进入第三步选择场景"
                onClick={() => onChangeWorkflowStep(3)}
                className="px-5 py-2.5 rounded-xl text-xs font-bold text-white flex items-center gap-1.5"
                style={{ backgroundColor: '#3B5BDB', cursor: 'pointer' }}
              >
                <span>下一步：选择学习场景</span>
                <ArrowRight className="w-4 h-4" />
              </SpringButton>
            </div>
          )}
        </div>
      )}

      {/* STEP 3: A / B / C Scenario Selection, Deliverables Checkboxes, Params & Confirm Gate */}
      {workflowStep === 3 && documentIr && blueprint && !ocrProgress?.active && (
        <div className="space-y-4 asg-drawer-enter">
          {/* Scenario Cards */}
          <div data-glass-panel="true" className="asg-card p-5 space-y-4">
            <div>
              <span
                className="text-[11px] font-bold px-2.5 py-0.5 rounded-full"
                style={{ backgroundColor: 'var(--brand-tint)', color: '#3B5BDB' }}
              >
                场景选择
              </span>
              <h2 className="text-base font-bold mt-1.5">请根据您当前的学习阶段选择场景模式</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {SCENARIO_CARDS.map((card) => {
                const selected = activeScenario === card.id;
                return (
                  <button
                    key={card.id}
                    type="button"
                    disabled={generating}
                    onClick={() => selectScenario(card.id)}
                    className="text-left p-4 rounded-2xl border transition asg-btn-spring flex flex-col justify-between gap-2"
                    style={{
                      borderColor: selected ? card.accent : 'var(--border-default)',
                      backgroundColor: selected ? 'var(--brand-tint)' : 'var(--bg-subtle)',
                      boxShadow: selected ? `0 0 0 1px ${card.accent}` : 'none',
                      cursor: generating ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between" style={{ color: card.accent }}>
                        <div className="p-2 rounded-xl bg-white/80 dark:bg-black/20">{card.icon}</div>
                        {selected && <CheckCircle2 className="w-4 h-4" />}
                      </div>
                      <div className="text-[11px] font-bold" style={{ color: card.accent }}>
                        {card.badge}
                      </div>
                      <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                        {card.title}
                      </div>
                      <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                        {card.subtitle}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Scenario-Specific Selectable Deliverables */}
            {currentPreset && (
              <div
                className="p-4 rounded-xl border space-y-2.5"
                style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-bold flex items-center gap-1.5">
                    <FileCheck2 className="w-4 h-4 text-[#3B5BDB]" />
                    <span>当前场景【{currentPreset.name}】可生成的资料（均支持打印与 PDF / Markdown 导出）：</span>
                  </div>
                  <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
                    已选 {selectedItems.length}/{currentPreset.available_items.length} 项
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {currentPreset.available_items.map((opt) => {
                    const checked = selectedItems.includes(opt.item_id);
                    return (
                      <button
                        key={opt.item_id}
                        type="button"
                        disabled={generating}
                        onClick={() => toggleDeliverableItem(opt.item_id)}
                        className="text-left p-3 rounded-xl border transition flex items-start gap-2.5"
                        style={{
                          borderColor: checked ? '#3B5BDB' : 'var(--border-default)',
                          backgroundColor: checked ? 'var(--brand-tint)' : 'var(--bg-subtle)',
                        }}
                      >
                        {checked ? (
                          <CheckSquare className="w-4 h-4 text-[#3B5BDB] shrink-0 mt-0.5" />
                        ) : (
                          <Square className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--text-muted)' }} />
                        )}
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="text-xs font-bold">{opt.label}</div>
                          <div className="text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                            {opt.description}
                          </div>
                          <div className="flex flex-wrap gap-1 pt-0.5">
                            {opt.export_formats.map((fmt) => (
                              <span
                                key={fmt}
                                className="text-[10px] px-1.5 py-0.5 rounded bg-black/5 font-medium"
                                style={{ color: 'var(--text-secondary)' }}
                              >
                                {fmt}
                              </span>
                            ))}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Parameters Form (Manual OR AI Smart Fill) */}
          <div data-glass-panel="true" className="asg-card p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span
                  className="text-[11px] font-bold px-2.5 py-0.5 rounded-full"
                  style={{ backgroundColor: 'var(--brand-tint)', color: '#3B5BDB' }}
                >
                  参数配置
                </span>
                <h3 className="text-sm font-bold mt-1.5">题量、难度与个性化重点参数设置</h3>
              </div>

              <SpringButton
                springLabel="AI智能填写参数"
                disabled={aiFilling || generating}
                onClick={onAiFillParams}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white flex items-center gap-1.5"
                style={{ backgroundColor: '#3B5BDB', cursor: aiFilling ? 'wait' : 'pointer' }}
              >
                {aiFilling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                <span>{aiFilling ? 'AI 评估文档密度中...' : '✨ AI 智能填写参数'}</span>
              </SpringButton>
            </div>

            {blueprint.parsed_intent_summary && (
              <div
                className="p-3 rounded-xl border text-xs leading-relaxed"
                style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-subtle)' }}
              >
                <strong>方案摘要：</strong>
                {blueprint.parsed_intent_summary}
                {blueprint.ai_feedback_message ? ` — ${blueprint.ai_feedback_message}` : ''}
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2.5">
              <label className="text-[11px] font-semibold space-y-1 block">
                <span>单选题 (道)</span>
                <input
                  type="number"
                  min={0}
                  max={25}
                  disabled={!hasQuizPaperSelected || generating}
                  value={blueprint.deliverables.mcq_count}
                  onChange={(e) =>
                    onChangeBlueprint({
                      ...blueprint,
                      deliverables: {
                        ...blueprint.deliverables,
                        mcq_count: Math.max(0, Number(e.target.value) || 0),
                      },
                    })
                  }
                  className="w-full rounded-xl border px-2.5 py-1.5 text-xs font-bold"
                  style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
                />
              </label>

              <label className="text-[11px] font-semibold space-y-1 block">
                <span>填空题 (道)</span>
                <input
                  type="number"
                  min={0}
                  max={15}
                  disabled={!hasQuizPaperSelected || generating}
                  value={blueprint.deliverables.fill_blank_count}
                  onChange={(e) =>
                    onChangeBlueprint({
                      ...blueprint,
                      deliverables: {
                        ...blueprint.deliverables,
                        fill_blank_count: Math.max(0, Number(e.target.value) || 0),
                      },
                    })
                  }
                  className="w-full rounded-xl border px-2.5 py-1.5 text-xs font-bold"
                  style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
                />
              </label>

              <label className="text-[11px] font-semibold space-y-1 block">
                <span>简答/大题 (道)</span>
                <input
                  type="number"
                  min={0}
                  max={10}
                  disabled={!hasQuizPaperSelected || generating}
                  value={blueprint.deliverables.short_answer_count}
                  onChange={(e) =>
                    onChangeBlueprint({
                      ...blueprint,
                      deliverables: {
                        ...blueprint.deliverables,
                        short_answer_count: Math.max(0, Number(e.target.value) || 0),
                      },
                    })
                  }
                  className="w-full rounded-xl border px-2.5 py-1.5 text-xs font-bold"
                  style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
                />
              </label>

              <label className="text-[11px] font-semibold space-y-1 block">
                <span>建议用时 (分)</span>
                <input
                  type="number"
                  min={5}
                  max={180}
                  disabled={!hasQuizPaperSelected || generating}
                  value={blueprint.deliverables.suggested_minutes}
                  onChange={(e) =>
                    onChangeBlueprint({
                      ...blueprint,
                      deliverables: {
                        ...blueprint.deliverables,
                        suggested_minutes: Math.max(5, Number(e.target.value) || 30),
                      },
                    })
                  }
                  className="w-full rounded-xl border px-2.5 py-1.5 text-xs font-bold"
                  style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
                />
              </label>

              <label className="text-[11px] font-semibold space-y-1 block">
                <span>满分设置 (分)</span>
                <input
                  type="number"
                  min={10}
                  max={200}
                  disabled={!hasQuizPaperSelected || generating}
                  value={blueprint.deliverables.total_score}
                  onChange={(e) =>
                    onChangeBlueprint({
                      ...blueprint,
                      deliverables: {
                        ...blueprint.deliverables,
                        total_score: Math.max(10, Number(e.target.value) || 100),
                      },
                    })
                  }
                  className="w-full rounded-xl border px-2.5 py-1.5 text-xs font-bold"
                  style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
                />
              </label>

              <label className="text-[11px] font-semibold space-y-1 block">
                <span>难度定位</span>
                <select
                  disabled={generating}
                  value={blueprint.target_difficulty}
                  onChange={(e) =>
                    onChangeBlueprint({
                      ...blueprint,
                      target_difficulty: e.target.value as DifficultyLevel,
                    })
                  }
                  className="w-full rounded-xl border px-2 py-1.5 text-xs font-bold"
                  style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
                >
                  <option value="beginner">入门 / 基础</option>
                  <option value="intermediate">巩固 / 提高</option>
                  <option value="advanced">进阶 / 拓展</option>
                  <option value="exam_sprint">考前冲刺</option>
                </select>
              </label>
            </div>

            <label className="block text-xs font-semibold space-y-1.5">
              <span>自定义侧重点 / 补充命题要求</span>
              <textarea
                rows={2}
                disabled={generating}
                value={blueprint.custom_instructions}
                onChange={(e) =>
                  onChangeBlueprint({
                    ...blueprint,
                    custom_instructions: e.target.value,
                  })
                }
                placeholder="例如：侧重推导过程、加入容易混淆的参数边界判断..."
                className="w-full rounded-xl border px-3 py-2 text-xs"
                style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
              />
            </label>
          </div>

          {/* Explicit Confirmation Gate + Streaming Progress & Interrupt Secondary Confirmation */}
          <div data-glass-panel="true" className="asg-card p-5 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="text-xs font-bold flex items-center gap-1.5">
                  <Award className="w-4 h-4 text-[#3B5BDB]" />
                  <span>开始生成</span>
                </div>
                <div className="text-[11.5px] flex flex-wrap items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                  <span>
                    当前模型通道：
                    <strong style={{ color: 'var(--text-primary)' }}>
                      {activeEngine === 'harness'
                        ? `Magpie + DSH (${freeModel})`
                        : `云端 API (${providerStatus?.settings.cloud_config.model || '未填'})`}
                    </strong>
                  </span>
                  {activeEngine === 'harness' && !freeAuthorized && (
                    <span className="text-[#D97706] font-semibold">（点击生成前将弹窗请求本机免费 AI 授权）</span>
                  )}
                  {activeEngine === 'cloud' && !cloudConfigured && (
                    <span className="text-[#D97706] font-semibold">（请先配置云端 API Key）</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {generating ? (
                  <SpringButton
                    springLabel="打断当前生成"
                    onClick={() => setConfirmCancelOpen(true)}
                    className="px-4 py-2.5 rounded-xl text-xs font-bold border flex items-center gap-1.5"
                    style={{
                      borderColor: '#D97706',
                      backgroundColor: 'var(--semantic-warning-tint)',
                      color: '#D97706',
                      cursor: 'pointer',
                    }}
                  >
                    <StopCircle className="w-4 h-4" />
                    <span>打断生成</span>
                  </SpringButton>
                ) : (
                  <SpringButton
                    springLabel="确认场景与参数并开始生成"
                    disabled={selectedItems.length === 0 || blueprint.selected_chapter_ids.length === 0}
                    onClick={() => onConfirmAndGenerate({ ...blueprint, confirmed: true })}
                    className="px-5 py-2.5 rounded-xl text-xs font-bold text-white flex items-center gap-1.5 shadow-sm"
                    style={{
                      backgroundColor:
                        selectedItems.length === 0 || blueprint.selected_chapter_ids.length === 0
                          ? '#9CA3AF'
                          : '#3B5BDB',
                      cursor:
                        selectedItems.length === 0 || blueprint.selected_chapter_ids.length === 0
                          ? 'not-allowed'
                          : 'pointer',
                    }}
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>开始生成学习资料</span>
                  </SpringButton>
                )}
              </div>
            </div>

            {progressInfo && (
              <div
                className="p-4 rounded-xl border space-y-2"
                style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-subtle)' }}
              >
                <div className="flex items-center justify-between text-xs font-bold">
                  <span className="flex items-center gap-1.5 text-[#3B5BDB]">
                    {generating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>{progressInfo.message}</span>
                  </span>
                  <span className="font-mono">{progressInfo.percent}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-black/10 overflow-hidden">
                  <div
                    className="h-full bg-[#3B5BDB] transition-all duration-300"
                    style={{ width: `${Math.max(4, Math.min(100, progressInfo.percent))}%` }}
                  />
                </div>
                {progressInfo.logs && progressInfo.logs.length > 0 && (
                  <div className="space-y-0.5 max-h-28 overflow-y-auto text-[11px] font-mono pt-1" style={{ color: 'var(--text-secondary)' }}>
                    {progressInfo.logs.map((ln, idx) => (
                      <div key={idx}>▸ {ln}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Secondary Confirmation Modal for Interrupting Generation */}
      {confirmCancelOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(15, 23, 42, 0.5)', backdropFilter: 'blur(4px)' }}
        >
          <div
            className="asg-card w-full max-w-md p-5 space-y-4 asg-drawer-enter"
            style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
          >
            <div className="flex items-start gap-3">
              <div
                className="p-2.5 rounded-xl shrink-0"
                style={{ backgroundColor: 'var(--semantic-warning-tint)', color: 'var(--semantic-warning)' }}
              >
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold">确认要打断当前流式生成任务吗？</h4>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  打断后将立即终止后台 AI 进程（已消耗的本次生成内容不会保存为正式资料包），您需要重新确认生成。是否确认打断？
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <SpringButton
                springLabel="取消打断继续生成"
                onClick={() => setConfirmCancelOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold border"
                style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-subtle)' }}
              >
                继续等待生成
              </SpringButton>
              <SpringButton
                springLabel="确认打断"
                onClick={() => {
                  setConfirmCancelOpen(false);
                  onCancelGenerate();
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white flex items-center gap-1"
                style={{ backgroundColor: '#D97706' }}
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>确认打断并终止</span>
              </SpringButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
