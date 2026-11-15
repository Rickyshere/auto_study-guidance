import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  FileText,
  Loader2,
  RotateCcw,
  ScanText,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { api } from '../api';
import { DocumentIR } from '../types';
import { SpringButton } from '../utils/springPhysics';

interface Props {
  documentIr: DocumentIR | null;
  /** 用户点了「确认无误」并通过后端落库后回调 */
  onConfirmed: (updated: DocumentIR) => void;
  /** 订正正文保存成功后回调，让上层 documentIr 保持最新 */
  onDocumentChanged: (updated: DocumentIR) => void;
  /** 让用户回到上传入口重新传一份 */
  onRequestReupload: () => void;
}

/**
 * 第二步「识别结果确认」——直接是主界面的一整屏，不再是一个小弹窗。
 *
 * 上传完 OCR 后，用户必须先看到机器到底认出了什么、能不能改，确认之后才进场景选择。
 */
export const OcrReviewStep: React.FC<Props> = ({
  documentIr,
  onConfirmed,
  onDocumentChanged,
  onRequestReupload,
}) => {
  const [activeChapterId, setActiveChapterId] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reparsing, setReparsing] = useState(false);
  const [reparseMsg, setReparseMsg] = useState('');
  const [error, setError] = useState<string | null>(null);

  const projectId = documentIr?.project_id || '';
  const chapters = useMemo(() => documentIr?.chapters || [], [documentIr]);

  useEffect(() => {
    if (!documentIr) return;
    setDrafts({});
    setError(null);
    setActiveChapterId((prev) =>
      prev && documentIr.chapters.some((c) => c.chapter_id === prev)
        ? prev
        : documentIr.chapters[0]?.chapter_id || ''
    );
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!documentIr) return null;

  const activeChapter =
    chapters.find((c) => c.chapter_id === activeChapterId) || chapters[0] || null;
  const draftText = activeChapter ? drafts[activeChapter.chapter_id] ?? activeChapter.content_text : '';
  const dirty = Boolean(activeChapter && draftText !== activeChapter.content_text);
  const pendingCount = chapters.filter(
    (chapter) => drafts[chapter.chapter_id] !== undefined && drafts[chapter.chapter_id] !== chapter.content_text
  ).length;
  const totalChars = documentIr.total_chars || 0;
  const emptyResult = totalChars === 0;
  const failedPages = documentIr.ocr_failed_pages || [];
  const scannedTotal = documentIr.ocr_pages_total || 0;
  const partialFailure = !emptyResult && failedPages.length > 0;
  const confirmed = documentIr.ocr_confirmed === true;
  const engineLabel =
    documentIr.oxr_engine_used ||
    (documentIr.project_type === 'exam_paper' ? 'SoMark OXR' : '本地 PDF 文本层 / OCR');

  /** 把所有未保存的订正依次写回后端，返回最新的 DocumentIR */
  const persistDrafts = async (source: DocumentIR): Promise<DocumentIR> => {
    let latest = source;
    for (const chapter of source.chapters) {
      const draft = drafts[chapter.chapter_id];
      if (draft === undefined || draft === chapter.content_text) continue;
      latest = await api.updateChapterText(latest.project_id, chapter.chapter_id, draft);
    }
    return latest;
  };

  const handleSaveDrafts = async () => {
    if (!activeChapter || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateChapterText(
        documentIr.project_id,
        activeChapter.chapter_id,
        drafts[activeChapter.chapter_id] ?? activeChapter.content_text
      );
      const nextDrafts = { ...drafts };
      delete nextDrafts[activeChapter.chapter_id];
      setDrafts(nextDrafts);
      onDocumentChanged(updated);
    } catch (e: any) {
      setError(e?.message || '保存订正失败');
    } finally {
      setSaving(false);
    }
  };

  const handleReparse = async () => {
    setReparsing(true);
    setError(null);
    setReparseMsg('正在按当前 OCR 引擎重新识别整本文件…');
    try {
      const detail = await api.reparseProjectStream(documentIr.project_id, (evt) => {
        setReparseMsg(`${evt.percent ?? 0}% · ${evt.message || '识别中…'}`);
      });
      if (detail?.document_ir) {
        setDrafts({});
        setActiveChapterId(detail.document_ir.chapters[0]?.chapter_id || '');
        onDocumentChanged(detail.document_ir);
      }
      setReparseMsg('');
    } catch (e: any) {
      setError(e?.message || '重新识别失败');
      setReparseMsg('');
    } finally {
      setReparsing(false);
    }
  };

  const handleConfirm = async () => {
    setConfirming(true);
    setError(null);
    try {
      const latest = await persistDrafts(documentIr);
      const confirmedIr = await api.confirmDocumentOcr(latest.project_id);
      setDrafts({});
      onConfirmed(confirmedIr);
    } catch (e: any) {
      setError(e?.message || '确认失败，请重试');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="max-w-[1060px] mx-auto space-y-4 pb-16 asg-drawer-enter">
      {/* Header */}
      <div data-glass-panel="true" className="asg-card p-5 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <span
              className="text-[11px] font-bold px-2.5 py-0.5 rounded-full"
              style={{ backgroundColor: 'var(--brand-tint)', color: '#3B5BDB' }}
            >
              第二步 · 识别结果确认
            </span>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <ScanText className="w-5 h-5" style={{ color: '#3B5BDB' }} />
              <span>先核对识别出的文字，再往下生成</span>
            </h2>
            <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              OCR 会把公式、上下标、中英文混排认错。这里把识别出的原文整篇摊开，哪一节错了就地改；
              确认之后才会进入场景选择与生成。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="px-2.5 py-1 rounded-full text-[11px] font-bold"
              style={{
                backgroundColor: emptyResult ? '#FEE2E2' : 'var(--brand-tint)',
                color: emptyResult ? '#B91C1C' : '#3B5BDB',
              }}
            >
              {engineLabel}
            </span>
            <span
              className="px-2.5 py-1 rounded-full text-[11px] font-bold"
              style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}
            >
              {chapters.length} {documentIr.project_type === 'exam_paper' ? '页' : '节'} ·{' '}
              {totalChars.toLocaleString()} 字
            </span>
            <span
              className="px-2.5 py-1 rounded-full text-[11px] font-bold"
              style={{
                backgroundColor: confirmed ? 'var(--semantic-success-tint)' : '#FEF3C7',
                color: confirmed ? 'var(--semantic-success)' : '#B45309',
              }}
            >
              {confirmed ? '已确认' : '待确认'}
            </span>
          </div>
        </div>
      </div>

      {/* 部分页识别失败：总字数不为 0 时最容易误判「都识别好了」，必须点名 */}
      {partialFailure && (
        <div
          className="asg-card p-4 text-[12px] leading-relaxed"
          style={{ borderColor: '#FCD34D', backgroundColor: '#FFFBEB', color: '#92400E' }}
        >
          <div className="font-bold flex items-center gap-1.5 mb-1">
            <AlertTriangle className="w-4 h-4" />
            {scannedTotal || chapters.length} 页扫描页里只有 {(documentIr.ocr_pages_ok || 0) || chapters.length}{' '}
            页识别出文字
          </div>
          第 {failedPages.slice(0, 20).join('、')}
          {failedPages.length > 20 ? ` 等 ${failedPages.length} 页` : ' 页'}没取到文字，这些页的内容不会出现在生成的讲义与题目里。
          建议先到「设置 → OCR 文本识别」确认引擎真的可用，再点下面「重新识别」；也可以直接在正文里手动补上。
        </div>
      )}

      {emptyResult && (
        <div
          className="asg-card p-4 text-[12px] leading-relaxed"
          style={{ borderColor: '#FCA5A5', backgroundColor: '#FEF2F2', color: '#7F1D1D' }}
        >
          <div className="font-bold flex items-center gap-1.5 mb-1">
            <AlertTriangle className="w-4 h-4" />
            这次一个字都没识别出来
          </div>
          可能是扫描件且 OCR 引擎没就绪，或文件本身没有文字层。带着空文本继续生成，产出只能依据标题硬编。
          建议先到「设置 → OCR 文本识别」跑通引擎，再重新识别。
        </div>
      )}

      {/* 校对工作区 */}
      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4">
        <div data-glass-panel="true" className="asg-card p-3 space-y-1 max-h-[560px] overflow-y-auto">
          <div className="text-[11px] font-bold mb-1 px-1" style={{ color: 'var(--text-muted)' }}>
            {documentIr.project_type === 'exam_paper' ? '按页核对' : '按节核对'}
          </div>
          {chapters.map((chapter, index) => {
            const isActive = activeChapter?.chapter_id === chapter.chapter_id;
            const chapterDirty = drafts[chapter.chapter_id] !== undefined;
            return (
              <button
                key={chapter.chapter_id}
                onClick={() => setActiveChapterId(chapter.chapter_id)}
                className="w-full text-left px-2.5 py-2 rounded-xl text-[11.5px] leading-snug flex items-start gap-1.5"
                style={{
                  backgroundColor: isActive ? 'var(--brand-tint)' : 'transparent',
                  color: isActive ? '#3B5BDB' : 'var(--text-secondary)',
                  fontWeight: isActive ? 700 : 500,
                }}
              >
                <span className="shrink-0" style={{ color: 'var(--text-muted)' }}>
                  {index + 1}.
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block truncate">{chapter.title || `第 ${index + 1} 节`}</span>
                  <span className="block text-[10.5px]" style={{ color: 'var(--text-muted)' }}>
                    {chapterDirty ? '已改 · 未保存' : `${chapter.char_count.toLocaleString()} 字`}
                  </span>
                </span>
              </button>
            );
          })}
          {chapters.length === 0 && (
            <div className="text-[11px] px-1" style={{ color: 'var(--text-muted)' }}>
              没有切出任何章节
            </div>
          )}
        </div>

        <div data-glass-panel="true" className="asg-card p-4 flex flex-col gap-2 min-h-[420px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[12px] font-bold min-w-0" style={{ color: 'var(--text-primary)' }}>
              <FileText className="w-3.5 h-3.5 inline mr-1" />
              <span className="align-middle">{activeChapter?.title || '（无标题）'}</span>
              <span className="ml-2 font-normal text-[11px]" style={{ color: 'var(--text-muted)' }}>
                {draftText.length.toLocaleString()} 字
                {dirty && <span style={{ color: '#B45309' }}> · 有未保存改动</span>}
              </span>
            </div>
            <button
              onClick={handleSaveDrafts}
              disabled={!dirty || saving}
              className="px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1"
              style={{
                backgroundColor: dirty ? '#3B5BDB' : 'var(--bg-subtle)',
                color: dirty ? '#fff' : 'var(--text-muted)',
                cursor: dirty ? 'pointer' : 'default',
              }}
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
              保存本节订正
            </button>
          </div>
          <textarea
            value={draftText}
            onChange={(e) =>
              activeChapter &&
              setDrafts((prev) => ({ ...prev, [activeChapter.chapter_id]: e.target.value }))
            }
            spellCheck={false}
            className="flex-1 min-h-[360px] w-full rounded-2xl p-3 text-[12.5px] leading-relaxed border outline-none resize-none"
            style={{
              borderColor: dirty ? '#F59E0B' : 'var(--border-default)',
              backgroundColor: 'var(--bg-canvas, #FCFCFB)',
              color: 'var(--text-primary)',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}
            placeholder="这一节没有识别出文字，可在这里手动补上内容……"
          />
          <div className="text-[11px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            公式请保留 <code>$...$</code> 或 <code>$$...$$</code> 写法，生成与导出都会照排。
            确认之后仍可回到本步修改，改完需要重新确认。
          </div>
          {error && (
            <div className="text-[11.5px] font-bold" style={{ color: '#B91C1C' }}>
              {error}
            </div>
          )}
        </div>
      </div>

      {/* 操作条 */}
      <div
        data-glass-panel="true"
        className="asg-card p-4 flex flex-wrap items-center justify-between gap-3"
      >
        <div className="text-[11.5px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {pendingCount > 0
            ? `还有 ${pendingCount} 节改动未保存，点确认时会自动一起保存。`
            : confirmed
            ? '已确认过；如需继续改动，改完记得重新确认。'
            : '确认后进入第三步：选择学习场景并生成资料。'}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {reparseMsg && (
            <span className="text-[11px] font-semibold" style={{ color: '#3B5BDB' }}>
              {reparseMsg}
            </span>
          )}
          <SpringButton
            springLabel="重新识别所有页"
            onClick={handleReparse}
            disabled={reparsing || confirming}
            className="px-3 py-2 rounded-xl text-[11.5px] font-bold flex items-center gap-1.5"
            style={{ backgroundColor: 'var(--bg-surface)', color: '#B45309', border: '1px solid #FCD34D' }}
          >
            {reparsing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
            重新识别
          </SpringButton>
          <SpringButton
            springLabel="重新上传文件"
            onClick={onRequestReupload}
            className="px-3 py-2 rounded-xl text-[11.5px] font-bold flex items-center gap-1.5"
            style={{
              backgroundColor: 'var(--bg-surface)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-default)',
            }}
          >
            <Upload className="w-3.5 h-3.5" />
            重新上传
          </SpringButton>
          <SpringButton
            springLabel="确认识别结果并继续"
            onClick={handleConfirm}
            disabled={confirming}
            className="px-4 py-2 rounded-xl text-[12px] font-bold text-white flex items-center gap-1.5"
            style={{ backgroundColor: confirming ? '#93A8E8' : '#3B5BDB', cursor: confirming ? 'wait' : 'pointer' }}
          >
            {confirming ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="w-3.5 h-3.5" />
            )}
            {emptyResult ? '仍然继续（文字为空）' : '确认无误，进入下一步'}
            {!emptyResult && !confirming && <ArrowRight className="w-3.5 h-3.5" />}
          </SpringButton>
        </div>
      </div>
    </div>
  );
};
