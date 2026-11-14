import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Cpu,
  FileText,
  HelpCircle,
  Layers,
  ScanText,
  Settings,
  Sparkles,
  X,
} from 'lucide-react';
import { api } from '../api';
import {
  OcrEngineType,
  ProviderStatusResponse,
  ProviderType,
  RouterSettings,
} from '../types';
import { SpringButton, SpringSegmentedControl } from '../utils/springPhysics';

interface Props {
  open: boolean;
  onClose: () => void;
  status: ProviderStatusResponse | null;
  onSavedSettings: (settings: RouterSettings) => void;
  onOpenFullConfig: () => void;
  onLoadDemo: () => void;
}

type GuideStep = 'walkthrough' | 'ocr_quick' | 'ai_quick';

export const OnboardingGuideModal: React.FC<Props> = ({
  open,
  onClose,
  status,
  onSavedSettings,
  onOpenFullConfig,
  onLoadDemo,
}) => {
  const [step, setStep] = useState<GuideStep>('walkthrough');
  const [ocrEngine, setOcrEngine] = useState<OcrEngineType>('auto_recommend');
  const [provider, setProvider] = useState<ProviderType>('harness');
  const [cloudBaseUrl, setCloudBaseUrl] = useState('https://api.deepseek.com/v1');
  const [cloudModel, setCloudModel] = useState('deepseek-chat');
  const [cloudKey, setCloudKey] = useState('');
  const [preferredCli, setPreferredCli] = useState<'dsh' | 'claude' | 'codex' | 'gemini' | 'custom'>('dsh');
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!status) return;
    setOcrEngine(status.settings.ocr_config.active_engine);
    setProvider(status.settings.active_provider);
    setCloudBaseUrl(status.settings.cloud_config.base_url);
    setCloudModel(status.settings.cloud_config.model);
    setCloudKey(status.settings.cloud_config.api_key);
    setPreferredCli(status.settings.harness_config.preferred_cli);
  }, [status, open]);

  if (!open) return null;

  const markSeenAndClose = () => {
    try {
      localStorage.setItem('asg_onboarding_seen_v1', '1');
    } catch {
      // ignore storage errors
    }
    onClose();
  };

  const handleSaveQuickSetup = async (loadDemoAfter = false) => {
    if (!status) {
      if (loadDemoAfter) onLoadDemo();
      markSeenAndClose();
      return;
    }
    setSaving(true);
    setSavedNotice(null);
    try {
      const next: RouterSettings = {
        ...status.settings,
        routing_mode: 'single',
        active_provider: provider,
        cloud_config: {
          ...status.settings.cloud_config,
          base_url: cloudBaseUrl.trim() || status.settings.cloud_config.base_url,
          model: cloudModel.trim() || status.settings.cloud_config.model,
          api_key: cloudKey.trim(),
        },
        harness_config: {
          ...status.settings.harness_config,
          preferred_cli: preferredCli,
        },
        ocr_config: {
          ...status.settings.ocr_config,
          active_engine: ocrEngine,
        },
      };
      const saved = await api.saveProviderSettings(next);
      onSavedSettings(saved);
      setSavedNotice('快速设置已保存生效！');
      if (loadDemoAfter) {
        markSeenAndClose();
        onLoadDemo();
      }
    } catch {
      setSavedNotice('保存失败，请检查后端连接');
    } finally {
      setSaving(false);
    }
  };

  const gpu = status?.gpu_vram;

  return (
    <div
      className="no-print"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 75,
        backgroundColor: 'rgba(15, 23, 42, 0.5)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '18px',
      }}
      onClick={markSeenAndClose}
    >
      <div
        style={{
          width: 'min(860px, 95vw)',
          maxHeight: '90vh',
          borderRadius: '22px',
          backgroundColor: '#FFFFFF',
          border: '1px solid rgba(60, 60, 67, 0.14)',
          boxShadow: '0 32px 80px -16px rgba(0, 0, 0, 0.34)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 22px',
            borderBottom: '1px solid rgba(60, 60, 67, 0.1)',
            background: 'linear-gradient(135deg, #F0F7FF 0%, #FFFFFF 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <img
              src="/logo.svg"
              alt="Logo"
              style={{ width: 34, height: 34, borderRadius: '9px' }}
            />
            <div>
              <div style={{ fontSize: '15.5px', fontWeight: 800, color: '#0F172A' }}>
                快速上手指南 · v1.0.0
              </div>
              <div style={{ fontSize: '12px', color: '#64748B', marginTop: '1px' }}>
                快速完成 OCR 文本识别与 AI 模型通道配置
              </div>
            </div>
          </div>

          <button
            onClick={markSeenAndClose}
            style={{
              borderRadius: '999px',
              border: '1px solid rgba(60, 60, 67, 0.14)',
              backgroundColor: '#FFFFFF',
              padding: '6px',
              cursor: 'pointer',
              display: 'inline-flex',
            }}
            title="关闭引导"
          >
            <X className="w-4 h-4 text-[#636366]" />
          </button>
        </div>

        {/* Step Navigation */}
        <div
          style={{
            padding: '10px 22px',
            backgroundColor: '#F8FAFC',
            borderBottom: '1px solid rgba(60, 60, 67, 0.08)',
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <SpringSegmentedControl<GuideStep>
            springLabel="新手引导步骤"
            value={step}
            onChange={setStep}
            options={[
              { value: 'walkthrough', label: '1. 核心功能导览' },
              { value: 'ocr_quick', label: '2. 显存与 OCR 速配' },
              { value: 'ai_quick', label: '3. AI 生成通道上手' },
            ]}
          />
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {step === 'walkthrough' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
                  gap: '12px',
                }}
              >
                <FeatureGuideCard
                  badge="STEP 1"
                  color="#007AFF"
                  icon={<FileText className="w-4 h-4 text-[#007AFF]" />}
                  title="导入课本 / PPTX 与划范围"
                  desc="左侧栏支持拖拽上传 PDF、PPTX、Word、Markdown，自动切分章节并支持逐章勾选；也可一键加载内置演示课件。"
                />
                <FeatureGuideCard
                  badge="STEP 2"
                  color="#5856D6"
                  icon={<Layers className="w-4 h-4 text-[#5856D6]" />}
                  title="Stage 1 定制方案与随时暂停"
                  desc="选择 6 种教学预设，可直接输入题量或点「AI 一键填充参数」。点击生成后可随时点「暂停生成」（含二次确认）中止。"
                />
                <FeatureGuideCard
                  badge="STEP 3"
                  color="#34C759"
                  icon={<CheckCircle2 className="w-4 h-4 text-[#248A3D]" />}
                  title="Stage 2 交付、A4/A3 排版与撤销"
                  desc="生成后自动进入导学笔记（含典型例题解析）、互动题库、考前速记与图谱。支持纯预览及 A4/A3 PDF 导出；如需重选方案，点顶栏「撤销生成」。"
                />
              </div>

              <div
                style={{
                  borderRadius: '14px',
                  border: '1px solid rgba(0, 122, 255, 0.16)',
                  backgroundColor: '#F0F7FF',
                  padding: '13px 16px',
                  fontSize: '12.5px',
                  color: '#1E3A8A',
                  lineHeight: 1.65,
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <HelpCircle className="w-4 h-4" />
                  <span>上手建议</span>
                </div>
                <div>
                  • 如果想零配置立即体验：保持默认的 <strong>内置规则引擎 + RapidOCR/免费 API</strong>，直接加载示例 PPTX 即可完整跑通。
                  <br />
                  • 如果有扫描版教材 PDF 或 DeepSeek / OpenAI / Claude 等模型密钥，可切换上方第 2、3 步完成快速绑定。
                </div>
              </div>
            </div>
          )}

          {step === 'ocr_quick' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div
                style={{
                  borderRadius: '14px',
                  backgroundColor: '#F8FAFC',
                  border: '1px solid rgba(60, 60, 67, 0.12)',
                  padding: '12px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <ScanText className="w-5 h-5 text-[#007AFF]" />
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#0F172A' }}>
                      本机显卡：{gpu?.gpu_name || '探测中...'}（有效显存 {gpu?.effective_vram_gb?.toFixed(1) ?? '0.0'} GB）
                    </div>
                    <div style={{ fontSize: '11.5px', color: '#64748B' }}>
                      {gpu?.recommendation_reason || '已根据本机显存自动匹配推荐 OCR 方案'}
                    </div>
                  </div>
                </div>
                <SpringButton
                  springLabel="打开完整OCR安装面板"
                  onClick={() => {
                    markSeenAndClose();
                    onOpenFullConfig();
                  }}
                  maxShift={4}
                  style={{
                    borderRadius: '999px',
                    border: '1px solid rgba(0, 122, 255, 0.3)',
                    backgroundColor: '#FFFFFF',
                    color: '#007AFF',
                    padding: '6px 12px',
                    fontSize: '11.5px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  打开一键安装 / 卸载中心 →
                </SpringButton>
              </div>

              <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#0F172A' }}>
                快速选择默认文档识图 / 公式 OCR 引擎：
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: '10px',
                }}
              >
                {[
                  {
                    id: 'auto_recommend' as OcrEngineType,
                    title: '按显存自动推荐（默认）',
                    desc: '启动自动根据显卡显存分档选择最佳引擎。',
                  },
                  {
                    id: 'somark_free_api' as OcrEngineType,
                    title: 'SoMark Free-OXR 开放 API',
                    desc: '≤8GB 零显存占用，免本地安装直接识别公式与版面。',
                  },
                  {
                    id: 'mineru_pipeline' as OcrEngineType,
                    title: 'MinerU 2 Pipeline（无 vLLM）',
                    desc: '≤8GB 显卡首选本地部署，可在设置中一键安装启动。',
                  },
                  {
                    id: 'paddleocr' as OcrEngineType,
                    title: 'PaddleOCR 极速备选',
                    desc: '轻量本地 CPU/低显存 OCR，适合常规文字页面。',
                  },
                  {
                    id: 'mineru_full' as OcrEngineType,
                    title: 'MinerU 2 全量本地（8–48GB）',
                    desc: '适合中大显存显卡的全量高精度版面与公式识别。',
                  },
                  {
                    id: 'oxr_full' as OcrEngineType,
                    title: 'SoMark OXR 全量（≥48GB）',
                    desc: '大显存旗舰全量部署方案，面向复杂教材。',
                  },
                ].map((opt) => {
                  const selected = ocrEngine === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => setOcrEngine(opt.id)}
                      style={{
                        textAlign: 'left',
                        borderRadius: '12px',
                        padding: '11px 12px',
                        border: selected ? '1.5px solid #007AFF' : '1px solid rgba(60, 60, 67, 0.14)',
                        backgroundColor: selected ? 'rgba(0, 122, 255, 0.07)' : '#FFFFFF',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ fontSize: '12.5px', fontWeight: 700, color: selected ? '#007AFF' : '#1E293B' }}>
                        {opt.title}
                      </div>
                      <div style={{ fontSize: '11.5px', color: '#64748B', marginTop: '3px', lineHeight: 1.45 }}>
                        {opt.desc}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 'ai_quick' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#0F172A' }}>
                选择您希望使用的 AI 生成后端：
              </div>

              <SpringSegmentedControl<ProviderType>
                springLabel="快速选择AI通道"
                value={provider}
                onChange={setProvider}
                options={[
                  { value: 'harness', label: '① 免费 AI 反代 (Magpie + DSH)' },
                  { value: 'cloud', label: '② 云端 OpenAI/DeepSeek API' },
                ]}
              />

              {provider === 'cloud' && (
                <div
                  style={{
                    borderRadius: '12px',
                    backgroundColor: '#F8FAFC',
                    border: '1px solid rgba(60, 60, 67, 0.14)',
                    padding: '14px',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: '10px',
                  }}
                >
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#334155' }}>
                    API Base URL
                    <input
                      value={cloudBaseUrl}
                      onChange={(e) => setCloudBaseUrl(e.target.value)}
                      placeholder="https://api.deepseek.com/v1"
                      style={{
                        marginTop: '4px',
                        width: '100%',
                        borderRadius: '8px',
                        border: '1px solid #CBD5E1',
                        padding: '7px 10px',
                        fontSize: '12px',
                      }}
                    />
                  </label>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#334155' }}>
                    模型名称
                    <input
                      value={cloudModel}
                      onChange={(e) => setCloudModel(e.target.value)}
                      placeholder="deepseek-chat / gpt-4o-mini"
                      style={{
                        marginTop: '4px',
                        width: '100%',
                        borderRadius: '8px',
                        border: '1px solid #CBD5E1',
                        padding: '7px 10px',
                        fontSize: '12px',
                      }}
                    />
                  </label>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#334155', gridColumn: '1 / -1' }}>
                    API Key
                    <input
                      type="password"
                      value={cloudKey}
                      onChange={(e) => setCloudKey(e.target.value)}
                      placeholder="sk-..."
                      style={{
                        marginTop: '4px',
                        width: '100%',
                        borderRadius: '8px',
                        border: '1px solid #CBD5E1',
                        padding: '7px 10px',
                        fontSize: '12px',
                      }}
                    />
                  </label>
                </div>
              )}

              {provider === 'harness' && (
                <div
                  style={{
                    borderRadius: '12px',
                    backgroundColor: '#F8FAFC',
                    border: '1px solid rgba(60, 60, 67, 0.14)',
                    padding: '14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                  }}
                >
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#334155' }}>
                    选择默认 CLI Harness 工具（支持 DeepSeek Harness / Claude / Codex / Gemini）：
                  </div>
                  <SpringSegmentedControl<'dsh' | 'claude' | 'codex' | 'gemini'>
                    compact
                    springLabel="默认CLI"
                    value={preferredCli === 'custom' ? 'dsh' : preferredCli}
                    onChange={(cli) => setPreferredCli(cli)}
                    options={[
                      { value: 'dsh', label: 'DeepSeek DSH' },
                      { value: 'claude', label: 'Claude Code' },
                      { value: 'codex', label: 'Codex CLI' },
                      { value: 'gemini', label: 'Gemini CLI' },
                    ]}
                  />
                  <div style={{ fontSize: '11.5px', color: '#64748B' }}>
                    若尚未在本机安装 CLI，可在顶栏「设置图标」中一键安装。
                  </div>
                </div>
              )}

              {savedNotice && (
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#16A34A' }}>
                  ✓ {savedNotice}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '13px 22px',
            borderTop: '1px solid rgba(60, 60, 67, 0.1)',
            backgroundColor: '#F8FAFC',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {step !== 'walkthrough' && (
              <SpringButton
                springLabel="上一步引导"
                onClick={() => setStep(step === 'ai_quick' ? 'ocr_quick' : 'walkthrough')}
                maxShift={4}
                style={{
                  borderRadius: '999px',
                  border: '1px solid rgba(60, 60, 67, 0.16)',
                  backgroundColor: '#FFFFFF',
                  color: '#1C1C1E',
                  padding: '7px 14px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                上一步
              </SpringButton>
            )}
            {step !== 'ai_quick' && (
              <SpringButton
                springLabel="下一步引导"
                onClick={() => setStep(step === 'walkthrough' ? 'ocr_quick' : 'ai_quick')}
                maxShift={4}
                style={{
                  borderRadius: '999px',
                  border: '1px solid rgba(0, 122, 255, 0.3)',
                  backgroundColor: 'rgba(0, 122, 255, 0.08)',
                  color: '#007AFF',
                  padding: '7px 14px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                下一步：快速配置 →
              </SpringButton>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <SpringButton
              springLabel="保存并体验Demo"
              disabled={saving}
              onClick={() => handleSaveQuickSetup(true)}
              maxShift={5}
              style={{
                borderRadius: '999px',
                border: '1px solid rgba(0, 122, 255, 0.3)',
                backgroundColor: '#FFFFFF',
                color: '#007AFF',
                padding: '7px 14px',
                fontSize: '12px',
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                cursor: 'pointer',
              }}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>保存配置并加载示例课件体验</span>
            </SpringButton>
            <SpringButton
              springLabel="完成新手引导"
              disabled={saving}
              onClick={() => handleSaveQuickSetup(false).then(markSeenAndClose)}
              maxShift={5}
              style={{
                borderRadius: '999px',
                border: 'none',
                backgroundColor: '#007AFF',
                color: '#FFFFFF',
                padding: '8px 18px',
                fontSize: '12.5px',
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                cursor: 'pointer',
              }}
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>{saving ? '保存中...' : '保存并开始使用'}</span>
            </SpringButton>
          </div>
        </div>
      </div>
    </div>
  );
};

function FeatureGuideCard({
  badge,
  color,
  icon,
  title,
  desc,
}: {
  badge: string;
  color: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div
      style={{
        borderRadius: '14px',
        border: '1px solid rgba(60, 60, 67, 0.1)',
        backgroundColor: '#FAFAFC',
        padding: '14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span
          style={{
            fontSize: '10px',
            fontWeight: 800,
            color,
            backgroundColor: '#FFFFFF',
            border: '1px solid rgba(60, 60, 67, 0.1)',
            borderRadius: '999px',
            padding: '2px 8px',
          }}
        >
          {badge}
        </span>
        {icon}
      </div>
      <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#0F172A' }}>{title}</div>
      <div style={{ fontSize: '12px', color: '#475569', lineHeight: 1.55 }}>{desc}</div>
    </div>
  );
}
