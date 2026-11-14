import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  Cloud,
  Cpu,
  GraduationCap,
  HelpCircle,
  Layers,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  RotateCcw,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
} from 'lucide-react';
import { api } from './api';
import { BlueprintNegotiator } from './components/BlueprintNegotiator';
import { LiquidGlassCanvas, LiquidGlassOptics } from './components/LiquidGlassCanvas';
import { OnboardingGuideModal } from './components/OnboardingGuideModal';
import { RouterConfigModal } from './components/RouterConfigModal';
import { StudioTabKey, StudyStudio } from './components/StudyStudio';
import { UpdatePushModal } from './components/UpdatePushModal';
import { UploadAndTocPanel } from './components/UploadAndTocPanel';
import {
  DocumentIR,
  PresetTemplate,
  ProjectSummary,
  ProviderStatusResponse,
  RouterSettings,
  StudyBlueprint,
  StudyPackage,
  UiVisualMode,
  UpdateStatusResponse,
} from './types';
import {
  SegmentedOption,
  SpringButton,
  SpringSegmentedControl,
  SpringTelemetryProvider,
} from './utils/springPhysics';

type MainViewKey = 'workflow' | StudioTabKey;

export function App() {
  const [providerStatus, setProviderStatus] = useState<ProviderStatusResponse | null>(null);
  const [presets, setPresets] = useState<PresetTemplate[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [documentIr, setDocumentIr] = useState<DocumentIR | null>(null);
  const [blueprint, setBlueprint] = useState<StudyBlueprint | null>(null);
  const [studyPackage, setStudyPackage] = useState<StudyPackage | null>(null);

  const [workflowStep, setWorkflowStep] = useState<1 | 2 | 3>(1);
  const [activeMainView, setActiveMainView] = useState<MainViewKey>('workflow');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [configOpen, setConfigOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(() => {
    try {
      return localStorage.getItem('asg_onboarding_seen_v1') !== '1';
    } catch {
      return false;
    }
  });
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatusResponse | null>(null);
  const [autoCheckPush, setAutoCheckPush] = useState(true);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  // Dark Mode & Visual Mode (First launch ALWAYS academic_pure; downgrade if no GPU)
  const [darkMode, setDarkMode] = useState(() => {
    try {
      return localStorage.getItem('asg_theme_dark') === '1';
    } catch {
      return false;
    }
  });
  const [requestedVisualMode, setRequestedVisualMode] = useState<UiVisualMode>(() => {
    try {
      const saved = localStorage.getItem('asg_visual_mode_v2');
      return saved === 'liquid_glass' ? 'liquid_glass' : 'academic_pure';
    } catch {
      return 'academic_pure';
    }
  });
  const [webglUnavailable, setWebglUnavailable] = useState(false);
  const [downgradeNotice, setDowngradeNotice] = useState<string | null>(null);
  const [optics, setOptics] = useState<LiquidGlassOptics>({
    ior: 1.46,
    dispersion: 0.35,
    smoothK: 30,
    blur: 0.35,
  });
  const [pillResetCounter, setPillResetCounter] = useState(0);

  const [uploading, setUploading] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<{
    active: boolean;
    percent: number;
    stage: string;
    message: string;
    logs: string[];
  } | null>(null);

  const [aiFilling, setAiFilling] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [progressInfo, setProgressInfo] = useState<{
    percent: number;
    message: string;
    logs?: string[];
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Free AI Proxy Authorization & Cloud Missing Prompt Modals
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [pendingActionAfterAuth, setPendingActionAfterAuth] = useState<(() => Promise<void>) | null>(null);
  const [cloudPromptOpen, setCloudPromptOpen] = useState(false);

  const generateAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark-theme');
      document.body.classList.add('dark-theme');
    } else {
      root.classList.remove('dark-theme');
      document.body.classList.remove('dark-theme');
    }
    try {
      localStorage.setItem('asg_theme_dark', darkMode ? '1' : '0');
    } catch {
      // ignore
    }
  }, [darkMode]);

  const gpuAvailable = useMemo(() => {
    if (webglUnavailable) return false;
    if (!providerStatus) return false;
    return (providerStatus.gpu_vram?.detected_vram_gb || 0) > 0;
  }, [providerStatus, webglUnavailable]);

  const effectiveVisualMode: UiVisualMode =
    requestedVisualMode === 'liquid_glass' && gpuAvailable ? 'liquid_glass' : 'academic_pure';

  useEffect(() => {
    if (providerStatus && requestedVisualMode === 'liquid_glass' && !gpuAvailable) {
      setRequestedVisualMode('academic_pure');
      try {
        localStorage.setItem('asg_visual_mode_v2', 'academic_pure');
      } catch {
        // ignore
      }
      setDowngradeNotice('当前环境未检测到可用独立 GPU 或 WebGL 硬件加速，已自动切换为「标准界面」。');
    }
  }, [providerStatus, requestedVisualMode, gpuAvailable]);

  const handleChangeVisualMode = (mode: UiVisualMode) => {
    if (mode === 'liquid_glass' && !gpuAvailable) {
      setDowngradeNotice('未检测到独立 GPU 加速，无法开启 Liquid Glass，继续使用「标准界面」。');
      return;
    }
    setDowngradeNotice(null);
    setRequestedVisualMode(mode);
    try {
      localStorage.setItem('asg_visual_mode_v2', mode);
    } catch {
      // ignore
    }
    if (providerStatus) {
      api
        .saveProviderSettings({
          ...providerStatus.settings,
          ui_visual_mode: mode,
        })
        .then((saved) => setProviderStatus({ ...providerStatus, settings: saved }))
        .catch(() => {});
    }
  };

  const refreshProviderStatus = useCallback(async () => {
    try {
      const st = await api.getProviderStatus();
      setProviderStatus(st);
    } catch {
      // ignore
    }
  }, []);

  const refreshProjects = useCallback(async () => {
    try {
      const list = await api.listProjects();
      setProjects(list);
    } catch {
      // ignore
    }
  }, []);

  const refreshUpdateStatus = useCallback(async (fetchRemote = false) => {
    setCheckingUpdate(true);
    try {
      const st = await api.getUpdateStatus(fetchRemote);
      setUpdateStatus(st);
    } catch {
      // ignore
    } finally {
      setCheckingUpdate(false);
    }
  }, []);

  useEffect(() => {
    refreshProviderStatus();
    api.getPresets().then(setPresets).catch(() => {});
    refreshProjects();
    refreshUpdateStatus(true);
  }, [refreshProviderStatus, refreshProjects, refreshUpdateStatus]);

  useEffect(() => {
    if (!autoCheckPush) return;
    const timer = setInterval(() => refreshUpdateStatus(true), 60000);
    return () => clearInterval(timer);
  }, [autoCheckPush, refreshUpdateStatus]);

  // Pre-execution Gate: Check Free AI Authorization OR Cloud Key before running AI
  const ensureEngineReadyOrPrompt = (retryAction: () => Promise<void>): boolean => {
    if (!providerStatus) return true;
    const s = providerStatus.settings;
    if (s.active_provider === 'harness') {
      if (!s.free_ai_auth?.authorized_use_local_ai) {
        setPendingActionAfterAuth(() => retryAction);
        setAuthModalOpen(true);
        return false;
      }
    } else if (s.active_provider === 'cloud') {
      if (!s.cloud_config?.api_key) {
        setCloudPromptOpen(true);
        return false;
      }
    }
    return true;
  };

  const handleEngineError = (errMessage: string, retryAction?: () => Promise<void>) => {
    if (errMessage.includes('AUTH_REQUIRED')) {
      if (retryAction) setPendingActionAfterAuth(() => retryAction);
      setAuthModalOpen(true);
    } else if (errMessage.includes('CLOUD_NOT_CONFIGURED')) {
      setCloudPromptOpen(true);
    } else {
      setErrorMsg(errMessage);
    }
  };

  // Step 1 -> Step 2 Live Streaming Upload + OCR Progress
  const handleUploadFile = async (file: File) => {
    setErrorMsg(null);
    setUploading(true);
    setStudyPackage(null);
    setActiveMainView('workflow');
    setWorkflowStep(2);
    setOcrProgress({
      active: true,
      percent: 4,
      stage: 'ocr_init',
      message: `准备上传并识别《${file.name}》...`,
      logs: [`接收文件 ${file.name} (${Math.round(file.size / 1024)} KB)`],
    });
    try {
      const detail = await api.uploadProjectStream(file, (evt) => {
        const msg = String(evt.message || '');
        const pct = Number(evt.percent ?? 20);
        setOcrProgress((prev) => ({
          active: evt.type !== 'complete',
          percent: pct,
          stage: evt.stage || 'ocr',
          message: msg || '正在执行 OCR 文本与公式识别...',
          logs: msg && prev?.logs[prev.logs.length - 1] !== msg ? [...(prev?.logs || []).slice(-6), msg] : prev?.logs || [],
        }));
      }, 'A_beginner');
      setDocumentIr(detail.document_ir);
      setBlueprint(detail.blueprint || null);
      setStudyPackage(detail.study_package || null);
      setOcrProgress((prev) =>
        prev ? { ...prev, active: false, percent: 100, message: `识别完成！共 ${detail.document_ir.chapters.length} 章节` } : null
      );
      setWorkflowStep(2);
      await refreshProjects();
    } catch (e: any) {
      setOcrProgress(null);
      setErrorMsg(e?.message || '上传与 OCR 解析失败');
    } finally {
      setUploading(false);
    }
  };

  const handleLoadDemo = async () => {
    setErrorMsg(null);
    setUploading(true);
    setStudyPackage(null);
    setActiveMainView('workflow');
    setWorkflowStep(2);
    setOcrProgress({
      active: true,
      percent: 8,
      stage: 'ocr_init',
      message: '正在加载示例课件并执行公式 OCR 扫描...',
      logs: ['加载《深度学习架构与梯度下降》示例课件...'],
    });
    try {
      const detail = await api.loadDemoProjectStream((evt) => {
        const msg = String(evt.message || '');
        const pct = Number(evt.percent ?? 35);
        setOcrProgress((prev) => ({
          active: evt.type !== 'complete',
          percent: pct,
          stage: evt.stage || 'ocr',
          message: msg || '正在识别...',
          logs: msg && prev?.logs[prev.logs.length - 1] !== msg ? [...(prev?.logs || []).slice(-6), msg] : prev?.logs || [],
        }));
      });
      setDocumentIr(detail.document_ir);
      setBlueprint(detail.blueprint || null);
      setStudyPackage(detail.study_package || null);
      setOcrProgress((prev) =>
        prev ? { ...prev, active: false, percent: 100, message: `示例课件 OCR 完成！共 ${detail.document_ir.chapters.length} 个章节` } : null
      );
      setWorkflowStep(2);
      await refreshProjects();
    } catch (e: any) {
      setOcrProgress(null);
      setErrorMsg(e?.message || '加载示例课件失败');
    } finally {
      setUploading(false);
    }
  };

  const handleOpenProject = async (projectId: string) => {
    setErrorMsg(null);
    setOcrProgress(null);
    try {
      const detail = await api.getProjectDetail(projectId);
      setDocumentIr(detail.document_ir);
      setBlueprint(detail.blueprint || null);
      setStudyPackage(detail.study_package || null);
      if (detail.study_package) {
        autoSwitchTabForPackage(detail.study_package);
      } else {
        setWorkflowStep(3);
        setActiveMainView('workflow');
      }
    } catch (e: any) {
      setErrorMsg(e?.message || '打开工作区失败');
    }
  };

  const handleDeleteProject = async (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await api.deleteProject(projectId);
    if (documentIr?.project_id === projectId) {
      setDocumentIr(null);
      setBlueprint(null);
      setStudyPackage(null);
      setWorkflowStep(1);
      setActiveMainView('workflow');
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

  const autoSwitchTabForPackage = useCallback((pkg: StudyPackage) => {
    const items = pkg.blueprint_used?.deliverables?.selected_items || [];
    if (pkg.study_notes_markdown && (items.includes('detailed_study_guide') || items.includes('key_knowledge_extraction'))) {
      setActiveMainView('notes');
    } else if (pkg.quiz_paper?.questions?.length > 0) {
      setActiveMainView('quiz');
    } else if (pkg.cheatsheet_markdown) {
      setActiveMainView('cheatsheet');
    } else if (pkg.mindmap_mermaid) {
      setActiveMainView('mindmap');
    } else {
      setActiveMainView('blueprint_trace');
    }
  }, []);

  const handleAiFillParams = async () => {
    if (!documentIr || !blueprint) return;
    const run = async () => {
      setErrorMsg(null);
      setAiFilling(true);
      try {
        const bp = await api.aiFillParams(documentIr.project_id, {
          preset_id: blueprint.scenario_type,
          user_prompt: blueprint.custom_instructions || '',
          current_blueprint: blueprint,
        });
        setBlueprint(bp);
      } catch (e: any) {
        handleEngineError(e?.message || 'AI 智能填参失败', run);
      } finally {
        setAiFilling(false);
      }
    };
    if (!ensureEngineReadyOrPrompt(run)) return;
    await run();
  };

  const handleConfirmAndGenerate = async (confirmedBp: StudyBlueprint) => {
    if (!documentIr) return;
    const run = async () => {
      setErrorMsg(null);
      setGenerating(true);
      setProgressInfo({
        percent: 5,
        message: '已确认学习方案与参数，正在调度 AI 生成引擎...',
        logs: ['已确认场景与参数配置，开始流式生成...'],
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
                prevLogs[prevLogs.length - 1] === message ? prevLogs : [...prevLogs.slice(-8), message];
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
          setProgressInfo({ percent: 0, message: '已确认打断并停止生成任务' });
        } else {
          handleEngineError(e?.message || '流式生成失败', run);
        }
      } finally {
        if (generateAbortRef.current === controller) generateAbortRef.current = null;
        setGenerating(false);
        setTimeout(() => setProgressInfo(null), 1200);
      }
    };
    if (!ensureEngineReadyOrPrompt(run)) return;
    await run();
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
    setProgressInfo({ percent: 0, message: '已打断并终止后台生成任务' });
    setTimeout(() => setProgressInfo(null), 2000);
  };

  const handleAuthorizeAndContinue = async () => {
    try {
      const saved = await api.authorizeFreeAi({
        authorized: true,
        preferred_proxy_mode: 'magpie_dsh',
        selected_free_model: providerStatus?.settings.free_ai_auth?.selected_free_model || 'qoder-cn/fast',
      });
      if (providerStatus) {
        setProviderStatus({ ...providerStatus, settings: saved });
      }
      setAuthModalOpen(false);
      const pending = pendingActionAfterAuth;
      setPendingActionAfterAuth(null);
      if (pending) await pending();
    } catch (e: any) {
      setErrorMsg(e?.message || '保存授权失败');
    }
  };

  const topbarOptions = useMemo<SegmentedOption<MainViewKey>[]>(() => {
    if (!documentIr) {
      return [{ value: 'workflow', label: '① 资料上传与 OCR' }];
    }
    if (!studyPackage) {
      return [{ value: 'workflow', label: workflowStep === 2 ? '② OCR 识别与显存配置' : '③ 选择 A/B/C 场景与参数' }];
    }
    return [
      { value: 'notes', label: '讲义 / 知识提取' },
      { value: 'quiz', label: '在线练习卡片' },
      { value: 'cheatsheet', label: '考前速记' },
      { value: 'mindmap', label: 'MindMap' },
      { value: 'blueprint_trace', label: '明细与路由' },
      { value: 'workflow', label: '重新配置生成' },
    ];
  }, [documentIr, studyPackage, workflowStep]);

  const activeEngineText = () => {
    const s = providerStatus?.settings;
    if (!s) return '加载配置...';
    if (s.active_provider === 'cloud') {
      return s.cloud_config.api_key ? `云端 · ${s.cloud_config.model}` : '云端 API (待填 Key)';
    }
    const model = s.free_ai_auth?.selected_free_model || 'qoder-cn/fast';
    return s.free_ai_auth?.authorized_use_local_ai ? `Magpie+DSH (${model})` : 'Magpie+DSH (待授权)';
  };

  return (
    <SpringTelemetryProvider onReport={() => {}}>
      <div className={`asg-root flex flex-col h-screen overflow-hidden ${effectiveVisualMode === 'liquid_glass' ? 'mode-liquid-glass' : 'mode-academic-pure'} ${darkMode ? 'dark-theme' : ''}`}>
        {effectiveVisualMode === 'liquid_glass' && (
          <LiquidGlassCanvas
            isDark={darkMode}
            optics={optics}
            resetTrigger={pillResetCounter}
            onSelectFlashcards={() => {
              if (studyPackage) setActiveMainView('quiz');
            }}
            onWebglUnavailable={() => setWebglUnavailable(true)}
          />
        )}

        {/* Top Academic / Glass Header */}
        <header
          data-glass-panel="topbar"
          data-radius="16"
          data-bezel="22"
          data-darkmix="0.32"
          className="asg-glass-surface asg-floating-header h-14 px-4 border-b flex items-center justify-between gap-3 shrink-0 z-20 relative no-print"
          style={{
            borderColor: 'var(--border-default)',
            backgroundColor: effectiveVisualMode === 'liquid_glass' ? undefined : 'var(--bg-surface)',
          }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <SpringButton
              springLabel="切换侧栏"
              onClick={() => setSidebarOpen((s) => !s)}
              className="p-2 rounded-lg border"
              style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-subtle)' }}
            >
              {sidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
            </SpringButton>
            <div className="w-8 h-8 rounded-xl bg-[#3B5BDB] text-white flex items-center justify-center shrink-0">
              <GraduationCap className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold truncate flex items-center gap-1.5">
                <span>Auto Study Guidance</span>
                <span
                  className="text-[10.5px] font-mono px-1.5 py-0.5 rounded-full font-semibold shrink-0"
                  style={{ backgroundColor: 'var(--brand-tint)', color: '#3B5BDB' }}
                >
                  v1.0.0
                </span>
              </div>
              <div className="text-[11px] truncate" style={{ color: 'var(--text-secondary)' }}>
                {documentIr ? documentIr.filename : 'AI 智能学习资料与互动练习系统'}
              </div>
            </div>
          </div>

          <div className="hidden lg:flex items-center">
            <SpringSegmentedControl<MainViewKey>
              compact
              springLabel="主视图切换"
              value={activeMainView}
              onChange={(v) => {
                setActiveMainView(v);
                if (v === 'workflow' && documentIr && workflowStep === 1) setWorkflowStep(3);
              }}
              options={topbarOptions}
            />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => handleChangeVisualMode(effectiveVisualMode === 'academic_pure' ? 'liquid_glass' : 'academic_pure')}
              disabled={!gpuAvailable}
              title={gpuAvailable ? '切换 标准界面 / Liquid Glass' : '未检测到独立 GPU，使用标准界面'}
              className="px-2.5 py-1.5 rounded-full border text-[11px] font-semibold flex items-center gap-1"
              style={{
                borderColor: 'var(--border-default)',
                backgroundColor: 'var(--bg-subtle)',
                opacity: gpuAvailable ? 1 : 0.65,
                cursor: gpuAvailable ? 'pointer' : 'not-allowed',
              }}
            >
              {effectiveVisualMode === 'liquid_glass' ? <Sparkles className="w-3 h-3 text-[#3B5BDB]" /> : <Layers className="w-3 h-3" />}
              <span>{effectiveVisualMode === 'liquid_glass' ? 'Liquid Glass' : '标准界面'}</span>
            </button>

            <SpringButton
              springLabel="AI 模型通道设置"
              onClick={() => setConfigOpen(true)}
              className="px-3 py-1.5 rounded-full border text-[11px] font-bold flex items-center gap-1.5"
              style={{ borderColor: '#3B5BDB', backgroundColor: 'var(--brand-tint)', color: '#3B5BDB' }}
            >
              {providerStatus?.settings.active_provider === 'cloud' ? (
                <Cloud className="w-3.5 h-3.5" />
              ) : (
                <Cpu className="w-3.5 h-3.5" />
              )}
              <span className="max-w-[160px] truncate">{activeEngineText()}</span>
            </SpringButton>

            <button
              type="button"
              onClick={() => setDarkMode((d) => !d)}
              className="p-2 rounded-lg border"
              style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-subtle)' }}
              title="切换浅色 / 深色模式"
            >
              {darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={() => setOnboardingOpen(true)}
              className="p-2 rounded-lg border"
              style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-subtle)' }}
              title="新手引导"
            >
              <HelpCircle className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setUpdateModalOpen(true)}
              className="p-2 rounded-lg border"
              style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-subtle)' }}
              title="版本同步与更新"
            >
              <RefreshCw className={`w-4 h-4 ${(updateStatus?.has_update || updateStatus?.update_available) ? 'text-[#3B5BDB]' : ''}`} />
            </button>

            <SpringButton
              springLabel="打开完整设置"
              onClick={() => setConfigOpen(true)}
              className="px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1"
              style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
            >
              <Settings className="w-3.5 h-3.5" />
              <span>设置</span>
            </SpringButton>
          </div>
        </header>

        {/* Liquid Glass Optical Parameter Strip (matches liquid_glass_preview.html) */}
        {effectiveVisualMode === 'liquid_glass' && (
          <section
            data-glass-panel="optics"
            data-radius="14"
            data-bezel="18"
            data-darkmix="0.34"
            className="asg-glass-surface h-11 px-3.5 rounded-[14px] border flex items-center justify-between gap-3 shrink-0 z-20 relative no-print overflow-hidden"
            style={{ borderColor: 'var(--border-default)' }}
          >
            <div className="flex items-center gap-3 overflow-x-auto min-w-0">
              <span
                className="px-2 py-0.5 rounded text-[11px] font-semibold shrink-0"
                style={{
                  backgroundColor: 'var(--brand-tint)',
                  color: 'var(--brand-primary)',
                }}
              >
                光学参数
              </span>
              <label className="flex items-center gap-1.5 text-[11.5px] shrink-0" style={{ color: 'var(--text-secondary)' }}>
                <span>IOR</span>
                <input
                  type="range"
                  min="1.00"
                  max="2.50"
                  step="0.01"
                  value={optics.ior}
                  onChange={(e) => setOptics((o) => ({ ...o, ior: parseFloat(e.target.value) }))}
                  className="w-16 accent-[#3B5BDB] cursor-pointer"
                />
                <span className="font-mono font-semibold text-[#3B5BDB] w-8">{optics.ior.toFixed(2)}</span>
              </label>
              <label className="flex items-center gap-1.5 text-[11.5px] shrink-0" style={{ color: 'var(--text-secondary)' }}>
                <span>色散</span>
                <input
                  type="range"
                  min="0.00"
                  max="1.00"
                  step="0.01"
                  value={optics.dispersion}
                  onChange={(e) => setOptics((o) => ({ ...o, dispersion: parseFloat(e.target.value) }))}
                  className="w-16 accent-[#3B5BDB] cursor-pointer"
                />
                <span className="font-mono font-semibold text-[#3B5BDB] w-8">{optics.dispersion.toFixed(2)}</span>
              </label>
              <label className="flex items-center gap-1.5 text-[11.5px] shrink-0" style={{ color: 'var(--text-secondary)' }}>
                <span>融球 K</span>
                <input
                  type="range"
                  min="0"
                  max="90"
                  step="1"
                  value={optics.smoothK}
                  onChange={(e) => setOptics((o) => ({ ...o, smoothK: parseFloat(e.target.value) }))}
                  className="w-16 accent-[#3B5BDB] cursor-pointer"
                />
                <span className="font-mono font-semibold text-[#3B5BDB] w-7">{Math.round(optics.smoothK)}</span>
              </label>
              <label className="flex items-center gap-1.5 text-[11.5px] shrink-0" style={{ color: 'var(--text-secondary)' }}>
                <span>磨砂</span>
                <input
                  type="range"
                  min="0.00"
                  max="1.00"
                  step="0.01"
                  value={optics.blur}
                  onChange={(e) => setOptics((o) => ({ ...o, blur: parseFloat(e.target.value) }))}
                  className="w-16 accent-[#3B5BDB] cursor-pointer"
                />
                <span className="font-mono font-semibold text-[#3B5BDB] w-8">{optics.blur.toFixed(2)}</span>
              </label>
            </div>

            <button
              type="button"
              onClick={() => setPillResetCounter((c) => c + 1)}
              className="px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1 shrink-0"
              style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)', color: 'var(--text-secondary)' }}
            >
              <RotateCcw className="w-3 h-3" />
              <span>复位胶囊</span>
            </button>
          </section>
        )}

        {/* Notices / Error Banners */}
        {(errorMsg || downgradeNotice) && (
          <div className="px-4 pt-2 z-20 relative no-print">
            {downgradeNotice && (
              <div
                className="mb-1.5 px-4 py-2 rounded-xl border text-xs flex items-center justify-between"
                style={{
                  borderColor: 'var(--semantic-warning)',
                  backgroundColor: 'var(--semantic-warning-tint)',
                  color: 'var(--semantic-warning)',
                }}
              >
                <span>{downgradeNotice}</span>
                <button type="button" onClick={() => setDowngradeNotice(null)} className="underline ml-3">
                  知道了
                </button>
              </div>
            )}
            {errorMsg && (
              <div
                className="px-4 py-2.5 rounded-xl border text-xs flex items-center justify-between gap-2"
                style={{
                  borderColor: 'var(--semantic-warning)',
                  backgroundColor: 'var(--semantic-warning-tint)',
                  color: 'var(--semantic-warning)',
                }}
              >
                <span className="flex items-center gap-2 font-medium">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{errorMsg}</span>
                </span>
                <button type="button" onClick={() => setErrorMsg(null)} className="underline shrink-0">
                  关闭
                </button>
              </div>
            )}
          </div>
        )}

        {/* Main Workspace Split */}
        <div className={`flex-1 min-h-0 flex relative z-10 overflow-hidden ${effectiveVisualMode === 'liquid_glass' ? 'gap-3' : ''}`}>
          {sidebarOpen && (
            <aside
              data-glass-panel={effectiveVisualMode === 'liquid_glass' ? 'sidebar-left' : undefined}
              data-radius="16"
              data-bezel="22"
              data-darkmix="0.38"
              className={`w-[270px] shrink-0 h-full overflow-y-auto p-3.5 no-print ${effectiveVisualMode === 'liquid_glass' ? 'asg-glass-surface asg-floating-sidebar' : 'border-r'}`}
              style={{ borderColor: 'var(--border-default)' }}
            >
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
          )}

          <main className="flex-1 min-w-0 h-full overflow-y-auto p-5 sm:p-7">
            {!documentIr && !ocrProgress?.active ? (
              <div
                data-glass-panel="true"
                className="asg-card max-w-[720px] mx-auto mt-8 p-8 text-center space-y-5"
              >
                <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center bg-[#EDF2FF] text-[#3B5BDB]">
                  <BookOpen className="w-7 h-7" />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-center gap-2">
                    <h1 className="text-2xl font-bold">Auto Study Guidance</h1>
                    <span
                      className="text-xs font-mono px-2 py-0.5 rounded-full font-bold"
                      style={{ backgroundColor: 'var(--brand-tint)', color: '#3B5BDB' }}
                    >
                      v1.0.0
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed max-w-xl mx-auto" style={{ color: 'var(--text-secondary)' }}>
                    上传教材、课件或讲义图片，自动完成文档解析，按学习场景生成自学讲义、章节练习、冲刺试卷、速记卡与思维导图。
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                  <SpringButton
                    springLabel="体验示例课件"
                    disabled={uploading}
                    onClick={handleLoadDemo}
                    className="px-5 py-2.5 rounded-xl text-xs font-bold text-white flex items-center gap-1.5"
                    style={{ backgroundColor: '#3B5BDB' }}
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>载入示例课件</span>
                  </SpringButton>
                  <SpringButton
                    springLabel="系统设置"
                    onClick={() => setConfigOpen(true)}
                    className="px-4 py-2.5 rounded-xl text-xs font-bold border flex items-center gap-1.5"
                    style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-subtle)' }}
                  >
                    <Settings className="w-4 h-4 text-[#3B5BDB]" />
                    <span>系统设置</span>
                  </SpringButton>
                </div>
              </div>
            ) : activeMainView === 'workflow' || !studyPackage ? (
              <BlueprintNegotiator
                documentIr={documentIr}
                workflowStep={workflowStep}
                onChangeWorkflowStep={setWorkflowStep}
                ocrProgress={ocrProgress}
                presets={presets}
                blueprint={blueprint}
                providerStatus={providerStatus}
                onChangeBlueprint={setBlueprint}
                onAiFillParams={handleAiFillParams}
                onConfirmAndGenerate={handleConfirmAndGenerate}
                onCancelGenerate={handleCancelGenerate}
                onOpenSettings={() => setConfigOpen(true)}
                onRefreshProviderStatus={refreshProviderStatus}
                aiFilling={aiFilling}
                generating={generating}
                progressInfo={progressInfo}
              />
            ) : (
              <StudyStudio
                studyPackage={studyPackage}
                documentIr={documentIr}
                activeTab={activeMainView}
                onChangeTab={(tab) => setActiveMainView(tab)}
                onUpdatePackage={(updatedPkg) => setStudyPackage(updatedPkg)}
                onRequestAuth={() => setAuthModalOpen(true)}
                darkMode={darkMode}
              />
            )}
          </main>
        </div>

        {/* Free AI Software Proxy Authorization Modal */}
        {authModalOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ backgroundColor: 'rgba(15, 23, 42, 0.5)', backdropFilter: 'blur(4px)' }}
          >
            <div
              className="asg-card w-full max-w-lg p-6 space-y-4 asg-drawer-enter"
              style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
            >
              <div className="flex items-start gap-3">
                <div className="p-2.5 rounded-xl bg-[#EDF2FF] text-[#3B5BDB] shrink-0">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-bold">请求授权使用本机免费 AI 软件反代出题</h3>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                    即将通过 <strong>Magpie + DeepSeek Harness (dsh)</strong> 调用您本机已安装的免费 AI 软件（Qoder CN / WorkBuddy / Trae CN）完成参数评估或高质量题目命制。调用前需要取得您的明确授权：
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {(providerStatus?.free_ai_apps || [])
                  .filter((a) => ['qoder_cn', 'workbuddy', 'trae_cn'].includes(a.app_id))
                  .map((app) => (
                    <div
                      key={app.app_id}
                      className="p-2.5 rounded-xl border text-center"
                      style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-subtle)' }}
                    >
                      <div className="text-xs font-bold">{app.name}</div>
                      <div
                        className="text-[11px] mt-0.5 font-semibold"
                        style={{ color: app.installed ? 'var(--semantic-success)' : 'var(--text-muted)' }}
                      >
                        {app.running ? '在线可用' : app.installed ? '已安装' : '未安装'}
                      </div>
                    </div>
                  ))}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setAuthModalOpen(false);
                    setConfigOpen(true);
                  }}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold border"
                  style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-subtle)' }}
                >
                  去设置详情 / 一键配置 Magpie
                </button>
                <SpringButton
                  springLabel="授权并继续"
                  onClick={handleAuthorizeAndContinue}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-white"
                  style={{ backgroundColor: '#2B8A3E' }}
                >
                  ✓ 授权并继续出题
                </SpringButton>
              </div>
            </div>
          </div>
        )}

        {/* Cloud API Missing Prompt Modal */}
        {cloudPromptOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ backgroundColor: 'rgba(15, 23, 42, 0.5)', backdropFilter: 'blur(4px)' }}
          >
            <div
              className="asg-card w-full max-w-md p-6 space-y-4 asg-drawer-enter"
              style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
            >
              <div className="space-y-1.5">
                <h3 className="text-base font-bold flex items-center gap-2">
                  <Cloud className="w-5 h-5 text-[#3B5BDB]" />
                  <span>当前已选「云端 API」，尚未填写 API Key</span>
                </h3>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  请先填写云端 API Key（DeepSeek / OpenAI 等），或者直接切换至「选项 1：Magpie + DeepSeek Harness」使用本机免费 AI 软件出题。
                </p>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCloudPromptOpen(false)}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold border"
                  style={{ borderColor: 'var(--border-default)' }}
                >
                  稍后
                </button>
                <SpringButton
                  springLabel="打开设置填写 API Key"
                  onClick={() => {
                    setCloudPromptOpen(false);
                    setConfigOpen(true);
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-white"
                  style={{ backgroundColor: '#3B5BDB' }}
                >
                  立即前往配置
                </SpringButton>
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
          gpuAvailable={gpuAvailable}
          effectiveVisualMode={effectiveVisualMode}
          onChangeVisualMode={handleChangeVisualMode}
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

export default App;
