import React, { useState } from 'react';
import {
  Cloud,
  Cpu,
  Terminal,
  Sparkles,
  CheckCircle2,
  XCircle,
  X,
  RefreshCw,
  Zap,
} from 'lucide-react';
import { api } from '../api';
import {
  ProviderStatusResponse,
  ProviderType,
  RouterSettings,
  StageName,
} from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  status: ProviderStatusResponse | null;
  onSaved: (settings: RouterSettings) => void;
  onRefreshStatus: () => Promise<void>;
}

const STAGE_LABELS: Record<StageName, string> = {
  vision_ocr: '1. 扫描件 / 图片识图 (OCR/VLM)',
  requirement_negotiation: '2. 需求解析与方案制定',
  notes_and_cheatsheet: '3. 导学案笔记 & 速记表生成',
  quiz_generation: '4. 随堂/同步/自测题库生成',
  mindmap_generation: '5. 可视化知识图谱生成',
};

const PROVIDER_OPTIONS: { value: ProviderType; label: string }[] = [
  { value: 'heuristic', label: '内置智能规则引擎 (免Token即时预览)' },
  { value: 'harness', label: '本地 CLI Harness (Claude / Codex / Gemini)' },
  { value: 'cloud', label: '云端 API (OpenAI / DeepSeek / Claude / OpenRouter)' },
  { value: 'local', label: '本地模型服务 (Ollama / LM Studio)' },
];

