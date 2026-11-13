import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  GraduationCap,
  Settings,
  Cpu,
  AlertCircle,
  PanelLeft,
  Search,
  Sparkles,
  CheckCircle2,
  Gauge,
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
  Spring1D,
  SpringButton,
  SpringTelemetry,
  SpringTelemetryProvider,
  project,
  rubberband,
} from './utils/springPhysics';

type AppViewMode =
  | 'functional'
  | 'apple_audited'
  | 'impeccable_audited'
  | 'swiftui'
  | 'apple'
  | 'impeccable'
  | 'emil';

const STUDIO_TABS: { key: StudioTabKey; label: string }[] = [
  { key: 'notes', label: '导学笔记' },
  { key: 'quiz', label: '互动题库' },
  { key: 'cheatsheet', label: '考前速记' },
  { key: 'mindmap', label: '知识图谱' },
  { key: 'blueprint_trace', label: '细目与路由' },
];

export function App() {
  const [viewMode, setViewMode] = useState<AppViewMode>('functional');
  const [providerStatus, setProviderStatus] = useState<ProviderStatusResponse | null>(null);
  const [presets, setPresets] = useState<PresetTemplate[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);

  const [documentIr, setDocumentIr] = useState<DocumentIR | null>(null);
  const [blueprint, setBlueprint] = useState<StudyBlueprint | null>(null);
  const [studyPackage, setStudyPackage] = useState<StudyPackage | null>(null);

  const [activeStudioTab, setActiveStudioTab] = useState<StudioTabKey>('notes');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [configOpen, setConfigOpen] = useState(false);
  const [routerPopoverOpen, setRouterPopoverOpen] = useState(false);
  const [spotlightOpen, setSpotlightOpen] = useState(false);
  const [hudVisible, setHudVisible] = useState(true);

  const [uploading, setUploading] = useState(false);
  const [negotiating, setNegotiating] = useState(false);
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

  // Refs for macOS Three-Pane Split, Segmented Control & Floating HUD ζ=1.0 springs
  const splitRef = useRef<HTMLDivElement | null>(null);
  const segTrackRef = useRef<HTMLDivElement | null>(null);
  const segThumbRef = useRef<HTMLDivElement | null>(null);
  const tabBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const hudRef = useRef<HTMLDivElement | null>(null);

  const sidebarSpringRef = useRef<Spring1D | null>(null);
  const segXRef = useRef<Spring1D | null>(null);
  const segWRef = useRef<Spring1D | null>(null);
  const segDragRef = useRef({
    active: false,
    startX: 0,
    baseLeft: 3,
    curLeft: 3,
    lastX: 0,
    lastT: 0,
    vx: 0,
  });

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

  // Backend initialization
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

  // Sidebar ζ=1.0 spring
  useEffect(() => {
    if (viewMode !== 'functional') return;
    sidebarSpringRef.current = new Spring1D({
      value: sidebarOpen ? 290 : 0,
      response: 0.28,
      bounds: [0, 290],
      bounceFactor: 0.45,
      onUpdate: (w) => {
        if (splitRef.current) {
          splitRef.current.style.gridTemplateColumns = `${Math.max(0, w).toFixed(1)}px 400px minmax(520px, 1fr)`;
        }
      },
      onRebound: (v) => reportPhysics(v, 0, '侧栏滑轨边界回弹'),
    });
    return () => sidebarSpringRef.current?.stop();
  }, [viewMode, reportPhysics]);

  const toggleSidebar = () => {
    const next = !sidebarOpen;
    setSidebarOpen(next);
    sidebarSpringRef.current?.setTarget(next ? 290 : 0);
  };

  // Segmented Control ζ=1.0 springs
  const syncSegToTab = useCallback((tab: StudioTabKey, instant: boolean, boostVx: number | null = null) => {
    const btn = tabBtnRefs.current[tab];
    const track = segTrackRef.current;
    if (!btn || !track || !segXRef.current || !segWRef.current) return;
    segXRef.current.bounds = [3, Math.max(3, track.clientWidth - btn.offsetWidth - 3)];
    if (instant) {
      segXRef.current.setImmediate(btn.offsetLeft);
      segWRef.current.setImmediate(btn.offsetWidth);
    } else {
      segXRef.current.setTarget(btn.offsetLeft, boostVx);
      segWRef.current.setTarget(btn.offsetWidth);
    }
  }, []);

  useEffect(() => {
    if (viewMode !== 'functional') return;
    segXRef.current = new Spring1D({
      value: 3,
      response: 0.24,
      bounceFactor: 0.62,
      onUpdate: (x) => {
        if (segThumbRef.current) {
          segThumbRef.current.style.transform = `translate3d(${x.toFixed(2)}px, 0, 0)`;
        }
      },
      onRebound: (v, side) => reportPhysics(v, 0, `分段滑块${side}`),
    });
    segWRef.current = new Spring1D({
      value: 84,
      response: 0.24,
      onUpdate: (w) => {
        if (segThumbRef.current) {
          segThumbRef.current.style.width = `${w.toFixed(2)}px`;
        }
      },
    });
    const rafId = requestAnimationFrame(() => syncSegToTab(activeStudioTab, true));
    const onResize = () => syncSegToTab(activeStudioTab, true);
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      segXRef.current?.stop();
      segWRef.current?.stop();
    };
  }, [viewMode, reportPhysics, syncSegToTab]);

  const selectStudioTab = useCallback(
    (tab: StudioTabKey, boostVx: number | null = null) => {
      setActiveStudioTab(tab);
      syncSegToTab(tab, false, boostVx);
    },
    [syncSegToTab]
  );

  // Sync tab automatically when a new StudyPackage completes
  const autoSwitchTabForPackage = useCallback(
    (pkg: StudyPackage) => {
      const pid = pkg.blueprint_used.preset_id;
      let nextTab: StudioTabKey = 'notes';
      if (pid === 'in_class_practice' || pid === 'self_test_exam' || pid === 'sync_practice') {
        nextTab = 'quiz';
      } else if (pid === 'exam_cheatsheet') {
        nextTab = 'cheatsheet';
      }
      selectStudioTab(nextTab);
    },
    [selectStudioTab]
  );

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

  // ⌘K Spotlight & Escape keyboard shortcuts (0ms latency)
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
      if (detail.study_package) autoSwitchTabForPackage(detail.study_package);
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
      if (detail.study_package) autoSwitchTabForPackage(detail.study_package);
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
      if (detail.study_package) autoSwitchTabForPackage(detail.study_package);
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
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setNegotiating(false);
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
      harness: `CLI · ${s.harness_config.preferred_cli}`,
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

  // Segmented Thumb Drag Handlers (Pointer velocity inheritance + rubberband + wall rebound)
  const onSegThumbDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    segXRef.current?.stop();
    segWRef.current?.stop();
    if (segXRef.current) segXRef.current.dragging = true;
    const cur = segXRef.current?.value ?? 3;
    segDragRef.current = {
      active: true,
      startX: e.clientX,
      baseLeft: cur,
      curLeft: cur,
      lastX: e.clientX,
      lastT: performance.now(),
      vx: 0,
    };
  };

  const onSegThumbMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const sd = segDragRef.current;
    const track = segTrackRef.current;
    const thumb = segThumbRef.current;
    if (!sd.active || !track || !thumb || !segXRef.current) return;
    const now = performance.now();
    const dt = Math.max(1, now - sd.lastT) / 1000;
    sd.vx = (e.clientX - sd.lastX) / dt;
    sd.lastX = e.clientX;
    sd.lastT = now;

    const minX = 3;
    const maxX = Math.max(3, track.clientWidth - thumb.offsetWidth - 3);
    const raw = sd.baseLeft + (e.clientX - sd.startX);
    const clamped =
      raw < minX
        ? minX - rubberband(minX - raw, 110, 0.55)
        : raw > maxX
        ? maxX + rubberband(raw - maxX, 110, 0.55)
        : raw;
    sd.curLeft = clamped;
    segXRef.current.setImmediate(clamped, sd.vx);
  };

  const onSegThumbUp = () => {
    const sd = segDragRef.current;
    if (!sd.active || !segXRef.current || !segThumbRef.current) return;
    sd.active = false;
    segXRef.current.dragging = false;

    const projCenter =
      sd.curLeft + segThumbRef.current.offsetWidth / 2 + project(sd.vx, 0.994);
    let best: StudioTabKey = 'notes';
    let bestDist = Infinity;
    STUDIO_TABS.forEach((t) => {
      const b = tabBtnRefs.current[t.key];
      if (!b) return;
      const c = b.offsetLeft + b.offsetWidth / 2;
      if (Math.abs(c - projCenter) < bestDist) {
        bestDist = Math.abs(c - projCenter);
        best = t.key;
      }
    });
    reportPhysics(
      sd.vx,
      0,
      Math.abs(sd.vx) > 650 ? '分段滑块高速松手边界回弹!' : 'ζ = 1.0 速度接管落位'
    );
    selectStudioTab(best, sd.vx * 0.85);
  };

  if (viewMode !== 'functional') {
    return (
      <div className="min-h-screen bg-slate-100">
        <div className="bg-slate-900 text-slate-200 px-4 py-1.5 text-xs flex flex-wrap items-center justify-between gap-2 no-print">
          <span className="font-medium">UI 范式对比预览模式（只读展示）</span>
          <div className="flex items-center gap-2">
            <select
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value as AppViewMode)}
              className="rounded-md bg-slate-800 border border-slate-700 px-2.5 py-1 text-xs text-white"
            >
              <option value="functional">← 返回 ASG 完整生产工作台 (Apple Design + ζ=1.0)</option>
              <option value="apple_audited">Apple Design 融合审计示范版</option>
              <option value="impeccable_audited">Impeccable 融合审计示范版</option>
              <option value="swiftui">示范版 4：SwiftUI Liquid Glass</option>
              <option value="apple">示范版 3：Apple Design 原版</option>
              <option value="impeccable">示范版 1：Impeccable 原版</option>
              <option value="emil">示范版 2：Emil Kowalski 原版</option>
            </select>
            <button
              onClick={() => setViewMode('functional')}
              className="rounded-md bg-[#007AFF] px-3 py-1 text-xs font-semibold text-white"
            >
              返回生产工作台
            </button>
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
            gap: 12px;
            padding: 0 16px;
            z-index: 30;
          }
          .mac-sp-split {
            flex: 1;
            min-height: 0;
            display: grid;
            grid-template-columns: 290px 400px minmax(520px, 1fr);
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
            padding: 26px 32px 72px;
            min-width: 0;
          }
          .mac-sp-seg-track {
            position: relative;
            display: inline-flex;
            align-items: center;
            background: rgba(118, 118, 128, 0.14);
            border-radius: 999px;
            padding: 3px;
            gap: 2px;
            touch-action: none;
            user-select: none;
          }
          .mac-sp-seg-thumb {
            position: absolute;
            top: 3px;
            left: 0;
            height: calc(100% - 6px);
            background: #FFFFFF;
            border-radius: 999px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
            will-change: transform, width;
            cursor: grab;
            z-index: 1;
          }
          .mac-sp-tab {
            position: relative;
            z-index: 2;
            border: none;
            background: transparent;
            padding: 6px 12px;
            font-size: 12px;
            font-weight: 600;
            border-radius: 999px;
            cursor: pointer;
            user-select: none;
            white-space: nowrap;
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
          {/* Left: Traffic Lights + Collapsible Sidebar Toggle + Plain Document Title */}
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
                  style={{ fontSize: '12px', color: '#636366', maxWidth: '210px' }}
                  title={documentIr.filename}
                >
                  — {documentIr.filename}
                </span>
              )}
            </div>
          </div>

          {/* Center: Draggable & Flickable Critically-Damped Spring Segmented Control */}
          <div ref={segTrackRef} className="mac-sp-seg-track">
            <div
              ref={segThumbRef}
              className="mac-sp-seg-thumb"
              onPointerDown={onSegThumbDown}
              onPointerMove={onSegThumbMove}
              onPointerUp={onSegThumbUp}
              onPointerCancel={onSegThumbUp}
            />
            {STUDIO_TABS.map((t) => (
              <button
                key={t.key}
                ref={(el) => {
                  tabBtnRefs.current[t.key] = el;
                }}
                onClick={() => selectStudioTab(t.key)}
                className="mac-sp-tab"
                style={{ color: activeStudioTab === t.key ? '#007AFF' : '#636366' }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Right: Spotlight + HUD Toggle + 3-Tier Router + Showcase Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', position: 'relative' }}>
            <SpringButton
              springLabel="Spotlight"
              onClick={() => setSpotlightOpen(true)}
              maxShift={5}
              style={{
                borderRadius: '999px',
                border: '1px solid rgba(60, 60, 67, 0.12)',
                backgroundColor: 'rgba(255, 255, 255, 0.88)',
                padding: '6px 10px',
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
                padding: '6px 10px',
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
              <span className="hidden lg:inline">HUD</span>
            </SpringButton>

            <SpringButton
              springLabel="三模路由"
              onClick={() => setRouterPopoverOpen((o) => !o)}
              maxShift={5}
              style={{
                borderRadius: '999px',
                border: '1px solid rgba(60, 60, 67, 0.14)',
                backgroundColor: 'rgba(255, 255, 255, 0.92)',
                padding: '6px 11px',
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
              <span className="max-w-[140px] truncate">{activeEngineLabel()}</span>
              <Settings className="w-3.5 h-3.5 text-[#636366]" />
            </SpringButton>

            <select
              aria-label="视图模式"
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value as AppViewMode)}
              style={{
                borderRadius: '999px',
                border: '1px solid rgba(60, 60, 67, 0.12)',
                backgroundColor: 'rgba(255, 255, 255, 0.88)',
                padding: '5px 8px',
                fontSize: '11px',
                color: '#636366',
                cursor: 'pointer',
              }}
            >
              <option value="functional">ASG 生产工作台</option>
              <option value="apple_audited">Apple 审计示范稿</option>
              <option value="impeccable_audited">Impeccable 示范稿</option>
            </select>

            {/* Anchored 3-Tier Router Quick Popover */}
            {routerPopoverOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: '46px',
                  right: '0',
                  width: '300px',
                  borderRadius: '16px',
                  padding: '10px',
                  zIndex: 50,
                  backgroundColor: 'rgba(255, 255, 255, 0.92)',
                  backdropFilter: 'blur(22px) saturate(180%)',
                  WebkitBackdropFilter: 'blur(22px) saturate(180%)',
                  border: '1px solid rgba(60, 60, 67, 0.12)',
                  boxShadow: '0 20px 44px -12px rgba(0, 0, 0, 0.22)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                }}
              >
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#636366', padding: '2px 6px' }}>
                  快速切换模型路由通道
                </div>
                {(
                  [
                    {
                      id: 'harness' as ProviderType,
                      title: `CLI Harness (${providerStatus?.settings.harness_config.preferred_cli || 'claude'})`,
                      sub: '本机 Claude / Codex / Gemini 命令行代理',
                      dot: '#34C759',
                    },
                    {
                      id: 'cloud' as ProviderType,
                      title: `云端 API (${providerStatus?.settings.cloud_config.model || 'Cloud'})`,
                      sub: 'OpenAI / DeepSeek / Anthropic 高精度生成',
                      dot: '#007AFF',
                    },
                    {
                      id: 'local' as ProviderType,
                      title: `本地模型 (${providerStatus?.settings.local_config.model || 'Ollama'})`,
                      sub: 'Ollama / LM Studio 100% 离线私有推理',
                      dot: '#5856D6',
                    },
                    {
                      id: 'heuristic' as ProviderType,
                      title: '内置智能规则引擎',
                      sub: '零 Token 消耗结构化即时预览与保底回退',
                      dot: '#FF9500',
                    },
                  ] as const
                ).map((item) => {
                  const isActive =
                    providerStatus?.settings.routing_mode === 'single' &&
                    providerStatus.settings.active_provider === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleQuickSwitchProvider(item.id)}
                      style={{
                        textAlign: 'left',
                        padding: '8px 10px',
                        borderRadius: '10px',
                        border: isActive ? `1px solid ${item.dot}` : '1px solid transparent',
                        backgroundColor: isActive ? 'rgba(0, 122, 255, 0.08)' : '#FFFFFF',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700 }}>
                        <span style={{ width: 7, height: 7, borderRadius: '999px', backgroundColor: item.dot }} />
                        <span>{item.title}</span>
                      </div>
                      <div style={{ fontSize: '10.5px', color: '#636366', marginTop: '2px' }}>{item.sub}</div>
                    </button>
                  );
                })}
                <SpringButton
                  springLabel="打开完整路由配置"
                  onClick={() => {
                    setRouterPopoverOpen(false);
                    setConfigOpen(true);
                  }}
                  maxShift={4}
                  style={{
                    marginTop: '4px',
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
                  <span>打开多阶段编排与密钥配置...</span>
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
            <button
              onClick={() => setErrorMsg(null)}
              style={{
                border: 'none',
                background: 'transparent',
                color: '#C62828',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              关闭
            </button>
          </div>
        )}

        {/* Desktop Three-Pane NavigationSplitView */}
        <div ref={splitRef} className="mac-sp-split">
          {/* Pane 1: Collapsible Left Source & History Sidebar */}
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

          {/* Pane 2: Center Stage 1 Inspector (Presets + AI Requirement Negotiation + Blueprint Spec) */}
          <section className="mac-sp-col no-print">
            {!documentIr ? (
              <div
                style={{
                  backgroundColor: '#FFFFFF',
                  borderRadius: '14px',
                  border: '1px solid rgba(60, 60, 67, 0.08)',
                  padding: '20px 16px',
                  textAlign: 'center',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}
              >
                <Sparkles className="w-6 h-6 text-[#007AFF] mx-auto" />
                <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#1C1C1E' }}>
                  阶段 1 · 等待导入教材或课件
                </div>
                <p style={{ fontSize: '11.5px', color: '#636366', lineHeight: 1.55 }}>
                  请在左侧导入课本 / PPTX（或加载示例课件），即可在此选择「随堂练习 / 同步练习 / 自测卷 / 自学案 / 考前速记包」并由 AI 解析微调方案。
                </p>
              </div>
            ) : (
              <BlueprintNegotiator
                presets={presets}
                blueprint={blueprint}
                onChangeBlueprint={setBlueprint}
                onNegotiate={handleNegotiate}
                onConfirmAndGenerate={handleConfirmAndGenerate}
                onQuickGenerate={handleQuickGenerate}
                negotiating={negotiating}
                generating={generating}
                progressInfo={progressInfo}
              />
            )}
          </section>

          {/* Pane 3: Right Widescreen Stage 2 Study Studio Canvas */}
          <main className="mac-sp-canvas">
            {!documentIr ? (
              <div
                style={{
                  maxWidth: '640px',
                  margin: '56px auto 0',
                  borderRadius: '20px',
                  border: '1px solid rgba(60, 60, 67, 0.1)',
                  backgroundColor: '#FAFAFC',
                  padding: '40px 32px',
                  textAlign: 'center',
                }}
              >
                <div
                  style={{
                    width: '58px',
                    height: '58px',
                    borderRadius: '16px',
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
                <h1 className="mac-sp-display" style={{ fontSize: '24px', fontWeight: 700, color: '#1C1C1E' }}>
                  上传课本或 PPTX，定制专属学习资料
                </h1>
                <p style={{ marginTop: '10px', fontSize: '13px', color: '#636366', lineHeight: 1.65 }}>
                  保留 <strong>「AI 解析需求 → 反馈确认方案 → 正式生成」</strong> 双阶段控制契约，内置 6 大教学预设与三模（Cloud API / Local Ollama·LM Studio / 本机 Claude·Codex·Gemini CLI Harness）智能路由引擎。
                </p>
                <div style={{ marginTop: '22px' }}>
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
                </div>
              </div>
            ) : !studyPackage ? (
              <div
                style={{
                  maxWidth: '680px',
                  margin: '28px auto 0',
                  borderRadius: '18px',
                  border: '1px solid rgba(60, 60, 67, 0.1)',
                  backgroundColor: '#FAFAFC',
                  padding: '28px',
                }}
              >
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    borderRadius: '999px',
                    backgroundColor: 'rgba(0, 122, 255, 0.1)',
                    color: '#007AFF',
                    padding: '4px 10px',
                    fontSize: '11px',
                    fontWeight: 700,
                  }}
                >
                  Stage 1 方案预览 · 待确认正式生成
                </div>
                <h2 className="mac-sp-display" style={{ fontSize: '21px', fontWeight: 700, marginTop: '10px' }}>
                  {blueprint?.blueprint_title || documentIr.filename}
                </h2>
                <p style={{ fontSize: '13px', color: '#636366', marginTop: '6px', lineHeight: 1.6 }}>
                  {blueprint?.parsed_intent_summary}
                </p>

                {blueprint && (
                  <div
                    className="mac-sp-tabular"
                    style={{
                      marginTop: '18px',
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: '10px',
                    }}
                  >
                    <div style={{ backgroundColor: '#FFFFFF', borderRadius: '12px', padding: '12px', border: '1px solid rgba(60,60,67,0.08)' }}>
                      <div style={{ fontSize: '11px', color: '#8E8E93' }}>已选章节范围</div>
                      <div style={{ fontSize: '16px', fontWeight: 700, marginTop: '3px' }}>
                        {blueprint.selected_chapter_ids.length} / {documentIr.chapters.length} 章
                      </div>
                    </div>
                    <div style={{ backgroundColor: '#FFFFFF', borderRadius: '12px', padding: '12px', border: '1px solid rgba(60,60,67,0.08)' }}>
                      <div style={{ fontSize: '11px', color: '#8E8E93' }}>题库题量配比</div>
                      <div style={{ fontSize: '16px', fontWeight: 700, marginTop: '3px' }}>
                        {blueprint.deliverables.mcq_count}选 · {blueprint.deliverables.fill_blank_count}填 ·{' '}
                        {blueprint.deliverables.short_answer_count}简
                      </div>
                    </div>
                    <div style={{ backgroundColor: '#FFFFFF', borderRadius: '12px', padding: '12px', border: '1px solid rgba(60,60,67,0.08)' }}>
                      <div style={{ fontSize: '11px', color: '#8E8E93' }}>当前调度路由</div>
                      <div style={{ fontSize: '14px', fontWeight: 700, marginTop: '5px', color: '#007AFF' }}>
                        {activeEngineLabel()}
                      </div>
                    </div>
                  </div>
                )}

                {blueprint && (
                  <div style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
                    <SpringButton
                      springLabel="右边栏直接确认生成"
                      disabled={generating || negotiating || blueprint.selected_chapter_ids.length === 0}
                      onClick={() => handleConfirmAndGenerate(blueprint)}
                      maxShift={7}
                      style={{
                        borderRadius: '999px',
                        border: 'none',
                        backgroundColor: '#007AFF',
                        color: '#FFFFFF',
                        padding: '10px 20px',
                        fontSize: '13px',
                        fontWeight: 700,
                        boxShadow: '0 8px 20px -6px rgba(0, 122, 255, 0.45)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        cursor: generating ? 'not-allowed' : 'pointer',
                      }}
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{generating ? '正在流式生成中...' : '确认当前方案并立即生成学习资料'}</span>
                    </SpringButton>
                  </div>
                )}
              </div>
            ) : (
              <StudyStudio
                studyPackage={studyPackage}
                documentIr={documentIr}
                activeTab={activeStudioTab}
                onChangeTab={selectStudioTab}
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
                ζ=1.00 弹簧物理与生成配比 HUD
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

        {/* Spotlight ⌘K Instant 0ms Command Modal */}
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
                  label="切换三模路由与 CLI Harness 编排配置..."
                  hint="Router"
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
    <button
      onClick={onClick}
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
    </button>
  );
}

export default App;
