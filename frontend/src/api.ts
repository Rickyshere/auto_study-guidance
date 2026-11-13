import {
  GpuVramInfo,
  OcrEngineStatusItem,
  OcrEngineType,
  PresetTemplate,
  ProjectDetailResponse,
  ProjectSummary,
  ProviderStatusResponse,
  RouterSettings,
  StudyBlueprint,
  StudyPackage,
  UpdateStatusResponse,
} from './types';

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

  uploadDocument: async (file: File, defaultPresetId = 'self_study_guide') => {
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

  deleteProject: (projectId: string) =>
    requestJson<{ status: string }>(`/api/projects/${projectId}`, { method: 'DELETE' }),

  revokeStudyPackage: (projectId: string) =>
    requestJson<{ status: string; blueprint?: StudyBlueprint | null }>(
      `/api/projects/${encodeURIComponent(projectId)}/package`,
      { method: 'DELETE' }
    ),

  getUpdateStatus: (fetchRemote = false) =>
    requestJson<UpdateStatusResponse>(
      `/api/system/update-status?fetch=${fetchRemote ? 'true' : 'false'}`
    ),

  pullUpdateStream: (
    rebuildFrontend: boolean,
    onProgress: (evt: StreamProgressEvent) => void
  ) =>
    postSseStream<{
      ok: boolean;
      updated?: boolean;
      message: string;
      status?: UpdateStatusResponse;
    }>('/api/system/pull-update', { rebuild_frontend: rebuildFrontend }, onProgress),

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

  getExportPdfUrl: (
    projectId: string,
    opts: {
      doc_type: 'quiz' | 'study_guide' | 'cheatsheet';
      paper_size: 'a4' | 'a3';
      include_answers: boolean;
    }
  ) =>
    `/api/projects/${encodeURIComponent(projectId)}/export-pdf?doc_type=${encodeURIComponent(
      opts.doc_type
    )}&paper_size=${encodeURIComponent(opts.paper_size)}&include_answers=${opts.include_answers}`,

  exportPdf: async (
    projectId: string,
    opts: {
      doc_type: 'quiz' | 'study_guide' | 'cheatsheet';
      paper_size: 'a4' | 'a3';
      include_answers: boolean;
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
