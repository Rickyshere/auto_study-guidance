import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import mermaid from 'mermaid';
import {
  BookOpen,
  Zap,
  ClipboardCheck,
  Network,
  Download,
  Printer,
  CheckCircle2,
  XCircle,
  Eye,
  Play,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Copy,
  Layers,
  FileText,
  Columns2,
  X,
} from 'lucide-react';
import { api } from '../api';
import { DocumentIR, QuizQuestion, StudyPackage } from '../types';
import { normalizeMathMarkdown } from '../utils/mathMarkdown';
import { SpringButton, SpringSegmentedControl } from '../utils/springPhysics';

mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
});

export type StudioTabKey = 'notes' | 'quiz' | 'cheatsheet' | 'mindmap' | 'blueprint_trace';

interface Props {
  studyPackage: StudyPackage;
  documentIr?: DocumentIR | null;
  activeTab: StudioTabKey;
  onChangeTab?: (tab: StudioTabKey) => void;
}

function downloadText(filename: string, content: string, mime = 'text/markdown;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const StudyStudio: React.FC<Props> = ({
  studyPackage,
  documentIr,
  activeTab,
  onChangeTab,
}) => {
  const [quizStudyMode, setQuizStudyMode] = useState<'exam' | 'review'>('exam');
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [exportingPdfKey, setExportingPdfKey] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [previewSpec, setPreviewSpec] = useState<{
    docType: 'quiz' | 'study_guide' | 'cheatsheet';
    paperSize: 'a4' | 'a3';
    includeAnswers: boolean;
  } | null>(null);

  const handleExportPdf = async (
    docType: 'quiz' | 'study_guide' | 'cheatsheet',
    paperSize: 'a4' | 'a3',
    includeAnswers = true
  ) => {
    const key = `${docType}-${paperSize}`;
    setExportingPdfKey(key);
    setPdfError(null);
    try {
      await api.exportPdf(studyPackage.project_id, {
        doc_type: docType,
        paper_size: paperSize,
        include_answers: includeAnswers,
      });
    } catch (e: any) {
      setPdfError(e?.message || 'PDF 导出失败');
    } finally {
      setExportingPdfKey(null);
    }
  };

  // Mermaid rendering state
  const mermaidRef = useRef<HTMLDivElement | null>(null);
  const [mermaidSvg, setMermaidSvg] = useState<string>('');
  const [mermaidError, setMermaidError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  // Reset quiz state when a new package arrives
  useEffect(() => {
    setUserAnswers({});
    setSubmitted(false);
    setElapsedSeconds(0);
  }, [studyPackage.generated_at, studyPackage.blueprint_used.preset_id]);

  // Quiz timer
  useEffect(() => {
    if (activeTab !== 'quiz' || quizStudyMode !== 'exam' || submitted) return;
    const timer = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [activeTab, quizStudyMode, submitted]);

  // Render Mermaid diagram
  useEffect(() => {
    if (activeTab !== 'mindmap' || !studyPackage.mindmap_mermaid) return;
    let cancelled = false;
    (async () => {
      try {
        setMermaidError(null);
        const id = `mm_${Date.now()}`;
        const { svg } = await mermaid.render(id, studyPackage.mindmap_mermaid);
        if (!cancelled) setMermaidSvg(svg);
      } catch (e: any) {
        if (!cancelled) setMermaidError(e?.message || 'Mermaid 语法渲染失败');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab, studyPackage.mindmap_mermaid]);

  const quiz = studyPackage.quiz_paper;
  const formatTime = (sec: number) =>
    `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

  const evaluateQuestion = (q: QuizQuestion): boolean | null => {
    const ans = (userAnswers[q.id] || '').trim();
    if (!ans) return false;
    if (q.type === 'mcq') {
      return ans.toUpperCase().startsWith(q.answer.trim().toUpperCase().charAt(0));
    }
    if (q.type === 'fill_blank') {
      return (
        ans.toLowerCase() === q.answer.trim().toLowerCase() ||
        q.answer.toLowerCase().includes(ans.toLowerCase())
      );
    }
    return null;
  };

  const objectiveQs = quiz.questions.filter((q) => q.type !== 'short_answer');
  const objectiveScore = objectiveQs.reduce(
    (sum, q) => sum + (evaluateQuestion(q) ? q.score : 0),
    0
  );
  const objectiveMax = objectiveQs.reduce((sum, q) => sum + q.score, 0);

  const exportQuizMarkdown = (withAnswers: boolean) => {
    const lines = [`# ${quiz.title}`, `> ${quiz.instructions}`, ''];
    quiz.questions.forEach((q, idx) => {
      lines.push(`### ${idx + 1}. [${q.tier} · ${q.score}分] ${q.question}`);
      if (q.options.length > 0) {
        q.options.forEach((o) => lines.push(`- ${o}`));
      }
      if (withAnswers) {
        lines.push(`- **参考答案**：${q.answer}`);
        lines.push(`- **解析**：${q.explanation} *(${q.source_chapter} ${q.source_page})*`);
      }
      lines.push('');
    });
    downloadText(
      `${quiz.title}_${withAnswers ? '教师解析版' : '学生空白卷'}.md`,
      lines.join('\n')
    );
  };

  const selectedChapters =
    documentIr?.chapters.filter((ch) =>
      studyPackage.blueprint_used.selected_chapter_ids.includes(ch.chapter_id)
    ) || [];

  const stage2HasNotes = Boolean(studyPackage.study_notes_markdown);
  const stage2HasCheatsheet = Boolean(studyPackage.cheatsheet_markdown);
  const stage2HasQuiz = quiz.questions.length > 0;
  const stage2HasMindmap = Boolean(studyPackage.mindmap_mermaid);

  return (
    <div style={{ maxWidth: '1080px', margin: '0 auto' }}>
      {/* Document Sheet Header */}
      <div
        className="no-print"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: '12px',
          paddingBottom: '16px',
          borderBottom: '1px solid rgba(60, 60, 67, 0.12)',
          marginBottom: '20px',
        }}
      >
        <div>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              borderRadius: '999px',
              backgroundColor: 'rgba(52, 199, 89, 0.12)',
              color: '#248A3D',
              padding: '3px 10px',
              fontSize: '11px',
              fontWeight: 700,
              marginBottom: '6px',
            }}
          >
            阶段 2 · 已生成学习资料包 · {studyPackage.blueprint_used.preset_name}
          </div>
          <h2
            className="mac-sp-display"
            style={{
              fontSize: '24px',
              fontWeight: 700,
              color: '#1C1C1E',
              lineHeight: 1.25,
            }}
          >
            {studyPackage.blueprint_used.blueprint_title}
          </h2>
          <p
            style={{
              marginTop: '4px',
              fontSize: '12.5px',
              color: '#636366',
              lineHeight: 1.5,
            }}
          >
            {studyPackage.blueprint_used.parsed_intent_summary}
          </p>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
          {activeTab === 'quiz' && stage2HasQuiz && (
            <>
              <SpringButton
                springLabel="导出A4试卷"
                disabled={Boolean(exportingPdfKey)}
                onClick={() => handleExportPdf('quiz', 'a4', true)}
                maxShift={6}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  borderRadius: '999px',
                  border: 'none',
                  backgroundColor: '#007AFF',
                  color: '#FFFFFF',
                  padding: '7px 14px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: exportingPdfKey ? 'wait' : 'pointer',
                }}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>{exportingPdfKey === 'quiz-a4' ? '生成中...' : '导出 A4 试卷 PDF (附答案)'}</span>
              </SpringButton>
              <SpringButton
                springLabel="导出A3试卷"
                disabled={Boolean(exportingPdfKey)}
                onClick={() => handleExportPdf('quiz', 'a3', true)}
                maxShift={6}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  borderRadius: '999px',
                  border: '1px solid rgba(0, 122, 255, 0.35)',
                  backgroundColor: 'rgba(0, 122, 255, 0.08)',
                  color: '#007AFF',
                  padding: '7px 14px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: exportingPdfKey ? 'wait' : 'pointer',
                }}
              >
                <Columns2 className="w-3.5 h-3.5" />
                <span>{exportingPdfKey === 'quiz-a3' ? '生成中...' : '导出 A3 双栏试卷 PDF (附答案)'}</span>
              </SpringButton>
            </>
          )}
          {activeTab === 'notes' && stage2HasNotes && (
            <SpringButton
              springLabel="导出自学案PDF"
              disabled={Boolean(exportingPdfKey)}
              onClick={() => handleExportPdf('study_guide', 'a4', true)}
              maxShift={6}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                borderRadius: '999px',
                border: 'none',
                backgroundColor: '#007AFF',
                color: '#FFFFFF',
                padding: '7px 14px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: exportingPdfKey ? 'wait' : 'pointer',
              }}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>
                {exportingPdfKey === 'study_guide-a4'
                  ? '排版生成中...'
                  : '导出自学案讲义 PDF (含例题解析)'}
              </span>
            </SpringButton>
          )}
          <SpringButton
            springLabel="印刷预览"
            onClick={() =>
              setPreviewSpec({
                docType:
                  activeTab === 'quiz'
                    ? 'quiz'
                    : activeTab === 'cheatsheet'
                    ? 'cheatsheet'
                    : 'study_guide',
                paperSize: 'a4',
                includeAnswers: true,
              })
            }
            maxShift={6}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              borderRadius: '999px',
              border: '1px solid rgba(60, 60, 67, 0.14)',
              backgroundColor: '#F9F9FB',
              color: '#1C1C1E',
              padding: '7px 14px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Printer className="w-3.5 h-3.5" />
            <span>印刷版式预览</span>
          </SpringButton>
        </div>
      </div>

      {pdfError && (
        <div
          className="no-print"
          style={{
            marginBottom: '12px',
            borderRadius: '10px',
            backgroundColor: 'rgba(255, 59, 48, 0.08)',
            border: '1px solid rgba(255, 59, 48, 0.25)',
            color: '#C62828',
            padding: '8px 12px',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>PDF 导出异常：{pdfError}</span>
          <button
            onClick={() => setPdfError(null)}
            style={{ fontSize: '11.5px', fontWeight: 600, cursor: 'pointer', background: 'none', border: 'none', color: '#C62828' }}
          >
            关闭
          </button>
        </div>
      )}

      {/* Tab Content */}
      {activeTab === 'notes' && (
        <div>
          {!stage2HasNotes ? (
            <EmptyDeliverableBanner
              title="本次方案未启用「导学精要笔记」模块"
              hint="可在左侧 Stage 1 方案微调面板勾选「导学笔记」并重新生成，或切换上方分段控制器查看其他产物。"
              onSwitch={() => onChangeTab?.('quiz')}
              switchLabel={stage2HasQuiz ? '前往互动题库' : '查看方案细目'}
            />
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 65ch) 1px minmax(200px, 1fr)',
                gap: '24px',
                alignItems: 'start',
              }}
            >
              {/* Primary 65ch Reading Column */}
              <div>
                <div
                  className="no-print"
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                    marginBottom: '12px',
                  }}
                >
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#636366' }}>
                    <BookOpen className="w-3.5 h-3.5 inline mr-1.5 text-[#007AFF]" />
                    结构化导学精要讲义 · 典型例题与解析
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
                    <SpringButton
                      springLabel="讲义A4PDF"
                      disabled={Boolean(exportingPdfKey)}
                      onClick={() => handleExportPdf('study_guide', 'a4', true)}
                      maxShift={5}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        borderRadius: '999px',
                        border: '1px solid rgba(0, 122, 255, 0.35)',
                        backgroundColor: 'rgba(0, 122, 255, 0.08)',
                        padding: '5px 11px',
                        fontSize: '11.5px',
                        fontWeight: 600,
                        color: '#007AFF',
                        cursor: 'pointer',
                      }}
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>A4 讲义 PDF</span>
                    </SpringButton>
                    <SpringButton
                      springLabel="讲义A3PDF"
                      disabled={Boolean(exportingPdfKey)}
                      onClick={() => handleExportPdf('study_guide', 'a3', true)}
                      maxShift={5}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        borderRadius: '999px',
                        border: '1px solid rgba(60, 60, 67, 0.14)',
                        backgroundColor: '#FFFFFF',
                        padding: '5px 11px',
                        fontSize: '11.5px',
                        fontWeight: 600,
                        color: '#1C1C1E',
                        cursor: 'pointer',
                      }}
                    >
                      <Columns2 className="w-3.5 h-3.5" />
                      <span>A3 双栏讲义 PDF</span>
                    </SpringButton>
                    <SpringButton
                      springLabel="导出笔记"
                      onClick={() =>
                        downloadText(
                          `${studyPackage.blueprint_used.blueprint_title}_精要笔记.md`,
                          studyPackage.study_notes_markdown
                        )
                      }
                      maxShift={5}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        borderRadius: '999px',
                        border: '1px solid rgba(60, 60, 67, 0.14)',
                        backgroundColor: '#FFFFFF',
                        padding: '5px 11px',
                        fontSize: '11.5px',
                        fontWeight: 600,
                        color: '#1C1C1E',
                        cursor: 'pointer',
                      }}
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>.md</span>
                    </SpringButton>
                  </div>
                </div>

                <div className="markdown-body">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeKatex]}
                  >
                    {normalizeMathMarkdown(studyPackage.study_notes_markdown)}
                  </ReactMarkdown>
                </div>
              </div>

              <div style={{ backgroundColor: 'rgba(60, 60, 67, 0.12)', height: '100%' }} />

              {/* Right Contextual Margin Column */}
              <aside style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div
                  style={{
                    borderRadius: '12px',
                    backgroundColor: '#F9F9FB',
                    border: '1px solid rgba(60, 60, 67, 0.08)',
                    padding: '12px',
                  }}
                >
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#1C1C1E', marginBottom: '6px' }}>
                    纳入范围章节 ({selectedChapters.length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {selectedChapters.map((ch) => (
                      <div
                        key={ch.chapter_id}
                        style={{
                          fontSize: '11.5px',
                          color: '#3A3A3C',
                          padding: '6px 8px',
                          borderRadius: '8px',
                          backgroundColor: '#FFFFFF',
                          border: '1px solid rgba(60, 60, 67, 0.08)',
                        }}
                      >
                        <div style={{ fontWeight: 600 }}>{ch.title}</div>
                        <div className="mac-sp-tabular" style={{ fontSize: '10.5px', color: '#8E8E93', marginTop: '2px' }}>
                          P{ch.start_page}–{ch.end_page} · {ch.key_terms.slice(0, 3).join(' / ')}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {documentIr && documentIr.all_assets.length > 0 && (
                  <div
                    style={{
                      borderRadius: '12px',
                      backgroundColor: '#F9F9FB',
                      border: '1px solid rgba(60, 60, 67, 0.08)',
                      padding: '12px',
                    }}
                  >
                    <div style={{ fontSize: '11px', fontWeight: 700, color: '#1C1C1E', marginBottom: '8px' }}>
                      配套教材原图索引
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {documentIr.all_assets.slice(0, 4).map((a) => (
                        <div
                          key={a.asset_id}
                          style={{
                            borderRadius: '8px',
                            overflow: 'hidden',
                            backgroundColor: '#FFFFFF',
                            border: '1px solid rgba(60, 60, 67, 0.1)',
                          }}
                        >
                          <img
                            src={a.url}
                            alt={a.caption}
                            style={{ width: '100%', height: '86px', objectFit: 'contain' }}
                          />
                          <div style={{ padding: '4px 8px', fontSize: '10.5px', color: '#636366' }}>
                            P{a.page_or_slide} · {a.caption}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </aside>
            </div>
          )}
        </div>
      )}

      {activeTab === 'quiz' && (
        <div>
          {!stage2HasQuiz ? (
            <EmptyDeliverableBanner
              title="本次方案未生成题库试题"
              hint="可在左侧 Stage 1 调整单选 / 填空 / 简答题数量后重新生成。"
              onSwitch={() => onChangeTab?.('notes')}
              switchLabel="返回导学笔记"
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Quiz Action Bar */}
              <div
                className="no-print"
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                  borderRadius: '12px',
                  backgroundColor: '#F2F2F7',
                  border: '1px solid rgba(60, 60, 67, 0.08)',
                  padding: '10px 14px',
                }}
              >
                <div>
                  <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#1C1C1E' }}>
                    {quiz.title}
                  </div>
                  <div className="mac-sp-tabular" style={{ fontSize: '11.5px', color: '#636366', marginTop: '2px' }}>
                    {quiz.instructions} · 满分 {quiz.total_score} 分 · 共 {quiz.questions.length} 题
                  </div>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
                  {quizStudyMode === 'exam' && (
                    <span
                      className="mac-sp-tabular"
                      style={{
                        borderRadius: '999px',
                        backgroundColor: '#FFFFFF',
                        border: '1px solid rgba(60, 60, 67, 0.12)',
                        padding: '4px 10px',
                        fontSize: '11.5px',
                        fontWeight: 700,
                        color: '#1C1C1E',
                      }}
                    >
                      ⏱ {formatTime(elapsedSeconds)}
                    </span>
                  )}

                  <SpringSegmentedControl<'exam' | 'review'>
                    compact
                    springLabel="做题模式"
                    value={quizStudyMode}
                    onChange={(mode) => setQuizStudyMode(mode)}
                    options={[
                      { value: 'exam', label: '▶ 在线作答' },
                      { value: 'review', label: '👁 背题与解析' },
                    ]}
                  />

                  <SpringButton
                    springLabel="导出A4PDF"
                    disabled={Boolean(exportingPdfKey)}
                    onClick={() => handleExportPdf('quiz', 'a4', true)}
                    maxShift={5}
                    style={{
                      borderRadius: '999px',
                      border: '1px solid rgba(0, 122, 255, 0.35)',
                      backgroundColor: 'rgba(0, 122, 255, 0.1)',
                      padding: '5px 10px',
                      fontSize: '11.5px',
                      fontWeight: 600,
                      color: '#007AFF',
                      cursor: 'pointer',
                    }}
                  >
                    {exportingPdfKey === 'quiz-a4' ? '生成A4中...' : 'A4 试卷 PDF (附答案)'}
                  </SpringButton>
                  <SpringButton
                    springLabel="导出A3PDF"
                    disabled={Boolean(exportingPdfKey)}
                    onClick={() => handleExportPdf('quiz', 'a3', true)}
                    maxShift={5}
                    style={{
                      borderRadius: '999px',
                      border: '1px solid rgba(0, 122, 255, 0.35)',
                      backgroundColor: '#FFFFFF',
                      padding: '5px 10px',
                      fontSize: '11.5px',
                      fontWeight: 600,
                      color: '#007AFF',
                      cursor: 'pointer',
                    }}
                  >
                    {exportingPdfKey === 'quiz-a3' ? '生成A3中...' : 'A3 双栏密封线 PDF'}
                  </SpringButton>
                  <SpringButton
                    springLabel="导出空白卷"
                    onClick={() => exportQuizMarkdown(false)}
                    maxShift={5}
                    style={{
                      borderRadius: '999px',
                      border: '1px solid rgba(60, 60, 67, 0.14)',
                      backgroundColor: '#FFFFFF',
                      padding: '5px 10px',
                      fontSize: '11.5px',
                      fontWeight: 600,
                      color: '#1C1C1E',
                      cursor: 'pointer',
                    }}
                  >
                    空白卷 .md
                  </SpringButton>
                  <SpringButton
                    springLabel="导出解析"
                    onClick={() => exportQuizMarkdown(true)}
                    maxShift={5}
                    style={{
                      borderRadius: '999px',
                      border: '1px solid rgba(60, 60, 67, 0.14)',
                      backgroundColor: '#FFFFFF',
                      padding: '5px 10px',
                      fontSize: '11.5px',
                      fontWeight: 600,
                      color: '#1C1C1E',
                      cursor: 'pointer',
                    }}
                  >
                    教师解析版 .md
                  </SpringButton>
                </div>
              </div>

              {/* Score Banner after submit */}
              {submitted && quizStudyMode === 'exam' && (
                <div
                  style={{
                    borderRadius: '12px',
                    backgroundColor: 'rgba(52, 199, 89, 0.1)',
                    border: '1px solid rgba(52, 199, 89, 0.28)',
                    padding: '12px 16px',
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px',
                  }}
                >
                  <div>
                    <div className="mac-sp-tabular" style={{ fontSize: '14px', fontWeight: 700, color: '#1B5E20' }}>
                      客观题自动判分结果：{objectiveScore} / {objectiveMax} 分
                      {quiz.questions.some((q) => q.type === 'short_answer') &&
                        '（简答题请对照右栏与解析自评）'}
                    </div>
                    <div className="mac-sp-tabular" style={{ fontSize: '11.5px', color: '#2E7D32', marginTop: '2px' }}>
                      用时 {formatTime(elapsedSeconds)} · 已展开全部参考答案与教材溯源解析
                    </div>
                  </div>
                  <SpringButton
                    springLabel="重新作答"
                    onClick={() => {
                      setSubmitted(false);
                      setUserAnswers({});
                      setElapsedSeconds(0);
                    }}
                    maxShift={5}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      borderRadius: '999px',
                      border: '1px solid rgba(52, 199, 89, 0.4)',
                      backgroundColor: '#FFFFFF',
                      padding: '6px 12px',
                      fontSize: '11.5px',
                      fontWeight: 600,
                      color: '#1B5E20',
                      cursor: 'pointer',
                    }}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    重新作答
                  </SpringButton>
                </div>
              )}

              {/* Widescreen Two-Column Questions */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {quiz.questions.map((q, idx) => {
                  const showAns = quizStudyMode === 'review' || submitted;
                  const isCorrect = submitted ? evaluateQuestion(q) : null;
                  const typeLabel =
                    q.type === 'mcq' ? '单选题' : q.type === 'fill_blank' ? '填空题' : '简答/分析';

                  return (
                    <div
                      key={q.id}
                      style={{
                        borderRadius: '14px',
                        border: '1px solid rgba(60, 60, 67, 0.1)',
                        backgroundColor: '#FFFFFF',
                        padding: '16px 18px',
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0, 65ch) 1px minmax(185px, 1fr)',
                        gap: '18px',
                      }}
                    >
                      {/* Question Stem + Interactive Input */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '7px' }}>
                          <span
                            className="mac-sp-tabular"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: '24px',
                              height: '24px',
                              borderRadius: '999px',
                              backgroundColor: '#007AFF',
                              color: '#FFFFFF',
                              fontSize: '12px',
                              fontWeight: 700,
                            }}
                          >
                            {idx + 1}
                          </span>
                          <span
                            style={{
                              borderRadius: '6px',
                              backgroundColor: '#F2F2F7',
                              padding: '2px 8px',
                              fontSize: '11px',
                              fontWeight: 600,
                              color: '#3A3A3C',
                            }}
                          >
                            {typeLabel}
                          </span>
                          <span
                            className="mac-sp-tabular"
                            style={{
                              fontSize: '11.5px',
                              fontWeight: 700,
                              color: '#FF9500',
                            }}
                          >
                            {q.score} 分
                          </span>
                        </div>

                        <div
                          style={{
                            fontSize: '14.5px',
                            fontWeight: 500,
                            color: '#1C1C1E',
                            lineHeight: 1.65,
                            whiteSpace: 'pre-line',
                          }}
                        >
                          {q.question}
                        </div>

                        {q.type === 'mcq' && q.options.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {q.options.map((opt) => {
                              const letter = opt.trim().charAt(0);
                              const selected = userAnswers[q.id] === letter;
                              const isThisRight =
                                showAns &&
                                q.answer.trim().toUpperCase().startsWith(letter.toUpperCase());

                              return (
                                <SpringButton
                                  key={opt}
                                  springLabel={`选项 ${letter}`}
                                  disabled={submitted && quizStudyMode === 'exam'}
                                  onClick={() =>
                                    setUserAnswers((prev) => ({ ...prev, [q.id]: letter }))
                                  }
                                  maxShift={5}
                                  style={{
                                    width: '100%',
                                    textAlign: 'left',
                                    borderRadius: '10px',
                                    border: isThisRight
                                      ? '1.5px solid #34C759'
                                      : selected && submitted && isCorrect === false
                                      ? '1.5px solid #FF3B30'
                                      : selected
                                      ? '1.5px solid #007AFF'
                                      : '1px solid rgba(60, 60, 67, 0.12)',
                                    backgroundColor: isThisRight
                                      ? 'rgba(52, 199, 89, 0.1)'
                                      : selected && submitted && isCorrect === false
                                      ? 'rgba(255, 59, 48, 0.08)'
                                      : selected
                                      ? 'rgba(0, 122, 255, 0.08)'
                                      : '#FAFAFC',
                                    color: '#1C1C1E',
                                    padding: '9px 12px',
                                    fontSize: '12.5px',
                                    fontWeight: isThisRight || selected ? 600 : 400,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    cursor:
                                      submitted && quizStudyMode === 'exam' ? 'default' : 'pointer',
                                  }}
                                >
                                  <span>{opt}</span>
                                  {isThisRight && (
                                    <CheckCircle2 className="w-4 h-4 text-[#34C759] shrink-0" />
                                  )}
                                  {selected && submitted && isCorrect === false && (
                                    <XCircle className="w-4 h-4 text-[#FF3B30] shrink-0" />
                                  )}
                                </SpringButton>
                              );
                            })}
                          </div>
                        )}

                        {q.type === 'fill_blank' && (
                          <input
                            type="text"
                            disabled={submitted && quizStudyMode === 'exam'}
                            value={userAnswers[q.id] || ''}
                            onChange={(e) =>
                              setUserAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
                            }
                            placeholder="请输入填空答案..."
                            style={{
                              width: '100%',
                              maxWidth: '380px',
                              borderRadius: '10px',
                              border: '1px solid rgba(60, 60, 67, 0.2)',
                              padding: '8px 12px',
                              fontSize: '12.5px',
                              outline: 'none',
                            }}
                          />
                        )}

                        {q.type === 'short_answer' && (
                          <textarea
                            rows={3}
                            disabled={submitted && quizStudyMode === 'exam'}
                            value={userAnswers[q.id] || ''}
                            onChange={(e) =>
                              setUserAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
                            }
                            placeholder="在此输入分析与作答要点..."
                            style={{
                              width: '100%',
                              borderRadius: '10px',
                              border: '1px solid rgba(60, 60, 67, 0.2)',
                              padding: '8px 12px',
                              fontSize: '12.5px',
                              outline: 'none',
                            }}
                          />
                        )}

                        {showAns && (
                          <div
                            style={{
                              borderRadius: '10px',
                              backgroundColor: '#F2F2F7',
                              border: '1px solid rgba(60, 60, 67, 0.08)',
                              padding: '10px 12px',
                              fontSize: '12px',
                              lineHeight: 1.6,
                            }}
                          >
                            <div style={{ fontWeight: 700, color: '#248A3D', marginBottom: '3px' }}>
                              参考答案：{q.answer}
                            </div>
                            <div style={{ color: '#3A3A3C' }}>
                              <strong>解析：</strong>
                              {q.explanation}
                            </div>
                          </div>
                        )}
                      </div>

                      <div style={{ backgroundColor: 'rgba(60, 60, 67, 0.1)' }} />

                      {/* Right Margin Provenance Column */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '11.5px' }}>
                        <div>
                          <div style={{ fontSize: '10.5px', color: '#8E8E93', fontWeight: 600 }}>
                            分层定位
                          </div>
                          <div style={{ fontWeight: 700, color: '#007AFF', marginTop: '2px' }}>
                            {q.tier} · {q.difficulty}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: '10.5px', color: '#8E8E93', fontWeight: 600 }}>
                            教材溯源锚点
                          </div>
                          <div style={{ color: '#1C1C1E', fontWeight: 600, marginTop: '2px', lineHeight: 1.4 }}>
                            {q.source_chapter}
                          </div>
                          <div style={{ color: '#636366', marginTop: '1px' }}>{q.source_page}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {quizStudyMode === 'exam' && !submitted && quiz.questions.length > 0 && (
                <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '6px' }}>
                  <SpringButton
                    springLabel="交卷判分"
                    onClick={() => setSubmitted(true)}
                    maxShift={6}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '7px',
                      borderRadius: '999px',
                      border: 'none',
                      backgroundColor: '#007AFF',
                      color: '#FFFFFF',
                      padding: '10px 22px',
                      fontSize: '13px',
                      fontWeight: 700,
                      boxShadow: '0 8px 20px -6px rgba(0, 122, 255, 0.45)',
                      cursor: 'pointer',
                    }}
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>交卷并自动判分</span>
                  </SpringButton>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'cheatsheet' && (
        <div>
          {!stage2HasCheatsheet ? (
            <EmptyDeliverableBanner
              title="本次方案未启用「考前速记表」"
              hint="可在左侧 Stage 1 勾选「考前速记表」后重新生成。"
              onSwitch={() => onChangeTab?.('notes')}
              switchLabel="返回导学笔记"
            />
          ) : (
            <div style={{ width: '100%', maxWidth: '100%' }}>
              <div
                className="no-print"
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  marginBottom: '12px',
                }}
              >
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#636366' }}>
                  <Zap className="w-3.5 h-3.5 inline mr-1.5 text-[#FF9500]" />
                  高密度考前速记表 (Cheat Sheet)
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <SpringButton
                    springLabel="导出速记PDF"
                    disabled={Boolean(exportingPdfKey)}
                    onClick={() => handleExportPdf('cheatsheet', 'a4', true)}
                    maxShift={5}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      borderRadius: '999px',
                      border: '1px solid rgba(255, 149, 0, 0.35)',
                      backgroundColor: 'rgba(255, 149, 0, 0.1)',
                      padding: '5px 12px',
                      fontSize: '11.5px',
                      fontWeight: 600,
                      color: '#995700',
                      cursor: 'pointer',
                    }}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>{exportingPdfKey === 'cheatsheet-a4' ? '生成中...' : '导出速记 PDF'}</span>
                  </SpringButton>
                  <SpringButton
                    springLabel="导出速记表"
                    onClick={() =>
                      downloadText(
                        `${studyPackage.blueprint_used.blueprint_title}_考前速记表.md`,
                        studyPackage.cheatsheet_markdown
                      )
                    }
                    maxShift={5}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      borderRadius: '999px',
                      border: '1px solid rgba(60, 60, 67, 0.14)',
                      backgroundColor: '#FFFFFF',
                      padding: '5px 12px',
                      fontSize: '11.5px',
                      fontWeight: 600,
                      color: '#1C1C1E',
                      cursor: 'pointer',
                    }}
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>导出速记表 .md</span>
                  </SpringButton>
                </div>
              </div>
              <div
                className="markdown-body"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  overflowX: 'auto',
                  borderRadius: '14px',
                  backgroundColor: '#FFFDF5',
                  border: '1px solid rgba(255, 149, 0, 0.25)',
                  padding: '20px 22px',
                  marginBottom: '28px',
                }}
              >
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                >
                  {normalizeMathMarkdown(studyPackage.cheatsheet_markdown)}
                </ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'mindmap' && (
        <div>
          {!stage2HasMindmap ? (
            <EmptyDeliverableBanner
              title="本次方案未启用「可视化知识图谱」"
              hint="可在左侧 Stage 1 勾选「知识图谱」后重新生成。"
              onSwitch={() => onChangeTab?.('notes')}
              switchLabel="返回导学笔记"
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div
                className="no-print"
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <SpringButton
                    springLabel="缩小图谱"
                    onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.15).toFixed(2))))}
                    maxShift={4}
                    style={{
                      borderRadius: '999px',
                      border: '1px solid rgba(60, 60, 67, 0.14)',
                      backgroundColor: '#FFFFFF',
                      padding: '6px 10px',
                      cursor: 'pointer',
                    }}
                    title="缩小"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </SpringButton>
                  <span className="mac-sp-tabular" style={{ fontSize: '12px', fontWeight: 600, color: '#636366' }}>
                    {Math.round(zoom * 100)}%
                  </span>
                  <SpringButton
                    springLabel="放大图谱"
                    onClick={() => setZoom((z) => Math.min(2.2, Number((z + 0.15).toFixed(2))))}
                    maxShift={4}
                    style={{
                      borderRadius: '999px',
                      border: '1px solid rgba(60, 60, 67, 0.14)',
                      backgroundColor: '#FFFFFF',
                      padding: '6px 10px',
                      cursor: 'pointer',
                    }}
                    title="放大"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </SpringButton>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <SpringButton
                    springLabel="复制Mermaid"
                    onClick={() => navigator.clipboard.writeText(studyPackage.mindmap_mermaid)}
                    maxShift={5}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      borderRadius: '999px',
                      border: '1px solid rgba(60, 60, 67, 0.14)',
                      backgroundColor: '#FFFFFF',
                      padding: '6px 12px',
                      fontSize: '11.5px',
                      fontWeight: 600,
                      color: '#1C1C1E',
                      cursor: 'pointer',
                    }}
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>复制 Mermaid 源码</span>
                  </SpringButton>
                  {mermaidSvg && (
                    <SpringButton
                      springLabel="导出SVG"
                      onClick={() =>
                        downloadText(
                          `${studyPackage.blueprint_used.blueprint_title}_知识图谱.svg`,
                          mermaidSvg,
                          'image/svg+xml;charset=utf-8'
                        )
                      }
                      maxShift={5}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        borderRadius: '999px',
                        border: 'none',
                        backgroundColor: '#007AFF',
                        padding: '6px 12px',
                        fontSize: '11.5px',
                        fontWeight: 600,
                        color: '#FFFFFF',
                        cursor: 'pointer',
                      }}
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>导出 SVG</span>
                    </SpringButton>
                  )}
                </div>
              </div>

              {mermaidError ? (
                <div
                  style={{
                    borderRadius: '12px',
                    backgroundColor: 'rgba(255, 149, 0, 0.1)',
                    border: '1px solid rgba(255, 149, 0, 0.3)',
                    padding: '14px',
                    fontSize: '12px',
                    color: '#995700',
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: '6px' }}>
                    <Network className="w-4 h-4 inline mr-1" />
                    Mermaid 渲染提示：{mermaidError}
                  </div>
                  <pre
                    style={{
                      backgroundColor: '#FFFFFF',
                      padding: '10px',
                      borderRadius: '8px',
                      overflowX: 'auto',
                      color: '#1C1C1E',
                    }}
                  >
                    {studyPackage.mindmap_mermaid}
                  </pre>
                </div>
              ) : (
                <div
                  style={{
                    overflow: 'auto',
                    borderRadius: '14px',
                    border: '1px solid rgba(60, 60, 67, 0.1)',
                    backgroundColor: '#FAFAFC',
                    padding: '24px',
                    minHeight: '380px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <div
                    ref={mermaidRef}
                    style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}
                    dangerouslySetInnerHTML={{ __html: mermaidSvg }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'blueprint_trace' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '820px' }}>
          <div
            style={{
              borderRadius: '14px',
              border: '1px solid rgba(60, 60, 67, 0.1)',
              backgroundColor: '#FAFAFC',
              padding: '16px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '13px',
                fontWeight: 700,
                color: '#1C1C1E',
                marginBottom: '10px',
              }}
            >
              <Layers className="w-4 h-4 text-[#007AFF]" />
              <span>已执行教学契约与题型分布</span>
            </div>
            <div
              className="mac-sp-tabular"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: '10px',
              }}
            >
              <MetricTile label="预设模板" value={studyPackage.blueprint_used.preset_name} />
              <MetricTile label="目标难度" value={studyPackage.blueprint_used.target_difficulty} />
              <MetricTile label="单选题" value={`${studyPackage.blueprint_used.deliverables.mcq_count} 题`} />
              <MetricTile label="填空题" value={`${studyPackage.blueprint_used.deliverables.fill_blank_count} 题`} />
              <MetricTile label="简答分析" value={`${studyPackage.blueprint_used.deliverables.short_answer_count} 题`} />
              <MetricTile label="卷面总分" value={`${studyPackage.quiz_paper.total_score} 分`} />
            </div>
          </div>

          <div
            style={{
              borderRadius: '14px',
              border: '1px solid rgba(60, 60, 67, 0.1)',
              backgroundColor: '#FFFFFF',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid rgba(60, 60, 67, 0.08)',
                fontSize: '13px',
                fontWeight: 700,
                color: '#1C1C1E',
              }}
            >
              三模路由与 CLI Harness 阶段执行轨迹
            </div>
            {Object.entries(studyPackage.routing_trace).map(([stage, label]) => (
              <div
                key={stage}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 16px',
                  borderBottom: '1px solid rgba(60, 60, 67, 0.08)',
                  fontSize: '12.5px',
                }}
              >
                <span style={{ fontWeight: 600, color: '#636366' }}>{stage}</span>
                <span
                  style={{
                    borderRadius: '999px',
                    backgroundColor: 'rgba(0, 122, 255, 0.08)',
                    color: '#007AFF',
                    padding: '2px 10px',
                    fontSize: '11.5px',
                    fontWeight: 600,
                  }}
                >
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {previewSpec && (
        <PrintPreviewModal
          projectId={studyPackage.project_id}
          studyPackage={studyPackage}
          documentIr={documentIr}
          docType={previewSpec.docType}
          paperSize={previewSpec.paperSize}
          includeAnswers={previewSpec.includeAnswers}
          exporting={Boolean(exportingPdfKey)}
          onChangeSpec={setPreviewSpec}
          onDownload={() =>
            handleExportPdf(
              previewSpec.docType,
              previewSpec.paperSize,
              previewSpec.includeAnswers
            )
          }
          onClose={() => setPreviewSpec(null)}
        />
      )}
    </div>
  );
};

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        borderRadius: '10px',
        backgroundColor: '#FFFFFF',
        border: '1px solid rgba(60, 60, 67, 0.08)',
        padding: '10px 12px',
      }}
    >
      <div style={{ fontSize: '10.5px', color: '#8E8E93', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '13px', fontWeight: 700, color: '#1C1C1E', marginTop: '3px' }}>
        {value}
      </div>
    </div>
  );
}

