import {
  CloudConfig,
  ExamDirectionType,
  ExamSoulSpec,
  FreeAiAuthConfig,
  GpuVramInfo,
  OcrEngineStatusItem,
  OcrEngineType,
  PresetTemplate,
  ProjectDetailResponse,
  ProjectSummary,
  ProviderStatusResponse,
  ProviderType,
  QuizPaper,
  QuizQuestion,
  RouterSettings,
  StudyBlueprint,
  StudyPackage,
  UpdateStatusResponse,
} from './types';

export interface SseProgressEvent {
  type: 'progress' | 'complete' | 'error' | 'cancelled' | 'log' | 'done';
  stage?: string;
  percent?: number;
  progress?: number;
  message?: string;
  agent_id?: string;
  soul_file?: string;
  detail_data?: Record<string, any>;
  ok?: boolean;
  package?: StudyPackage;
  detail?: ProjectDetailResponse;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let msg = `请求失败 (${res.status})`;
    try {
      const data = await res.json();
      if (data.detail) msg = data.detail;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return res.json();
}

export interface StreamProgressEvent {
  type: 'progress' | 'complete' | 'error';
  percent: number;
  stage: string;
  message: string;
  log_line?: string;
  result?: any;
}

async function postSseStream<T>(
  url: string,
  body: Record<string, unknown>,
  onProgress: (evt: StreamProgressEvent) => void
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, stream: true }),
  });
  if (!res.ok) {
    throw new Error(`流式请求失败 (${res.status})`);
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json') || !res.body) {
    const json = (await res.json()) as any;
    onProgress({
      type: 'complete',
      percent: 100,
      stage: json?.ok ? '✓ 操作完成' : '操作结束',
      message: json?.message || '操作已完成',
      log_line: json?.log || '',
      result: json,
    });
    return json as T;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let finalResult: T | null = null;

  const consumeChunk = (part: string) => {
    for (const rawLine of part.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const jsonStr = line.replace(/^data:\s*/, '');
      if (!jsonStr) continue;
      try {
        const evt = JSON.parse(jsonStr) as StreamProgressEvent;
        onProgress(evt);
        if (evt.type === 'complete' && evt.result !== undefined) {
          finalResult = evt.result as T;
        } else if (evt.type === 'error') {
          throw new Error(evt.message || '执行出错');
        }
      } catch (err) {
        if (err instanceof Error && err.message !== 'Unexpected end of JSON input') {
          throw err;
        }
      }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() || '';
    for (const part of parts) {
      consumeChunk(part);
    }
  }
  if (buffer.trim()) {
    consumeChunk(buffer);
  }
  if (!finalResult) {
    throw new Error('操作已结束但未返回最终结果');
  }
  return finalResult;
}

export interface NoteSectionsResponse {
  notes_fingerprint: string;
  sections: {
    section_id: string;
    title: string;
    level: number;
    char_count: number;
    has_practice: boolean;
  }[];
}

export const api = {
  getProviderStatus: () => requestJson<ProviderStatusResponse>('/api/providers/status'),

  saveProviderSettings: (settings: RouterSettings) =>
    requestJson<RouterSettings>('/api/providers/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    }),

  testProvider: (provider: string) =>
    requestJson<{ ok: boolean; provider: string; label?: string; sample_response?: string; error?: string }>(
      '/api/providers/test',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      }
    ),

  detectOcrVram: (vramOverrideGb?: number | null) => {
    const qs =
      vramOverrideGb !== undefined && vramOverrideGb !== null
        ? `?vram_override_gb=${encodeURIComponent(vramOverrideGb)}`
        : '';
    return requestJson<{ gpu_vram: GpuVramInfo; ocr_engines: OcrEngineStatusItem[] }>(
      `/api/ocr/vram-detect${qs}`
    );
  },

  setupOcrEngine: (engineId: OcrEngineType, action = 'install_and_start') =>
    requestJson<{
      ok: boolean;
      engine_id: OcrEngineType;
      installed: boolean;
      running: boolean;
      message: string;
      log: string;
    }>('/api/ocr/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engine_id: engineId, action }),
    }),

  setupOcrEngineStream: (
    engineId: OcrEngineType,
    action: 'install_and_start' | 'install' | 'uninstall',
    onProgress: (evt: StreamProgressEvent) => void
  ) =>
    postSseStream<{
      ok: boolean;
      engine_id: OcrEngineType;
      installed: boolean;
      running: boolean;
      message: string;
      log: string;
    }>('/api/ocr/setup', { engine_id: engineId, action }, onProgress),

  manageHarnessStream: (
    cliName: string,
    action: 'install' | 'uninstall',
    onProgress: (evt: StreamProgressEvent) => void
  ) =>
    postSseStream<{
      ok: boolean;
      cli_name: string;
      available: boolean;
      executable_path?: string | null;
      message: string;
      log: string;
    }>('/api/harnesses/install', { cli_name: cliName, action }, onProgress),

  installHarness: (cliName: string) =>
    requestJson<{
      ok: boolean;
      cli_name: string;
      available: boolean;
      executable_path?: string | null;
      message: string;
      log: string;
    }>('/api/harnesses/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cli_name: cliName }),
    }),

  getPresets: () => requestJson<PresetTemplate[]>('/api/presets'),

  listProjects: () => requestJson<ProjectSummary[]>('/api/projects'),

  uploadDocument: async (file: File, defaultPresetId = 'A_beginner') => {
    const form = new FormData();
    form.append('file', file);
    form.append('default_preset_id', defaultPresetId);
    return requestJson<ProjectDetailResponse>('/api/projects/upload', {
      method: 'POST',
      body: form,
    });
  },

  loadDemoProject: () =>
    requestJson<ProjectDetailResponse>('/api/projects/demo', { method: 'POST' }),

  getProjectDetail: (projectId: string) =>
    requestJson<ProjectDetailResponse>(`/api/projects/${projectId}`),

  /** 讲义小节列表（分节练习导航用） */
  getNoteSections: (projectId: string) =>
    requestJson<NoteSectionsResponse>(`/api/projects/${encodeURIComponent(projectId)}/sections`),

  /** 生成/取出某一节的分节练习（同一节同一份讲义只生成一次） */
  createSectionPractice: (projectId: string, sectionId: string) =>
    requestJson<{ paper: QuizPaper; cached: boolean }>(
      `/api/projects/${encodeURIComponent(projectId)}/section-practice`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section_id: sectionId }),
      }
    ),

  deleteProject: (projectId: string) =>
    requestJson<{ status: string }>(`/api/projects/${projectId}`, { method: 'DELETE' }),

  renameProject: (projectId: string, title: string) =>
    requestJson<{ status: string; workspace_title: string; display_name: string }>(
      `/api/projects/${encodeURIComponent(projectId)}/rename`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      }
    ),

  revokeStudyPackage: (projectId: string) =>
    requestJson<{ status: string; blueprint?: StudyBlueprint | null }>(
      `/api/projects/${encodeURIComponent(projectId)}/package`,
      { method: 'DELETE' }
    ),

  cancelGeneration: (projectId: string) =>
    requestJson<{ status: string; project_id: string }>(
      `/api/projects/${encodeURIComponent(projectId)}/cancel`,
      { method: 'POST' }
    ),

  getUpdateStatus: (fetchRemote = false) =>
    requestJson<UpdateStatusResponse>(
      `/api/system/update-status?fetch=${fetchRemote ? 'true' : 'false'}`
    ),

  pullUpdateStream: (
    rebuildFrontend: boolean,
    onProgress: (evt: StreamProgressEvent) => void,
    options?: { installDeps?: boolean; rebuildDesktop?: boolean }
  ) =>
    postSseStream<{
      ok: boolean;
      updated?: boolean;
      message: string;
      status?: UpdateStatusResponse;
      steps?: { name: string; ok: boolean; detail: string }[];
      needs_restart?: boolean;
      exe_rebuild?: string;
    }>(
      '/api/system/pull-update',
      {
        rebuild_frontend: rebuildFrontend,
        install_deps: options?.installDeps ?? true,
        rebuild_desktop: options?.rebuildDesktop ?? true,
      },
      onProgress
    ),

  negotiateBlueprint: (
    projectId: string,
    payload: {
      preset_id?: string;
      user_prompt: string;
      current_blueprint?: StudyBlueprint | null;
    }
  ) =>
    requestJson<StudyBlueprint>(`/api/projects/${projectId}/negotiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  aiFillParams: (
    projectId: string,
    payload: {
      preset_id?: string;
      user_prompt?: string;
      current_blueprint?: StudyBlueprint | null;
    }
  ) =>
    requestJson<StudyBlueprint>(`/api/projects/${projectId}/ai-fill-params`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_prompt: '', ...payload }),
    }),

  quickGenerate: (
    projectId: string,
    payload: {
      preset_id: string;
      selected_chapter_ids?: string[];
      user_prompt?: string;
    },
    signal?: AbortSignal
  ) =>
    requestJson<StudyPackage>(`/api/projects/${projectId}/quick-generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, stream: false }),
      signal,
    }),

  generateStudyPackageStream: async (
    projectId: string,
    blueprint: StudyBlueprint,
    onProgress: (stage: string, percent: number, message: string) => void,
    signal?: AbortSignal
  ): Promise<StudyPackage> => {
    const res = await fetch(`/api/projects/${projectId}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blueprint, stream: true }),
      signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`生成请求失败 (${res.status})`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let finalPkg: StudyPackage | null = null;

    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          reader.cancel().catch(() => {});
        },
        { once: true }
      );
    }

    while (true) {
      if (signal?.aborted) {
        const abortErr = new Error('已暂停生成');
        abortErr.name = 'AbortError';
        throw abortErr;
      }
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith('data:')) continue;
        const jsonStr = line.replace(/^data:\s*/, '');
        try {
          const evt = JSON.parse(jsonStr);
          if (evt.type === 'progress') {
            onProgress(evt.stage, evt.percent, evt.message);
          } else if (evt.type === 'complete') {
            finalPkg = evt.package as StudyPackage;
          } else if (evt.type === 'error') {
            throw new Error(evt.message || '生成出错');
          }
        } catch (err) {
          if (err instanceof Error && err.message !== 'Unexpected end of JSON input') {
            throw err;
          }
        }
      }
    }
    if (!finalPkg) {
      throw new Error('流式生成未返回完整学习资料包');
    }
    return finalPkg;
  },

  setupMagpieAndDshStream: async (
    onEvent: (evt: SseProgressEvent) => void,
    gatewayUrl = 'http://127.0.0.1:3425/v1'
  ): Promise<SseProgressEvent> => {
    const res = await fetch('/api/harnesses/setup-magpie-dsh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gateway_url: gatewayUrl, stream: true }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`一键部署 Magpie + DSH 启动失败 (${res.status})`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let lastEvt: SseProgressEvent = { type: 'done', progress: 100, ok: false };
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const block of parts) {
        for (const line of block.split('\n')) {
          if (line.startsWith('data:')) {
            const evt = JSON.parse(line.slice(5).trim()) as SseProgressEvent;
            lastEvt = evt;
            onEvent(evt);
            if (evt.type === 'error') {
              throw new Error(evt.message || '安装过程异常');
            }
          }
        }
      }
    }
    return lastEvt;
  },

  authorizeFreeAi: (payload: {
    authorized: boolean;
    preferred_proxy_mode?: 'magpie_dsh' | 'direct_cli';
    selected_free_model?: string;
    magpie_gateway_url?: string;
  }) =>
    requestJson<RouterSettings>('/api/harnesses/authorize-free-ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  testProviderConnection: (payload: {
    provider: ProviderType;
    cloud_config?: CloudConfig;
    free_ai_auth?: FreeAiAuthConfig;
  }) =>
    requestJson<{ ok: boolean; provider: string; label?: string; sample_response?: string; error?: string }>(
      '/api/providers/test',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    ),

  uploadProjectStream: async (
    file: File,
    onEvent: (evt: SseProgressEvent) => void,
    defaultPresetId = 'A_beginner',
    signal?: AbortSignal
  ): Promise<ProjectDetailResponse> => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('default_preset_id', defaultPresetId);
    const res = await fetch('/api/projects/upload-stream', {
      method: 'POST',
      body: fd,
      signal,
    });
    if (!res.ok || !res.body) {
      const detail = await res.text();
      throw new Error(detail || `上传识别失败 (${res.status})`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let finalDetail: ProjectDetailResponse | null = null;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const block of parts) {
        for (const line of block.split('\n')) {
          if (line.startsWith('data:')) {
            const evt = JSON.parse(line.slice(5).trim()) as SseProgressEvent;
            onEvent(evt);
            if (evt.type === 'error') {
              throw new Error(evt.message || 'OCR 解析出错');
            }
            if (evt.type === 'complete' && evt.detail) {
              finalDetail = evt.detail;
            }
          }
        }
      }
    }
    if (!finalDetail) {
      throw new Error('文档识别流未返回完成数据');
    }
    return finalDetail;
  },

  loadDemoProjectStream: async (
    onEvent: (evt: SseProgressEvent) => void,
    signal?: AbortSignal
  ): Promise<ProjectDetailResponse> => {
    const res = await fetch('/api/projects/demo-stream', {
      method: 'POST',
      signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`装载示例课件失败 (${res.status})`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let finalDetail: ProjectDetailResponse | null = null;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const block of parts) {
        for (const line of block.split('\n')) {
          if (line.startsWith('data:')) {
            const evt = JSON.parse(line.slice(5).trim()) as SseProgressEvent;
            onEvent(evt);
            if (evt.type === 'error') {
              throw new Error(evt.message || '示例课件识别失败');
            }
            if (evt.type === 'complete' && evt.detail) {
              finalDetail = evt.detail;
            }
          }
        }
      }
    }
    if (!finalDetail) {
      throw new Error('示例课件识别流未返回完成数据');
    }
    return finalDetail;
  },

  getExamAgentSouls: () => requestJson<{ souls: ExamSoulSpec[] }>('/api/exam-agents/souls'),

  probeOxrStatus: () =>
    requestJson<{
      local_oxr_installed: boolean;
      local_oxr_running: boolean;
      local_oxr_ready: boolean;
      selected_engine: string;
      summary: string;
    }>('/api/ocr/probe-oxr'),

  uploadExamProjectStream: async (
    file: File,
    onEvent: (evt: SseProgressEvent) => void,
    signal?: AbortSignal
  ): Promise<ProjectDetailResponse> => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/projects/upload-exam-stream', {
      method: 'POST',
      body: fd,
      signal,
    });
    if (!res.ok || !res.body) {
      const detail = await res.text();
      throw new Error(detail || `试卷上传 OXR 识别失败 (${res.status})`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let finalDetail: ProjectDetailResponse | null = null;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const block of parts) {
        for (const line of block.split('\n')) {
          if (line.startsWith('data:')) {
            const evt = JSON.parse(line.slice(5).trim()) as SseProgressEvent;
            onEvent(evt);
            if (evt.type === 'error') {
              throw new Error(evt.message || '试卷 OXR 提取出错');
            }
            if (evt.type === 'complete' && evt.detail) {
              finalDetail = evt.detail;
            }
          }
        }
      }
    }
    if (!finalDetail) {
      throw new Error('试卷 OXR 提取流未返回完成数据');
    }
    return finalDetail;
  },

  loadDemoExamProjectStream: async (
    onEvent: (evt: SseProgressEvent) => void,
    signal?: AbortSignal
  ): Promise<ProjectDetailResponse> => {
    const res = await fetch('/api/projects/demo-exam-stream', {
      method: 'POST',
      signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`装载示例试卷失败 (${res.status})`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let finalDetail: ProjectDetailResponse | null = null;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const block of parts) {
        for (const line of block.split('\n')) {
          if (line.startsWith('data:')) {
            const evt = JSON.parse(line.slice(5).trim()) as SseProgressEvent;
            onEvent(evt);
            if (evt.type === 'error') {
              throw new Error(evt.message || '示例试卷提取失败');
            }
            if (evt.type === 'complete' && evt.detail) {
              finalDetail = evt.detail;
            }
          }
        }
      }
    }
    if (!finalDetail) {
      throw new Error('示例试卷提取流未返回完成数据');
    }
    return finalDetail;
  },

  generateExamPackageStream: async (
    projectId: string,
    payload: {
      direction: ExamDirectionType;
      user_requirements: string;
      raw_exam_text_override?: string;
    },
    onEvent: (evt: {
      stage: string;
      percent: number;
      message: string;
      agent_id?: string;
      soul_file?: string;
      detail?: Record<string, any>;
    }) => void,
    signal?: AbortSignal
  ): Promise<StudyPackage> => {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/generate-exam`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, stream: true }),
      signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`试卷生成请求失败 (${res.status})`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let finalPkg: StudyPackage | null = null;

    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          reader.cancel().catch(() => {});
        },
        { once: true }
      );
    }

    while (true) {
      if (signal?.aborted) {
        const abortErr = new Error('已暂停生成');
        abortErr.name = 'AbortError';
        throw abortErr;
      }
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith('data:')) continue;
        const jsonStr = line.replace(/^data:\s*/, '');
        try {
          const evt = JSON.parse(jsonStr);
          if (evt.type === 'progress') {
            onEvent({
              stage: String(evt.stage || ''),
              percent: Number(evt.percent ?? 10),
              message: String(evt.message || ''),
              agent_id: evt.agent_id,
              soul_file: evt.soul_file,
              detail: evt.detail,
            });
          } else if (evt.type === 'complete') {
            finalPkg = evt.package as StudyPackage;
          } else if (evt.type === 'error') {
            throw new Error(evt.message || '试卷生成出错');
          }
        } catch (err) {
          if (err instanceof Error && err.message !== 'Unexpected end of JSON input') {
            throw err;
          }
        }
      }
    }
    if (!finalPkg) {
      throw new Error('试卷生成流未返回完整结果包');
    }
    return finalPkg;
  },

  generateVariantQuestion: (
    projectId: string,
    sourceQuestion: QuizQuestion,
    selectedChapterIds: string[]
  ) =>
    requestJson<{ question: QuizQuestion }>(`/api/projects/${encodeURIComponent(projectId)}/variant-question`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_question: sourceQuestion,
        selected_chapter_ids: selectedChapterIds,
      }),
    }),

  getExportPdfUrl: (
    projectId: string,
    opts: {
      doc_type: 'quiz' | 'study_guide' | 'cheatsheet';
      paper_size: 'a4' | 'a3';
      include_answers: boolean;
      paper_id?: string;
    }
  ) =>
    `/api/projects/${encodeURIComponent(projectId)}/export-pdf?doc_type=${encodeURIComponent(
      opts.doc_type
    )}&paper_size=${encodeURIComponent(opts.paper_size)}&include_answers=${opts.include_answers}${
      opts.paper_id ? `&paper_id=${encodeURIComponent(opts.paper_id)}` : ''
    }`,

  exportPdf: async (
    projectId: string,
    opts: {
      doc_type: 'quiz' | 'study_guide' | 'cheatsheet';
      paper_size: 'a4' | 'a3';
      include_answers: boolean;
      paper_id?: string;
      fallbackFilename?: string;
    }
  ): Promise<void> => {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/export-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        doc_type: opts.doc_type,
        paper_size: opts.paper_size,
        include_answers: opts.include_answers,
        paper_id: opts.paper_id,
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(detail || `PDF 导出失败 (${res.status})`);
    }
    const blob = await res.blob();
    let filename = opts.fallbackFilename || `study_export_${opts.paper_size}.pdf`;
    const disp = res.headers.get('Content-Disposition') || '';
    const utf8Match = disp.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match && utf8Match[1]) {
      try {
        filename = decodeURIComponent(utf8Match[1]);
      } catch {
        // fallback to default filename
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  },
};
