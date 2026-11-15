import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  CheckSquare,
  FileText,
  FolderOpen,
  Pencil,
  Plus,
  RotateCcw,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { DocumentIR, ProjectSummary } from '../types';
import { SpringButton } from '../utils/springPhysics';

interface Props {
  documentIr: DocumentIR | null;
  selectedChapterIds: string[];
  onToggleChapter: (chapterId: string) => void;
  onSelectAllChapters: (all: boolean) => void;
  projects: ProjectSummary[];
  onOpenProject: (projectId: string) => void;
  onDeleteProject: (projectId: string, e: React.MouseEvent) => void;
  /** 回到初始界面，新建另一份资料 */
  onNewWorkspace: () => void;
  /** 修改工作区显示名（空字符串表示回退为文件名） */
  onRenameProject: (projectId: string, title: string) => void | Promise<void>;
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
  projects,
  onOpenProject,
  onDeleteProject,
  onNewWorkspace,
  onRenameProject,
  hasStudyPackage,
  isWorkflowActive,
  onReconfigureGenerate,
  onBackToStudio,
}) => {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (renamingId) inputRef.current?.focus();
  }, [renamingId]);

  const startRename = (project: ProjectSummary, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingId(project.project_id);
    setRenameValue(project.workspace_title || project.filename);
  };

  const commitRename = async (projectId: string) => {
    const next = renameValue.trim();
    setRenamingId(null);
    await onRenameProject(projectId, next);
  };

  const cancelRename = () => setRenamingId(null);

  return (
    <div className="space-y-4">
      {/* Chapter Scope Checklist */}
      {documentIr && (
        <div data-glass-panel="true" className="asg-card p-3.5 space-y-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-bold truncate" title={documentIr.filename}>
                {documentIr.workspace_title || documentIr.filename}
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

      {/* Workspaces */}
      <div data-glass-panel="true" className="asg-card p-3.5 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-bold flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
            <FolderOpen className="w-3.5 h-3.5 text-[#3B5BDB]" />
            工作区
            {projects.length > 0 && <span style={{ color: 'var(--text-muted)' }}>({projects.length})</span>}
          </span>
          <button
            type="button"
            onClick={onNewWorkspace}
            title="新建工作区"
            aria-label="新建工作区"
            className="w-6 h-6 rounded-lg border flex items-center justify-center transition hover:opacity-80"
            style={{ borderColor: '#3B5BDB', color: '#3B5BDB', backgroundColor: 'var(--brand-tint)' }}
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {projects.length === 0 ? (
          <button
            type="button"
            onClick={onNewWorkspace}
            className="w-full py-2.5 rounded-lg border border-dashed text-[11px] font-medium transition hover:opacity-80"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
          >
            还没有工作区，点击新建一份资料
          </button>
        ) : (
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {projects.map((p) => {
              const isCurrent = documentIr?.project_id === p.project_id;
              const isRenaming = renamingId === p.project_id;
              return (
                <div
                  key={p.project_id}
                  onClick={() => {
                    if (!isRenaming) onOpenProject(p.project_id);
                  }}
                  className="p-2 rounded-lg border cursor-pointer flex items-center justify-between gap-2 transition"
                  style={{
                    borderColor: isCurrent ? '#3B5BDB' : 'var(--border-default)',
                    backgroundColor: isCurrent ? 'var(--brand-tint)' : 'var(--bg-subtle)',
                  }}
                >
                  <div className="min-w-0 flex-1">
                    {isRenaming ? (
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <input
                          ref={inputRef}
                          value={renameValue}
                          maxLength={60}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename(p.project_id);
                            if (e.key === 'Escape') cancelRename();
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="min-w-0 flex-1 px-1.5 py-0.5 rounded border text-[11.5px] font-semibold outline-none"
                          style={{
                            borderColor: '#3B5BDB',
                            backgroundColor: 'var(--bg-surface)',
                            color: 'var(--text-primary)',
                          }}
                        />
                        <button
                          type="button"
                          title="保存"
                          onClick={(e) => {
                            e.stopPropagation();
                            commitRename(p.project_id);
                          }}
                          className="p-1 rounded hover:bg-[#3B5BDB]/10 text-[#3B5BDB]"
                        >
                          <Check className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          title="取消"
                          onClick={(e) => {
                            e.stopPropagation();
                            cancelRename();
                          }}
                          className="p-1 rounded hover:bg-black/5"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <div className="text-[11.5px] font-semibold truncate flex items-center gap-1">
                        <FileText className="w-3 h-3 shrink-0 text-[#3B5BDB]" />
                        <span className="truncate" title={p.workspace_title ? `${p.workspace_title}（${p.filename}）` : p.filename}>
                          {p.workspace_title || p.filename}
                        </span>
                        {p.project_type === 'exam_paper' && (
                          <span
                            className="text-[9.5px] px-1 py-0.2 rounded font-bold shrink-0"
                            style={{ backgroundColor: 'var(--brand-tint)', color: '#3B5BDB' }}
                          >
                            试卷
                          </span>
                        )}
                      </div>
                    )}
                    <div className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>
                      {p.project_type === 'exam_paper' ? 'OXR 试卷 · ' : ''}
                      {p.chapter_count} 章 · {p.has_package ? '已生成资料' : '待生成'}
                    </div>
                  </div>
                  {!isRenaming && (
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => startRename(p, e)}
                        className="p-1 rounded hover:bg-[#3B5BDB]/10 text-[#3B5BDB]"
                        title="重命名工作区"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => onDeleteProject(p.project_id, e)}
                        className="p-1 rounded hover:bg-rose-500/10 text-rose-500"
                        title="删除项目"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
