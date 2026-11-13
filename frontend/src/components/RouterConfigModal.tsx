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
  ScanText,
  Download,
} from 'lucide-react';
import { api } from '../api';
import {
  GpuVramInfo,
  OcrEngineStatusItem,
  OcrEngineType,
  ProviderStatusResponse,
  ProviderType,
  RouterSettings,
  StageName,
} from '../types';
import {
  SpringButton,
  SpringSegmentedControl,
  SpringToggleSwitch,
} from '../utils/springPhysics';

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
  { value: 'heuristic', label: '内置规则引擎' },
  { value: 'harness', label: 'CLI Harness (DSH/Claude/Codex)' },
  { value: 'cloud', label: '云端 API' },
  { value: 'local', label: '本地模型 (Ollama/LM Studio)' },
];

type VramPresetKey = 'auto' | 'le_8gb' | 'gt_8_lt_48gb' | 'ge_48gb';

function vramPresetFromOverride(override?: number | null): VramPresetKey {
  if (override === undefined || override === null) return 'auto';
  if (override >= 48) return 'ge_48gb';
  if (override > 8) return 'gt_8_lt_48gb';
  return 'le_8gb';
}

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
  const [liveVram, setLiveVram] = useState<GpuVramInfo | null>(status?.gpu_vram ?? null);
  const [liveOcrEngines, setLiveOcrEngines] = useState<OcrEngineStatusItem[]>(
    status?.ocr_engines ?? []
  );
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [installingTarget, setInstallingTarget] = useState<string | null>(null);

  React.useEffect(() => {
    if (status && open) {
      const cloned: RouterSettings = JSON.parse(JSON.stringify(status.settings));
      if (!cloned.ocr_config) {
        cloned.ocr_config = {
          active_engine: 'auto_recommend',
          detect_vram_on_startup: true,
          vram_override_gb: null,
          somark_api_base_url: 'https://free-oxr.somark.ai/api/v1',
          somark_api_key: '',
          mineru_service_url: 'http://127.0.0.1:8010',
          oxr_service_url: 'http://127.0.0.1:8020',
        };
      }
      setDraft(cloned);
      setLiveVram(status.gpu_vram);
      setLiveOcrEngines(status.ocr_engines || []);
      setTestResult(null);
    }
  }, [status, open]);

  if (!open || !draft || !status) return null;

  const currentVram = liveVram || status.gpu_vram;
  const currentOcrEngines = liveOcrEngines.length > 0 ? liveOcrEngines : status.ocr_engines;

  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = await api.saveProviderSettings(draft);
      onSaved(saved);
      await onRefreshStatus();
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

  const handleVramPresetChange = async (tierKey: VramPresetKey) => {
    const overrideMap: Record<VramPresetKey, number | null> = {
      auto: null,
      le_8gb: 8,
      gt_8_lt_48gb: 24,
      ge_48gb: 48,
    };
    const nextOverride = overrideMap[tierKey];
    const nextDraft = {
      ...draft,
      ocr_config: { ...draft.ocr_config, vram_override_gb: nextOverride },
    };
    setDraft(nextDraft);
    try {
      const res = await api.detectOcrVram(nextOverride);
      setLiveVram(res.gpu_vram);
      setLiveOcrEngines(res.ocr_engines);
    } catch (e: any) {
      setTestResult(`显存探测异常: ${e.message}`);
    }
  };

  const handleSetupOcr = async (engineId: OcrEngineType) => {
    setInstallingTarget(`ocr:${engineId}`);
    setTestResult(`正在静默执行 [${engineId}] 下载·安装·启动一条龙服务...`);
    try {
      const res = await api.setupOcrEngine(engineId, 'install_and_start');
      setTestResult(`${res.ok ? '✅' : '⚠️'} ${res.message}${res.log ? `\n${res.log}` : ''}`);
      await onRefreshStatus();
      const vramRes = await api.detectOcrVram(draft.ocr_config.vram_override_gb);
      setLiveVram(vramRes.gpu_vram);
      setLiveOcrEngines(vramRes.ocr_engines);
      if (res.ok) {
        setDraft((prev) =>
          prev ? { ...prev, ocr_config: { ...prev.ocr_config, active_engine: engineId } } : prev
        );
      }
    } catch (e: any) {
      setTestResult(`❌ OCR 部署异常: ${e.message}`);
    } finally {
      setInstallingTarget(null);
    }
  };

  const handleInstallHarness = async (cliName: string) => {
    setInstallingTarget(`cli:${cliName}`);
    setTestResult(`正在静默安装 ${cliName.toUpperCase()} CLI Harness...`);
    try {
      const res = await api.installHarness(cliName);
      setTestResult(`${res.ok ? '✅' : '⚠️'} ${res.message}${res.log ? `\n${res.log}` : ''}`);
      await onRefreshStatus();
      if (res.ok && ['dsh', 'claude', 'codex', 'gemini'].includes(cliName)) {
        setDraft((prev) =>
          prev
            ? {
                ...prev,
                harness_config: {
                  ...prev.harness_config,
                  preferred_cli: cliName as RouterSettings['harness_config']['preferred_cli'],
                },
              }
            : prev
        );
      }
    } catch (e: any) {
      setTestResult(`❌ CLI 安装异常: ${e.message}`);
    } finally {
      setInstallingTarget(null);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(15, 23, 42, 0.45)',
        backdropFilter: 'blur(8px)',
        padding: '16px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '1040px',
          maxHeight: '92vh',
          overflowY: 'auto',
          borderRadius: '20px',
          backgroundColor: '#FFFFFF',
          boxShadow: '0 28px 70px -16px rgba(0, 0, 0, 0.35)',
          border: '1px solid rgba(60, 60, 67, 0.14)',
        }}
      >
        {/* Header */}
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid rgba(60, 60, 67, 0.12)',
            backgroundColor: 'rgba(255, 255, 255, 0.92)',
            backdropFilter: 'blur(18px)',
            padding: '14px 22px',
          }}
        >
          <div>
            <h2
              style={{
                fontSize: '16px',
                fontWeight: 700,
                color: '#1C1C1E',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <Zap className="w-5 h-5 text-[#007AFF]" />
              三模路由、DSH CLI Harness 与显卡分级 OCR 部署中心
            </h2>
            <p style={{ fontSize: '11.5px', color: '#636366', marginTop: '2px' }}>
              启动自动探测显存并推荐 MinerU 2 Pipeline / 全量 MinerU / SoMark Free-OXR / PaddleOCR / OXR 全量部署，同时支持 DSH 一键安装
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <SpringButton
              springLabel="重新探测环境"
              onClick={onRefreshStatus}
              maxShift={5}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                borderRadius: '999px',
                border: '1px solid rgba(60, 60, 67, 0.14)',
                backgroundColor: '#F9F9FB',
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: 600,
                color: '#1C1C1E',
                cursor: 'pointer',
              }}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              重新探测环境
            </SpringButton>
            <SpringButton
              springLabel="关闭设置"
              onClick={onClose}
              maxShift={4}
              style={{
                borderRadius: '999px',
                border: 'none',
                backgroundColor: '#F2F2F7',
                padding: '6px',
                color: '#636366',
                cursor: 'pointer',
              }}
            >
              <X className="w-4 h-4" />
            </SpringButton>
          </div>
        </div>

        <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {/* Section 1: GPU VRAM Detection & Tiered OCR Engine Matrix */}
          <div
            style={{
              borderRadius: '16px',
              backgroundColor: '#F9F9FB',
              border: '1px solid rgba(60, 60, 67, 0.1)',
              padding: '16px',
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
                gap: '10px',
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: '14px',
                    fontWeight: 700,
                    color: '#1C1C1E',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <ScanText className="w-4 h-4 text-[#007AFF]" />
                  <span>分级 OCR 识别引擎与启动显存检测</span>
                </div>
                {currentVram && (
                  <div style={{ fontSize: '11.5px', color: '#3A3A3C', marginTop: '4px' }}>
                    <span style={{ fontWeight: 600, color: '#007AFF' }}>
                      {currentVram.gpu_name} · 有效显存 {currentVram.effective_vram_gb.toFixed(1)} GB
                    </span>
                    <span style={{ color: '#636366', marginLeft: '8px' }}>
                      {currentVram.recommendation_reason}
                    </span>
                  </div>
                )}
              </div>

              <SpringToggleSwitch
                checked={draft.ocr_config.detect_vram_on_startup}
                onChange={(val) =>
                  setDraft({
                    ...draft,
                    ocr_config: { ...draft.ocr_config, detect_vram_on_startup: val },
                  })
                }
                label="启动时检测显存大小"
                springLabel="显存启动检测开关"
              />
            </div>

            {/* VRAM Tier Quick Probe / Simulation Switcher */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#636366' }}>
                显存档位模式：
              </span>
              <SpringSegmentedControl<VramPresetKey>
                springLabel="显存档位切换"
                compact
                wrap
                value={vramPresetFromOverride(draft.ocr_config.vram_override_gb)}
                onChange={handleVramPresetChange}
                options={[
                  { value: 'auto', label: '自动探测本机显存' },
                  { value: 'le_8gb', label: '≤ 8GB 轻量档 (MinerU Pipeline / Free-OXR / PaddleOCR)' },
                  { value: 'gt_8_lt_48gb', label: '8–48GB 进阶档 (MinerU 2 全量本地)' },
                  { value: 'ge_48gb', label: '≥ 48GB 旗舰档 (SoMark OXR 全量部署)' },
                ]}
              />
            </div>

            {/* Active OCR Selector */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#636366' }}>
                当前激活 OCR：
              </span>
              <SpringSegmentedControl<OcrEngineType>
                springLabel="OCR引擎切换"
                compact
                wrap
                value={draft.ocr_config.active_engine}
                onChange={(val) =>
                  setDraft({ ...draft, ocr_config: { ...draft.ocr_config, active_engine: val } })
                }
                options={[
                  { value: 'auto_recommend', label: '★ 按显存自动推荐' },
                  { value: 'mineru_pipeline', label: 'MinerU 2 Pipeline (无vLLM)' },
                  { value: 'somark_free_api', label: 'Free-OXR 开放 API' },
                  { value: 'paddleocr', label: 'PaddleOCR 备选' },
                  { value: 'mineru_full', label: 'MinerU 2 全量部署' },
                  { value: 'oxr_full', label: 'SoMark OXR 全量部署' },
                  { value: 'rapidocr', label: 'RapidOCR 内置' },
                ]}
              />
            </div>

            {/* OCR Engine Cards with 1-Click Download/Install/Start */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: '10px',
              }}
            >
              {currentOcrEngines.map((eng) => {
                const isRec = currentVram?.recommended_ocr_engine === eng.engine_id;
                const isInstalling = installingTarget === `ocr:${eng.engine_id}`;
                return (
                  <div
                    key={eng.engine_id}
                    style={{
                      borderRadius: '12px',
                      backgroundColor: '#FFFFFF',
                      border: isRec
                        ? '1.5px solid #007AFF'
                        : '1px solid rgba(60, 60, 67, 0.12)',
                      padding: '11px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      gap: '8px',
                    }}
                  >
                    <div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '6px',
                        }}
                      >
                        <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#1C1C1E' }}>
                          {eng.name}
                        </span>
                        <span
                          style={{
                            borderRadius: '999px',
                            backgroundColor: isRec
                              ? 'rgba(0, 122, 255, 0.12)'
                              : '#F2F2F7',
                            color: isRec ? '#007AFF' : '#636366',
                            fontSize: '10px',
                            fontWeight: 700,
                            padding: '2px 7px',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {isRec ? '★ 当前显存推荐' : eng.tier_badge}
                        </span>
                      </div>
                      <p style={{ fontSize: '11px', color: '#636366', marginTop: '4px', lineHeight: 1.45 }}>
                        {eng.description}
                      </p>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '6px',
                        paddingTop: '6px',
                        borderTop: '1px solid rgba(60, 60, 67, 0.08)',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '10.5px',
                          fontWeight: 600,
                          color: eng.installed ? '#248A3D' : '#8E8E93',
                        }}
                      >
                        {eng.running
                          ? '● 运行中 / 就绪'
                          : eng.installed
                          ? '● 已安装'
                          : '○ 未本地安装'}
                      </span>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        {eng.supports_one_click_setup && (
                          <SpringButton
                            springLabel={`一键部署:${eng.engine_id}`}
                            disabled={Boolean(installingTarget)}
                            onClick={() => handleSetupOcr(eng.engine_id)}
                            maxShift={5}
                            style={{
                              borderRadius: '999px',
                              border: 'none',
                              backgroundColor: '#007AFF',
                              color: '#FFFFFF',
                              fontSize: '10.5px',
                              fontWeight: 600,
                              padding: '4px 9px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px',
                              cursor: installingTarget ? 'wait' : 'pointer',
                            }}
                          >
                            <Download className="w-3 h-3" />
                            <span>
                              {isInstalling
                                ? '安装启动中...'
                                : eng.engine_id === 'mineru_pipeline'
                                ? '一键下载·安装·启动'
                                : '一键下载部署'}
                            </span>
                          </SpringButton>
                        )}
                        <SpringButton
                          springLabel={`选用:${eng.engine_id}`}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              ocr_config: { ...draft.ocr_config, active_engine: eng.engine_id },
                            })
                          }
                          maxShift={4}
                          style={{
                            borderRadius: '999px',
                            border: '1px solid rgba(60, 60, 67, 0.16)',
                            backgroundColor:
                              draft.ocr_config.active_engine === eng.engine_id
                                ? '#1C1C1E'
                                : '#FFFFFF',
                            color:
                              draft.ocr_config.active_engine === eng.engine_id
                                ? '#FFFFFF'
                                : '#1C1C1E',
                            fontSize: '10.5px',
                            fontWeight: 600,
                            padding: '4px 9px',
                            cursor: 'pointer',
                          }}
                        >
                          {draft.ocr_config.active_engine === eng.engine_id ? '已选用' : '选用'}
                        </SpringButton>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Free-OXR API Endpoint Config */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: '10px',
                paddingTop: '4px',
              }}
            >
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#636366', marginBottom: '3px' }}>
                  SoMark Free-OXR 开放 API URL
                </label>
                <input
                  type="text"
                  value={draft.ocr_config.somark_api_base_url}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      ocr_config: { ...draft.ocr_config, somark_api_base_url: e.target.value },
                    })
                  }
                  style={{
                    width: '100%',
                    borderRadius: '8px',
                    border: '1px solid rgba(60, 60, 67, 0.18)',
                    backgroundColor: '#FFFFFF',
                    padding: '6px 9px',
                    fontSize: '11.5px',
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#636366', marginBottom: '3px' }}>
                  MinerU 2 本地服务端口 URL
                </label>
                <input
                  type="text"
                  value={draft.ocr_config.mineru_service_url}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      ocr_config: { ...draft.ocr_config, mineru_service_url: e.target.value },
                    })
                  }
                  style={{
                    width: '100%',
                    borderRadius: '8px',
                    border: '1px solid rgba(60, 60, 67, 0.18)',
                    backgroundColor: '#FFFFFF',
                    padding: '6px 9px',
                    fontSize: '11.5px',
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#636366', marginBottom: '3px' }}>
                  SoMark OXR 本地服务端口 URL
                </label>
                <input
                  type="text"
                  value={draft.ocr_config.oxr_service_url}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      ocr_config: { ...draft.ocr_config, oxr_service_url: e.target.value },
                    })
                  }
                  style={{
                    width: '100%',
                    borderRadius: '8px',
                    border: '1px solid rgba(60, 60, 67, 0.18)',
                    backgroundColor: '#FFFFFF',
                    padding: '6px 9px',
                    fontSize: '11.5px',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Section 2: Routing Mode Selector (Physical Spring Switchers) */}
          <div
            style={{
              borderRadius: '16px',
              backgroundColor: '#F9F9FB',
              border: '1px solid rgba(60, 60, 67, 0.1)',
              padding: '15px',
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
                gap: '10px',
              }}
            >
              <div>
                <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#1C1C1E' }}>
                  模型路由调度模式
                </div>
                <div style={{ fontSize: '11px', color: '#636366', marginTop: '2px' }}>
                  单一引擎模式统一调用同一通道；智能阶段编排允许不同任务阶段使用不同模型/CLI
                </div>
              </div>
              <SpringSegmentedControl<'single' | 'smart_stage'>
                springLabel="路由调度模式"
                value={draft.routing_mode}
                onChange={(val) => setDraft({ ...draft, routing_mode: val })}
                options={[
                  { value: 'single', label: '单一引擎直连' },
                  { value: 'smart_stage', label: '智能阶段 Harness 编排' },
                ]}
              />
            </div>

            {draft.routing_mode === 'single' ? (
              <div>
                <div style={{ fontSize: '11.5px', fontWeight: 600, color: '#636366', marginBottom: '6px' }}>
                  当前全局激活引擎（可拖拽或点击切换，ζ = 1.0 物理弹簧）
                </div>
                <SpringSegmentedControl<ProviderType>
                  springLabel="全局激活引擎"
                  wrap
                  value={draft.active_provider}
                  onChange={(val) => setDraft({ ...draft, active_provider: val })}
                  options={PROVIDER_OPTIONS}
                />
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontSize: '11.5px', fontWeight: 600, color: '#636366' }}>
                  按任务阶段分配路由通道：
                </div>
                {(Object.keys(STAGE_LABELS) as StageName[]).map((stage) => (
                  <div
                    key={stage}
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '8px',
                      backgroundColor: '#FFFFFF',
                      borderRadius: '10px',
                      border: '1px solid rgba(60, 60, 67, 0.1)',
                      padding: '8px 11px',
                    }}
                  >
                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#1C1C1E' }}>
                      {STAGE_LABELS[stage]}
                    </span>
                    <SpringSegmentedControl<ProviderType>
                      springLabel={`阶段:${stage}`}
                      compact
                      wrap
                      value={draft.stage_mapping[stage]?.provider || 'heuristic'}
                      onChange={(val) =>
                        setDraft({
                          ...draft,
                          stage_mapping: {
                            ...draft.stage_mapping,
                            [stage]: { provider: val },
                          },
                        })
                      }
                      options={[
                        { value: 'heuristic', label: '规则引擎' },
                        { value: 'harness', label: 'CLI Harness' },
                        { value: 'cloud', label: '云端 API' },
                        { value: 'local', label: '本地模型' },
                      ]}
                    />
                  </div>
                ))}
              </div>
            )}

            <SpringToggleSwitch
              checked={draft.enable_fallback}
              onChange={(val) => setDraft({ ...draft, enable_fallback: val })}
              label="启用自动安全回退（外部 API / CLI 调用异常时自动降级至内置智能规则引擎，确保不中断）"
              springLabel="安全回退开关"
            />
          </div>

          {/* Section 3: 3-Column Provider Cards (CLI Harness with DSH + Cloud API + Local LLM) */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '14px',
            }}
          >
            {/* CLI Harness Card (with DSH + 1-Click Install) */}
            <div
              style={{
                borderRadius: '14px',
                border: '1px solid rgba(60, 60, 67, 0.12)',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h3
                  style={{
                    fontSize: '13.5px',
                    fontWeight: 700,
                    color: '#1C1C1E',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <Terminal className="w-4 h-4 text-[#34C759]" />
                  CLI Harness (含 DSH)
                </h3>
                <SpringButton
                  springLabel="测试CLI"
                  disabled={testing}
                  onClick={() => handleTest('harness')}
                  maxShift={4}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    fontSize: '11.5px',
                    fontWeight: 600,
                    color: '#007AFF',
                    cursor: 'pointer',
                  }}
                >
                  测试连通性
                </SpringButton>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {status.harnesses.map((h) => (
                  <div
                    key={h.name}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '6px',
                      fontSize: '11.5px',
                      padding: '6px 9px',
                      borderRadius: '8px',
                      backgroundColor: '#F9F9FB',
                      border: '1px solid rgba(60, 60, 67, 0.08)',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <span style={{ fontWeight: 700, textTransform: 'uppercase' }}>{h.name}</span>
                      {h.name === 'dsh' && (
                        <span style={{ marginLeft: '5px', fontSize: '10px', color: '#007AFF', fontWeight: 600 }}>
                          DeepSeek Harness
                        </span>
                      )}
                    </div>
                    {h.available ? (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px',
                          color: '#248A3D',
                          fontWeight: 600,
                          fontSize: '11px',
                        }}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> 已安装
                      </span>
                    ) : (
                      <SpringButton
                        springLabel={`一键安装:${h.name}`}
                        disabled={Boolean(installingTarget)}
                        onClick={() => handleInstallHarness(h.name)}
                        maxShift={4}
                        style={{
                          borderRadius: '999px',
                          border: 'none',
                          backgroundColor: '#007AFF',
                          color: '#FFFFFF',
                          fontSize: '10.5px',
                          fontWeight: 600,
                          padding: '3px 8px',
                          cursor: installingTarget ? 'wait' : 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px',
                        }}
                      >
                        <XCircle className="w-3 h-3" />
                        <span>
                          {installingTarget === `cli:${h.name}` ? '安装中...' : '一键安装'}
                        </span>
                      </SpringButton>
                    )}
                  </div>
                ))}
              </div>

              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#636366', marginBottom: '4px' }}>
                  首选 CLI 工具
                </div>
                <SpringSegmentedControl<'dsh' | 'claude' | 'codex' | 'gemini' | 'custom'>
                  springLabel="首选CLI工具"
                  compact
                  wrap
                  value={draft.harness_config.preferred_cli}
                  onChange={(val) =>
                    setDraft({
                      ...draft,
                      harness_config: { ...draft.harness_config, preferred_cli: val },
                    })
                  }
                  options={[
                    { value: 'dsh', label: 'DSH (DeepSeek)' },
                    { value: 'claude', label: 'Claude' },
                    { value: 'codex', label: 'Codex' },
                    { value: 'gemini', label: 'Gemini' },
                    { value: 'custom', label: '自定义' },
                  ]}
                />
              </div>

              {draft.harness_config.preferred_cli === 'custom' && (
                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: '#636366', marginBottom: '3px' }}>
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
                    placeholder="dsh --file {prompt_file}"
                    style={{
                      width: '100%',
                      borderRadius: '8px',
                      border: '1px solid rgba(60, 60, 67, 0.2)',
                      padding: '6px 9px',
                      fontSize: '11.5px',
                    }}
                  />
                </div>
              )}
            </div>

            {/* Cloud API Card */}
            <div
              style={{
                borderRadius: '14px',
                border: '1px solid rgba(60, 60, 67, 0.12)',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '9px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h3
                  style={{
                    fontSize: '13.5px',
                    fontWeight: 700,
                    color: '#1C1C1E',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <Cloud className="w-4 h-4 text-[#007AFF]" />
                  云端 API (DeepSeek / OpenAI)
                </h3>
                <SpringButton
                  springLabel="测试云端API"
                  disabled={testing}
                  onClick={() => handleTest('cloud')}
                  maxShift={4}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    fontSize: '11.5px',
                    fontWeight: 600,
                    color: '#007AFF',
                    cursor: 'pointer',
                  }}
                >
                  测试 API
                </SpringButton>
              </div>

              <div>
                <div style={{ fontSize: '11px', color: '#636366', marginBottom: '4px' }}>接口协议</div>
                <SpringSegmentedControl<'openai_compatible' | 'anthropic'>
                  springLabel="云端接口协议"
                  compact
                  value={draft.cloud_config.api_format}
                  onChange={(val) =>
                    setDraft({
                      ...draft,
                      cloud_config: { ...draft.cloud_config, api_format: val },
                    })
                  }
                  options={[
                    { value: 'openai_compatible', label: 'OpenAI / DeepSeek' },
                    { value: 'anthropic', label: 'Anthropic Claude' },
                  ]}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#636366', marginBottom: '2px' }}>
                  Base URL
                </label>
                <input
                  type="text"
                  value={draft.cloud_config.base_url}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      cloud_config: { ...draft.cloud_config, base_url: e.target.value },
                    })
                  }
                  style={{
                    width: '100%',
                    borderRadius: '8px',
                    border: '1px solid rgba(60, 60, 67, 0.2)',
                    padding: '6px 9px',
                    fontSize: '11.5px',
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#636366', marginBottom: '2px' }}>
                  API Key（DSH Harness 亦可复用此密钥）
                </label>
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
                  style={{
                    width: '100%',
                    borderRadius: '8px',
                    border: '1px solid rgba(60, 60, 67, 0.2)',
                    padding: '6px 9px',
                    fontSize: '11.5px',
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#636366', marginBottom: '2px' }}>
                  模型名称
                </label>
                <input
                  type="text"
                  value={draft.cloud_config.model}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      cloud_config: { ...draft.cloud_config, model: e.target.value },
                    })
                  }
                  style={{
                    width: '100%',
                    borderRadius: '8px',
                    border: '1px solid rgba(60, 60, 67, 0.2)',
                    padding: '6px 9px',
                    fontSize: '11.5px',
                  }}
                />
              </div>
            </div>

            {/* Local LLM Card */}
            <div
              style={{
                borderRadius: '14px',
                border: '1px solid rgba(60, 60, 67, 0.12)',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '9px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h3
                  style={{
                    fontSize: '13.5px',
                    fontWeight: 700,
                    color: '#1C1C1E',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <Cpu className="w-4 h-4 text-[#5856D6]" />
                  本地模型服务
                </h3>
                <SpringButton
                  springLabel="测试本地模型"
                  disabled={testing}
                  onClick={() => handleTest('local')}
                  maxShift={4}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    fontSize: '11.5px',
                    fontWeight: 600,
                    color: '#007AFF',
                    cursor: 'pointer',
                  }}
                >
                  测试本地
                </SpringButton>
              </div>

              <div style={{ fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    backgroundColor: '#F9F9FB',
                    padding: '5px 8px',
                    borderRadius: '7px',
                  }}
                >
                  <span>Ollama</span>
                  <span style={{ color: status.ollama_available ? '#248A3D' : '#8E8E93', fontWeight: 600 }}>
                    {status.ollama_available ? `在线 (${status.ollama_models.length} 模型)` : '未启动'}
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    backgroundColor: '#F9F9FB',
                    padding: '5px 8px',
                    borderRadius: '7px',
                  }}
                >
                  <span>LM Studio</span>
                  <span style={{ color: status.lmstudio_available ? '#248A3D' : '#8E8E93', fontWeight: 600 }}>
                    {status.lmstudio_available ? `在线 (${status.lmstudio_models.length} 模型)` : '未启动'}
                  </span>
                </div>
              </div>

              <div>
                <div style={{ fontSize: '11px', color: '#636366', marginBottom: '4px' }}>本地引擎</div>
                <SpringSegmentedControl<'ollama' | 'lmstudio'>
                  springLabel="本地模型引擎"
                  compact
                  value={draft.local_config.engine}
                  onChange={(val) =>
                    setDraft({
                      ...draft,
                      local_config: { ...draft.local_config, engine: val },
                    })
                  }
                  options={[
                    { value: 'ollama', label: 'Ollama (11434)' },
                    { value: 'lmstudio', label: 'LM Studio (1234)' },
                  ]}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#636366', marginBottom: '2px' }}>
                  模型名称
                </label>
                <input
                  type="text"
                  value={draft.local_config.model}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      local_config: { ...draft.local_config, model: e.target.value },
                    })
                  }
                  style={{
                    width: '100%',
                    borderRadius: '8px',
                    border: '1px solid rgba(60, 60, 67, 0.2)',
                    padding: '6px 9px',
                    fontSize: '11.5px',
                  }}
                />
              </div>
            </div>
          </div>

          {testResult && (
            <div
              style={{
                borderRadius: '12px',
                backgroundColor: '#1C1C1E',
                color: '#F2F2F7',
                padding: '10px 14px',
                fontSize: '11.5px',
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
                maxHeight: '160px',
                overflowY: 'auto',
              }}
            >
              {testResult}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            position: 'sticky',
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '10px',
            borderTop: '1px solid rgba(60, 60, 67, 0.12)',
            backgroundColor: '#F9F9FB',
            padding: '12px 22px',
          }}
        >
          <SpringButton
            springLabel="取消设置"
            onClick={onClose}
            maxShift={5}
            style={{
              borderRadius: '999px',
              border: '1px solid rgba(60, 60, 67, 0.14)',
              backgroundColor: '#FFFFFF',
              padding: '8px 16px',
              fontSize: '12px',
              fontWeight: 600,
              color: '#636366',
              cursor: 'pointer',
            }}
          >
            取消
          </SpringButton>
          <SpringButton
            springLabel="保存路由与OCR配置"
            disabled={saving}
            onClick={handleSave}
            maxShift={6}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              borderRadius: '999px',
              border: 'none',
              backgroundColor: '#007AFF',
              padding: '8px 18px',
              fontSize: '12.5px',
              fontWeight: 700,
              color: '#FFFFFF',
              cursor: saving ? 'wait' : 'pointer',
              opacity: saving ? 0.65 : 1,
            }}
          >
            <Sparkles className="w-4 h-4" />
            <span>{saving ? '保存中...' : '保存路由与 OCR 配置'}</span>
          </SpringButton>
        </div>
      </div>
    </div>
  );
};
