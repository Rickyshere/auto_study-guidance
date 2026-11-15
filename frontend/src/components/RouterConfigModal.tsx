import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Cloud,
  Cpu,
  Download,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  RotateCcw,
  ScanText,
  Settings2,
  ShieldCheck,
  Sliders,
  Sparkles,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../api';
import {
  OcrEngineType,
  ProviderStatusResponse,
  ProviderType,
  RouterSettings,
  UiVisualMode,
} from '../types';
import { SpringButton, SpringSegmentedControl } from '../utils/springPhysics';
import { LiquidGlassOptics } from './LiquidGlassCanvas';

export const DEFAULT_LIQUID_OPTICS: LiquidGlassOptics = {
  ior: 1.46,
  dispersion: 0.35,
  smoothK: 30,
  blur: 0.35,
};

interface Props {
  open: boolean;
  onClose: () => void;
  status: ProviderStatusResponse | null;
  onSaved: (settings: RouterSettings) => void;
  onRefreshStatus: () => Promise<void>;
  gpuAvailable: boolean;
  effectiveVisualMode: UiVisualMode;
  onChangeVisualMode: (mode: UiVisualMode) => void;
  optics: LiquidGlassOptics;
  onChangeOptics: (optics: LiquidGlassOptics) => void;
}

type VramPresetKey = 'auto' | 'le_8gb' | 'gt_8_lt_48gb' | 'ge_48gb';
type SectionKey = 'engine' | 'ocr' | 'appearance';

interface TaskProgressState {
  targetKey: string;
  title: string;
  percent: number;
  message: string;
  logs: string[];
  status: 'running' | 'success' | 'error';
}

function vramPresetFromOverride(override?: number | null): VramPresetKey {
  if (override === undefined || override === null) return 'auto';
  if (override >= 48) return 'ge_48gb';
  if (override > 8) return 'gt_8_lt_48gb';
  return 'le_8gb';
}

const SECTION_META: Record<SectionKey, { title: string; subtitle: string }> = {
  engine: {
    title: 'AI 模型通道配置',
    subtitle: '选择本机免费 AI 反代（Magpie + DeepSeek Harness）或云端大模型 API',
  },
  ocr: {
    title: 'OCR 文本识别引擎',
    subtitle: '按显卡显存自动分级推荐，支持一键下载并启动本地识图服务',
  },
  appearance: {
    title: '界面外观与光学效果',
    subtitle: '切换标准界面或 GPU 硬件加速 Liquid Glass，并微调实时光学参数',
  },
};

