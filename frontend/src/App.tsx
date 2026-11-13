import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GraduationCap,
  Settings,
  Cpu,
  AlertCircle,
  PanelLeft,
  Search,
  Sparkles,
  Gauge,
  ScanText,
} from 'lucide-react';
import { api } from './api';
import {
  DocumentIR,
  PresetTemplate,
  ProjectSummary,
  ProviderStatusResponse,
  ProviderType,
  RouterSettings,
  StudyBlueprint,
  StudyPackage,
} from './types';
import { RouterConfigModal } from './components/RouterConfigModal';
import { UploadAndTocPanel } from './components/UploadAndTocPanel';
import { BlueprintNegotiator } from './components/BlueprintNegotiator';
import { StudyStudio, StudioTabKey } from './components/StudyStudio';
import { ImpeccableShowcase } from './components/showcases/ImpeccableShowcase';
import { EmilShowcase } from './components/showcases/EmilShowcase';
import { AppleDesignShowcase } from './components/showcases/AppleDesignShowcase';
import { SwiftUILiquidGlassShowcase } from './components/showcases/SwiftUILiquidGlassShowcase';
import { ImpeccableAuditedShowcase } from './components/showcases/ImpeccableAuditedShowcase';
import { AppleDesignAuditedShowcase } from './components/showcases/AppleDesignAuditedShowcase';
import {
  SegmentedOption,
  Spring1D,
  SpringButton,
  SpringSegmentedControl,
  SpringTelemetry,
  SpringTelemetryProvider,
  project,
} from './utils/springPhysics';

type AppViewMode =
  | 'functional'
  | 'apple_audited'
  | 'impeccable_audited'
  | 'swiftui'
  | 'apple'
  | 'impeccable'
  | 'emil';

type MainViewKey = 'stage1_negotiate' | StudioTabKey;

const OCR_SHORT_LABEL: Record<string, string> = {
  mineru_pipeline: 'MinerU Pipeline',
  somark_free_api: 'Free-OXR API',
  paddleocr: 'PaddleOCR',
  mineru_full: 'MinerU Full',
  oxr_full: 'SoMark OXR',
  rapidocr: 'RapidOCR',
  vision_vlm: 'VLM 识图',
};