export const RouterConfigModal: React.FC<Props> = ({
  open,
  onClose,
  status,
  onSaved,
  onRefreshStatus,
}) => {
  const [draft, setDraft] = useState<RouterSettings | null>(
    status ? JSON.parse(JSON.stringify(status.settings)) : null
  );
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  React.useEffect(() => {
    if (status && open) {
      setDraft(JSON.parse(JSON.stringify(status.settings)));
      setTestResult(null);
    }
  }, [status, open]);

  if (!open || !draft || !status) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = await api.saveProviderSettings(draft);
      onSaved(saved);
      onClose();
    } catch (e: any) {
      setTestResult(`保存失败: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (provider: ProviderType) => {
    setTesting(true);
    setTestResult('正在测试连接...');
    try {
      await api.saveProviderSettings(draft);
      const res = await api.testProvider(provider);
      if (res.ok) {
        setTestResult(`✅ 测试成功 [${res.label}]: ${res.sample_response}`);
      } else {
        setTestResult(`❌ 测试失败: ${res.error}`);
      }
    } catch (e: any) {
      setTestResult(`❌ 测试异常: ${e.message}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
      <div className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl border border-slate-200">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Zap className="w-5 h-5 text-indigo-600" />
              三模路由与 CLI Harness 编排中心
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              自由切换 云端 API / 本地模型 (Ollama·LM Studio) / 本地 Agent CLI Harness (Claude·Codex)，支持按阶段混合路由
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onRefreshStatus}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              <RefreshCw className="w-3.5 h-3.5" /> 重新探测本机环境
            </button>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Routing Mode Selector */}
          <div className="rounded-xl bg-slate-50 p-4 border border-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-slate-800">路由调度模式</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  单一引擎模式统一调用同一通道；智能阶段编排允许不同任务阶段使用不同模型/CLI
                </div>
              </div>
              <div className="flex rounded-lg bg-white p-1 border border-slate-200">
                <button
                  onClick={() => setDraft({ ...draft, routing_mode: 'single' })}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                    draft.routing_mode === 'single'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  单一引擎直连
                </button>
                <button
                  onClick={() => setDraft({ ...draft, routing_mode: 'smart_stage' })}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                    draft.routing_mode === 'smart_stage'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  智能阶段 Harness 编排
                </button>
              </div>
            </div>

            {draft.routing_mode === 'single' ? (
              <div className="mt-4">
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  当前全局激活引擎
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {PROVIDER_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setDraft({ ...draft, active_provider: opt.value })}
                      className={`text-left px-3 py-2.5 rounded-lg border text-xs font-medium transition ${
                        draft.active_provider === opt.value
                          ? 'border-indigo-600 bg-indigo-50 text-indigo-800 ring-1 ring-indigo-600'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                <div className="text-xs font-medium text-slate-700">按任务阶段分配路由通道：</div>
                {(Object.keys(STAGE_LABELS) as StageName[]).map((stage) => (
                  <div
                    key={stage}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-white p-2.5 rounded-lg border border-slate-200"
                  >
                    <span className="text-xs font-medium text-slate-700">{STAGE_LABELS[stage]}</span>
                    <select
                      value={draft.stage_mapping[stage]?.provider || 'heuristic'}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          stage_mapping: {
                            ...draft.stage_mapping,
                            [stage]: { provider: e.target.value as ProviderType },
                          },
                        })
                      }
                      className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs bg-white"
                    >
                      {PROVIDER_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}

            <label className="mt-3 inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.enable_fallback}
                onChange={(e) => setDraft({ ...draft, enable_fallback: e.target.checked })}
                className="rounded border-slate-300 text-indigo-600"
              />
              启用自动安全回退（当外部 API / CLI 调用超时或未配置时自动降级至内置智能规则引擎，确保流程不中断）
            </label>
          </div>

          {/* 3-Column Provider Configurations */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* CLI Harness Card */}
            <div className="rounded-xl border border-slate-200 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                  <Terminal className="w-4 h-4 text-emerald-600" />
                  CLI Harness 路由
                </h3>
                <button
                  disabled={testing}
                  onClick={() => handleTest('harness')}
                  className="text-xs text-indigo-600 hover:underline font-medium"
                >
                  测试 CLI
                </button>
              </div>
              <div className="space-y-1.5">
                {status.harnesses.map((h) => (
                  <div
                    key={h.name}
                    className="flex items-center justify-between text-xs px-2.5 py-1.5 rounded-md bg-slate-50"
                  >
                    <span className="font-medium uppercase">{h.name}</span>
                    {h.available ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" /> 已检测到
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-slate-400">
                        <XCircle className="w-3.5 h-3.5" /> 未安装
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">首选 CLI 工具</label>
                <select
                  value={draft.harness_config.preferred_cli}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      harness_config: {
                        ...draft.harness_config,
                        preferred_cli: e.target.value as any,
                      },
                    })
                  }
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                >
                  <option value="claude">Claude Code CLI (claude)</option>
                  <option value="codex">OpenAI Codex CLI (codex)</option>
                  <option value="gemini">Gemini CLI (gemini)</option>
                  <option value="custom">自定义命令模板</option>
                </select>
              </div>
              {draft.harness_config.preferred_cli === 'custom' && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    自定义模板 (支持 {'{prompt_file}'})
                  </label>
                  <input
                    type="text"
                    value={draft.harness_config.custom_command_template}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        harness_config: {
                          ...draft.harness_config,
                          custom_command_template: e.target.value,
                        },
                      })
                    }
                    placeholder="my-agent --file {prompt_file}"
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                  />
                </div>
              )}
            </div>

            {/* Cloud API Card */}
            <div className="rounded-xl border border-slate-200 p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                  <Cloud className="w-4 h-4 text-sky-600" />
                  云端 API 配置
                </h3>
                <button
                  disabled={testing}
                  onClick={() => handleTest('cloud')}
                  className="text-xs text-indigo-600 hover:underline font-medium"
                >
                  测试 API
                </button>
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-0.5">接口协议</label>
                <select
                  value={draft.cloud_config.api_format}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      cloud_config: { ...draft.cloud_config, api_format: e.target.value as any },
                    })
                  }
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                >
                  <option value="openai_compatible">OpenAI 兼容 (DeepSeek / OpenRouter / Qwen 等)</option>
                  <option value="anthropic">Anthropic Claude 原生</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-0.5">Base URL</label>
                <input
                  type="text"
                  value={draft.cloud_config.base_url}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      cloud_config: { ...draft.cloud_config, base_url: e.target.value },
                    })
                  }
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-0.5">API Key</label>
                <input
                  type="password"
                  value={draft.cloud_config.api_key}
                  placeholder="sk-..."
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      cloud_config: { ...draft.cloud_config, api_key: e.target.value },
                    })
                  }
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-0.5">文本模型名称</label>
                <input
                  type="text"
                  value={draft.cloud_config.model}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      cloud_config: { ...draft.cloud_config, model: e.target.value },
                    })
                  }
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                />
              </div>
            </div>

            {/* Local LLM Card */}
            <div className="rounded-xl border border-slate-200 p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                  <Cpu className="w-4 h-4 text-violet-600" />
                  本地模型服务
                </h3>
                <button
                  disabled={testing}
                  onClick={() => handleTest('local')}
                  className="text-xs text-indigo-600 hover:underline font-medium"
                >
                  测试本地
                </button>
              </div>
              <div className="text-xs space-y-1">
                <div className="flex justify-between bg-slate-50 px-2 py-1 rounded">
                  <span>Ollama</span>
                  <span className={status.ollama_available ? 'text-emerald-600 font-medium' : 'text-slate-400'}>
                    {status.ollama_available ? `在线 (${status.ollama_models.length} 模型)` : '未启动'}
                  </span>
                </div>
                <div className="flex justify-between bg-slate-50 px-2 py-1 rounded">
                  <span>LM Studio</span>
                  <span className={status.lmstudio_available ? 'text-emerald-600 font-medium' : 'text-slate-400'}>
                    {status.lmstudio_available ? `在线 (${status.lmstudio_models.length} 模型)` : '未启动'}
                  </span>
                </div>
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-0.5">本地引擎</label>
                <select
                  value={draft.local_config.engine}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      local_config: { ...draft.local_config, engine: e.target.value as any },
                    })
                  }
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                >
                  <option value="ollama">Ollama (127.0.0.1:11434)</option>
                  <option value="lmstudio">LM Studio (127.0.0.1:1234)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-0.5">模型名</label>
                {((draft.local_config.engine === 'ollama' && status.ollama_models.length > 0) ||
                  (draft.local_config.engine === 'lmstudio' && status.lmstudio_models.length > 0)) ? (
                  <select
                    value={draft.local_config.model}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        local_config: { ...draft.local_config, model: e.target.value },
                      })
                    }
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                  >
                    {(draft.local_config.engine === 'ollama'
                      ? status.ollama_models
                      : status.lmstudio_models
                    ).map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={draft.local_config.model}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        local_config: { ...draft.local_config, model: e.target.value },
                      })
                    }
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                  />
                )}
              </div>
            </div>
          </div>

          {testResult && (
            <div className="rounded-xl bg-slate-900 text-slate-100 px-4 py-3 text-xs font-mono">
              {testResult}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-3.5">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-200"
          >
            取消
          </button>
          <button
            disabled={saving}
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            <Sparkles className="w-4 h-4" />
            {saving ? '保存中...' : '保存路由配置'}
          </button>
        </div>
      </div>
    </div>
  );
};
