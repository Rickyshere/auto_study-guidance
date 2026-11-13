import {
  PresetTemplate,
  ProjectDetailResponse,
  ProjectSummary,
  ProviderStatusResponse,
  RouterSettings,
  StudyBlueprint,
  StudyPackage,
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

  quickGenerate: (
    projectId: string,
    payload: {
      preset_id: string;
      selected_chapter_ids?: string[];
      user_prompt?: string;
    }
  ) =>
    requestJson<StudyPackage>(`/api/projects/${projectId}/quick-generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, stream: false }),
    }),

  generateStudyPackageStream: async (
    projectId: string,
    blueprint: StudyBlueprint,
    onProgress: (stage: string, percent: number, message: string) => void
  ): Promise<StudyPackage> => {
    const res = await fetch(`/api/projects/${projectId}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blueprint, stream: true }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`生成请求失败 (${res.status})`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let finalPkg: StudyPackage | null = null;

    while (true) {
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
};
