import React, { useRef, useState } from 'react';
import {
  UploadCloud,
  FileText,
  Image as ImageIcon,
  Check,
  Sparkles,
  BookOpen,
  FolderOpen,
  Trash2,
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Card 1: Drag & Drop Uploader + 1-Click Demo */}
      <div
        style={{
          fontSize: '11px',
          fontWeight: 600,
          color: '#636366',
          paddingLeft: '4px',
        }}
      >
        教材 / 课件导入
      </div>

      <div
        style={{
          backgroundColor: '#FFFFFF',
          borderRadius: '14px',
          border: '1px solid rgba(60, 60, 67, 0.08)',
          boxShadow: '0 2px 8px -4px rgba(0, 0, 0, 0.04)',
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        <div
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
          onClick={() => inputRef.current?.click()}
          style={{
            cursor: 'pointer',
            borderRadius: '11px',
            border: dragActive ? '1.5px dashed #007AFF' : '1.5px dashed rgba(60, 60, 67, 0.22)',
            backgroundColor: dragActive ? 'rgba(0, 122, 255, 0.06)' : '#F9F9FB',
            padding: '14px 10px',
            textAlign: 'center',
          }}
        >
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept=".pdf,.pptx,.ppt,.docx,.epub,.md,.txt,.png,.jpg,.jpeg,.webp"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <UploadCloud
            style={{
              width: '26px',
              height: '26px',
              margin: '0 auto',
              color: '#007AFF',
            }}
          />
          <p
            style={{
              marginTop: '6px',
              fontSize: '12px',
              fontWeight: 600,
              color: '#1C1C1E',
            }}
          >
            {uploading ? '正在解析并切分章节目录...' : '拖拽或点击导入课本 / PPTX'}
          </p>
          <p
            style={{
              marginTop: '3px',
              fontSize: '10.5px',
              color: '#636366',
              lineHeight: 1.45,
            }}
          >
            PDF (OCR) · PPTX · DOCX · EPUB · MD · 图片
          </p>
        </div>

        <SpringButton
          springLabel="加载示例课件"
          disabled={uploading}
          onClick={onLoadDemo}
          maxShift={6}
          style={{
            width: '100%',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            borderRadius: '10px',
            border: '1px solid rgba(0, 122, 255, 0.22)',
            backgroundColor: 'rgba(0, 122, 255, 0.08)',
            color: '#007AFF',
            fontSize: '11.5px',
            fontWeight: 600,
            padding: '8px 10px',
            cursor: uploading ? 'not-allowed' : 'pointer',
            opacity: uploading ? 0.6 : 1,
          }}
        >
          <Sparkles className="w-3.5 h-3.5 shrink-0" />
          <span>{uploading ? '加载解析中...' : '一键加载示例 PPTX 课件'}</span>
        </SpringButton>
      </div>

      {/* Card 2: Parsed DocumentIR & Chapter Checklist */}
      {documentIr && (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingLeft: '4px',
              marginTop: '2px',
            }}
          >
            <span style={{ fontSize: '11px', fontWeight: 600, color: '#636366' }}>
              章节与范围 ({selectedChapterIds.length}/{documentIr.chapters.length})
            </span>
            <div style={{ display: 'flex', gap: '6px' }}>
              <SpringButton
                springLabel="全选章节"
                onClick={() => onSelectAllChapters(true)}
                maxShift={4}
                style={{
                  border: 'none',
                  background: 'transparent',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#007AFF',
                  cursor: 'pointer',
                  padding: '2px 4px',
                }}
              >
                全选
              </SpringButton>
              <SpringButton
                springLabel="清空章节"
                onClick={() => onSelectAllChapters(false)}
                maxShift={4}
                style={{
                  border: 'none',
                  background: 'transparent',
                  fontSize: '11px',
                  fontWeight: 500,
                  color: '#8E8E93',
                  cursor: 'pointer',
                  padding: '2px 4px',
                }}
              >
                清空
              </SpringButton>
            </div>
          </div>

          <div
            style={{
              backgroundColor: '#FFFFFF',
              borderRadius: '14px',
              border: '1px solid rgba(60, 60, 67, 0.08)',
              boxShadow: '0 2px 8px -4px rgba(0, 0, 0, 0.04)',
              overflow: 'hidden',
            }}
          >
            {/* Document Metadata Header */}
            <div
              style={{
                padding: '10px 12px',
                borderBottom: '1px solid rgba(60, 60, 67, 0.1)',
                backgroundColor: '#FAFAFC',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '12px',
                  fontWeight: 700,
                  color: '#1C1C1E',
                }}
              >
                <BookOpen className="w-3.5 h-3.5 text-[#007AFF] shrink-0" />
                <span className="truncate">{documentIr.filename}</span>
              </div>
              <div
                className="mac-sp-tabular"
                style={{
                  marginTop: '5px',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '6px',
                  fontSize: '10.5px',
                  color: '#636366',
                }}
              >
                <span
                  style={{
                    backgroundColor: '#FFFFFF',
                    border: '1px solid rgba(60, 60, 67, 0.12)',
                    borderRadius: '5px',
                    padding: '1px 6px',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                  }}
                >
                  {documentIr.file_type}
                </span>
                <span>{documentIr.total_pages_or_slides} 页/张</span>
                <span>· {documentIr.total_chars.toLocaleString()} 字</span>
                <span>· {documentIr.all_assets.length} 图</span>
                {documentIr.ocr_applied && (
                  <span style={{ color: '#34C759', fontWeight: 600 }}>· OCR</span>
                )}
              </div>
            </div>

            {/* Chapter Rows */}
            <div style={{ maxHeight: '260px', overflowY: 'auto' }}>
              {documentIr.chapters.map((ch) => {
                const checked = selectedChapterIds.includes(ch.chapter_id);
                return (
                  <div
                    key={ch.chapter_id}
                    onClick={() => onToggleChapter(ch.chapter_id)}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '9px',
                      padding: '9px 12px',
                      borderBottom: '1px solid rgba(60, 60, 67, 0.08)',
                      cursor: 'pointer',
                      backgroundColor: checked ? 'rgba(0, 122, 255, 0.04)' : '#FFFFFF',
                    }}
                  >
                    <span
                      style={{
                        width: '16px',
                        height: '16px',
                        borderRadius: '5px',
                        marginTop: '2px',
                        flexShrink: 0,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: checked ? '#007AFF' : '#FFFFFF',
                        border: checked ? '1px solid #007AFF' : '1.5px solid #C7C7CC',
                        color: '#FFFFFF',
                      }}
                    >
                      {checked && <Check className="w-3 h-3" strokeWidth={3} />}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: '12px',
                          fontWeight: 600,
                          color: '#1C1C1E',
                          lineHeight: 1.35,
                        }}
                      >
                        {ch.title}
                      </div>
                      <div
                        className="mac-sp-tabular"
                        style={{
                          marginTop: '2px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          fontSize: '10.5px',
                          color: '#8E8E93',
                        }}
                      >
                        <span>
                          P{ch.start_page}–{ch.end_page}
                        </span>
                        <span>{ch.char_count.toLocaleString()} 字</span>
                        {ch.assets.length > 0 && (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '2px',
                              color: '#34C759',
                              fontWeight: 600,
                            }}
                          >
                            <ImageIcon className="w-3 h-3" /> {ch.assets.length}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Card 3: Extracted Assets Preview */}
          {documentIr.all_assets.length > 0 && (
            <>
              <div
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#636366',
                  paddingLeft: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
              >
                <FileText className="w-3 h-3 text-[#007AFF]" />
                原书图表资产 ({documentIr.all_assets.length})
              </div>
              <div
                style={{
                  backgroundColor: '#FFFFFF',
                  borderRadius: '14px',
                  border: '1px solid rgba(60, 60, 67, 0.08)',
                  padding: '10px',
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '8px',
                }}
              >
                {documentIr.all_assets.slice(0, 4).map((a) => (
                  <div
                    key={a.asset_id}
                    style={{
                      borderRadius: '8px',
                      border: '1px solid rgba(60, 60, 67, 0.1)',
                      overflow: 'hidden',
                      backgroundColor: '#F9F9FB',
                    }}
                  >
                    <img
                      src={a.url}
                      alt={a.caption}
                      style={{
                        height: '58px',
                        width: '100%',
                        objectFit: 'contain',
                        backgroundColor: '#FFFFFF',
                      }}
                    />
                    <div
                      className="truncate"
                      style={{
                        padding: '3px 6px',
                        fontSize: '10px',
                        color: '#636366',
                      }}
                      title={a.caption}
                    >
                      P{a.page_or_slide} · {a.caption}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* Card 4: Project History */}
      {projects.length > 0 && (
        <>
          <div
            style={{
              fontSize: '11px',
              fontWeight: 600,
              color: '#636366',
              paddingLeft: '4px',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              marginTop: '2px',
            }}
          >
            <FolderOpen className="w-3 h-3 text-[#007AFF]" />
            历史资料项目 ({projects.length})
          </div>
          <div
            style={{
              backgroundColor: '#FFFFFF',
              borderRadius: '14px',
              border: '1px solid rgba(60, 60, 67, 0.08)',
              overflow: 'hidden',
              maxHeight: '210px',
              overflowY: 'auto',
            }}
          >
            {projects.map((p) => {
              const isActive = documentIr?.project_id === p.project_id;
              return (
                <div
                  key={p.project_id}
                  onClick={() => onOpenProject(p.project_id)}
                  style={{
                    cursor: 'pointer',
                    padding: '9px 12px',
                    borderBottom: '1px solid rgba(60, 60, 67, 0.08)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                    backgroundColor: isActive ? 'rgba(0, 122, 255, 0.08)' : '#FFFFFF',
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      className="truncate"
                      style={{
                        fontSize: '12px',
                        fontWeight: isActive ? 700 : 600,
                        color: isActive ? '#007AFF' : '#1C1C1E',
                      }}
                    >
                      {p.filename}
                    </div>
                    <div
                      className="mac-sp-tabular"
                      style={{ fontSize: '10.5px', color: '#8E8E93', marginTop: '1px' }}
                    >
                      {p.chapter_count} 章 · {p.has_package ? '已生成资料' : '待确认方案'}
                    </div>
                  </div>
                  <SpringButton
                    springLabel="删除项目"
                    onClick={(e) => onDeleteProject(p.project_id, e)}
                    maxShift={4}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      padding: '4px',
                      color: '#8E8E93',
                      cursor: 'pointer',
                    }}
                    title="删除项目"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </SpringButton>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};
