import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  FileCheck2,
  FileText,
  Layers,
  Loader2,
  RefreshCw,
  ScanText,
  Settings,
  ShieldCheck,
  Sparkles,
  StopCircle,
} from 'lucide-react';
import { api } from '../api';
import {
  DocumentIR,
  ExamDirectionType,
  ExamSoulSpec,
  ProviderStatusResponse,
} from '../types';
import { SpringButton } from '../utils/springPhysics';

export interface ExamProgressState {
  percent: number;
  stage: string;
  message: string;
  agentStates: Record<'a' | 'b' | 'c' | 'd' | 'orig', 'idle' | 'running' | 'retry' | 'done'>;
  logs: string[];
}

interface Props {
  documentIr: DocumentIR | null;
  ocrProgress: {
    active: boolean;
    percent: number;
    stage: string;
    message: string;
    logs: string[];
  } | null;
  providerStatus: ProviderStatusResponse | null;
  generating: boolean;
  examProgress: ExamProgressState | null;
  onGenerateExam: (
    direction: ExamDirectionType,
    userRequirements: string,
    rawExamTextOverride?: string
  ) => Promise<void>;
  onCancelGenerate: () => void;
  onOpenSettings: () => void;
}

const DIRECTION_OPTIONS: {
  id: ExamDirectionType;
  badge: string;
  title: string;
  desc: string;
  accent: string;
  icon: React.ReactNode;
}[] = [
  {
    id: 'original_to_bank',
    badge: '方向 1 · 原卷解析',
    title: '原卷生成在线题库与解析',
    desc: '完整保留原卷每一道试题，自动补全标准答案、逐项易错分析、知识点标签与 A3/A4 打印版式。',
    accent: '#2B8A3E',
    icon: <ClipboardList className="w-5 h-5" />,
  },
  {
    id: 'similar_paper',
    badge: '方向 2 · 核心功能',
    title: '生成类似风格卷（四子 Agent 协同）',
    desc: 'Agent A 提取风格指纹 → Agent B 三维解构 + 6 大变异策略 → Agent C 逆向命题 ⇄ Agent D 独立盲测校验打回重写。',
    accent: '#3B5BDB',
    icon: <Sparkles className="w-5 h-5" />,
  },
  {
    id: 'both',
    badge: '方向 3 · 全套双收',
    title: '都要（原卷在线题库 + 生成类似风格卷）',
    desc: '同步输出《原卷在线题库与解析》与《四子 Agent 同风格变式新卷》，可在在线练习中一键切换对比。',
    accent: '#D97706',
    icon: <Layers className="w-5 h-5" />,
  },
];

const QUICK_REQUIREMENT_CHIPS = [
  '严格保持原卷题型配比与难度梯度',
  '难度再拔高一点，干扰项更具迷惑性',
  '多出几道定量计算与实验分析题',
  '把简答题改编为情境推导类单项选择题',
  '加强跨章节综合机制与临床案例包装',
];

const AGENT_PIPELINE_CARDS: {
  id: 'a' | 'b' | 'c' | 'd';
  label: string;
  soulFile: string;
  role: string;
}[] = [
  { id: 'a', label: 'Agent A · 风格鉴赏', soulFile: 'soul_a.md', role: '提取神韵与硬性约束' },
  { id: 'b', label: 'Agent B · 命题架构', soulFile: 'soul_b.md', role: '三维解构与 6 大策略' },
  { id: 'c', label: 'Agent C · 逆向命题', soulFile: 'soul_c.md', role: '先答案后条件并发创作' },
  { id: 'd', label: 'Agent D · 盲测校验', soulFile: 'soul_d.md', role: '隐去答案盲解与打回' },
];