export function App() {
  const [viewMode, setViewMode] = useState<AppViewMode>('functional');
  const [providerStatus, setProviderStatus] = useState<ProviderStatusResponse | null>(null);
  const [presets, setPresets] = useState<PresetTemplate[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);

  const [documentIr, setDocumentIr] = useState<DocumentIR | null>(null);
  const [blueprint, setBlueprint] = useState<StudyBlueprint | null>(null);
  const [studyPackage, setStudyPackage] = useState<StudyPackage | null>(null);

  const [activeMainView, setActiveMainView] = useState<MainViewKey>('stage1_negotiate');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [configOpen, setConfigOpen] = useState(false);
  const [routerPopoverOpen, setRouterPopoverOpen] = useState(false);
  const [spotlightOpen, setSpotlightOpen] = useState(false);
  const [hudVisible, setHudVisible] = useState(true);

  const [uploading, setUploading] = useState(false);
  const [negotiating, setNegotiating] = useState(false);
  const [aiFilling, setAiFilling] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [progressInfo, setProgressInfo] = useState<{ percent: number; message: string } | null>(
    null
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [telemetry, setTelemetry] = useState<SpringTelemetry>({
    vx: 0,
    vy: 0,
    note: 'ζ = 1.00 临界阻尼就绪',
  });

  const reportPhysics = useCallback((vx: number, vy: number, msg: string) => {
    setTelemetry({ vx: Math.round(vx), vy: Math.round(vy), note: msg });
  }, []);

  // Refs for Focused 2-Pane Split & Floating HUD ζ=1.0 springs
  const splitRef = useRef<HTMLDivElement | null>(null);
  const hudRef = useRef<HTMLDivElement | null>(null);
  const sidebarSpringRef = useRef<Spring1D | null>(null);

  const hudXRef = useRef<Spring1D | null>(null);
  const hudYRef = useRef<Spring1D | null>(null);
  const hudDragRef = useRef({
    active: false,
    sx: 0,
    sy: 0,
    bx: 0,
    by: 0,
    lx: 0,
    ly: 0,
    lt: 0,
    vx: 0,
    vy: 0,
  });

  // Backend initialization (includes startup GPU VRAM & OCR auto-detection)
  const refreshProviderStatus = async () => {
    try {
      const st = await api.getProviderStatus();
      setProviderStatus(st);
    } catch (e: any) {
      setErrorMsg(e.message);
    }
  };

  const refreshProjects = async () => {
    try {
      const list = await api.listProjects();
      setProjects(list);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    refreshProviderStatus();
    api.getPresets().then(setPresets).catch(() => {});
    refreshProjects();
  }, []);

  // Sidebar ζ=1.0 spring (280px <-> 0px in Focused 2-Pane NavigationSplitView)
  useEffect(() => {
    if (viewMode !== 'functional') return;
    sidebarSpringRef.current = new Spring1D({
      value: sidebarOpen ? 280 : 0,
      response: 0.28,
      bounds: [0, 280],
      bounceFactor: 0.45,
      onUpdate: (w) => {
        if (splitRef.current) {
          splitRef.current.style.gridTemplateColumns = `${Math.max(0, w).toFixed(1)}px minmax(620px, 1fr)`;
        }
      },
      onRebound: (v) => reportPhysics(v, 0, '侧栏滑轨边界回弹'),
    });
    return () => sidebarSpringRef.current?.stop();
  }, [viewMode, reportPhysics]);

  const toggleSidebar = () => {
    const next = !sidebarOpen;
    setSidebarOpen(next);
    sidebarSpringRef.current?.setTarget(next ? 280 : 0);
  };

  // Keep activeMainView valid if studyPackage disappears
  useEffect(() => {
    if (!studyPackage && activeMainView !== 'stage1_negotiate') {
      setActiveMainView('stage1_negotiate');
    }
  }, [studyPackage, activeMainView]);

  // Contextual topbar switcher options: never show dead deliverable tabs before generation!
  const topbarViewOptions = useMemo<SegmentedOption<MainViewKey>[]>(() => {
    if (!documentIr) {
      return [{ value: 'stage1_negotiate', label: '① 等待导入教材' }];
    }
    if (!studyPackage) {
      return [
        { value: 'stage1_negotiate', label: '① 需求解析与方案定制' },
        {
          value: 'notes',
          label: '② 学习资料工作台 (生成后解锁)',
          disabled: true,
          title: '请在下方确认方案并点击“确认生成”，生成完成后即可切换导学笔记/题库/速记',
        },
      ];
    }
    return [
      { value: 'stage1_negotiate', label: '① 方案微调' },
      { value: 'notes', label: '导学笔记' },
      { value: 'quiz', label: '互动题库' },
      { value: 'cheatsheet', label: '考前速记' },
      { value: 'mindmap', label: '知识图谱' },
      { value: 'blueprint_trace', label: '细目与路由' },
    ];
  }, [documentIr, studyPackage]);

  const autoSwitchTabForPackage = useCallback((pkg: StudyPackage) => {
    const pid = pkg.blueprint_used.preset_id;
    let nextTab: StudioTabKey = 'notes';
    if (pid === 'in_class_practice' || pid === 'self_test_exam' || pid === 'sync_practice') {
      nextTab = 'quiz';
    } else if (pid === 'exam_cheatsheet') {
      nextTab = 'cheatsheet';
    }
    setActiveMainView(nextTab);
  }, []);

  // HUD 2D ζ=1.0 springs
  useEffect(() => {
    if (viewMode !== 'functional') return;
    const syncHud = () => {
      if (!hudRef.current || !hudXRef.current || !hudYRef.current) return;
      hudRef.current.style.transform = `translate3d(${hudXRef.current.value.toFixed(2)}px, ${hudYRef.current.value.toFixed(2)}px, 0)`;
    };
    hudXRef.current = new Spring1D({
      value: 0,
      response: 0.3,
      bounds: [-620, 0],
      bounceFactor: 0.58,
      onUpdate: syncHud,
      onRebound: (v) => reportPhysics(v, 0, 'HUD 撞击水平边界回弹!'),
    });
    hudYRef.current = new Spring1D({
      value: 0,
      response: 0.3,
      bounds: [-420, 0],
      bounceFactor: 0.58,
      onUpdate: syncHud,
      onRebound: (v) => reportPhysics(0, v, 'HUD 撞击垂直边界回弹!'),
    });
    return () => {
      hudXRef.current?.stop();
      hudYRef.current?.stop();
    };
  }, [viewMode, reportPhysics]);

  // ⌘K Spotlight & Escape keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSpotlightOpen((s) => !s);
      } else if (e.key === 'Escape') {
        setSpotlightOpen(false);
        setRouterPopoverOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Backend action handlers
  const handleUploadFile = async (file: File) => {
    setErrorMsg(null);
    setUploading(true);
    try {
      const detail = await api.uploadDocument(file, 'self_study_guide');
      setDocumentIr(detail.document_ir);
      setBlueprint(detail.blueprint);
      setStudyPackage(detail.study_package);
      if (detail.study_package) {
        autoSwitchTabForPackage(detail.study_package);
      } else {
        setActiveMainView('stage1_negotiate');
      }
      await refreshProjects();
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setUploading(false);
    }
  };

  const handleLoadDemo = async () => {
    setErrorMsg(null);
    setUploading(true);
    try {
      const detail = await api.loadDemoProject();
      setDocumentIr(detail.document_ir);
      setBlueprint(detail.blueprint);
      setStudyPackage(detail.study_package);
      if (detail.study_package) {
        autoSwitchTabForPackage(detail.study_package);
      } else {
        setActiveMainView('stage1_negotiate');
      }
      await refreshProjects();
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setUploading(false);
    }
  };

  const handleOpenProject = async (projectId: string) => {
    setErrorMsg(null);
    try {
      const detail = await api.getProjectDetail(projectId);
      setDocumentIr(detail.document_ir);
      setBlueprint(detail.blueprint);
      setStudyPackage(detail.study_package);
      if (detail.study_package) {
        autoSwitchTabForPackage(detail.study_package);
      } else {
        setActiveMainView('stage1_negotiate');
      }
    } catch (e: any) {
      setErrorMsg(e.message);
    }
  };

  const handleDeleteProject = async (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await api.deleteProject(projectId);
    if (documentIr?.project_id === projectId) {
      setDocumentIr(null);
      setBlueprint(null);
      setStudyPackage(null);
      setActiveMainView('stage1_negotiate');
    }
    await refreshProjects();
  };

  const handleToggleChapter = (chapterId: string) => {
    if (!blueprint) return;
    const exists = blueprint.selected_chapter_ids.includes(chapterId);
    const next = exists
      ? blueprint.selected_chapter_ids.filter((id) => id !== chapterId)
      : [...blueprint.selected_chapter_ids, chapterId];
    setBlueprint({ ...blueprint, selected_chapter_ids: next });
  };

  const handleSelectAllChapters = (all: boolean) => {
    if (!blueprint || !documentIr) return;
    setBlueprint({
      ...blueprint,
      selected_chapter_ids: all ? documentIr.chapters.map((c) => c.chapter_id) : [],
    });
  };

  const handleNegotiate = async (presetId: string | undefined, userPrompt: string) => {
    if (!documentIr) return;
    setErrorMsg(null);
    setNegotiating(true);
    try {
      const updated = await api.negotiateBlueprint(documentIr.project_id, {
        preset_id: presetId,
        user_prompt: userPrompt,
        current_blueprint: blueprint,
      });
      setBlueprint(updated);
      setActiveMainView('stage1_negotiate');
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setNegotiating(false);
    }
  };

  const handleAiFillParams = async () => {
    if (!documentIr) return;
    setErrorMsg(null);
    setAiFilling(true);
    try {
      const filled = await api.aiFillParams(documentIr.project_id, {
        preset_id: blueprint?.preset_id,
        user_prompt: blueprint?.ai_feedback_message || '',
        current_blueprint: blueprint,
      });
      setBlueprint(filled);
      reportPhysics(0, 0, '✨ AI 已智能填充题量与参数');
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setAiFilling(false);
    }
  };

  const handleConfirmAndGenerate = async (confirmedBp: StudyBlueprint) => {
    if (!documentIr) return;
    setErrorMsg(null);
    setGenerating(true);
    setProgressInfo({ percent: 5, message: '已确认定制方案，正在调度路由引擎...' });
    try {
      const pkg = await api.generateStudyPackageStream(
        documentIr.project_id,
        confirmedBp,
        (_stage, percent, message) => {
          setProgressInfo({ percent, message });
        }
      );
      setBlueprint(pkg.blueprint_used);
      setStudyPackage(pkg);
      autoSwitchTabForPackage(pkg);
      await refreshProjects();
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setGenerating(false);
      setTimeout(() => setProgressInfo(null), 1200);
    }
  };

  const handleQuickGenerate = async (presetId: string) => {
    if (!documentIr) return;
    setErrorMsg(null);
    setGenerating(true);
    setProgressInfo({ percent: 35, message: '正在按所选预设模板一键生成学习资料...' });
    try {
      const pkg = await api.quickGenerate(documentIr.project_id, {
        preset_id: presetId,
        selected_chapter_ids: blueprint?.selected_chapter_ids,
      });
      setBlueprint(pkg.blueprint_used);
      setStudyPackage(pkg);
      autoSwitchTabForPackage(pkg);
      await refreshProjects();
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setGenerating(false);
      setTimeout(() => setProgressInfo(null), 800);
    }
  };

  const handleQuickSwitchProvider = async (provider: ProviderType) => {
    if (!providerStatus) return;
    const nextSettings: RouterSettings = {
      ...providerStatus.settings,
      routing_mode: 'single',
      active_provider: provider,
    };
    try {
      const saved = await api.saveProviderSettings(nextSettings);
      setProviderStatus({ ...providerStatus, settings: saved });
      setRouterPopoverOpen(false);
    } catch (e: any) {
      setErrorMsg(e.message);
    }
  };

  const activeEngineLabel = () => {
    if (!providerStatus) return '探测路由...';
    const s = providerStatus.settings;
    if (s.routing_mode === 'smart_stage') return '智能多阶段 Harness';
    const map: Record<string, string> = {
      heuristic: '内置规则引擎',
      harness: `CLI · ${s.harness_config.preferred_cli.toUpperCase()}`,
      cloud: `Cloud · ${s.cloud_config.model}`,
      local: `Local · ${s.local_config.model}`,
    };
    return map[s.active_provider] || s.active_provider;
  };

  const activeProviderTint = () => {
    const p = providerStatus?.settings.active_provider;
    if (p === 'harness') return '#34C759';
    if (p === 'cloud') return '#007AFF';
    if (p === 'local') return '#5856D6';
    return '#FF9500';
  };

  const vramPillLabel = () => {
    const gpu = providerStatus?.gpu_vram;
    const ocrCfg = providerStatus?.settings.ocr_config;
    if (!gpu || ocrCfg?.detect_vram_on_startup === false) return null;
    const activeEngine = ocrCfg?.active_engine || gpu.recommended_ocr_engine;
    const engineLabel = OCR_SHORT_LABEL[activeEngine] || activeEngine;
    const vramStr = gpu.effective_vram_gb > 0 ? `${gpu.effective_vram_gb.toFixed(0)}GB` : '无独显';
    return `${vramStr} · ${engineLabel}`;
  };

  if (viewMode !== 'functional') {
    return (
      <div className="min-h-screen bg-slate-100">
        <div className="bg-slate-900 text-slate-200 px-4 py-2 text-xs flex flex-wrap items-center justify-between gap-2 no-print">
          <span className="font-medium">UI 范式对比预览模式（只读展示）</span>
          <div className="flex flex-wrap items-center gap-2">
            <SpringSegmentedControl<AppViewMode>
              compact
              springLabel="视图模式"
              value={viewMode}
              onChange={(m) => setViewMode(m)}
              options={[
                { value: 'functional', label: '← 返回 ASG 生产工作台' },
                { value: 'apple_audited', label: 'Apple 审计版' },
                { value: 'impeccable_audited', label: 'Impeccable 审计版' },
                { value: 'swiftui', label: 'SwiftUI' },
                { value: 'apple', label: 'Apple 原版' },
                { value: 'impeccable', label: 'Impeccable' },
                { value: 'emil', label: 'Emil' },
              ]}
            />
          </div>
        </div>
        {viewMode === 'apple_audited' && <AppleDesignAuditedShowcase />}
        {viewMode === 'impeccable_audited' && <ImpeccableAuditedShowcase />}
        {viewMode === 'swiftui' && <SwiftUILiquidGlassShowcase />}
        {viewMode === 'apple' && <AppleDesignShowcase />}
        {viewMode === 'impeccable' && <ImpeccableShowcase />}
        {viewMode === 'emil' && <EmilShowcase />}
      </div>
    );
  }

  return (
    <SpringTelemetryProvider onReport={reportPhysics}>
      <div className="mac-asg-root">
        <style>{`
          .mac-asg-root {
            --bg-grouped: #F2F2F7;
            --label-primary: #1C1C1E;
            --label-secondary: #636366;
            --separator: rgba(60, 60, 67, 0.14);

            height: 100vh;
            width: 100vw;
            display: flex;
            flex-direction: column;
            background-color: var(--bg-grouped);
            color: var(--label-primary);
            font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', sans-serif;
            overflow: hidden;
            position: relative;
          }
          .mac-sp-display {
            font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'PingFang SC', sans-serif;
            letter-spacing: -0.022em;
          }
          .mac-sp-tabular { font-variant-numeric: tabular-nums; }
          .mac-sp-glass {
            background-color: rgba(255, 255, 255, 0.78);
            backdrop-filter: blur(22px) saturate(180%);
            -webkit-backdrop-filter: blur(22px) saturate(180%);
            border-bottom: 1px solid var(--separator);
            box-shadow: 0 8px 24px -12px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.85);
          }
          .mac-sp-topbar {
            height: 54px;
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            padding: 0 16px;
            z-index: 30;
          }
          .mac-sp-split {
            flex: 1;
            min-height: 0;
            display: grid;
            grid-template-columns: 280px minmax(620px, 1fr);
          }
          .mac-sp-col {
            height: 100%;
            overflow-y: auto;
            padding: 14px;
            border-right: 1px solid var(--separator);
            background-color: var(--bg-grouped);
            min-width: 0;
          }
          .mac-sp-canvas {
            height: 100%;
            overflow-y: auto;
            background-color: #FFFFFF;
            padding: 24px 32px 84px;
            min-width: 0;
          }
          .mac-sp-hud {
            position: fixed;
            right: 22px;
            bottom: 22px;
            width: 315px;
            border-radius: 18px;
            padding: 11px 14px;
            z-index: 40;
            background-color: rgba(255, 255, 255, 0.82);
            backdrop-filter: blur(22px) saturate(180%);
            -webkit-backdrop-filter: blur(22px) saturate(180%);
            border: 1px solid rgba(255, 255, 255, 0.9);
            box-shadow: 0 18px 40px -12px rgba(0, 0, 0, 0.22);
            cursor: grab;
            touch-action: none;
            user-select: none;
            will-change: transform;
          }
          .mac-sp-hud:active { cursor: grabbing; }
          @media print {
            .mac-asg-root {
              height: auto !important;
              overflow: visible !important;
              display: block !important;
              background: #FFFFFF !important;
            }
            .mac-sp-split {
              display: block !important;
            }
            .mac-sp-canvas {
              overflow: visible !important;
              padding: 0 !important;
            }
          }
        `}</style>

        {/* Top Liquid Glass Window Toolbar */}
        <header className="mac-sp-topbar mac-sp-glass no-print">
          {/* Left: Traffic Lights + Collapsible Sidebar Toggle + Title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }} aria-hidden="true">
              <span style={{ width: 11, height: 11, borderRadius: '999px', backgroundColor: '#FF5F57' }} />
              <span style={{ width: 11, height: 11, borderRadius: '999px', backgroundColor: '#FEBC2E' }} />
              <span style={{ width: 11, height: 11, borderRadius: '999px', backgroundColor: '#28C840' }} />
            </div>

            <SpringButton
              springLabel="边栏折叠"
              onClick={toggleSidebar}
              maxShift={5}
              style={{
                borderRadius: '999px',
                border: '1px solid rgba(60, 60, 67, 0.12)',
                backgroundColor: 'rgba(255, 255, 255, 0.88)',
                padding: '6px 11px',
                fontSize: '12px',
                fontWeight: 600,
                color: '#1C1C1E',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                cursor: 'pointer',
              }}
            >
              <PanelLeft className="w-3.5 h-3.5 text-[#007AFF]" />
              <span>{sidebarOpen ? '收起边栏' : '展开边栏'}</span>
            </SpringButton>

            <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="mac-sp-display" style={{ fontSize: '14.5px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                Auto Study Guidance
              </span>
              {documentIr && (
                <span
                  className="truncate hidden xl:inline"
                  style={{ fontSize: '12px', color: '#636366', maxWidth: '180px' }}
                  title={documentIr.filename}
                >
                  — {documentIr.filename}
                </span>
              )}
            </div>
          </div>

          {/* Center: Contextual ζ=1.0 Spring Stage / Studio Switcher (no dead buttons before generation) */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <SpringSegmentedControl<MainViewKey>
              compact
              springLabel="工作区阶段"
              value={activeMainView}
              onChange={(next) => {
                if (next !== 'stage1_negotiate' && !studyPackage) return;
                setActiveMainView(next);
              }}
              options={topbarViewOptions}
            />
          </div>

          {/* Right: Startup VRAM/OCR Badge + Spotlight + HUD + 3-Tier Router */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', position: 'relative' }}>
            {vramPillLabel() && (
              <SpringButton
                springLabel="显存与OCR识别"
                onClick={() => setConfigOpen(true)}
                maxShift={4}
                style={{
                  borderRadius: '999px',
                  border: '1px solid rgba(52, 199, 89, 0.3)',
                  backgroundColor: 'rgba(52, 199, 89, 0.1)',
                  padding: '5px 9px',
                  fontSize: '11px',
                  fontWeight: 700,
                  color: '#1B5E20',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  cursor: 'pointer',
                }}
                title={providerStatus?.gpu_vram?.recommendation_reason || '查看显存检测与 OCR 部署配置'}
              >
                <ScanText className="w-3 h-3 text-[#2E7D32]" />
                <span className="mac-sp-tabular hidden lg:inline">{vramPillLabel()}</span>
              </SpringButton>
            )}

            <SpringButton
              springLabel="Spotlight"
              onClick={() => setSpotlightOpen(true)}
              maxShift={5}
              style={{
                borderRadius: '999px',
                border: '1px solid rgba(60, 60, 67, 0.12)',
                backgroundColor: 'rgba(255, 255, 255, 0.88)',
                padding: '6px 9px',
                fontSize: '11.5px',
                fontWeight: 600,
                color: '#1C1C1E',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer',
              }}
            >
              <Search className="w-3 h-3 text-[#636366]" />
              <span className="hidden md:inline">⌘K</span>
            </SpringButton>

            <SpringButton
              springLabel="遥测HUD"
              onClick={() => setHudVisible((v) => !v)}
              maxShift={5}
              style={{
                borderRadius: '999px',
                border: '1px solid rgba(60, 60, 67, 0.12)',
                backgroundColor: hudVisible ? 'rgba(0, 122, 255, 0.1)' : 'rgba(255, 255, 255, 0.88)',
                padding: '6px 9px',
                fontSize: '11.5px',
                fontWeight: 600,
                color: hudVisible ? '#007AFF' : '#636366',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer',
              }}
              title="切换物理遥测悬浮舱"
            >
              <Gauge className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">HUD</span>
            </SpringButton>

            <SpringButton
              springLabel="三模路由"
              onClick={() => setRouterPopoverOpen((o) => !o)}
              maxShift={5}
              style={{
                borderRadius: '999px',
                border: '1px solid rgba(60, 60, 67, 0.14)',
                backgroundColor: 'rgba(255, 255, 255, 0.92)',
                padding: '6px 10px',
                fontSize: '11.5px',
                fontWeight: 600,
                color: '#1C1C1E',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '999px',
                  backgroundColor: activeProviderTint(),
                }}
              />
              <span className="max-w-[130px] truncate">{activeEngineLabel()}</span>
            </SpringButton>

            <SpringButton
              springLabel="路由与OCR设置"
              onClick={() => setConfigOpen(true)}
              maxShift={5}
              style={{
                borderRadius: '999px',
                border: '1px solid rgba(60, 60, 67, 0.12)',
                backgroundColor: 'rgba(255, 255, 255, 0.88)',
                padding: '6px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
              title="路由、CLI Harness 与显存分级 OCR 配置"
            >
              <Settings className="w-3.5 h-3.5 text-[#636366]" />
            </SpringButton>

            {/* Anchored 3-Tier Router & View Quick Popover */}
            {routerPopoverOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: '46px',
                  right: '0',
                  width: '320px',
                  borderRadius: '16px',
                  padding: '10px',
                  zIndex: 50,
                  backgroundColor: 'rgba(255, 255, 255, 0.94)',
                  backdropFilter: 'blur(22px) saturate(180%)',
                  WebkitBackdropFilter: 'blur(22px) saturate(180%)',
                  border: '1px solid rgba(60, 60, 67, 0.12)',
                  boxShadow: '0 20px 44px -12px rgba(0, 0, 0, 0.22)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '7px',
                }}
              >
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#636366', padding: '0 4px' }}>
                  快速切换模型路由通道 (ζ=1.0)
                </div>

                <SpringSegmentedControl<ProviderType>
                  compact
                  wrap
                  springLabel="快速通道"
                  value={providerStatus?.settings.active_provider || 'heuristic'}
                  onChange={(p) => handleQuickSwitchProvider(p)}
                  options={[
                    {
                      value: 'harness',
                      label: `CLI (${(providerStatus?.settings.harness_config.preferred_cli || 'claude').toUpperCase()})`,
                    },
                    { value: 'cloud', label: '云端 API' },
                    { value: 'local', label: '本地模型' },
                    { value: 'heuristic', label: '内置规则' },
                  ]}
                />

                <div style={{ fontSize: '10.5px', color: '#8E8E93', padding: '0 4px', marginTop: '2px' }}>
                  界面视图范式对比
                </div>
                <SpringSegmentedControl<AppViewMode>
                  compact
                  wrap
                  springLabel="视图切换"
                  value={viewMode}
                  onChange={(m) => {
                    setRouterPopoverOpen(false);
                    setViewMode(m);
                  }}
                  options={[
                    { value: 'functional', label: 'ASG 生产工作台' },
                    { value: 'apple_audited', label: 'Apple 审计稿' },
                    { value: 'impeccable_audited', label: 'Impeccable 稿' },
                  ]}
                />

                <SpringButton
                  springLabel="打开完整路由与OCR配置"
                  onClick={() => {
                    setRouterPopoverOpen(false);
                    setConfigOpen(true);
                  }}
                  maxShift={4}
                  style={{
                    marginTop: '2px',
                    width: '100%',
                    borderRadius: '10px',
                    border: 'none',
                    backgroundColor: '#1C1C1E',
                    color: '#FFFFFF',
                    padding: '8px',
                    fontSize: '11.5px',
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '5px',
                    cursor: 'pointer',
                  }}
                >
                  <Cpu className="w-3.5 h-3.5" />
                  <span>打开 CLI 一键安装 / OCR 显存编排与密钥配置...</span>
                </SpringButton>
              </div>
            )}
          </div>
        </header>

        {/* Global Error Toast Banner */}
        {errorMsg && (
          <div
            className="no-print"
            style={{
              backgroundColor: 'rgba(255, 59, 48, 0.1)',
              borderBottom: '1px solid rgba(255, 59, 48, 0.24)',
              padding: '8px 18px',
              fontSize: '12px',
              color: '#C62828',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <AlertCircle className="w-4 h-4 shrink-0" />
              {errorMsg}
            </span>
            <SpringButton
              springLabel="关闭错误提示"
              onClick={() => setErrorMsg(null)}
              maxShift={3}
              style={{
                border: 'none',
                background: 'transparent',
                color: '#C62828',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              关闭
            </SpringButton>
          </div>
        )}

        {/* Focused Two-Pane Desktop Workspace (Collapsible Left Source Sidebar + Spacious Main Stage) */}
        <div ref={splitRef} className="mac-sp-split">
          {/* Pane 1: Collapsible Left Source & Chapter Sidebar */}
          <aside className="mac-sp-col no-print" style={{ borderRightColor: 'rgba(60, 60, 67, 0.14)' }}>
            <UploadAndTocPanel
              documentIr={documentIr}
              selectedChapterIds={blueprint?.selected_chapter_ids || []}
              onToggleChapter={handleToggleChapter}
              onSelectAllChapters={handleSelectAllChapters}
              onUploadFile={handleUploadFile}
              onLoadDemo={handleLoadDemo}
              uploading={uploading}
              projects={projects}
              onOpenProject={handleOpenProject}
              onDeleteProject={handleDeleteProject}
            />
          </aside>

          {/* Pane 2: Spacious Unified Main Stage (Welcome / Stage 1 Blueprint Negotiation / Stage 2 Study Studio) */}
          <main className="mac-sp-canvas">
            {!documentIr ? (
              <div
                style={{
                  maxWidth: '680px',
                  margin: '52px auto 0',
                  borderRadius: '22px',
                  border: '1px solid rgba(60, 60, 67, 0.1)',
                  backgroundColor: '#FAFAFC',
                  padding: '42px 34px',
                  textAlign: 'center',
                }}
              >
                <div
                  style={{
                    width: '60px',
                    height: '60px',
                    borderRadius: '18px',
                    backgroundColor: 'rgba(0, 122, 255, 0.1)',
                    color: '#007AFF',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: '14px',
                  }}
                >
                  <GraduationCap className="w-8 h-8" />
                </div>
                <h1 className="mac-sp-display" style={{ fontSize: '25px', fontWeight: 700, color: '#1C1C1E' }}>
                  上传课本或 PPTX，定制专属学习资料
                </h1>
                <p style={{ marginTop: '10px', fontSize: '13.5px', color: '#636366', lineHeight: 1.7 }}>
                  采用 <strong>「AI 解析需求 → 确认定制方案 → 正式生成资料」</strong> 双阶段控制契约。支持启动显存分级 OCR（MinerU Pipeline / Free-OXR API / PaddleOCR / Full OXR）、DSH/Claude/Codex/Gemini CLI 一键安装，以及直接输入或 AI 一键填充题量参数。
                </p>
                <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <SpringButton
                    springLabel="体验示例课件"
                    disabled={uploading}
                    onClick={handleLoadDemo}
                    maxShift={8}
                    style={{
                      borderRadius: '999px',
                      border: 'none',
                      backgroundColor: '#007AFF',
                      color: '#FFFFFF',
                      padding: '11px 22px',
                      fontSize: '13px',
                      fontWeight: 700,
                      boxShadow: '0 10px 24px -6px rgba(0, 122, 255, 0.5)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '7px',
                      cursor: uploading ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>{uploading ? '正在解析示例 PPTX...' : '立即加载示例 PPTX 课件体验完整流程'}</span>
                  </SpringButton>

                  <SpringButton
                    springLabel="打开OCR与CLI设置"
                    onClick={() => setConfigOpen(true)}
                    maxShift={6}
                    style={{
                      borderRadius: '999px',
                      border: '1px solid rgba(60, 60, 67, 0.14)',
                      backgroundColor: '#FFFFFF',
                      color: '#1C1C1E',
                      padding: '11px 18px',
                      fontSize: '12.5px',
                      fontWeight: 600,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      cursor: 'pointer',
                    }}
                  >
                    <ScanText className="w-4 h-4 text-[#34C759]" />
                    <span>查看显存 OCR 与 CLI Harness 配置</span>
                  </SpringButton>
                </div>
              </div>
            ) : !studyPackage || activeMainView === 'stage1_negotiate' ? (
              <div style={{ maxWidth: '1080px', margin: '0 auto' }}>
                <BlueprintNegotiator
                  presets={presets}
                  blueprint={blueprint}
                  onChangeBlueprint={setBlueprint}
                  onNegotiate={handleNegotiate}
                  onAiFillParams={handleAiFillParams}
                  onConfirmAndGenerate={handleConfirmAndGenerate}
                  onQuickGenerate={handleQuickGenerate}
                  negotiating={negotiating}
                  aiFilling={aiFilling}
                  generating={generating}
                  progressInfo={progressInfo}
                />
              </div>
            ) : (
              <StudyStudio
                studyPackage={studyPackage}
                documentIr={documentIr}
                activeTab={activeMainView}
                onChangeTab={(tab) => setActiveMainView(tab)}
              />
            )}
          </main>
        </div>

        {/* 2D Free-Draggable Floating Glass HUD (ζ=1.0 + Release Velocity + Viewport Rebound) */}
        {hudVisible && (
          <aside
            ref={hudRef}
            className="mac-sp-hud no-print"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              hudXRef.current?.stop();
              hudYRef.current?.stop();
              if (hudXRef.current) hudXRef.current.dragging = true;
              if (hudYRef.current) hudYRef.current.dragging = true;
              hudDragRef.current = {
                active: true,
                sx: e.clientX,
                sy: e.clientY,
                bx: hudXRef.current?.value ?? 0,
                by: hudYRef.current?.value ?? 0,
                lx: e.clientX,
                ly: e.clientY,
                lt: performance.now(),
                vx: 0,
                vy: 0,
              };
            }}
            onPointerMove={(e) => {
              const hd = hudDragRef.current;
              if (!hd.active || !hudXRef.current || !hudYRef.current) return;
              const now = performance.now();
              const dt = Math.max(1, now - hd.lt) / 1000;
              hd.vx = (e.clientX - hd.lx) / dt;
              hd.vy = (e.clientY - hd.ly) / dt;
              hd.lx = e.clientX;
              hd.ly = e.clientY;
              hd.lt = now;
              hudXRef.current.setImmediate(Math.max(-620, Math.min(0, hd.bx + (e.clientX - hd.sx))), hd.vx);
              hudYRef.current.setImmediate(Math.max(-420, Math.min(0, hd.by + (e.clientY - hd.sy))), hd.vy);
            }}
            onPointerUp={() => {
              const hd = hudDragRef.current;
              if (!hd.active || !hudXRef.current || !hudYRef.current) return;
              hd.active = false;
              hudXRef.current.dragging = false;
              hudYRef.current.dragging = false;
              const tx = Math.max(-620, Math.min(0, hudXRef.current.value + project(hd.vx, 0.992) * 0.25));
              const ty = Math.max(-420, Math.min(0, hudYRef.current.value + project(hd.vy, 0.992) * 0.25));
              hudXRef.current.setTarget(tx, hd.vx);
              hudYRef.current.setTarget(ty, hd.vy);
              reportPhysics(hd.vx, hd.vy, 'HUD 惯性滑行与边界碰撞');
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#1C1C1E' }}>
                ζ=1.00 弹簧物理与题量 HUD
              </span>
              <span className="mac-sp-tabular" style={{ fontSize: '10px', color: '#007AFF', fontWeight: 700 }}>
                {blueprint
                  ? `${blueprint.deliverables.mcq_count}选 · ${blueprint.deliverables.fill_blank_count}填 · ${blueprint.deliverables.short_answer_count}简`
                  : '待加载文档'}
              </span>
            </div>
            <div
              className="mac-sp-tabular"
              style={{
                padding: '6px 8px',
                borderRadius: '10px',
                backgroundColor: 'rgba(0, 122, 255, 0.08)',
                border: '1px solid rgba(0, 122, 255, 0.16)',
                fontSize: '10.5px',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: '#007AFF' }}>
                <span>{telemetry.note}</span>
                <span>ζ = 1.00</span>
              </div>
              <div style={{ color: '#636366' }}>
                松手速度 v₀: ({telemetry.vx}, {telemetry.vy}) px/s · 可拖抛撞边回弹
              </div>
            </div>
          </aside>
        )}

        {/* Spotlight ⌘K Instant Command Modal */}
        {spotlightOpen && (
          <div
            className="no-print"
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 60,
              backgroundColor: 'rgba(0, 0, 0, 0.24)',
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'center',
              paddingTop: '96px',
            }}
            onClick={() => setSpotlightOpen(false)}
          >
            <div
              style={{
                width: '480px',
                borderRadius: '18px',
                padding: '14px',
                backgroundColor: 'rgba(255, 255, 255, 0.94)',
                backdropFilter: 'blur(24px) saturate(180%)',
                WebkitBackdropFilter: 'blur(24px) saturate(180%)',
                border: '1px solid rgba(255, 255, 255, 0.9)',
                boxShadow: '0 24px 60px rgba(0, 0, 0, 0.26)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#1C1C1E', marginBottom: '8px' }}>
                ⌘K 聚焦快捷指令 (0ms 瞬时响应)
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <SpotlightRow
                  label="⚡ 加载示例 PPTX 课件（深度学习核心架构讲义）"
                  hint="Demo"
                  onClick={() => {
                    setSpotlightOpen(false);
                    handleLoadDemo();
                  }}
                />
                <SpotlightRow
                  label="✨ 一键 AI 智能填充当前题量与参数"
                  hint="AI Fill"
                  onClick={() => {
                    setSpotlightOpen(false);
                    if (documentIr) handleAiFillParams();
                  }}
                />
                <SpotlightRow
                  label="配置显存分级 OCR、DSH/CLI Harness 一键安装..."
                  hint="Router & OCR"
                  onClick={() => {
                    setSpotlightOpen(false);
                    setConfigOpen(true);
                  }}
                />
                {presets.map((p) => (
                  <SpotlightRow
                    key={p.preset_id}
                    label={`使用预设「${p.name}」并让 AI 解析方案`}
                    hint={p.badge}
                    onClick={() => {
                      setSpotlightOpen(false);
                      if (documentIr) {
                        handleNegotiate(p.preset_id, p.sample_prompt);
                      }
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        <RouterConfigModal
          open={configOpen}
          onClose={() => setConfigOpen(false)}
          status={providerStatus}
          onSaved={(settings: RouterSettings) => {
            if (providerStatus) {
              setProviderStatus({ ...providerStatus, settings });
            }
          }}
          onRefreshStatus={refreshProviderStatus}
        />
      </div>
    </SpringTelemetryProvider>
  );
}

function SpotlightRow({ label, hint, onClick }: { label: string; hint: string; onClick: () => void }) {
  return (
    <SpringButton
      springLabel={hint}
      onClick={onClick}
      maxShift={4}
      style={{
        width: '100%',
        textAlign: 'left',
        border: 'none',
        backgroundColor: '#FFFFFF',
        borderRadius: '10px',
        padding: '9px 11px',
        fontSize: '12.5px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        cursor: 'pointer',
      }}
    >
      <span style={{ fontWeight: 600, color: '#1C1C1E' }}>{label}</span>
      <span style={{ fontSize: '10.5px', color: '#007AFF', fontWeight: 700 }}>{hint}</span>
    </SpringButton>
  );
}

export default App;