export const RouterConfigModal: React.FC<Props> = ({
  open,
  onClose,
  status,
  onSaved,
  onRefreshStatus,
  gpuAvailable,
  effectiveVisualMode,
  onChangeVisualMode,
  optics,
  onChangeOptics,
}) => {
  const [draft, setDraft] = useState<RouterSettings | null>(null);
  const [activeSection, setActiveSection] = useState<SectionKey>('engine');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [taskProgress, setTaskProgress] = useState<TaskProgressState | null>(null);

  useEffect(() => {
    if (status?.settings && open) {
      setDraft(JSON.parse(JSON.stringify(status.settings)) as RouterSettings);
      setTestResult(null);
    }
  }, [status, open]);

  if (!open || !draft) return null;

  const isRunningTask = taskProgress?.status === 'running';
  const installedFreeApps = (status?.free_ai_apps || []).filter((a) =>
    ['qoder_cn', 'workbuddy', 'trae_cn'].includes(a.app_id)
  );
  const magpieModels = status?.magpie_models || [];
  const activeCliInHarness =
    draft.free_ai_auth.preferred_proxy_mode === 'magpie_dsh'
      ? 'dsh'
      : draft.harness_config.preferred_cli;

  const handleSave = async () => {
    setSaving(true);
    try {
      const normalizedHarness =
        draft.free_ai_auth.preferred_proxy_mode === 'magpie_dsh'
          ? { ...draft.harness_config, preferred_cli: 'dsh' as const }
          : draft.harness_config;
      const updated = await api.saveProviderSettings({
        ...draft,
        harness_config: normalizedHarness,
        ui_visual_mode: effectiveVisualMode,
        routing_mode: 'single',
      });
      onSaved(updated);
      onClose();
    } catch (e: any) {
      setTestResult({ ok: false, msg: e?.message || '保存配置失败' });
    } finally {
      setSaving(false);
    }
  };

  const handleAuthorizeFreeAi = async (authorized: boolean) => {
    try {
      const saved = await api.authorizeFreeAi({
        authorized,
        preferred_proxy_mode: 'magpie_dsh',
        selected_free_model: draft.free_ai_auth.selected_free_model,
        magpie_gateway_url: draft.free_ai_auth.magpie_gateway_url,
      });
      setDraft({
        ...saved,
        harness_config: { ...saved.harness_config, preferred_cli: 'dsh' },
      });
      onSaved(saved);
      setTestResult({
        ok: true,
        msg: authorized
          ? '已记录您的明确授权，现可通过本机免费 AI 软件（Qoder CN / WorkBuddy / Trae CN）反代出题。'
          : '已撤回本机免费 AI 软件反代授权。',
      });
    } catch (e: any) {
      setTestResult({ ok: false, msg: e?.message || '更新授权状态失败' });
    }
  };

  const handleSetupMagpieAndDsh = async () => {
    setTaskProgress({
      targetKey: 'magpie_dsh',
      title: '一键下载安装配置 Magpie + DeepSeek Harness (dsh)',
      percent: 5,
      message: '正在检测本机 Qoder CN / WorkBuddy / Trae CN、Magpie 网关与 DSH...',
      logs: ['开始环境扫描与自动配置...'],
      status: 'running',
    });
    try {
      const doneEvt = await api.setupMagpieAndDshStream((evt) => {
        const pct = Number(evt.progress ?? evt.percent ?? 35);
        const msg = String(evt.message || '');
        setTaskProgress((prev) => ({
          targetKey: 'magpie_dsh',
          title: '一键下载安装配置 Magpie + DeepSeek Harness (dsh)',
          percent: pct,
          message: msg,
          logs: msg ? [...(prev?.logs || []).slice(-18), msg] : prev?.logs || [],
          status: evt.type === 'done' ? (evt.ok === false ? 'error' : 'success') : 'running',
        }));
      }, draft.free_ai_auth.magpie_gateway_url);

      await onRefreshStatus();
      setTaskProgress((prev) =>
        prev
          ? {
              ...prev,
              percent: 100,
              status: doneEvt.ok === false ? 'error' : 'success',
              message: doneEvt.message || 'Magpie + DeepSeek Harness 配置完成',
            }
          : null
      );
    } catch (e: any) {
      setTaskProgress((prev) =>
        prev
          ? {
              ...prev,
              percent: 100,
              status: 'error',
              message: e?.message || '配置失败',
              logs: [...prev.logs, `错误：${e?.message}`],
            }
          : null
      );
    }
  };

  const handleTest = async (provider: ProviderType) => {
    setTesting(provider);
    setTestResult(null);
    try {
      const res = await api.testProviderConnection({
        provider,
        cloud_config: draft.cloud_config,
        free_ai_auth: draft.free_ai_auth,
      });
      if (res.ok) {
        setTestResult({
          ok: true,
          msg: `连通测试成功 [${res.label}]：${res.sample_response || 'OK'}`,
        });
      } else {
        setTestResult({
          ok: false,
          msg: res.error || '连通失败，请检查配置参数或授权状态',
        });
      }
    } catch (e: any) {
      setTestResult({ ok: false, msg: e?.message || '测试请求失败' });
    } finally {
      setTesting(null);
    }
  };

  const handleOcrStreamSetup = async (engineId: OcrEngineType, name: string) => {
    setTaskProgress({
      targetKey: `ocr:${engineId}`,
      title: `一键下载/启动 OCR 引擎：${name}`,
      percent: 5,
      message: '正在准备安装/启动任务...',
      logs: [`启动 ${engineId} 部署流程...`],
      status: 'running',
    });
    try {
      await api.setupOcrEngineStream(engineId, 'install_and_start', (evt) => {
        const msg = evt.message || '';
        setTaskProgress((prev) => ({
          targetKey: `ocr:${engineId}`,
          title: `一键下载/启动 OCR 引擎：${name}`,
          percent: Number(evt.percent ?? 50),
          message: msg,
          logs: evt.log_line
            ? [...(prev?.logs || []).slice(-18), evt.log_line]
            : msg
            ? [...(prev?.logs || []).slice(-18), msg]
            : prev?.logs || [],
          status: evt.type === 'complete' ? 'success' : evt.type === 'error' ? 'error' : 'running',
        }));
      });
      await onRefreshStatus();
    } catch (e: any) {
      setTaskProgress((prev) =>
        prev
          ? {
              ...prev,
              status: 'error',
              message: e?.message || 'OCR 一键安装失败',
            }
          : null
      );
    }
  };

  const handleHarnessAction = async (cliName: string, action: 'install' | 'uninstall') => {
    setTaskProgress({
      targetKey: `cli:${cliName}`,
      title: `${action === 'install' ? '一键部署' : '卸载'} ${cliName.toUpperCase()}`,
      percent: 10,
      message: `正在执行 ${cliName}...`,
      logs: [`准备执行 ${cliName} ${action}...`],
      status: 'running',
    });
    try {
      await api.manageHarnessStream(cliName, action, (evt) => {
        setTaskProgress((prev) => ({
          targetKey: `cli:${cliName}`,
          title: `${action === 'install' ? '一键部署' : '卸载'} ${cliName.toUpperCase()}`,
          percent: Number(evt.percent ?? 50),
          message: evt.message || '',
          logs: evt.log_line
            ? [...(prev?.logs || []).slice(-18), evt.log_line]
            : prev?.logs || [],
          status: evt.type === 'complete' ? 'success' : evt.type === 'error' ? 'error' : 'running',
        }));
      });
      await onRefreshStatus();
    } catch (e: any) {
      setTaskProgress((prev) => (prev ? { ...prev, status: 'error', message: e?.message } : null));
    }
  };

  const handleSelectCliRuntime = (cliName: 'dsh' | 'claude' | 'codex' | 'gemini') => {
    setDraft({
      ...draft,
      harness_config: { ...draft.harness_config, preferred_cli: cliName },
      free_ai_auth: {
        ...draft.free_ai_auth,
        preferred_proxy_mode: cliName === 'dsh' ? 'magpie_dsh' : 'direct_cli',
      },
    });
  };

  const navItems: { key: SectionKey; label: string; desc: string; icon: React.ReactNode }[] = [
    {
      key: 'engine',
      label: 'AI 模型通道',
      desc: 'Magpie+DSH · 云端API',
      icon: <Cpu className="w-4 h-4 shrink-0" />,
    },
    {
      key: 'ocr',
      label: 'OCR 文本识别',
      desc: '显存分级 · 一键下载',
      icon: <ScanText className="w-4 h-4 shrink-0" />,
    },
    {
      key: 'appearance',
      label: '界面外观与光学',
      desc: '标准 / Liquid Glass',
      icon: <Sparkles className="w-4 h-4 shrink-0" />,
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(15, 23, 42, 0.44)', backdropFilter: 'blur(5px)' }}
      onClick={onClose}
    >
      <div
        className="asg-card w-full max-w-5xl h-[86vh] max-h-[780px] flex flex-col md:flex-row overflow-hidden"
        style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left Navigation Column */}
        <aside
          className="w-full md:w-[244px] shrink-0 border-b md:border-b-0 md:border-r p-4 md:p-5 flex flex-col justify-between gap-4"
          style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-subtle)' }}
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-[#3B5BDB] text-white flex items-center justify-center shrink-0">
                  <Settings2 className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm font-bold leading-tight flex items-center gap-1.5">
                    <span>系统设置</span>
                    <span
                      className="text-[10.5px] font-mono px-1.5 py-0.5 rounded-full font-semibold"
                      style={{ backgroundColor: 'var(--brand-tint)', color: '#3B5BDB' }}
                    >
                      v1.2.0
                    </span>
                  </div>
                  <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                    引擎 · 识别 · 光学参数
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="md:hidden p-1.5 rounded-lg hover:bg-black/5 transition"
                aria-label="关闭设置"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <nav className="flex md:flex-col gap-1.5 overflow-x-auto md:overflow-visible pb-1 md:pb-0">
              {navItems.map((item) => {
                const active = activeSection === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setActiveSection(item.key)}
                    className="text-left px-3 py-2.5 rounded-xl border transition flex items-center gap-2.5 shrink-0 md:shrink asg-btn-spring"
                    style={{
                      borderColor: active ? '#3B5BDB' : 'transparent',
                      backgroundColor: active ? 'var(--bg-surface)' : 'transparent',
                      color: active ? '#3B5BDB' : 'var(--text-primary)',
                      boxShadow: active ? '0 2px 8px rgba(59, 91, 219, 0.08)' : 'none',
                    }}
                  >
                    <span style={{ color: active ? '#3B5BDB' : 'var(--text-secondary)' }}>{item.icon}</span>
                    <div className="min-w-0">
                      <div className="text-xs font-bold leading-tight">{item.label}</div>
                      <div className="text-[10.5px] mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>
                        {item.desc}
                      </div>
                    </div>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Left Bottom Environment Summary */}
          <div
            className="hidden md:block p-3 rounded-xl border space-y-1.5 text-[11px]"
            style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
          >
            <div className="font-bold flex items-center justify-between">
              <span style={{ color: 'var(--text-secondary)' }}>当前引擎</span>
              <span className="text-[#3B5BDB]">
                {draft.active_provider === 'cloud'
                  ? '云端 API'
                  : activeCliInHarness === 'dsh'
                  ? 'Magpie + DSH'
                  : `${activeCliInHarness.toUpperCase()} CLI`}
              </span>
            </div>
            <div className="font-bold flex items-center justify-between">
              <span style={{ color: 'var(--text-secondary)' }}>视觉模式</span>
              <span className="text-[#3B5BDB]">
                {effectiveVisualMode === 'liquid_glass' ? 'Liquid Glass' : '标准界面'}
              </span>
            </div>
            <div className="flex items-center justify-between pt-1 border-t" style={{ borderColor: 'var(--border-default)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>GPU 状态</span>
              <span
                className="font-semibold truncate max-w-[125px]"
                style={{ color: gpuAvailable ? 'var(--semantic-success)' : 'var(--text-muted)' }}
                title={status?.gpu_vram.gpu_name}
              >
                {gpuAvailable ? `${status?.gpu_vram.detected_vram_gb}GB 就绪` : '未检出独立 GPU'}
              </span>
            </div>
          </div>
        </aside>

        {/* Right Detail Column */}
        <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden">
          {/* Right Header */}
          <div
            className="px-6 py-4 flex items-center justify-between border-b shrink-0"
            style={{ borderColor: 'var(--border-default)' }}
          >
            <div>
              <h2 className="text-base font-bold">{SECTION_META[activeSection].title}</h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                {SECTION_META[activeSection].subtitle}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="hidden md:inline-flex p-2 rounded-lg hover:bg-black/5 transition"
              aria-label="关闭设置"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Right Scrollable Content */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {activeSection === 'engine' && (
              <>
                {/* Strict 2-Engine Switcher */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setDraft({ ...draft, active_provider: 'harness' })}
                    className="text-left p-4 rounded-2xl border transition asg-btn-spring"
                    style={{
                      borderColor: draft.active_provider === 'harness' ? '#3B5BDB' : 'var(--border-default)',
                      backgroundColor: draft.active_provider === 'harness' ? 'var(--brand-tint)' : 'var(--bg-subtle)',
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sm flex items-center gap-1.5">
                        <Terminal className="w-4 h-4 text-[#3B5BDB]" />
                        Magpie + DeepSeek Harness
                      </span>
                      {draft.active_provider === 'harness' && (
                        <CheckCircle2 className="w-4 h-4 text-[#3B5BDB]" />
                      )}
                    </div>
                    <p className="text-xs mt-1.5 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                      一键下载配置 Magpie 与 DSH，经您明确授权后，通过本机已安装的 Qoder CN / WorkBuddy / Trae CN 免费出题。
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDraft({ ...draft, active_provider: 'cloud' })}
                    className="text-left p-4 rounded-2xl border transition asg-btn-spring"
                    style={{
                      borderColor: draft.active_provider === 'cloud' ? '#3B5BDB' : 'var(--border-default)',
                      backgroundColor: draft.active_provider === 'cloud' ? 'var(--brand-tint)' : 'var(--bg-subtle)',
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sm flex items-center gap-1.5">
                        <Cloud className="w-4 h-4 text-[#3B5BDB]" />
                        云端大模型 API
                      </span>
                      {draft.active_provider === 'cloud' && (
                        <CheckCircle2 className="w-4 h-4 text-[#3B5BDB]" />
                      )}
                    </div>
                    <p className="text-xs mt-1.5 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                      标准接入 DeepSeek、OpenAI、Anthropic 等云端接口；配置好 Base URL 与 API Key 即可稳定高并发出题。
                    </p>
                  </button>
                </div>

                {draft.active_provider === 'harness' ? (
                  <div className="space-y-4">
                    {/* Detection & One-Click Magpie + DSH Card */}
                    <div
                      className="p-4 rounded-2xl border space-y-3"
                      style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-subtle)' }}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-bold flex items-center gap-1.5">
                            <Sparkles className="w-4 h-4 text-[#3B5BDB]" />
                            本机免费 AI 软件与 Magpie 反代池检测
                          </div>
                          <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                            Magpie 网关：{status?.magpie_gateway_running ? '在线运行中 (127.0.0.1:3425)' : '未启动'} ｜
                            DeepSeek Harness：{status?.dsh_available ? '已安装就绪' : '未部署'}
                          </div>
                        </div>
                        <SpringButton
                          springLabel="一键下载安装配置 Magpie 和 DSH"
                          disabled={isRunningTask}
                          onClick={handleSetupMagpieAndDsh}
                          className="px-4 py-2 rounded-xl text-xs font-bold text-white flex items-center gap-1.5"
                          style={{ backgroundColor: '#3B5BDB', cursor: isRunningTask ? 'not-allowed' : 'pointer' }}
                        >
                          {isRunningTask && taskProgress?.targetKey === 'magpie_dsh' ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Download className="w-3.5 h-3.5" />
                          )}
                          一键下载安装配置 Magpie + DSH
                        </SpringButton>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        {installedFreeApps.map((app) => (
                          <div
                            key={app.app_id}
                            className="p-3 rounded-xl border"
                            style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold">{app.name}</span>
                              <span
                                className="text-[11px] px-2 py-0.5 rounded-full font-semibold"
                                style={{
                                  backgroundColor: app.installed ? 'var(--semantic-success-tint)' : 'var(--bg-subtle)',
                                  color: app.installed ? 'var(--semantic-success)' : 'var(--text-muted)',
                                }}
                              >
                                {app.running ? '已安装·在线' : app.installed ? '已安装' : '未安装'}
                              </span>
                            </div>
                            <div className="text-[11px] mt-1" style={{ color: 'var(--text-secondary)' }}>
                              {app.available_models.length > 0
                                ? `可用模型：${app.available_models.slice(0, 3).join(', ')}`
                                : app.installed
                                ? '可在 Magpie 中启用并接入 DSH'
                                : '未在本机检测到'}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Explicit Authorization Panel */}
                    <div
                      className="p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      style={{
                        borderColor: draft.free_ai_auth.authorized_use_local_ai ? '#2B8A3E' : '#D97706',
                        backgroundColor: draft.free_ai_auth.authorized_use_local_ai
                          ? 'var(--semantic-success-tint)'
                          : 'var(--semantic-warning-tint)',
                      }}
                    >
                      <div className="space-y-1">
                        <div className="text-xs font-bold flex items-center gap-1.5">
                          <ShieldCheck className="w-4 h-4" />
                          {draft.free_ai_auth.authorized_use_local_ai
                            ? '已获得您的明确授权：允许通过本机免费 AI 软件 / Magpie + DSH 出题'
                            : '使用前须知与授权确认（调用本机免费 AI 软件反代出题）'}
                        </div>
                        <p className="text-[11.5px] leading-relaxed opacity-90">
                          本应用将仅在您明确授权后，通过本地 Magpie 网关（{draft.free_ai_auth.magpie_gateway_url}）及 DeepSeek Harness 调用您本机已登录的 Qoder CN / WorkBuddy / Trae CN 免费模型能力生成讲义与试题。
                        </p>
                      </div>
                      <SpringButton
                        springLabel="切换本机免费AI授权"
                        onClick={() => handleAuthorizeFreeAi(!draft.free_ai_auth.authorized_use_local_ai)}
                        className="shrink-0 px-3.5 py-2 rounded-xl text-xs font-bold border"
                        style={{
                          backgroundColor: draft.free_ai_auth.authorized_use_local_ai ? '#FFFFFF' : '#2B8A3E',
                          color: draft.free_ai_auth.authorized_use_local_ai ? '#2B8A3E' : '#FFFFFF',
                          borderColor: '#2B8A3E',
                          cursor: 'pointer',
                        }}
                      >
                        {draft.free_ai_auth.authorized_use_local_ai ? '撤回授权' : '我同意并立即授权'}
                      </SpringButton>
                    </div>

                    {/* Model & Gateway Parameters */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <label className="text-xs font-semibold space-y-1 block">
                        <span>反代模型选择（Magpie 已发现 {magpieModels.length} 个免费模型）</span>
                        {magpieModels.length > 0 ? (
                          <select
                            value={draft.free_ai_auth.selected_free_model}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                free_ai_auth: { ...draft.free_ai_auth, selected_free_model: e.target.value },
                              })
                            }
                            className="w-full rounded-xl border px-3 py-2 text-xs"
                            style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
                          >
                            {!magpieModels.includes(draft.free_ai_auth.selected_free_model) && (
                              <option value={draft.free_ai_auth.selected_free_model}>
                                {draft.free_ai_auth.selected_free_model}
                              </option>
                            )}
                            {magpieModels.map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            value={draft.free_ai_auth.selected_free_model}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                free_ai_auth: { ...draft.free_ai_auth, selected_free_model: e.target.value },
                              })
                            }
                            placeholder="qoder-cn/fast"
                            className="w-full rounded-xl border px-3 py-2 text-xs"
                            style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
                          />
                        )}
                      </label>

                      <label className="text-xs font-semibold space-y-1 block">
                        <span>Magpie 本地网关地址</span>
                        <input
                          value={draft.free_ai_auth.magpie_gateway_url}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              free_ai_auth: { ...draft.free_ai_auth, magpie_gateway_url: e.target.value },
                            })
                          }
                          placeholder="http://127.0.0.1:3425/v1"
                          className="w-full rounded-xl border px-3 py-2 text-xs"
                          style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
                        />
                      </label>
                    </div>

                    {/* CLI Harness Runtime Row */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold">子进程运行时选择</span>
                        <span style={{ color: 'var(--text-secondary)' }}>
                          Magpie 反代通道默认使用 DSH；也可切换直连本机其它 CLI
                        </span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {(status?.harnesses || []).map((h) => {
                          const isSelectedCli = activeCliInHarness === h.name;
                          return (
                            <div
                              key={h.name}
                              className="p-2.5 rounded-xl border flex flex-col justify-between gap-2 transition"
                              style={{
                                borderColor: isSelectedCli ? '#3B5BDB' : 'var(--border-default)',
                                backgroundColor: isSelectedCli ? 'var(--brand-tint)' : 'var(--bg-subtle)',
                              }}
                            >
                              <div className="flex items-center justify-between text-xs font-bold">
                                <span className="flex items-center gap-1">
                                  <span>{h.name.toUpperCase()}</span>
                                  {isSelectedCli && (
                                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#3B5BDB] text-white">
                                      使用中
                                    </span>
                                  )}
                                </span>
                                <span style={{ color: h.available ? 'var(--semantic-success)' : 'var(--text-muted)' }}>
                                  {h.available ? '已装' : '未装'}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  disabled={!h.available || isSelectedCli}
                                  onClick={() => handleSelectCliRuntime(h.name as 'dsh' | 'claude' | 'codex' | 'gemini')}
                                  className="flex-1 py-1 rounded-lg text-[11px] font-semibold border transition"
                                  style={{
                                    borderColor: isSelectedCli ? '#3B5BDB' : 'var(--border-default)',
                                    backgroundColor: 'var(--bg-surface)',
                                    color: isSelectedCli ? '#3B5BDB' : 'var(--text-primary)',
                                    opacity: !h.available ? 0.45 : 1,
                                    cursor: !h.available || isSelectedCli ? 'default' : 'pointer',
                                  }}
                                >
                                  {isSelectedCli ? '已激活' : '设为当前'}
                                </button>
                                <button
                                  type="button"
                                  disabled={isRunningTask}
                                  onClick={() => handleHarnessAction(h.name, 'install')}
                                  className="px-2 py-1 rounded-lg text-[11px] font-semibold bg-[#3B5BDB] text-white"
                                >
                                  {h.available ? '更新' : '安装'}
                                </button>
                                {h.available && h.name !== 'dsh' && (
                                  <button
                                    type="button"
                                    disabled={isRunningTask}
                                    onClick={() => handleHarnessAction(h.name, 'uninstall')}
                                    className="p-1 rounded-lg border text-rose-600"
                                    title="卸载"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Cloud API Form */
                  <div
                    className="p-4 rounded-2xl border space-y-3"
                    style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-subtle)' }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-bold">云端 API 参数设置</span>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setDraft({
                              ...draft,
                              cloud_config: {
                                ...draft.cloud_config,
                                provider_label: 'DeepSeek 官方',
                                api_format: 'openai_compatible',
                                base_url: 'https://api.deepseek.com/v1',
                                model: 'deepseek-chat',
                              },
                            })
                          }
                          className="px-2.5 py-1 rounded-full text-[11px] border font-semibold"
                          style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
                        >
                          填充 DeepSeek 预设
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setDraft({
                              ...draft,
                              cloud_config: {
                                ...draft.cloud_config,
                                provider_label: 'OpenAI 兼容接口',
                                api_format: 'openai_compatible',
                                base_url: 'https://api.openai.com/v1',
                                model: 'gpt-4o-mini',
                              },
                            })
                          }
                          className="px-2.5 py-1 rounded-full text-[11px] border font-semibold"
                          style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
                        >
                          填充 OpenAI 预设
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <label className="text-xs font-semibold space-y-1 block">
                        <span>API Base URL</span>
                        <input
                          value={draft.cloud_config.base_url}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              cloud_config: { ...draft.cloud_config, base_url: e.target.value },
                            })
                          }
                          placeholder="https://api.deepseek.com/v1"
                          className="w-full rounded-xl border px-3 py-2 text-xs"
                          style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
                        />
                      </label>
                      <label className="text-xs font-semibold space-y-1 block">
                        <span>推理模型名称</span>
                        <input
                          value={draft.cloud_config.model}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              cloud_config: { ...draft.cloud_config, model: e.target.value },
                            })
                          }
                          placeholder="deepseek-chat / gpt-4o-mini"
                          className="w-full rounded-xl border px-3 py-2 text-xs"
                          style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
                        />
                      </label>
                      <label className="text-xs font-semibold space-y-1 block md:col-span-2">
                        <span>API Key</span>
                        <div className="relative">
                          <input
                            type={showKey ? 'text' : 'password'}
                            value={draft.cloud_config.api_key}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                cloud_config: { ...draft.cloud_config, api_key: e.target.value },
                              })
                            }
                            placeholder="sk-..."
                            className="w-full rounded-xl border px-3 py-2 pr-9 text-xs"
                            style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
                          />
                          <button
                            type="button"
                            onClick={() => setShowKey((s) => !s)}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                          >
                            {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </label>
                    </div>
                  </div>
                )}

                {/* Connectivity test + result banner */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <SpringButton
                    springLabel="测试当前引擎连通性"
                    disabled={!!testing}
                    onClick={() => handleTest(draft.active_provider)}
                    className="px-3.5 py-2 rounded-xl text-xs font-bold border flex items-center gap-1.5"
                    style={{
                      borderColor: '#3B5BDB',
                      color: '#3B5BDB',
                      backgroundColor: 'var(--brand-tint)',
                      cursor: testing ? 'wait' : 'pointer',
                    }}
                  >
                    {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    测试当前选定引擎连通性
                  </SpringButton>
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    提示：无付费 Key 时推荐使用「Magpie + DeepSeek Harness」免费反代出题
                  </span>
                </div>
                {testResult && (
                  <div
                    className="p-3 rounded-xl border text-xs font-medium"
                    style={{
                      borderColor: testResult.ok ? 'var(--semantic-success)' : 'var(--semantic-warning)',
                      backgroundColor: testResult.ok ? 'var(--semantic-success-tint)' : 'var(--semantic-warning-tint)',
                      color: testResult.ok ? 'var(--semantic-success)' : 'var(--semantic-warning)',
                    }}
                  >
                    {testResult.msg}
                  </div>
                )}
              </>
            )}

            {activeSection === 'ocr' && (
              <div className="space-y-4">
                {/* GPU VRAM Classification Banner */}
                <div
                  className="p-4 rounded-2xl border space-y-2.5"
                  style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--brand-tint)' }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-bold text-sm text-[#3B5BDB]">
                      <ScanText className="w-4 h-4" />
                      <span>显卡硬件检测与 OCR 引擎推荐</span>
                    </div>
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-white/80 text-[#3B5BDB]">
                      {status?.gpu_vram.gpu_name || '检测中...'} ·{' '}
                      {status?.gpu_vram.detected_vram_gb ? `${status.gpu_vram.detected_vram_gb} GB` : '无独立显卡'}
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                    {status?.gpu_vram.recommendation_reason ||
                      '≤ 8GB 推荐 MinerU Pipeline / Free-OXR；8–48GB 推荐 MinerU VLM 全量；≥ 48GB 推荐 OXR Full / MinerU 全量。'}
                  </p>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <span className="text-xs font-semibold">显存档位覆写：</span>
                    <SpringSegmentedControl<VramPresetKey>
                      compact
                      springLabel="显存档位"
                      value={vramPresetFromOverride(draft.ocr_config.vram_override_gb)}
                      onChange={(k) => {
                        const val =
                          k === 'auto' ? null : k === 'le_8gb' ? 8 : k === 'gt_8_lt_48gb' ? 24 : 48;
                        setDraft({
                          ...draft,
                          ocr_config: { ...draft.ocr_config, vram_override_gb: val },
                        });
                      }}
                      options={[
                        { value: 'auto', label: '自动探测' },
                        { value: 'le_8gb', label: '≤ 8GB' },
                        { value: 'gt_8_lt_48gb', label: '8–48GB' },
                        { value: 'ge_48gb', label: '≥ 48GB' },
                      ]}
                    />
                  </div>
                </div>

                {/* OCR Engines List with One-Click Download/Start */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {(status?.ocr_engines || []).map((eng) => {
                    const isActive = draft.ocr_config.active_engine === eng.engine_id;
                    const isRec = status?.gpu_vram.recommended_ocr_engine === eng.engine_id;
                    return (
                      <div
                        key={eng.engine_id}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            ocr_config: { ...draft.ocr_config, active_engine: eng.engine_id },
                          })
                        }
                        className="p-3.5 rounded-2xl border cursor-pointer transition space-y-2"
                        style={{
                          borderColor: isActive ? '#3B5BDB' : 'var(--border-default)',
                          backgroundColor: isActive ? 'var(--brand-tint)' : 'var(--bg-surface)',
                        }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-xs font-bold flex items-center gap-1.5">
                              <span>{eng.name}</span>
                              {isRec && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-600 text-white">
                                  显存推荐
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] mt-0.5 font-medium" style={{ color: 'var(--text-secondary)' }}>
                              {eng.tier_badge}
                            </div>
                          </div>
                          <span
                            className="text-[11px] px-2 py-0.5 rounded-full font-semibold shrink-0"
                            style={{
                              backgroundColor: eng.running || eng.installed ? 'var(--semantic-success-tint)' : 'var(--bg-subtle)',
                              color: eng.running || eng.installed ? 'var(--semantic-success)' : 'var(--text-muted)',
                            }}
                          >
                            {eng.running ? '运行中' : eng.installed ? '已安装' : '未安装'}
                          </span>
                        </div>
                        <p className="text-[11.5px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                          {eng.description}
                        </p>
                        {eng.supports_one_click_setup && (
                          <div className="pt-1 flex justify-end">
                            <button
                              type="button"
                              disabled={isRunningTask}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOcrStreamSetup(eng.engine_id, eng.name);
                              }}
                              className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-[#3B5BDB] text-white flex items-center gap-1"
                            >
                              <Download className="w-3 h-3" />
                              {eng.installed ? '一键重启 / 检查升级' : '一键下载并部署启动'}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {activeSection === 'appearance' && (
              <div className="space-y-4">
                <div
                  className="p-4 rounded-2xl border space-y-2"
                  style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-subtle)' }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-bold flex items-center gap-1.5">
                      <Cpu className="w-4 h-4 text-[#3B5BDB]" />
                      <span>显卡图形渲染能力检测</span>
                    </div>
                    <span
                      className="text-xs px-2.5 py-0.5 rounded-full font-semibold"
                      style={{
                        backgroundColor: gpuAvailable ? 'var(--semantic-success-tint)' : 'var(--semantic-warning-tint)',
                        color: gpuAvailable ? 'var(--semantic-success)' : 'var(--semantic-warning)',
                      }}
                    >
                      {gpuAvailable ? `GPU 硬件加速已就绪 (${status?.gpu_vram.gpu_name})` : '未检测到独立 GPU · 使用标准界面'}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => onChangeVisualMode('academic_pure')}
                    className="text-left p-4 rounded-2xl border transition asg-btn-spring"
                    style={{
                      borderColor: effectiveVisualMode === 'academic_pure' ? '#3B5BDB' : 'var(--border-default)',
                      backgroundColor: effectiveVisualMode === 'academic_pure' ? 'var(--brand-tint)' : 'var(--bg-surface)',
                    }}
                  >
                    <div className="flex items-center justify-between font-bold text-sm">
                      <span>标准界面（默认）</span>
                      {effectiveVisualMode === 'academic_pure' && <CheckCircle2 className="w-4 h-4 text-[#3B5BDB]" />}
                    </div>
                    <p className="text-xs mt-1.5 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                      柔和纸张底色与高对比度阅读排版，适合长时间专注学习与刷题。
                    </p>
                  </button>

                  <button
                    type="button"
                    disabled={!gpuAvailable}
                    onClick={() => gpuAvailable && onChangeVisualMode('liquid_glass')}
                    className="text-left p-4 rounded-2xl border transition asg-btn-spring"
                    style={{
                      borderColor: effectiveVisualMode === 'liquid_glass' ? '#3B5BDB' : 'var(--border-default)',
                      backgroundColor: effectiveVisualMode === 'liquid_glass' ? 'var(--brand-tint)' : 'var(--bg-surface)',
                      opacity: gpuAvailable ? 1 : 0.55,
                      cursor: gpuAvailable ? 'pointer' : 'not-allowed',
                    }}
                  >
                    <div className="flex items-center justify-between font-bold text-sm">
                      <span>Liquid Glass 液态玻璃</span>
                      {effectiveVisualMode === 'liquid_glass' && <CheckCircle2 className="w-4 h-4 text-[#3B5BDB]" />}
                    </div>
                    <p className="text-xs mt-1.5 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                      启用实时光学折射、色散高光与面板柔滑过渡效果（需独立 GPU 支持）。{!gpuAvailable && '（当前无 GPU 不可用）'}
                    </p>
                  </button>
                </div>

                {/* Integrated Liquid Glass Optical Parameter Controls */}
                <div
                  className="p-4 rounded-2xl border space-y-4"
                  style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-subtle)' }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-bold flex items-center gap-1.5">
                        <Sliders className="w-4 h-4 text-[#3B5BDB]" />
                        <span>Liquid Glass 光学效果调节</span>
                      </div>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                        {effectiveVisualMode === 'liquid_glass'
                          ? '调节滑块将实时作用于当前 Liquid Glass 着色器渲染'
                          : '开启上方「Liquid Glass 液态玻璃」后生效，参数自动保存'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onChangeOptics({ ...DEFAULT_LIQUID_OPTICS })}
                      className="px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5"
                      style={{
                        borderColor: 'var(--border-default)',
                        backgroundColor: 'var(--bg-surface)',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>恢复默认光学参数</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div
                      className="p-3 rounded-xl border space-y-1.5"
                      style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
                    >
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span>折射率 (IOR)</span>
                        <span className="font-mono text-[#3B5BDB]">{optics.ior.toFixed(2)}</span>
                      </div>
                      <input
                        type="range"
                        min="1.00"
                        max="2.50"
                        step="0.01"
                        value={optics.ior}
                        onChange={(e) => onChangeOptics({ ...optics, ior: parseFloat(e.target.value) })}
                        className="w-full accent-[#3B5BDB] cursor-pointer"
                      />
                      <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                        控制面板边缘背景光线的弯曲放大程度（默认 1.46）
                      </div>
                    </div>

                    <div
                      className="p-3 rounded-xl border space-y-1.5"
                      style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
                    >
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span>色散强度 (Dispersion)</span>
                        <span className="font-mono text-[#3B5BDB]">{optics.dispersion.toFixed(2)}</span>
                      </div>
                      <input
                        type="range"
                        min="0.00"
                        max="1.00"
                        step="0.01"
                        value={optics.dispersion}
                        onChange={(e) => onChangeOptics({ ...optics, dispersion: parseFloat(e.target.value) })}
                        className="w-full accent-[#3B5BDB] cursor-pointer"
                      />
                      <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                        调节玻璃棱镜边界的 RGB 彩虹色散分色效果（默认 0.35）
                      </div>
                    </div>

                    <div
                      className="p-3 rounded-xl border space-y-1.5"
                      style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
                    >
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span>边缘柔化融合 (Smooth K)</span>
                        <span className="font-mono text-[#3B5BDB]">{Math.round(optics.smoothK)}</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="90"
                        step="1"
                        value={optics.smoothK}
                        onChange={(e) => onChangeOptics({ ...optics, smoothK: parseFloat(e.target.value) })}
                        className="w-full accent-[#3B5BDB] cursor-pointer"
                      />
                      <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                        调整相邻玻璃卡片边界的 SDF 平滑融合过渡半径（默认 30）
                      </div>
                    </div>

                    <div
                      className="p-3 rounded-xl border space-y-1.5"
                      style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
                    >
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span>磨砂模糊 (Blur)</span>
                        <span className="font-mono text-[#3B5BDB]">{optics.blur.toFixed(2)}</span>
                      </div>
                      <input
                        type="range"
                        min="0.00"
                        max="1.00"
                        step="0.01"
                        value={optics.blur}
                        onChange={(e) => onChangeOptics({ ...optics, blur: parseFloat(e.target.value) })}
                        className="w-full accent-[#3B5BDB] cursor-pointer"
                      />
                      <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                        调整透过玻璃背景的纹理模糊雾化浓度（默认 0.35）
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Shared SSE Deployment Terminal */}
            {taskProgress && (
              <div className="p-4 rounded-2xl border bg-slate-900 text-slate-100 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold">
                  <span>{taskProgress.title}</span>
                  <span>{taskProgress.percent}%</span>
                </div>
                <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#5C7CFA] transition-all duration-300"
                    style={{ width: `${Math.max(4, Math.min(100, taskProgress.percent))}%` }}
                  />
                </div>
                <div className="text-xs text-slate-300">{taskProgress.message}</div>
                <div className="max-h-28 overflow-y-auto font-mono text-[11px] text-slate-400 space-y-0.5 pt-1">
                  {taskProgress.logs.map((ln, idx) => (
                    <div key={idx}>{ln}</div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Footer */}
          <div
            className="px-6 py-3.5 border-t flex items-center justify-end gap-2 shrink-0"
            style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-subtle)' }}
          >
            <SpringButton
              springLabel="取消设置"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold border"
              style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
            >
              关闭
            </SpringButton>
            <SpringButton
              springLabel="保存全部配置"
              disabled={saving}
              onClick={handleSave}
              className="px-5 py-2 rounded-xl text-xs font-bold text-white"
              style={{ backgroundColor: '#3B5BDB', cursor: saving ? 'wait' : 'pointer' }}
            >
              {saving ? '保存中...' : '保存并生效'}
            </SpringButton>
          </div>
        </div>
      </div>
    </div>
  );
};
