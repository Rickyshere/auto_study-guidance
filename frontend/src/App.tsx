import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GraduationCap,
  Settings,
  Cpu,
  AlertCircle,
  PanelLeft,
  Search,
  Sparkles,
  ScanText,
  RotateCcw,
  HelpCircle,
  DownloadCloud,
  Moon,
  Sun,
  Droplets,
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
  UpdateStatusResponse,
} from './types';
import { RouterConfigModal } from './components/RouterConfigModal';
import { UploadAndTocPanel } from './components/UploadAndTocPanel';
import { BlueprintNegotiator } from './components/BlueprintNegotiator';
import { StudyStudio, StudioTabKey } from './components/StudyStudio';
import { OnboardingGuideModal } from './components/OnboardingGuideModal';
import { UpdatePushModal } from './components/UpdatePushModal';
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
  SpringTelemetryProvider,
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
  auto_recommend: '自动OCR',
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
  const [onboardingOpen, setOnboardingOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem('asg_onboarding_seen_v1') !== '1';
    } catch {
      return false;
    }
  });
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatusResponse | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [autoCheckPush, setAutoCheckPush] = useState(true);
  const [routerPopoverOpen, setRouterPopoverOpen] = useState(false);
  const [spotlightOpen, setSpotlightOpen] = useState(false);
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('asg_theme_dark') === '1';
    } catch {
      return false;
    }
  });
  const [liquidGlass, setLiquidGlass] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('asg_liquid_glass_v1');
      return saved === null ? true : saved === '1';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('asg_theme_dark', darkMode ? '1' : '0');
    } catch {
      // ignore
    }
    if (darkMode) {
      document.documentElement.classList.add('dark-theme');
      document.body.classList.add('dark-theme');
    } else {
      document.documentElement.classList.remove('dark-theme');
      document.body.classList.remove('dark-theme');
    }
  }, [darkMode]);

  useEffect(() => {
    try {
      localStorage.setItem('asg_liquid_glass_v1', liquidGlass ? '1' : '0');
    } catch {
      // ignore
    }
    if (liquidGlass) {
      document.documentElement.classList.add('liquid-glass');
      document.body.classList.add('liquid-glass');
    } else {
      document.documentElement.classList.remove('liquid-glass');
      document.body.classList.remove('liquid-glass');
    }
  }, [liquidGlass]);

  const [uploading, setUploading] = useState(false);
  const [negotiating, setNegotiating] = useState(false);
  const [aiFilling, setAiFilling] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [progressInfo, setProgressInfo] = useState<{
    percent: number;
    message: string;
    logs?: string[];
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const reportPhysics = useCallback((_vx: number, _vy: number, _msg: string) => {
    // Telemetry HUD removed per user preference
  }, []);

  // Refs for Focused 2-Pane Split & Generation Cancellation
  const splitRef = useRef<HTMLDivElement | null>(null);
  const sidebarSpringRef = useRef<Spring1D | null>(null);
  const generateAbortRef = useRef<AbortController | null>(null);

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

  const refreshUpdateStatus = useCallback(async (fetchRemote = false) => {
    setCheckingUpdate(true);
    try {
      const st = await api.getUpdateStatus(fetchRemote);
      setUpdateStatus(st);
    } catch {
      // ignore background git check error
    } finally {
      setCheckingUpdate(false);
    }
  }, []);

  useEffect(() => {
    refreshProviderStatus();
    api.getPresets().then(setPresets).catch(() => {});
    refreshProjects();
    refreshUpdateStatus(true);
  }, [refreshUpdateStatus]);

  // Periodic background remote push check every 60s
  useEffect(() => {
    if (!autoCheckPush) return;
    const timer = setInterval(() => {
      refreshUpdateStatus(true);
    }, 60000);
    return () => clearInterval(timer);
  }, [autoCheckPush, refreshUpdateStatus]);

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

  const handleCancelGenerate = () => {
    if (documentIr?.project_id) {
      api.cancelGeneration(documentIr.project_id).catch(() => {});
    }
    if (generateAbortRef.current) {
      generateAbortRef.current.abort();
      generateAbortRef.current = null;
    }
    setGenerating(false);
    setProgressInfo({
      percent: 0,
      message: '已暂停并通知后端终止子进程，可继续调整阶段 1 参数',
    });
    setTimeout(() => setProgressInfo(null), 2200);
  };

  const handleRevokeGeneration = async () => {
    if (!documentIr) return;
    setErrorMsg(null);
    setStudyPackage(null);
    setActiveMainView('stage1_negotiate');
    if (blueprint) {
      setBlueprint({ ...blueprint, confirmed: false });
    }
    try {
      const res = await api.revokeStudyPackage(documentIr.project_id);
      if (res.blueprint) {
        setBlueprint(res.blueprint);
      }
      await refreshProjects();
    } catch (e: any) {
      setErrorMsg(e?.message || '撤销生成状态同步失败');
    }
  };

  const handleConfirmAndGenerate = async (confirmedBp: StudyBlueprint) => {
    if (!documentIr) return;
    setErrorMsg(null);
    setGenerating(true);
    setProgressInfo({
      percent: 5,
      message: '已确认定制方案，正在调度路由引擎...',
      logs: ['已确认定制方案，正在调度路由引擎...'],
    });
    const controller = new AbortController();
    generateAbortRef.current = controller;
    try {
      const pkg = await api.generateStudyPackageStream(
        documentIr.project_id,
        confirmedBp,
        (_stage, percent, message) => {
          setProgressInfo((prev) => {
            const prevLogs = prev?.logs || [];
            const nextLogs =
              prevLogs[prevLogs.length - 1] === message
                ? prevLogs
                : [...prevLogs.slice(-5), message];
            return { percent, message, logs: nextLogs };
          });
        },
        controller.signal
      );
      setBlueprint(pkg.blueprint_used);
      setStudyPackage(pkg);
      autoSwitchTabForPackage(pkg);
      await refreshProjects();
    } catch (e: any) {
      if (e?.name === 'AbortError' || controller.signal.aborted) {
        setProgressInfo({ percent: 0, message: '已暂停并中止当前生成' });
      } else {
        setErrorMsg(e.message);
      }
    } finally {
      if (generateAbortRef.current === controller) {
        generateAbortRef.current = null;
      }
      setGenerating(false);
      setTimeout(() => setProgressInfo(null), 1200);
    }
  };

  const handleQuickGenerate = async (presetId: string) => {
    if (!documentIr) return;
    setErrorMsg(null);
    setGenerating(true);
    setProgressInfo({ percent: 35, message: '正在按所选预设模板一键生成学习资料...' });
    const controller = new AbortController();
    generateAbortRef.current = controller;
    try {
      const pkg = await api.quickGenerate(
        documentIr.project_id,
        {
          preset_id: presetId,
          selected_chapter_ids: blueprint?.selected_chapter_ids,
        },
        controller.signal
      );
      setBlueprint(pkg.blueprint_used);
      setStudyPackage(pkg);
      autoSwitchTabForPackage(pkg);
      await refreshProjects();
    } catch (e: any) {
      if (e?.name === 'AbortError' || controller.signal.aborted) {
        setProgressInfo({ percent: 0, message: '已暂停并中止当前生成' });
      } else {
        setErrorMsg(e.message);
      }
    } finally {
      if (generateAbortRef.current === controller) {
        generateAbortRef.current = null;
      }
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
              onChange={(m) => {
                if (m === 'swiftui') {
                  setLiquidGlass(true);
                  setViewMode('functional');
                  return;
                }
                setViewMode(m);
              }}
              options={[
                { value: 'functional', label: '← 返回 ASG 生产工作台' },
                { value: 'swiftui', label: 'Liquid Glass 工作台' },
                { value: 'apple_audited', label: 'Apple 审计版' },
                { value: 'impeccable_audited', label: 'Impeccable 审计版' },
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
      <div
        className={`mac-asg-root ${darkMode ? 'dark-theme' : ''} ${
          liquidGlass ? 'liquid-glass' : ''
        }`}
      >
        {liquidGlass && (
          <div className="lg-ambient-canvas no-print" aria-hidden="true">
            <div className="lg-orb lg-orb-1" />
            <div className="lg-orb lg-orb-2" />
            <div className="lg-orb lg-orb-3" />
          </div>
        )}
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
            height: calc(100vh - 54px);
            display: grid;
            grid-template-columns: 280px minmax(620px, 1fr);
            grid-template-rows: minmax(0, 1fr);
            overflow: hidden;
          }
          .mac-sp-col {
            height: 100%;
            min-height: 0;
            box-sizing: border-box;
            overflow-y: auto;
            padding: 14px 14px 80px;
            border-right: 1px solid var(--separator);
            background-color: var(--bg-grouped);
            min-width: 0;
          }
          .mac-sp-canvas {
            height: 100%;
            min-height: 0;
            box-sizing: border-box;
            overflow-y: auto;
            overflow-x: hidden;
            background-color: #FFFFFF;
            padding: 24px 32px 120px;
            min-width: 0;
          }
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
          {/* Left: Brand Logo + Collapsible Sidebar Toggle + Title */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              minWidth: 0,
              overflow: 'hidden',
              flex: '0 1 auto',
            }}
          >
            <img
              src="/logo.svg"
              alt="Auto Study Guidance Logo"
              style={{
                width: 28,
                height: 28,
                borderRadius: '7px',
                flexShrink: 0,
                boxShadow: '0 2px 6px rgba(0, 102, 255, 0.25)',
              }}
            />

            <SpringButton
              springLabel="边栏折叠"
              onClick={toggleSidebar}
              maxShift={5}
              style={{
                borderRadius: '999px',
                border: '1px solid rgba(60, 60, 67, 0.12)',
                backgroundColor: 'rgba(255, 255, 255, 0.88)',
                padding: '5px 10px',
                fontSize: '12px',
                fontWeight: 600,
                color: '#1C1C1E',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              <PanelLeft className="w-3.5 h-3.5 text-[#007AFF] shrink-0" />
              <span className="hidden sm:inline">{sidebarOpen ? '收起边栏' : '展开边栏'}</span>
            </SpringButton>

            <div
              style={{
                minWidth: 0,
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span
                className="mac-sp-display hidden 2xl:inline"
                style={{
                  fontSize: '14px',
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                }}
              >
                Auto Study Guidance
              </span>
              <span
                className="mac-sp-display inline 2xl:hidden"
                style={{
                  fontSize: '13.5px',
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                }}
              >
                ASG
              </span>
              {documentIr && (
                <span
                  className="truncate hidden 2xl:inline"
                  style={{ fontSize: '12px', color: '#636366', maxWidth: '150px' }}
                  title={documentIr.filename}
                >
                  — {documentIr.filename}
                </span>
              )}
            </div>
          </div>

          {/* Center: Contextual ζ=1.0 Spring Stage / Studio Switcher + Undo Generation */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              flexShrink: 0,
            }}
          >
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
            {studyPackage && (
              <SpringButton
                springLabel="撤销生成"
                onClick={handleRevokeGeneration}
                maxShift={5}
                style={{
                  borderRadius: '999px',
                  border: '1px solid rgba(255, 149, 0, 0.35)',
                  backgroundColor: 'rgba(255, 149, 0, 0.1)',
                  color: '#B45309',
                  padding: '5px 10px',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
                title="撤销当前生成的 Stage 2 学习资料，返回 Stage 1 方案定制页面"
              >
                <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                <span>撤销生成</span>
              </SpringButton>
            )}
          </div>

          {/* Right: First-Time Guide + Push Receiver + VRAM Badge + Spotlight + 3-Tier Router */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              position: 'relative',
              flexShrink: 0,
            }}
          >
            <SpringButton
              springLabel="液态玻璃切换"
              onClick={() => setLiquidGlass((v) => !v)}
              maxShift={4}
              style={{
                borderRadius: '999px',
                border: liquidGlass
                  ? '1px solid rgba(0, 122, 255, 0.36)'
                  : '1px solid rgba(60, 60, 67, 0.14)',
                backgroundColor: liquidGlass
                  ? 'rgba(0, 122, 255, 0.14)'
                  : 'rgba(255, 255, 255, 0.88)',
                padding: '5px 8px',
                fontSize: '11px',
                fontWeight: 700,
                color: liquidGlass ? '#007AFF' : '#475569',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
              title={liquidGlass ? '当前为 Liquid Glass 液态玻璃界面（点击切换标准界面）' : '切换为 Apple Liquid Glass 液态玻璃界面'}
            >
              <Droplets className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden 2xl:inline">{liquidGlass ? '液态玻璃' : '标准材质'}</span>
            </SpringButton>

            <SpringButton
              springLabel="深浅色切换"
              onClick={() => setDarkMode((d) => !d)}
              maxShift={4}
              style={{
                borderRadius: '999px',
                border: '1px solid rgba(60, 60, 67, 0.14)',
                backgroundColor: darkMode ? 'rgba(30, 41, 59, 0.92)' : 'rgba(255, 255, 255, 0.88)',
                padding: '5px 8px',
                fontSize: '11px',
                fontWeight: 700,
                color: darkMode ? '#F8FAFC' : '#1C1C1E',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
              title={darkMode ? '切换为浅色模式' : '切换为深色模式'}
            >
              {darkMode ? (
                <Sun className="w-3.5 h-3.5 text-[#FBBF24] shrink-0" />
              ) : (
                <Moon className="w-3.5 h-3.5 text-[#475569] shrink-0" />
              )}
              <span className="hidden 2xl:inline">{darkMode ? '浅色' : '深色'}</span>
            </SpringButton>

            <SpringButton
              springLabel="第一次使用"
              onClick={() => setOnboardingOpen(true)}
              maxShift={4}
              style={{
                borderRadius: '999px',
                border: '1px solid rgba(0, 122, 255, 0.25)',
                backgroundColor: 'rgba(0, 122, 255, 0.08)',
                padding: '5px 9px',
                fontSize: '11px',
                fontWeight: 700,
                color: '#007AFF',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
              title="查看新手指引与 3 分钟快速上手配置"
            >
              <HelpCircle className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden lg:inline">第一次使用？</span>
            </SpringButton>

            <SpringButton
              springLabel="接收Push更新"
              onClick={() => setUpdateModalOpen(true)}
              maxShift={4}
              style={{
                borderRadius: '999px',
                border: updateStatus?.has_update
                  ? '1px solid rgba(52, 199, 89, 0.45)'
                  : '1px solid rgba(60, 60, 67, 0.12)',
                backgroundColor: updateStatus?.has_update
                  ? 'rgba(52, 199, 89, 0.14)'
                  : 'rgba(255, 255, 255, 0.88)',
                padding: '5px 9px',
                fontSize: '11px',
                fontWeight: 700,
                color: updateStatus?.has_update ? '#15803D' : '#475569',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
              title="检查并随时接收远端 Git Push 新版本"
            >
              <DownloadCloud className="w-3.5 h-3.5 shrink-0" />
              <span className={updateStatus?.has_update ? 'hidden xl:inline' : 'hidden 2xl:inline'}>
                {updateStatus?.has_update
                  ? `新 Push (+${updateStatus.behind_count})`
                  : '版本同步'}
              </span>
            </SpringButton>

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
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
                title={providerStatus?.gpu_vram?.recommendation_reason || '查看显存检测与 OCR 部署配置'}
              >
                <ScanText className="w-3 h-3 text-[#2E7D32] shrink-0" />
                <span className="mac-sp-tabular hidden xl:inline max-w-[110px] truncate">
                  {vramPillLabel()}
                </span>
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
                padding: '5px 8px',
                fontSize: '11.5px',
                fontWeight: 600,
                color: '#1C1C1E',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              <Search className="w-3 h-3 text-[#636366] shrink-0" />
              <span className="hidden md:inline">⌘K</span>
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
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '999px',
                  backgroundColor: activeProviderTint(),
                  flexShrink: 0,
                }}
              />
              <span className="max-w-[125px] truncate">{activeEngineLabel()}</span>
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
                flexShrink: 0,
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
                    if (m === 'swiftui') {
                      setLiquidGlass(true);
                      setViewMode('functional');
                      return;
                    }
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
                    springLabel="第一次使用引导"
                    onClick={() => setOnboardingOpen(true)}
                    maxShift={6}
                    style={{
                      borderRadius: '999px',
                      border: '1px solid rgba(0, 122, 255, 0.25)',
                      backgroundColor: 'rgba(0, 122, 255, 0.08)',
                      color: '#007AFF',
                      padding: '11px 18px',
                      fontSize: '12.5px',
                      fontWeight: 700,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      cursor: 'pointer',
                    }}
                  >
                    <HelpCircle className="w-4 h-4" />
                    <span>第一次使用？3 分钟引导上手</span>
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
                  onCancelGenerate={handleCancelGenerate}
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
                darkMode={darkMode}
              />
            )}
          </main>
        </div>

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
                  label={liquidGlass ? '🫧 切换为标准经典界面材质' : '💧 切换为 Apple Liquid Glass 液态玻璃界面'}
                  hint="Glass"
                  onClick={() => {
                    setLiquidGlass((v) => !v);
                    setSpotlightOpen(false);
                  }}
                />
                <SpotlightRow
                  label={darkMode ? '☀️ 切换为浅色模式' : '🌙 切换为深色模式'}
                  hint="Theme"
                  onClick={() => {
                    setDarkMode((d) => !d);
                    setSpotlightOpen(false);
                  }}
                />
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

        <OnboardingGuideModal
          open={onboardingOpen}
          onClose={() => setOnboardingOpen(false)}
          status={providerStatus}
          onSavedSettings={(settings: RouterSettings) => {
            if (providerStatus) {
              setProviderStatus({ ...providerStatus, settings });
            }
          }}
          onOpenFullConfig={() => setConfigOpen(true)}
          onLoadDemo={handleLoadDemo}
        />

        <UpdatePushModal
          open={updateModalOpen}
          onClose={() => setUpdateModalOpen(false)}
          updateStatus={updateStatus}
          autoCheckEnabled={autoCheckPush}
          onToggleAutoCheck={setAutoCheckPush}
          onRefreshStatus={refreshUpdateStatus}
          checking={checkingUpdate}
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
