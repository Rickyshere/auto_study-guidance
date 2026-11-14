import React, { useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  CheckSquare,
  FileText,
  FolderOpen,
  Loader2,
  RotateCcw,
  ShieldCheck,
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
  onUploadExamFile?: (file: File) => Promise<void>;
  onLoadDemoExam?: () => Promise<void>;
  uploadMode?: 'courseware' | 'exam_paper';
  onChangeUploadMode?: (mode: 'courseware' | 'exam_paper') => void;
  uploading: boolean;
  projects: ProjectSummary[];
  onOpenProject: (projectId: string) => void;
  onDeleteProject: (projectId: string, e: React.MouseEvent) => void;
  hasStudyPackage?: boolean;
  isWorkflowActive?: boolean;
  onReconfigureGenerate?: () => void;
  onBackToStudio?: () => void;
}

export const UploadAndTocPanel: React.FC<Props> = ({
  documentIr,
  selectedChapterIds,
  onToggleChapter,
  onSelectAllChapters,
  onUploadFile,
  onLoadDemo,
  onUploadExamFile,
  onLoadDemoExam,
  uploadMode,
  onChangeUploadMode,
  uploading,
  projects,
  onOpenProject,
  onDeleteProject,
  hasStudyPackage,
  isWorkflowActive,
  onReconfigureGenerate,
  onBackToStudio,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [localUploadMode, setLocalUploadMode] = useState<'courseware' | 'exam_paper'>('courseware');
  const effectiveUploadMode = uploadMode ?? localUploadMode;

  const setMode = (mode: 'courseware' | 'exam_paper') => {
    setLocalUploadMode(mode);
    onChangeUploadMode?.(mode);
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (effectiveUploadMode === 'exam_paper' && onUploadExamFile) {
      await onUploadExamFile(files[0]);
      return;
    }
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
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
            <UploadCloud className="w-4 h-4 text-[#3B5BDB]" />
            {effectiveUploadMode === 'exam_paper' ? '上传试卷' : '资料上传'}
          </span>
          <span
            className="text-[10.5px] px-2 py-0.5 rounded-full font-semibold"
            style={{
              backgroundColor: effectiveUploadMode === 'exam_paper' ? 'var(--brand-tint)' : 'var(--bg-subtle)',
              color: effectiveUploadMode === 'exam_paper' ? '#3B5BDB' : 'var(--text-secondary)',
            }}
          >
            {effectiveUploadMode === 'exam_paper' ? '强制 OXR' : 'PDF / PPTX / 图片'}
          </span>
        </div>

        {/* Peer Entry Mode Switcher */}
        <div
          className="grid grid-cols-2 gap-1 p-1 rounded-xl border"
          style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-subtle)' }}
        >
          <button
            type="button"
            disabled={uploading}
            onClick={() => setMode('courseware')}
            className="px-2 py-1.5 rounded-lg text-[11px] font-bold transition flex items-center justify-center gap-1"
            style={{
              backgroundColor: effectiveUploadMode === 'courseware' ? 'var(--bg-surface)' : 'transparent',
              color: effectiveUploadMode === 'courseware' ? '#3B5BDB' : 'var(--text-secondary)',
              boxShadow: effectiveUploadMode === 'courseware' ? '0 1px 2px rgba(15,23,42,0.06)' : 'none',
              cursor: uploading ? 'not-allowed' : 'pointer',
            }}
          >
            <BookOpen className="w-3 h-3" />
            <span>上传课件</span>
          </button>
          <button
            type="button"
            disabled={uploading}
            onClick={() => setMode('exam_paper')}
            className="px-2 py-1.5 rounded-lg text-[11px] font-bold transition flex items-center justify-center gap-1"
            style={{
              backgroundColor: effectiveUploadMode === 'exam_paper' ? 'var(--bg-surface)' : 'transparent',
              color: effectiveUploadMode === 'exam_paper' ? '#3B5BDB' : 'var(--text-secondary)',
              boxShadow: effectiveUploadMode === 'exam_paper' ? '0 1px 2px rgba(15,23,42,0.06)' : 'none',
              cursor: uploading ? 'not-allowed' : 'pointer',
            }}
          >
            <ShieldCheck className="w-3 h-3" />
            <span>上传试卷</span>
          </button>
        </div>

        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept={
            effectiveUploadMode === 'exam_paper'
              ? '.pdf,.png,.jpg,.jpeg,.webp,.bmp,.tiff'
              : '.pdf,.pptx,.docx,.epub,.md,.txt,.png,.jpg,.jpeg,.webp'
          }
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />

        <SpringButton
          springLabel={effectiveUploadMode === 'exam_paper' ? '上传试卷原卷' : '上传教材或课件'}
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
          {uploading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : effectiveUploadMode === 'exam_paper' ? (
            <ShieldCheck className="w-3.5 h-3.5" />
          ) : (
            <UploadCloud className="w-3.5 h-3.5" />
          )}
          <span>
            {uploading
              ? effectiveUploadMode === 'exam_paper'
                ? '正在执行强制 OXR 扫描...'
                : '正在执行 OCR 与切片...'
              : effectiveUploadMode === 'exam_paper'
              ? '选择或拖拽试卷上传 (优先本地 OXR)'
              : '选择或拖拽课件文件上传'}
          </span>
        </SpringButton>

        {effectiveUploadMode === 'exam_paper' && onLoadDemoExam ? (
          <SpringButton
            springLabel="载入示例试卷"
            disabled={uploading}
            onClick={onLoadDemoExam}
            className="w-full py-2 px-3 rounded-xl border text-xs font-medium flex items-center justify-center gap-1.5"
            style={{
              borderColor: 'var(--border-default)',
              backgroundColor: 'var(--bg-subtle)',
              color: 'var(--text-primary)',
              cursor: uploading ? 'not-allowed' : 'pointer',
            }}
          >
            <Sparkles className="w-3.5 h-3.5 text-[#3B5BDB]" />
            <span>载入示例试卷 (生理学期中卷)</span>
          </SpringButton>
        ) : (
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
        )}
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
                {documentIr.project_type === 'exam_paper' && (
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                    style={{ backgroundColor: 'var(--brand-tint)', color: '#3B5BDB' }}
                  >
                    试卷 · OXR
                  </span>
                )}
                {documentIr.ocr_applied && (
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                    style={{ backgroundColor: 'var(--semantic-success-tint)', color: 'var(--semantic-success)' }}
                  >
                    {documentIr.oxr_engine_used ? `${documentIr.oxr_engine_used} 已识别` : 'OCR 已识别'}
                  </span>
                )}
              </div>
            </div>
          </div>

          {hasStudyPackage && (
            <div className="pt-1 border-t" style={{ borderColor: 'var(--border-default)' }}>
              {isWorkflowActive && onBackToStudio ? (
                <SpringButton
                  springLabel="返回学习成果"
                  onClick={onBackToStudio}
                  className="w-full py-2 px-3 rounded-xl text-xs font-bold text-white flex items-center justify-center gap-1.5"
                  style={{ backgroundColor: '#3B5BDB' }}
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                  <span>返回已生成的学习成果</span>
                </SpringButton>
              ) : onReconfigureGenerate ? (
                <SpringButton
                  springLabel="重新配置生成"
                  onClick={onReconfigureGenerate}
                  className="w-full py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5"
                  style={{
                    borderColor: '#3B5BDB',
                    color: '#3B5BDB',
                    backgroundColor: 'var(--brand-tint)',
                  }}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>
                    {documentIr.project_type === 'exam_paper' ? '重新配置并生成试卷' : '重新配置与重新生成'}
                  </span>
                </SpringButton>
              ) : null}
            </div>
          )}

          <div className="flex items-center justify-between pt-1 border-t" style={{ borderColor: 'var(--border-default)' }}>
            <span className="text-[11px] font-bold flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
              <BookOpen className="w-3.5 h-3.5 text-[#3B5BDB]" />
              {documentIr.project_type === 'exam_paper' ? '原卷页面范围' : '练习范围'} ({selectedChapterIds.length}/{documentIr.chapters.length})
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
                      {p.project_type === 'exam_paper' && (
                        <span
                          className="text-[9.5px] px-1 py-0.2 rounded font-bold shrink-0"
                          style={{ backgroundColor: 'var(--brand-tint)', color: '#3B5BDB' }}
                        >
                          试卷
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                      {p.project_type === 'exam_paper' ? 'OXR 试卷 · ' : ''}
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
