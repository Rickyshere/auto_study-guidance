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
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  UploadCloud,
} from 'lucide-react';
import { api } from './api';
import { BlueprintNegotiator } from './components/BlueprintNegotiator';
import { ExamPaperWorkbench, ExamProgressState } from './components/ExamPaperWorkbench';
import { LiquidGlassCanvas, LiquidGlassOptics } from './components/LiquidGlassCanvas';
import { OnboardingGuideModal } from './components/OnboardingGuideModal';
import { DEFAULT_LIQUID_OPTICS, RouterConfigModal } from './components/RouterConfigModal';
import { StudioTabKey, StudyStudio } from './components/StudyStudio';
import { UpdatePushModal } from './components/UpdatePushModal';
import { UploadAndTocPanel } from './components/UploadAndTocPanel';
import {
  DocumentIR,
  ExamDirectionType,
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
  const [optics, setOptics] = useState<LiquidGlassOptics>(() => {
    try {
      const raw = localStorage.getItem('asg_liquid_optics_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.ior === 'number') {
          return { ...DEFAULT_LIQUID_OPTICS, ...parsed };
        }
      }
    } catch {
      // ignore
    }
    return DEFAULT_LIQUID_OPTICS;
  });

  const handleChangeOptics = useCallback((nextOptics: LiquidGlassOptics) => {
    setOptics(nextOptics);
    try {
      localStorage.setItem('asg_liquid_optics_v1', JSON.stringify(nextOptics));
    } catch {
      // ignore
    }
  }, []);

  const [uploadMode, setUploadMode] = useState<'courseware' | 'exam_paper'>('courseware');
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
  const [examProgress, setExamProgress] = useState<ExamProgressState | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Free AI Proxy Authorization & Cloud Missing Prompt Modals
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [pendingActionAfterAuth, setPendingActionAfterAuth] = useState<(() => Promise<void>) | null>(null);
  const [cloudPromptOpen, setCloudPromptOpen] = useState(false);

  const generateAbortRef = useRef<AbortController | null>(null);
  const coursewareWelcomeInputRef = useRef<HTMLInputElement | null>(null);
  const examWelcomeInputRef = useRef<HTMLInputElement | null>(null);

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
    setUploadMode('courseware');
    setUploading(true);
    setExamProgress(null);
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
    setUploadMode('courseware');
    setUploading(true);
    setExamProgress(null);
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

  // Peer Entry: Upload Exam Paper (Forced OXR: local read-only probe -> Cloud OXR)
  const handleUploadExamFile = async (file: File) => {
    setErrorMsg(null);
    setUploadMode('exam_paper');
    setUploading(true);
    setExamProgress(null);
    setStudyPackage(null);
    setBlueprint(null);
    setActiveMainView('workflow');
    setWorkflowStep(2);
    setOcrProgress({
      active: true,
      percent: 4,
      stage: 'oxr_probe',
      message: `正在探查本地 OXR 环境并准备提取试卷《${file.name}》...`,
      logs: [`接收原卷 ${file.name} (${Math.round(file.size / 1024)} KB) · 执行只读 OXR 探查`],
    });
    try {
      const detail = await api.uploadExamProjectStream(file, (evt) => {
        const msg = String(evt.message || '');
        const pct = Number(evt.percent ?? 24);
        setOcrProgress((prev) => ({
          active: evt.type !== 'complete',
          percent: pct,
          stage: evt.stage || 'oxr',
          message: msg || '正在执行 OXR 原卷识别与公式提取...',
          logs: msg && prev?.logs[prev.logs.length - 1] !== msg ? [...(prev?.logs || []).slice(-8), msg] : prev?.logs || [],
        }));
      });
      setDocumentIr(detail.document_ir);
      setBlueprint(detail.blueprint || null);
      setStudyPackage(detail.study_package || null);
      setOcrProgress((prev) =>
        prev
          ? {
              ...prev,
              active: false,
              percent: 100,
              message: `OXR 原卷识别完成！提取 ${detail.document_ir.total_chars.toLocaleString()} 字`,
            }
          : null
      );
      await refreshProjects();
    } catch (e: any) {
      setOcrProgress(null);
      setErrorMsg(e?.message || '上传试卷与 OXR 解析失败');
    } finally {
      setUploading(false);
    }
  };

  const handleLoadDemoExam = async () => {
    setErrorMsg(null);
    setUploadMode('exam_paper');
    setUploading(true);
    setExamProgress(null);
    setStudyPackage(null);
    setBlueprint(null);
    setActiveMainView('workflow');
    setWorkflowStep(2);
    setOcrProgress({
      active: true,
      percent: 8,
      stage: 'oxr_probe',
      message: '正在探查本地 OXR 并载入示例真题原卷...',
      logs: ['载入《大学生理学与生物物理》期中真题示例卷...'],
    });
    try {
      const detail = await api.loadDemoExamProjectStream((evt) => {
        const msg = String(evt.message || '');
        const pct = Number(evt.percent ?? 40);
        setOcrProgress((prev) => ({
          active: evt.type !== 'complete',
          percent: pct,
          stage: evt.stage || 'oxr',
          message: msg || '正在提取试卷文本层...',
          logs: msg && prev?.logs[prev.logs.length - 1] !== msg ? [...(prev?.logs || []).slice(-8), msg] : prev?.logs || [],
        }));
      });
      setDocumentIr(detail.document_ir);
      setBlueprint(detail.blueprint || null);
      setStudyPackage(detail.study_package || null);
      setOcrProgress((prev) =>
        prev
          ? {
              ...prev,
              active: false,
              percent: 100,
              message: `示例试卷 OXR 文本层准备就绪 (${detail.document_ir.total_chars.toLocaleString()} 字)`,
            }
          : null
      );
      await refreshProjects();
    } catch (e: any) {
      setOcrProgress(null);
      setErrorMsg(e?.message || '加载示例试卷失败');
    } finally {
      setUploading(false);
    }
  };

  const handleOpenProject = async (projectId: string) => {
    setErrorMsg(null);
    setOcrProgress(null);
    setExamProgress(null);
    try {
      const detail = await api.getProjectDetail(projectId);
      setDocumentIr(detail.document_ir);
      setUploadMode(detail.document_ir.project_type === 'exam_paper' ? 'exam_paper' : 'courseware');
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
      setExamProgress(null);
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
    const allPapers = [pkg.quiz_paper, ...(pkg.extra_quiz_papers || [])].filter(Boolean);
    const hasSimilar = allPapers.some(
      (p) => p.paper_id === 'similar_style_paper' && (p.questions?.length || 0) > 0
    );
    const hasOriginal = allPapers.some(
      (p) => p.paper_id === 'original_exam_bank' && (p.questions?.length || 0) > 0
    );

    if (pkg.exam_pipeline_metadata || hasSimilar || hasOriginal) {
      if (hasSimilar) {
        setActiveMainView('quiz_similar');
      } else if (hasOriginal) {
        setActiveMainView('quiz_original');
      } else {
        setActiveMainView('notes');
      }
      return;
    }

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
      setActiveMainView('notes');
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

  const handleGenerateExam = async (
    direction: ExamDirectionType,
    userRequirements: string,
    rawExamTextOverride?: string
  ) => {
    if (!documentIr) return;
    const run = async () => {
      setErrorMsg(null);
      setGenerating(true);
      setExamProgress({
        percent: 4,
        stage: 'exam_init',
        message: '已确认试卷生成配置，正在调度 OXR 文本层与四子 Agent...',
        agentStates: { a: 'idle', b: 'idle', c: 'idle', d: 'idle', orig: 'idle' },
        logs: [`启动试卷生成方向：${direction}`],
      });
      const controller = new AbortController();
      generateAbortRef.current = controller;
      try {
        const pkg = await api.generateExamPackageStream(
          documentIr.project_id,
          {
            direction,
            user_requirements: userRequirements,
            raw_exam_text_override: rawExamTextOverride,
          },
          (evt) => {
            setExamProgress((prev) => {
              const base: ExamProgressState = prev || {
                percent: evt.percent || 5,
                stage: evt.stage || 'exam_init',
                message: evt.message || '',
                agentStates: { a: 'idle', b: 'idle', c: 'idle', d: 'idle', orig: 'idle' },
                logs: [],
              };
              const nextStates = { ...base.agentStates };
              const msg = String(evt.message || '');
              const agentId = (evt.agent_id || '') as '' | 'a' | 'b' | 'c' | 'd' | 'orig';
              const status = String(evt.detail?.status || '');
              const isDoneMsg =
                msg.startsWith('✓') || msg.includes('完成') || status === 'done' || status === 'passed';

              if (evt.stage === 'agent_b' && nextStates.a !== 'done') nextStates.a = 'done';
              if (evt.stage === 'agent_c') {
                nextStates.a = 'done';
                nextStates.b = 'done';
                if (status === 'done') nextStates.c = 'done';
                else if (status === 'retry' || Number(evt.detail?.attempt || 1) > 1) nextStates.c = 'retry';
                else nextStates.c = 'running';
              } else if (evt.stage === 'agent_d' || evt.stage === 'finalize') {
                nextStates.a = 'done';
                nextStates.b = 'done';
                nextStates.c = 'done';
                if (evt.stage === 'finalize' || status === 'done') nextStates.d = 'done';
                else if (status === 'retry') nextStates.d = 'retry';
                else nextStates.d = 'running';
              } else if (agentId && agentId in nextStates) {
                if (
                  status === 'retry' ||
                  status === 'failed' ||
                  Number(evt.detail?.attempt || 1) > 1 ||
                  msg.includes('打回') ||
                  msg.includes('重写')
                ) {
                  nextStates[agentId] = isDoneMsg ? 'done' : 'retry';
                } else {
                  nextStates[agentId] = isDoneMsg ? 'done' : 'running';
                }
              } else if (evt.stage === 'complete' || (evt.percent ?? 0) >= 99) {
                if (nextStates.a === 'running') nextStates.a = 'done';
                if (nextStates.b === 'running') nextStates.b = 'done';
                if (nextStates.c === 'running' || nextStates.c === 'retry') nextStates.c = 'done';
                if (nextStates.d === 'running' || nextStates.d === 'retry') nextStates.d = 'done';
                if (nextStates.orig === 'running') nextStates.orig = 'done';
              }

              const prevLogs = base.logs;
              const nextLogs =
                msg && prevLogs[prevLogs.length - 1] !== msg ? [...prevLogs.slice(-14), msg] : prevLogs;
              return {
                percent: evt.percent ?? base.percent,
                stage: evt.stage || base.stage,
                message: msg || base.message,
                agentStates: nextStates,
                logs: nextLogs,
              };
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
          setExamProgress((prev) =>
            prev ? { ...prev, percent: 0, message: '已确认打断并终止试卷生成任务' } : null
          );
        } else {
          handleEngineError(e?.message || '试卷四子 Agent 生成失败', run);
        }
      } finally {
        if (generateAbortRef.current === controller) generateAbortRef.current = null;
        setGenerating(false);
        setTimeout(() => setExamProgress(null), 1500);
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
    setExamProgress((prev) => (prev ? { ...prev, percent: 0, message: '已打断并终止后台试卷生成任务' } : null));
    setTimeout(() => {
      setProgressInfo(null);
      setExamProgress(null);
    }, 2000);
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
      return [{ value: 'workflow', label: uploadMode === 'exam_paper' ? '① 上传试卷 (强制 OXR)' : '① 资料上传与 OCR' }];
    }
    if (!studyPackage) {
      if (documentIr.project_type === 'exam_paper') {
        return [{ value: 'workflow', label: '② 试卷 OXR 与四子 Agent 组卷' }];
      }
      return [{ value: 'workflow', label: workflowStep === 2 ? '② OCR 识别与显存配置' : '③ 选择 A/B/C 场景与参数' }];
    }

    const isExamMode =
      documentIr.project_type === 'exam_paper' || Boolean(studyPackage.exam_pipeline_metadata);

    if (isExamMode) {
      const opts: SegmentedOption<MainViewKey>[] = [
        { value: 'notes', label: '知识点提取与讲解' },
      ];
      const allPapers = [studyPackage.quiz_paper, ...(studyPackage.extra_quiz_papers || [])].filter(Boolean);
      const hasSimilar = allPapers.some(
        (p) => p.paper_id === 'similar_style_paper' && (p.questions?.length || 0) > 0
      );
      const hasOriginal = allPapers.some(
        (p) => p.paper_id === 'original_exam_bank' && (p.questions?.length || 0) > 0
      );
      if (hasSimilar) {
        opts.push({ value: 'quiz_similar', label: '变式卷' });
      }
      if (hasOriginal) {
        opts.push({ value: 'quiz_original', label: '原卷' });
      }
      return opts;
    }

    return [
      { value: 'notes', label: '讲义 / 知识提取' },
      { value: 'quiz', label: '在线练习卡片' },
      { value: 'flashcards', label: '知识点闪卡' },
      { value: 'cheatsheet', label: '考前速记' },
      { value: 'mindmap', label: 'MindMap' },
    ];
  }, [documentIr, studyPackage, workflowStep, uploadMode]);

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
                  v1.1.0
                </span>
              </div>
              <div className="text-[11px] truncate" style={{ color: 'var(--text-secondary)' }}>
                {documentIr ? documentIr.filename : 'AI 智能学习资料与互动练习系统'}
              </div>
            </div>
          </div>

          <div data-tour-id="topbar-views" className="hidden md:flex items-center">
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
              data-tour-id="visual-mode-btn"
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
              title="新手指引"
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

            <span data-tour-id="settings-btn" className="inline-flex">
              <SpringButton
                springLabel="打开完整设置"
                onClick={() => setConfigOpen(true)}
                className="px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1"
                style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
              >
                <Settings className="w-3.5 h-3.5" />
                <span>设置</span>
              </SpringButton>
            </span>
          </div>
        </header>

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
              data-tour-id="upload-panel"
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
                onUploadExamFile={handleUploadExamFile}
                onLoadDemoExam={handleLoadDemoExam}
                uploadMode={uploadMode}
                onChangeUploadMode={setUploadMode}
                uploading={uploading}
                projects={projects}
                onOpenProject={handleOpenProject}
                onDeleteProject={handleDeleteProject}
                hasStudyPackage={Boolean(studyPackage)}
                isWorkflowActive={activeMainView === 'workflow'}
                onReconfigureGenerate={() => {
                  setActiveMainView('workflow');
                  if (documentIr?.project_type !== 'exam_paper') setWorkflowStep(3);
                }}
                onBackToStudio={() => {
                  if (studyPackage) autoSwitchTabForPackage(studyPackage);
                }}
              />
            </aside>
          )}

          <main data-tour-id="main-workspace" className="flex-1 min-w-0 h-full overflow-y-auto p-5 sm:p-7">
            {!documentIr && !ocrProgress?.active ? (
              <div
                data-glass-panel="true"
                className="asg-card max-w-[880px] mx-auto mt-6 p-7 sm:p-8 space-y-6"
              >
                <div className="text-center space-y-2.5">
                  <div className="w-13 h-13 rounded-2xl mx-auto flex items-center justify-center bg-[#EDF2FF] text-[#3B5BDB]">
                    <BookOpen className="w-7 h-7" />
                  </div>
                  <div className="flex items-center justify-center gap-2">
                    <h1 className="text-2xl font-bold">Auto Study Guidance</h1>
                    <span
                      className="text-xs font-mono px-2 py-0.5 rounded-full font-bold"
                      style={{ backgroundColor: 'var(--brand-tint)', color: '#3B5BDB' }}
                    >
                      v1.1.0
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed max-w-2xl mx-auto" style={{ color: 'var(--text-secondary)' }}>
                    请选择初始入口：上传日常教材/课件进行三场景导学备考，或直接上传真题/模拟试卷启用强制 OXR 识别与四子 Agent 协同命制同源风格卷。
                  </p>
                </div>

                {/* Hidden file inputs for direct peer entry cards */}
                <input
                  ref={coursewareWelcomeInputRef}
                  type="file"
                  className="hidden"
                  accept=".pdf,.pptx,.docx,.epub,.md,.txt,.png,.jpg,.jpeg,.webp"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUploadFile(f);
                    e.target.value = '';
                  }}
                />
                <input
                  ref={examWelcomeInputRef}
                  type="file"
                  className="hidden"
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.bmp,.tiff"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUploadExamFile(f);
                    e.target.value = '';
                  }}
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
                  {/* Peer Entry 1: Courseware / PDF / PPTX */}
                  <div
                    className="p-5 rounded-2xl border flex flex-col justify-between gap-4 transition"
                    style={{
                      borderColor: uploadMode === 'courseware' ? '#3B5BDB' : 'var(--border-default)',
                      backgroundColor: 'var(--bg-subtle)',
                    }}
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                          <BookOpen className="w-4 h-4 text-[#3B5BDB]" />
                          上传教材 / 课件 (PDF / PPTX)
                        </span>
                        <span
                          className="text-[10.5px] px-2 py-0.5 rounded-full font-semibold"
                          style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-secondary)' }}
                        >
                          A/B/C 三场景
                        </span>
                      </div>
                      <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                        支持 PDF、PPTX、Word、Markdown 与图片讲义。自动分章节 OCR 提取并按「入门自学 / 巩固提高 / 考前抱佛脚」生成讲义、题库、速记与思维导图。
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <SpringButton
                        springLabel="选择课件上传"
                        disabled={uploading}
                        onClick={() => {
                          setUploadMode('courseware');
                          coursewareWelcomeInputRef.current?.click();
                        }}
                        className="px-4 py-2 rounded-xl text-xs font-bold text-white flex items-center gap-1.5"
                        style={{ backgroundColor: '#3B5BDB' }}
                      >
                        <UploadCloud className="w-3.5 h-3.5" />
                        <span>选择课件上传</span>
                      </SpringButton>
                      <SpringButton
                        springLabel="载入示例课件"
                        disabled={uploading}
                        onClick={handleLoadDemo}
                        className="px-3.5 py-2 rounded-xl text-xs font-semibold border flex items-center gap-1.5"
                        style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
                      >
                        <Sparkles className="w-3.5 h-3.5 text-[#3B5BDB]" />
                        <span>载入示例课件</span>
                      </SpringButton>
                    </div>
                  </div>

                  {/* Peer Entry 2: Upload Exam Paper (Forced OXR + 4 Agents a/b/c/d) */}
                  <div
                    className="p-5 rounded-2xl border flex flex-col justify-between gap-4 transition"
                    style={{
                      borderColor: uploadMode === 'exam_paper' ? '#3B5BDB' : 'var(--border-default)',
                      backgroundColor: 'var(--bg-subtle)',
                    }}
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                          <ShieldCheck className="w-4 h-4 text-[#2B8A3E]" />
                          上传试卷 (强制 OXR)
                        </span>
                        <span
                          className="text-[10.5px] px-2 py-0.5 rounded-full font-semibold"
                          style={{ backgroundColor: 'var(--brand-tint)', color: '#3B5BDB' }}
                        >
                          四子 Agent a/b/c/d
                        </span>
                      </div>
                      <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                        仅只读探查本地 OXR，无则直连云端 OXR 扫描试卷文本层；可选生成原卷在线题库与解析、四子 Agent（a 风格指纹 → b 蓝图 → c 逆向命题 ⇄ d 盲测打回）或两项都要。
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <SpringButton
                        springLabel="选择试卷上传"
                        disabled={uploading}
                        onClick={() => {
                          setUploadMode('exam_paper');
                          examWelcomeInputRef.current?.click();
                        }}
                        className="px-4 py-2 rounded-xl text-xs font-bold text-white flex items-center gap-1.5"
                        style={{ backgroundColor: '#2B8A3E' }}
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>选择试卷上传</span>
                      </SpringButton>
                      <SpringButton
                        springLabel="载入示例试卷"
                        disabled={uploading}
                        onClick={handleLoadDemoExam}
                        className="px-3.5 py-2 rounded-xl text-xs font-semibold border flex items-center gap-1.5"
                        style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
                      >
                        <Sparkles className="w-3.5 h-3.5 text-[#3B5BDB]" />
                        <span>载入示例试卷</span>
                      </SpringButton>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-center pt-1">
                  <SpringButton
                    springLabel="系统设置"
                    onClick={() => setConfigOpen(true)}
                    className="px-4 py-2 rounded-xl text-xs font-bold border flex items-center gap-1.5"
                    style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-subtle)' }}
                  >
                    <Settings className="w-3.5 h-3.5 text-[#3B5BDB]" />
                    <span>系统设置（AI 出题引擎 · 显存分级 OCR · Liquid Glass）</span>
                  </SpringButton>
                </div>
              </div>
            ) : activeMainView === 'workflow' || !studyPackage ? (
              documentIr?.project_type === 'exam_paper' || (ocrProgress?.active && uploadMode === 'exam_paper') ? (
                <ExamPaperWorkbench
                  documentIr={documentIr}
                  ocrProgress={ocrProgress}
                  providerStatus={providerStatus}
                  generating={generating}
                  examProgress={examProgress}
                  onGenerateExam={handleGenerateExam}
                  onCancelGenerate={handleCancelGenerate}
                  onOpenSettings={() => setConfigOpen(true)}
                />
              ) : (
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
              )
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
          optics={optics}
          onChangeOptics={handleChangeOptics}
        />

        <OnboardingGuideModal
          open={onboardingOpen}
          onClose={() => setOnboardingOpen(false)}
          onOpenFullConfig={() => setConfigOpen(true)}
          onLoadDemo={handleLoadDemo}
          onEnsureSidebarOpen={() => setSidebarOpen(true)}
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