function PrintPreviewModal({
  studyPackage,
  documentIr,
  docType,
  paperSize,
  includeAnswers,
  exporting,
  onChangeSpec,
  onDownload,
  onClose,
}: {
  projectId: string;
  studyPackage: StudyPackage;
  documentIr?: DocumentIR | null;
  docType: 'quiz' | 'study_guide' | 'cheatsheet';
  paperSize: 'a4' | 'a3';
  includeAnswers: boolean;
  exporting: boolean;
  onChangeSpec: (next: {
    docType: 'quiz' | 'study_guide' | 'cheatsheet';
    paperSize: 'a4' | 'a3';
    includeAnswers: boolean;
  }) => void;
  onDownload: () => void;
  onClose: () => void;
}) {
  const isA3 = paperSize === 'a3';
  const quiz = studyPackage.quiz_paper;
  const mcqs = quiz.questions.filter((q) => q.type === 'mcq');
  const blanks = quiz.questions.filter((q) => q.type === 'fill_blank');
  const shorts = quiz.questions.filter((q) => q.type === 'short_answer');

  const mdPlugins = [remarkGfm, remarkMath];
  const rehypePlugins = [rehypeKatex];

  const renderMarkdownBlock = (md: string) => (
    <div className="prose prose-slate max-w-none prose-sm prose-headings:font-bold prose-headings:text-slate-900 prose-p:leading-relaxed prose-table:text-xs">
      <ReactMarkdown remarkPlugins={mdPlugins} rehypePlugins={rehypePlugins}>
        {normalizeMathMarkdown(md)}
      </ReactMarkdown>
    </div>
  );

  const renderQuestionList = (title: string, items: QuizQuestion[]) => {
    if (items.length === 0) return null;
    return (
      <div style={{ breakInside: 'avoid-column', marginBottom: '18px' }}>
        <div
          style={{
            fontSize: '13.5px',
            fontWeight: 800,
            color: '#0F172A',
            borderBottom: '1.5px solid #0F172A',
            paddingBottom: '4px',
            marginBottom: '10px',
          }}
        >
          {title}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {items.map((q, idx) => (
            <div
              key={q.id}
              style={{
                breakInside: 'avoid',
                fontSize: '12.5px',
                lineHeight: 1.65,
                color: '#1E293B',
              }}
            >
              <div style={{ fontWeight: 600 }}>
                <span>{idx + 1}. </span>
                <span style={{ color: '#475569', fontSize: '11px', marginRight: '4px' }}>
                  [{q.score}分]
                </span>
                <span className="inline [&>p]:inline">
                  <ReactMarkdown remarkPlugins={mdPlugins} rehypePlugins={rehypePlugins}>
                    {normalizeMathMarkdown(q.question)}
                  </ReactMarkdown>
                </span>
              </div>
              {q.options.length > 0 && (
                <div
                  style={{
                    marginTop: '4px',
                    paddingLeft: '14px',
                    display: 'grid',
                    gridTemplateColumns: isA3 ? '1fr 1fr' : '1fr',
                    gap: '3px 12px',
                    fontSize: '12px',
                    color: '#334155',
                  }}
                >
                  {q.options.map((opt, oi) => (
                    <div key={oi}>
                      <ReactMarkdown remarkPlugins={mdPlugins} rehypePlugins={rehypePlugins}>
                        {normalizeMathMarkdown(opt)}
                      </ReactMarkdown>
                    </div>
                  ))}
                </div>
              )}
              {q.type === 'short_answer' && (
                <div
                  style={{
                    marginTop: '8px',
                    height: '46px',
                    borderBottom: '1px dashed #CBD5E1',
                  }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div
      className="no-print"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        backgroundColor: 'rgba(15, 23, 42, 0.56)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        style={{
          width: 'min(1220px, 96vw)',
          height: '92vh',
          borderRadius: '18px',
          backgroundColor: '#FFFFFF',
          border: '1px solid rgba(60, 60, 67, 0.16)',
          boxShadow: '0 30px 70px -15px rgba(0, 0, 0, 0.35)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '12px 18px',
            borderBottom: '1px solid rgba(60, 60, 67, 0.12)',
            backgroundColor: '#F8FAFC',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13.5px', fontWeight: 700, color: '#0F172A' }}>
              独立印刷排版预览（纯预览不自动下载）
            </span>
            <SpringSegmentedControl<'quiz' | 'study_guide' | 'cheatsheet'>
              compact
              springLabel="预览文稿"
              value={docType}
              onChange={(nextDoc) =>
                onChangeSpec({ docType: nextDoc, paperSize, includeAnswers })
              }
              options={[
                { value: 'quiz', label: '标准试卷题库' },
                { value: 'study_guide', label: '自学案讲义(含例题)' },
                { value: 'cheatsheet', label: '考前速记表' },
              ]}
            />
            <SpringSegmentedControl<'a4' | 'a3'>
              compact
              springLabel="纸张版式"
              value={paperSize}
              onChange={(nextSize) =>
                onChangeSpec({ docType, paperSize: nextSize, includeAnswers })
              }
              options={[
                { value: 'a4', label: 'A4 竖版印刷' },
                { value: 'a3', label: 'A3 双栏密封线' },
              ]}
            />
            {docType !== 'cheatsheet' && (
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#334155',
                  cursor: 'pointer',
                  padding: '4px 8px',
                  borderRadius: '999px',
                  backgroundColor: '#FFFFFF',
                  border: '1px solid rgba(60, 60, 67, 0.14)',
                }}
              >
                <input
                  type="checkbox"
                  checked={includeAnswers}
                  onChange={(e) =>
                    onChangeSpec({
                      docType,
                      paperSize,
                      includeAnswers: e.target.checked,
                    })
                  }
                />
                <span>{docType === 'quiz' ? '附参考答案与解析' : '附边学边练与解析'}</span>
              </label>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <SpringButton
              springLabel="下载预览PDF"
              disabled={exporting}
              onClick={onDownload}
              maxShift={5}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                borderRadius: '999px',
                border: 'none',
                backgroundColor: '#007AFF',
                color: '#FFFFFF',
                padding: '6px 14px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: exporting ? 'wait' : 'pointer',
              }}
            >
              <Download className="w-3.5 h-3.5" />
              <span>{exporting ? '正在生成 PDF...' : `确认下载 ${paperSize.toUpperCase()} PDF`}</span>
            </SpringButton>
            <button
              onClick={onClose}
              style={{
                borderRadius: '999px',
                border: '1px solid rgba(60, 60, 67, 0.14)',
                backgroundColor: '#FFFFFF',
                padding: '6px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="关闭预览"
            >
              <X className="w-4 h-4 text-[#636366]" />
            </button>
          </div>
        </div>

        {/* Simulated Printed Paper Canvas (never triggers automatic PDF download) */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            backgroundColor: '#CBD5E1',
            padding: '28px 24px 48px',
          }}
        >
          <div
            style={{
              width: isA3 ? '1080px' : '780px',
              maxWidth: '100%',
              margin: '0 auto',
              backgroundColor: '#FFFFFF',
              boxShadow: '0 22px 50px -14px rgba(15, 23, 42, 0.28)',
              border: '1px solid #94A3B8',
              borderRadius: '4px',
              display: 'flex',
              minHeight: isA3 ? '740px' : '1040px',
            }}
          >
            {/* Left Binding Sealed Column for A3 Exam Paper */}
            {isA3 && (
              <div
                style={{
                  width: '74px',
                  flexShrink: 0,
                  borderRight: '2px dashed #475569',
                  padding: '24px 10px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  backgroundColor: '#FAFAFC',
                  color: '#334155',
                  fontSize: '11px',
                  fontWeight: 600,
                }}
              >
                <div style={{ writingMode: 'vertical-rl', letterSpacing: '0.28em' }}>
                  学校：________ 班级：________ 姓名：________ 学号：________
                </div>
                <div
                  style={{
                    writingMode: 'vertical-rl',
                    letterSpacing: '0.35em',
                    color: '#0F172A',
                    fontWeight: 800,
                  }}
                >
                  装 订 密 封 线 · 严 禁 答 题
                </div>
              </div>
            )}

            {/* Main Sheet Body */}
            <div style={{ flex: 1, minWidth: 0, padding: isA3 ? '30px 36px' : '40px 44px' }}>
              {/* Paper Masthead */}
              <div
                style={{
                  textAlign: 'center',
                  borderBottom: '2px solid #0F172A',
                  paddingBottom: '12px',
                  marginBottom: '18px',
                }}
              >
                <div style={{ fontSize: '11px', color: '#64748B', fontWeight: 600, letterSpacing: '0.06em' }}>
                  {isA3 ? 'A3 横向双栏独立印刷版式预览' : 'A4 竖版独立印刷版式预览'}
                  {documentIr ? ` · 来源：《${documentIr.filename}》` : ''}
                </div>
                <h1
                  style={{
                    fontSize: '19px',
                    fontWeight: 800,
                    color: '#0F172A',
                    marginTop: '4px',
                  }}
                >
                  {docType === 'quiz'
                    ? quiz.title
                    : docType === 'cheatsheet'
                    ? `${studyPackage.blueprint_used.blueprint_title} · 考前速记浓缩表`
                    : `${studyPackage.blueprint_used.blueprint_title} · 自学导学印刷讲义`}
                </h1>
                {docType === 'quiz' && (
                  <div
                    style={{
                      marginTop: '6px',
                      fontSize: '11.5px',
                      color: '#334155',
                      display: 'flex',
                      justifyContent: 'center',
                      gap: '18px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span>建议用时：{quiz.suggested_minutes} 分钟</span>
                    <span>卷面满分：{quiz.total_score} 分</span>
                    <span>题量：单选 {mcqs.length} / 填空 {blanks.length} / 简答 {shorts.length}</span>
                  </div>
                )}
              </div>

              {/* Paper Content Columns */}
              <div
                style={
                  isA3
                    ? {
                        columnCount: 2,
                        columnGap: '34px',
                        columnRule: '1px dashed #CBD5E1',
                      }
                    : undefined
                }
              >
                {docType === 'quiz' && (
                  <>
                    <div
                      style={{
                        fontSize: '11.5px',
                        color: '#475569',
                        backgroundColor: '#F8FAFC',
                        border: '1px solid #E2E8F0',
                        padding: '8px 10px',
                        borderRadius: '4px',
                        marginBottom: '14px',
                      }}
                    >
                      注意事项：{quiz.instructions}
                    </div>
                    {renderQuestionList('一、单项选择题', mcqs)}
                    {renderQuestionList('二、填空题', blanks)}
                    {renderQuestionList('三、简答与综合应用题', shorts)}

                    {includeAnswers && quiz.questions.length > 0 && (
                      <div
                        style={{
                          marginTop: '22px',
                          paddingTop: '14px',
                          borderTop: '2px solid #0F172A',
                        }}
                      >
                        <div style={{ fontSize: '14px', fontWeight: 800, color: '#0F172A', marginBottom: '10px' }}>
                          参考答案与详细解析
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '11.5px', color: '#1E293B' }}>
                          {quiz.questions.map((q, idx) => (
                            <div key={q.id} style={{ breakInside: 'avoid' }}>
                              <strong>第 {idx + 1} 题答案：</strong>
                              <span>{q.answer}</span>
                              <div style={{ color: '#475569', marginTop: '2px' }}>
                                解析：{q.explanation}（{q.source_chapter} {q.source_page}）
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {docType === 'study_guide' && (
                  <>
                    {renderMarkdownBlock(
                      studyPackage.study_notes_markdown || '_本次方案未生成自学导学讲义正文_'
                    )}
                    {includeAnswers && quiz.questions.length > 0 && (
                      <div
                        style={{
                          marginTop: '22px',
                          paddingTop: '14px',
                          borderTop: '2px solid #0F172A',
                        }}
                      >
                        <div style={{ fontSize: '14px', fontWeight: 800, color: '#0F172A', marginBottom: '10px' }}>
                          随堂边学边练与参考解析
                        </div>
                        {quiz.questions.map((q, idx) => (
                          <div key={q.id} style={{ marginBottom: '10px', fontSize: '12px', breakInside: 'avoid' }}>
                            <div style={{ fontWeight: 600 }}>
                              {idx + 1}. {q.question}
                            </div>
                            <div style={{ color: '#0369A1', marginTop: '2px' }}>
                              答案：{q.answer} ｜ 解析：{q.explanation}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {docType === 'cheatsheet' &&
                  renderMarkdownBlock(
                    studyPackage.cheatsheet_markdown || '_本次方案未生成考前速记表_'
                  )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyDeliverableBanner({
  title,
  hint,
  onSwitch,
  switchLabel,
}: {
  title: string;
  hint: string;
  onSwitch: () => void;
  switchLabel: string;
}) {
  return (
    <div
      style={{
        borderRadius: '14px',
        border: '1px dashed rgba(60, 60, 67, 0.2)',
        backgroundColor: '#FAFAFC',
        padding: '36px 24px',
        textAlign: 'center',
      }}
    >
      <ClipboardCheck className="w-8 h-8 text-[#8E8E93] mx-auto" />
      <div style={{ fontSize: '14px', fontWeight: 700, color: '#1C1C1E', marginTop: '10px' }}>
        {title}
      </div>
      <p style={{ fontSize: '12px', color: '#636366', marginTop: '4px' }}>{hint}</p>
      <div style={{ marginTop: '14px' }}>
        <SpringButton
          springLabel="切换产物标签"
          onClick={onSwitch}
          maxShift={5}
          style={{
            borderRadius: '999px',
            border: '1px solid rgba(0, 122, 255, 0.28)',
            backgroundColor: 'rgba(0, 122, 255, 0.08)',
            color: '#007AFF',
            padding: '7px 14px',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {switchLabel}
        </SpringButton>
      </div>
    </div>
  );
}