export const ExamPaperWorkbench: React.FC<Props> = ({
  documentIr,
  ocrProgress,
  providerStatus,
  generating,
  examProgress,
  onGenerateExam,
  onCancelGenerate,
  onOpenSettings,
}) => {
  const [direction, setDirection] = useState<ExamDirectionType>('similar_paper');
  const [userRequirements, setUserRequirements] = useState('');
  const [rawTextEdited, setRawTextEdited] = useState('');
  const [showRawEditor, setShowRawEditor] = useState(false);
  const [showSoulsDrawer, setShowSoulsDrawer] = useState(false);
  const [souls, setSouls] = useState<ExamSoulSpec[]>([]);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

  useEffect(() => {
    setRawTextEdited(documentIr?.raw_exam_text || '');
  }, [documentIr?.project_id, documentIr?.raw_exam_text]);

  useEffect(() => {
    api
      .getExamAgentSouls()
      .then((res) => setSouls(res.souls || []))
      .catch(() => {});
  }, []);

  const activeEngine = providerStatus?.settings.active_provider || 'harness';
  const freeAuthorized = Boolean(providerStatus?.settings.free_ai_auth?.authorized_use_local_ai);
  const freeModel = providerStatus?.settings.free_ai_auth?.selected_free_model || 'qoder-cn/fast';
  const cloudConfigured = Boolean(providerStatus?.settings.cloud_config?.api_key);
  const effectiveRawText =
    rawTextEdited ||
    documentIr?.raw_exam_text ||
    documentIr?.chapters.map((c) => c.content_text).join('\n\n') ||
    '';

  return (
    <div className="max-w-[820px] mx-auto space-y-5 pb-16">
      {/* 1. OXR Probe & Extraction Progress Card */}
      <div data-glass-panel="true" className="asg-card p-6 space-y-4 asg-drawer-enter">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span
              className="text-[11px] font-bold px-2.5 py-0.5 rounded-full"
              style={{ backgroundColor: 'var(--brand-tint)', color: '#3B5BDB' }}
            >
              试卷专项通道 · 强制 OXR 识别
            </span>
            <h2 className="text-lg font-bold mt-2 flex items-center gap-2">
              <ScanText className="w-5 h-5 text-[#3B5BDB]" />
              {ocrProgress?.active
                ? '正在探查本地 OXR 并提取试卷文本层...'
                : `已提取原卷《${documentIr?.filename || ''}》文本层`}
            </h2>
          </div>

          {documentIr && !ocrProgress?.active && (
            <button
              type="button"
              onClick={() => setShowRawEditor((s) => !s)}
              className="px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5"
              style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-subtle)' }}
            >
              <FileText className="w-3.5 h-3.5 text-[#3B5BDB]" />
              <span>{showRawEditor ? '收起原文文本层' : '查看 / 校对试卷文本层'}</span>
              {showRawEditor ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>

        {/* Live OXR Scanning Progress */}
        {ocrProgress?.active && (
          <div
            className="p-4 rounded-xl border space-y-2.5"
            style={{ borderColor: '#3B5BDB', backgroundColor: 'var(--brand-tint)' }}
          >
            <div className="flex items-center justify-between text-xs font-bold text-[#3B5BDB]">
              <span className="flex items-center gap-1.5">
                <Loader2 className="w-4 h-4 animate-spin" />
                {ocrProgress.message}
              </span>
              <span>{ocrProgress.percent}%</span>
            </div>
            <div className="w-full h-2.5 rounded-full bg-white/70 dark:bg-slate-800 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${ocrProgress.percent}%`, backgroundColor: '#3B5BDB' }}
              />
            </div>
            {ocrProgress.logs.length > 0 && (
              <div className="text-[11px] font-mono space-y-0.5 pt-1" style={{ color: 'var(--text-secondary)' }}>
                {ocrProgress.logs.slice(-3).map((lg, i) => (
                  <div key={i} className="truncate">
                    › {lg}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* OXR Probe Summary Banner */}
        {documentIr && !ocrProgress?.active && (
          <div
            className="p-3.5 rounded-xl border flex flex-wrap items-center justify-between gap-2 text-xs"
            style={{
              borderColor: 'var(--semantic-success)',
              backgroundColor: 'var(--semantic-success-tint)',
            }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: 'var(--semantic-success)' }} />
              <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                {documentIr.oxr_probe_summary || '已完成 OXR 探查与试卷文本提取。'}
              </span>
            </div>
            <span
              className="px-2 py-0.5 rounded-full font-mono text-[11px] font-bold"
              style={{ backgroundColor: 'var(--bg-surface)', color: '#3B5BDB' }}
            >
              引擎: {documentIr.oxr_engine_used || 'somark_free_api'} · {effectiveRawText.length.toLocaleString()} 字
            </span>
          </div>
        )}

        {/* Editable Raw Text Layer Drawer */}
        {showRawEditor && documentIr && !ocrProgress?.active && (
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between text-[11.5px]" style={{ color: 'var(--text-secondary)' }}>
              <span>以下为 OXR 提取的完整原卷文本层，发送给 Agent 1/2 前可直接修正识别偏差：</span>
              <button
                type="button"
                onClick={() => setRawTextEdited(documentIr.raw_exam_text || '')}
                className="text-[#3B5BDB] hover:underline flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                重置为 OXR 原文
              </button>
            </div>
            <textarea
              rows={8}
              value={rawTextEdited}
              onChange={(e) => setRawTextEdited(e.target.value)}
              className="w-full rounded-xl border p-3 text-xs font-mono leading-relaxed"
              style={{
                borderColor: 'var(--border-default)',
                backgroundColor: 'var(--bg-subtle)',
                color: 'var(--text-primary)',
              }}
            />
          </div>
        )}
      </div>

      {/* 2. Direction Selector + User Override Requirements + 4-Agent Blueprint */}
      {documentIr && !ocrProgress?.active && (
        <div data-glass-panel="true" className="asg-card p-6 space-y-5 asg-drawer-enter">
          <div className="space-y-1">
            <h3 className="text-base font-bold flex items-center gap-2">
              <FileCheck2 className="w-4 h-4 text-[#3B5BDB]" />
              选择试卷生成方向
            </h3>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              已获取试卷文本层，请选择需要执行的生成方向并可输入额外定制需求：
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {DIRECTION_OPTIONS.map((opt) => {
              const selected = direction === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  disabled={generating}
                  onClick={() => setDirection(opt.id)}
                  className="text-left p-4 rounded-2xl border transition flex flex-col justify-between gap-2.5"
                  style={{
                    borderColor: selected ? opt.accent : 'var(--border-default)',
                    backgroundColor: selected ? 'var(--brand-tint)' : 'var(--bg-subtle)',
                    boxShadow: selected ? `0 0 0 1px ${opt.accent}` : undefined,
                    opacity: generating ? 0.7 : 1,
                  }}
                >
                  <div className="flex items-center justify-between w-full">
                    <span
                      className="p-2 rounded-xl text-white"
                      style={{ backgroundColor: opt.accent }}
                    >
                      {opt.icon}
                    </span>
                    <span
                      className="text-[10.5px] font-bold px-2 py-0.5 rounded-full"
                      style={{
                        backgroundColor: selected ? opt.accent : 'var(--bg-surface)',
                        color: selected ? '#FFFFFF' : 'var(--text-secondary)',
                      }}
                    >
                      {opt.badge}
                    </span>
                  </div>
                  <div>
                    <div className="text-sm font-bold leading-snug">{opt.title}</div>
                    <div className="text-[11.5px] mt-1 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                      {opt.desc}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* User Extra Requirements */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-bold">额外定制需求（可选，将由 Agent A 转为下游硬性约束）</label>
              <button
                type="button"
                onClick={() => setShowSoulsDrawer((s) => !s)}
                className="text-[11.5px] font-semibold text-[#3B5BDB] hover:underline flex items-center gap-1"
              >
                <Bot className="w-3.5 h-3.5" />
                {showSoulsDrawer ? '收起随任务上传的 soul.md 列表' : '查看 4 个子 Agent 的 soul.md'}
              </button>
            </div>

            <textarea
              rows={3}
              disabled={generating}
              value={userRequirements}
              onChange={(e) => setUserRequirements(e.target.value)}
              placeholder="例如：难度再拔高一点；多出点计算推导题；把原卷简答题改为临床案例单选题；若留空则默认 1:1 复刻原卷风格与难度..."
              className="w-full rounded-xl border p-3 text-xs leading-relaxed"
              style={{
                borderColor: 'var(--border-default)',
                backgroundColor: 'var(--bg-subtle)',
                color: 'var(--text-primary)',
              }}
            />

            <div className="flex flex-wrap gap-1.5">
              {QUICK_REQUIREMENT_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  disabled={generating}
                  onClick={() =>
                    setUserRequirements((prev) =>
                      prev.includes(chip) ? prev : prev.trim() ? `${prev.trim()}；${chip}` : chip
                    )
                  }
                  className="text-[11px] px-2.5 py-1 rounded-full border transition hover:border-[#3B5BDB]"
                  style={{
                    borderColor: 'var(--border-default)',
                    backgroundColor: 'var(--bg-subtle)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  + {chip}
                </button>
              ))}
            </div>
          </div>

          {/* 4-Agent Soul Files Preview Drawer */}
          {showSoulsDrawer && (
            <div
              className="p-4 rounded-2xl border space-y-3 asg-drawer-enter"
              style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-subtle)' }}
            >
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-[#2B8A3E]" />
                  随任务同步上传的四子 Agent `soul.md`（a / b / c / d）
                </div>
                <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                  Agent D 盲测严格隔离 standard answer 与 detailed analysis
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {souls.map((s) => (
                  <details
                    key={s.agent_id}
                    className="rounded-xl border p-3"
                    style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
                  >
                    <summary className="cursor-pointer text-xs font-bold flex items-center justify-between">
                      <span>{s.name}</span>
                      <span className="font-mono text-[10.5px] text-[#3B5BDB]">{s.filename}</span>
                    </summary>
                    <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-secondary)' }}>
                      {s.summary}
                    </p>
                    <pre
                      className="mt-2 p-2 rounded-lg text-[10.5px] font-mono overflow-x-auto max-h-44 whitespace-pre-wrap"
                      style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-primary)' }}
                    >
                      {s.content}
                    </pre>
                  </details>
                ))}
              </div>
            </div>
          )}

          {/* Live 4-Agent Progress Dashboard */}
          {(generating || examProgress) && examProgress && (
            <div
              className="p-4 rounded-2xl border space-y-3.5"
              style={{ borderColor: '#3B5BDB', backgroundColor: 'var(--brand-tint)' }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-[#3B5BDB]">
                <span className="flex items-center gap-1.5">
                  {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  {examProgress.message}
                </span>
                <span className="font-mono">{examProgress.percent}%</span>
              </div>

              <div className="w-full h-2.5 rounded-full bg-white/75 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${examProgress.percent}%`, backgroundColor: '#3B5BDB' }}
                />
              </div>

              {/* A / B / C / D Subagent Live Pills */}
              {direction !== 'original_to_bank' && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {AGENT_PIPELINE_CARDS.map((card) => {
                    const st = examProgress.agentStates[card.id] || 'idle';
                    const badgeBg =
                      st === 'done'
                        ? 'var(--semantic-success-tint)'
                        : st === 'retry'
                        ? 'var(--semantic-warning-tint)'
                        : st === 'running'
                        ? '#FFFFFF'
                        : 'rgba(255,255,255,0.55)';
                    const badgeColor =
                      st === 'done'
                        ? 'var(--semantic-success)'
                        : st === 'retry'
                        ? 'var(--semantic-warning)'
                        : st === 'running'
                        ? '#3B5BDB'
                        : 'var(--text-secondary)';
                    return (
                      <div
                        key={card.id}
                        className="p-2.5 rounded-xl border text-[11px] space-y-1 transition"
                        style={{
                          borderColor:
                            st === 'running'
                              ? '#3B5BDB'
                              : st === 'done'
                              ? 'var(--semantic-success)'
                              : st === 'retry'
                              ? 'var(--semantic-warning)'
                              : 'var(--border-default)',
                          backgroundColor: badgeBg,
                        }}
                      >
                        <div className="flex items-center justify-between gap-1 font-bold" style={{ color: badgeColor }}>
                          <span className="truncate">{card.label}</span>
                          <span>
                            {st === 'done' ? '✓' : st === 'retry' ? '🔄' : st === 'running' ? '●' : '○'}
                          </span>
                        </div>
                        <div className="font-mono text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                          {card.soulFile} ·{' '}
                          {st === 'done'
                            ? '已完成'
                            : st === 'retry'
                            ? '盲测打回重写'
                            : st === 'running'
                            ? '执行中'
                            : '待调度'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {examProgress.logs.length > 0 && (
                <div
                  className="max-h-36 overflow-y-auto rounded-xl p-2.5 text-[11px] font-mono space-y-0.5"
                  style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-secondary)' }}
                >
                  {examProgress.logs.slice(-8).map((line, i) => (
                    <div key={i} className="truncate">
                      › {line}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Action Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t" style={{ borderColor: 'var(--border-default)' }}>
            <div className="flex items-center gap-2 text-xs">
              <span style={{ color: 'var(--text-secondary)' }}>
                模型通道：
                <strong className="ml-1" style={{ color: 'var(--text-primary)' }}>
                  {activeEngine === 'harness'
                    ? `Magpie + DeepSeek Harness (${freeModel})${freeAuthorized ? ' · 已授权' : ' · 需授权'}`
                    : `云端 API (${providerStatus?.settings.cloud_config.model || '未配置'})`}
                </strong>
              </span>
              {((activeEngine === 'harness' && !freeAuthorized) || (activeEngine === 'cloud' && !cloudConfigured)) && (
                <button type="button" onClick={onOpenSettings} className="text-[#3B5BDB] font-bold hover:underline flex items-center gap-1">
                  <Settings className="w-3.5 h-3.5" />
                  去配置
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {generating ? (
                <SpringButton
                  springLabel="打断生成"
                  onClick={() => setConfirmCancelOpen(true)}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold text-white flex items-center gap-1.5"
                  style={{ backgroundColor: '#D97706' }}
                >
                  <StopCircle className="w-4 h-4" />
                  <span>打断停止生成</span>
                </SpringButton>
              ) : (
                <SpringButton
                  springLabel="开始生成试卷"
                  disabled={!effectiveRawText.trim()}
                  onClick={() => onGenerateExam(direction, userRequirements, rawTextEdited)}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold text-white flex items-center gap-1.5"
                  style={{ backgroundColor: '#3B5BDB' }}
                >
                  <Sparkles className="w-4 h-4" />
                  <span>
                    {direction === 'original_to_bank'
                      ? '开始生成原卷在线题库'
                      : direction === 'both'
                      ? '开始双套生成（原卷 + A/B/C/D 风格卷）'
                      : '启动 A/B/C/D 四子 Agent 生成类似风格卷'}
                  </span>
                </SpringButton>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Two-step Cancellation Modal */}
      {confirmCancelOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(15, 23, 42, 0.5)', backdropFilter: 'blur(4px)' }}
        >
          <div
            className="asg-card max-w-sm w-full p-5 space-y-4 asg-drawer-enter"
            style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
          >
            <div className="flex items-center gap-2.5 text-sm font-bold text-[#D97706]">
              <AlertTriangle className="w-5 h-5" />
              <span>确认打断四子 Agent 试卷生成？</span>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              当前正在执行 OXR 后置四子 Agent 命题与盲测校验。打断后将立即终止后台 AI 子进程。
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmCancelOpen(false)}
                className="px-3.5 py-2 rounded-xl border text-xs font-semibold"
                style={{ borderColor: 'var(--border-default)' }}
              >
                继续生成
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmCancelOpen(false);
                  onCancelGenerate();
                }}
                className="px-3.5 py-2 rounded-xl text-xs font-bold text-white"
                style={{ backgroundColor: '#D97706' }}
              >
                确认打断并停止
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
