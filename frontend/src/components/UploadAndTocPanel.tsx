import React, { useRef, useState } from 'react';
import {
  BookOpen,
  CheckSquare,
  FileText,
  FolderOpen,
  Loader2,
  Sparkles,
  Square,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { DocumentIR, ProjectSummary } from '../types';
import { SpringButton } from '../utils/springPhysics';

interface Props {
  documentIr: DocumentIR | null;
  selectedChapterIds: string[];
  onToggleChapter: (chapterId: string) => void;
  onSelectAllChapters: (all: boolean) => void;
  onUploadFile: (file: File) => Promise<void>;
  onLoadDemo: () => Promise<void>;
  uploading: boolean;
  projects: ProjectSummary[];
  onOpenProject: (projectId: string) => void;
  onDeleteProject: (projectId: string, e: React.MouseEvent) => void;
}

export const UploadAndTocPanel: React.FC<Props> = ({
  documentIr,
  selectedChapterIds,
  onToggleChapter,
  onSelectAllChapters,
  onUploadFile,
  onLoadDemo,
  uploading,
  projects,
  onOpenProject,
  onDeleteProject,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    await onUploadFile(files[0]);
  };

  return (
    <div className="space-y-4">
      {/* Step 1 Upload Dropzone */}
      <div
        data-glass-panel="true"
        className="asg-card p-3.5 space-y-3"
        style={{
          borderColor: dragActive ? '#3B5BDB' : 'var(--border-default)',
          backgroundColor: dragActive ? 'var(--brand-tint)' : 'var(--bg-surface)',
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
            <UploadCloud className="w-4 h-4 text-[#3B5BDB]" />
            资料上传
          </span>
          <span
            className="text-[10.5px] px-2 py-0.5 rounded-full font-semibold"
            style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}
          >
            PDF / PPTX / 图片
          </span>
        </div>

        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept=".pdf,.pptx,.docx,.epub,.md,.txt,.png,.jpg,.jpeg,.webp"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />

        <SpringButton
          springLabel="上传教材或课件"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="w-full py-2.5 px-3 rounded-xl border border-dashed text-xs font-semibold flex items-center justify-center gap-1.5"
          style={{
            borderColor: '#3B5BDB',
            color: '#3B5BDB',
            backgroundColor: 'var(--brand-tint)',
            cursor: uploading ? 'wait' : 'pointer',
          }}
        >
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
          <span>{uploading ? '正在执行 OCR 与切片...' : '选择或拖拽文件上传'}</span>
        </SpringButton>

        <SpringButton
          springLabel="加载示例PPTX"
          disabled={uploading}
          onClick={onLoadDemo}
          className="w-full py-2 px-3 rounded-xl border text-xs font-medium flex items-center justify-center gap-1.5"
          style={{
            borderColor: 'var(--border-default)',
            backgroundColor: 'var(--bg-subtle)',
            color: 'var(--text-primary)',
            cursor: uploading ? 'not-allowed' : 'pointer',
          }}
        >
          <Sparkles className="w-3.5 h-3.5 text-[#3B5BDB]" />
          <span>载入示例课件 (梯度下降讲义)</span>
        </SpringButton>
      </div>

      {/* Chapter Scope Checklist */}
      {documentIr && (
        <div data-glass-panel="true" className="asg-card p-3.5 space-y-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-bold truncate" title={documentIr.filename}>
                {documentIr.filename}
              </div>
              <div className="text-[11px] mt-0.5 flex flex-wrap items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                <span>{documentIr.total_pages_or_slides} 页/张</span>
                <span>·</span>
                <span>{documentIr.total_chars.toLocaleString()} 字</span>
                {documentIr.ocr_applied && (
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                    style={{ backgroundColor: 'var(--semantic-success-tint)', color: 'var(--semantic-success)' }}
                  >
                    OCR 已识别
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1 border-t" style={{ borderColor: 'var(--border-default)' }}>
            <span className="text-[11px] font-bold flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
              <BookOpen className="w-3.5 h-3.5 text-[#3B5BDB]" />
              练习范围 ({selectedChapterIds.length}/{documentIr.chapters.length})
            </span>
            <div className="flex items-center gap-2 text-[11px] font-semibold">
              <button type="button" onClick={() => onSelectAllChapters(true)} className="text-[#3B5BDB] hover:underline">
                全选
              </button>
              <button
                type="button"
                onClick={() => onSelectAllChapters(false)}
                style={{ color: 'var(--text-muted)' }}
                className="hover:underline"
              >
                清空
              </button>
            </div>
          </div>

          <div className="max-h-60 overflow-y-auto space-y-1.5 pr-0.5">
            {documentIr.chapters.map((ch) => {
              const checked = selectedChapterIds.includes(ch.chapter_id);
              return (
                <button
                  key={ch.chapter_id}
                  type="button"
                  onClick={() => onToggleChapter(ch.chapter_id)}
                  className="w-full text-left p-2 rounded-lg border transition flex items-start gap-2"
                  style={{
                    borderColor: checked ? '#3B5BDB' : 'var(--border-default)',
                    backgroundColor: checked ? 'var(--brand-tint)' : 'var(--bg-subtle)',
                  }}
                >
                  {checked ? (
                    <CheckSquare className="w-3.5 h-3.5 text-[#3B5BDB] shrink-0 mt-0.5" />
                  ) : (
                    <Square className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: 'var(--text-muted)' }} />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-[11.5px] font-semibold truncate">{ch.title}</div>
                    <div className="text-[10.5px]" style={{ color: 'var(--text-secondary)' }}>
                      P{ch.start_page}-{ch.end_page} · {ch.char_count} 字
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* History Projects */}
      {projects.length > 0 && (
        <div data-glass-panel="true" className="asg-card p-3.5 space-y-2">
          <div className="text-[11px] font-bold flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
            <FolderOpen className="w-3.5 h-3.5 text-[#3B5BDB]" />
            最近工作区 ({projects.length})
          </div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {projects.map((p) => {
              const isCurrent = documentIr?.project_id === p.project_id;
              return (
                <div
                  key={p.project_id}
                  onClick={() => onOpenProject(p.project_id)}
                  className="p-2 rounded-lg border cursor-pointer flex items-center justify-between gap-2 transition"
                  style={{
                    borderColor: isCurrent ? '#3B5BDB' : 'var(--border-default)',
                    backgroundColor: isCurrent ? 'var(--brand-tint)' : 'var(--bg-subtle)',
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[11.5px] font-semibold truncate flex items-center gap-1">
                      <FileText className="w-3 h-3 shrink-0 text-[#3B5BDB]" />
                      <span className="truncate">{p.filename}</span>
                    </div>
                    <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                      {p.chapter_count} 章 · {p.has_package ? '已生成资料' : '待生成'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => onDeleteProject(p.project_id, e)}
                    className="p-1 rounded hover:bg-rose-500/10 text-rose-500"
                    title="删除项目"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
