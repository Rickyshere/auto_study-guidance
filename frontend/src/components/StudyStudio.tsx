import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  ArrowRight,
  BookmarkCheck,
  BookmarkPlus,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  Columns2,
  Copy,
  Download,
  Eye,
  ExternalLink,
  FileText,
  Layers,
  Network,
  Printer,
  RotateCcw,
  Shuffle,
  Sparkles,
  X,
  XCircle,
  Zap,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { api } from '../api';
import {
  DocumentIR,
  KnowledgeFlashcard,
  QuizPaper,
  QuizQuestion,
  ScenarioType,
  StudyPackage,
} from '../types';
import { SpringButton, SpringSegmentedControl } from '../utils/springPhysics';
import { MathMarkdown } from './MathMarkdown';

mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
});

export type StudioTabKey =
  | 'notes'
  | 'quiz'
  | 'quiz_similar'
  | 'quiz_original'
  | 'flashcards'
  | 'cheatsheet'
  | 'mindmap'
  | 'blueprint_trace';

interface Props {
  studyPackage: StudyPackage;
  documentIr?: DocumentIR | null;
  activeTab: StudioTabKey;
  onChangeTab: (tab: StudioTabKey) => void;
  onUpdatePackage?: (updated: StudyPackage) => void;
  onRequestAuth?: () => void;
  darkMode: boolean;
}

interface FlashcardItem {
  id: string;
  front: string;
  answer: string;
  explanation: string;
  badge: string;
  source: string;
}

function sanitizeMermaidClient(raw: string): string {
  if (!raw) return 'flowchart LR\n  A["知识核心"] --> B["内容空"]';
  let text = raw
    .trim()
    .replace(/^```(?:mermaid)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  text = text.replace(/\[([^\]"'\n]+)\]/g, (_m, inner) => {
    const clean = String(inner).replace(/"/g, "'").trim();
    return `["${clean}"]`;
  });
  if (!/^(flowchart|graph|mindmap|sequenceDiagram)/m.test(text)) {
    text = `flowchart LR\n${text}`;
  }
  return text;
}

function downloadText(filename: string, content: string, mime = 'text/markdown;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function extractOptionLetter(opt: string, index: number): string {
  const match = opt.trim().match(/^([A-D])[.、:：\s]/i);
  if (match) return match[1].toUpperCase();
  return String.fromCharCode(65 + index);
}

function isMcqOptionCorrect(opt: string, index: number, answer: string): boolean {
  const ans = (answer || '').trim().toUpperCase();
  const letter = extractOptionLetter(opt, index);
  if (!ans) return false;
  if (ans === letter) return true;
  if (ans.startsWith(`${letter}.`) || ans.startsWith(`${letter}、`) || ans.startsWith(`${letter} `)) {
    return true;
  }
  const cleanOpt = opt.trim().replace(/^[A-D][.、:：\s]+/i, '').trim().toUpperCase();
  return cleanOpt === ans;
}

function normalizeBlankAnswer(val: string): string {
  return (val || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。；：、“”‘’"'`]/g, '');
}

function getScenarioMeta(scenario?: ScenarioType): {
  tag: string;
  notesTitle: string;
  cheatsheetTitle: string;
  quizSectionTitle: string;
} {
  if (scenario === 'A_beginner') {
    return {
      tag: 'A · 入门 / 零基础学习',
      notesTitle: '详细自学案（附带例题）',
      cheatsheetTitle: '考前速记（核心知识点与公式）',
      quizSectionTitle: '同步练习与单元检测',
    };
  }
  if (scenario === 'C_sprint') {
    return {
      tag: 'C · 考前冲刺（抱佛脚）',
      notesTitle: '重要知识提取',
      cheatsheetTitle: '考前速记浓缩卡',
      quizSectionTitle: '佛教卷（高频考点冲刺突击）',
    };
  }
  return {
    tag: 'B · 巩固提高',
    notesTitle: '结构化深化笔记',
    cheatsheetTitle: '核心公式与方法速记',
    quizSectionTitle: '分章节巩固与综合检测',
  };
}

function stripQuizOptionLeakage(text: string): string {
  return (text || '')
    .trim()
    .replace(/^(?:本题|答案|参考答案)?(?:选|为|是)\s*[A-D](?:[.、:：\s]+)?/i, '')
    .replace(/(?:故选|因此选|故正确答案为)\s*[A-D][。.]?/gi, '')
    .trim();
}

function buildKnowledgeFlashcardDeck(
  studyPackage: StudyPackage,
  documentIr?: DocumentIR | null
): FlashcardItem[] {
  // 1. Prefer backend-extracted dedicated knowledge-point flashcards
  if (studyPackage.flashcards && studyPackage.flashcards.length > 0) {
    return studyPackage.flashcards.map((fc: KnowledgeFlashcard) => ({
      id: fc.id,
      front: fc.front,
      answer: fc.answer || '（详见背面记忆要点）',
      explanation: fc.explanation || '结合教材或讲义原文深化理解。',
      badge: fc.category || '核心概念',
      source: fc.source || documentIr?.filename || '知识体系梳理',
    }));
  }

  // 2. Legacy fallback for previously saved packages (strictly NO quiz stems or MCQ options)
  const cards: FlashcardItem[] = [];
  const seen = new Set<string>();
  const addCard = (
    id: string,
    front: string,
    answer: string,
    explanation: string,
    badge: string,
    source: string
  ) => {
    const key = answer.replace(/\s+/g, '').slice(0, 40).toLowerCase();
    if (!key || seen.has(key) || cards.length >= 18) return;
    seen.add(key);
    cards.push({ id, front, answer, explanation, badge, source });
  };

  // 2a. Exam blueprint knowledge skeletons (from Agent B, never question stems)
  const blueprints = studyPackage.exam_pipeline_metadata?.question_blueprints || [];
  for (const bp of blueprints) {
    const kpLabel = bp.knowledge_points?.filter(Boolean).join(' / ') || `第 ${bp.question_id} 题考点`;
    const traps = (bp.distractor_recipe || [])
      .map((r) => `- **${r.trap_type || '干扰陷阱'}**：${r.detail}`)
      .join('\n');
    addCard(
      `kf_bp_${bp.question_id}`,
      `**【核心考点回忆】** 请阐述「${kpLabel}」的核心推导机制，并指出常见命题设错陷阱。`,
      bp.original_skeleton || kpLabel,
      traps || bp.generation_directive || '注重因果推导链条与边界条件识别。',
      '高频考点与避坑',
      `Agent B 解构 · 原卷第 ${bp.question_id} 题`
    );
  }

  // 2b. Cheatsheet & Study Notes concepts/formulas
  const sources: Array<[string, string]> = [
    ['考前速记', studyPackage.cheatsheet_markdown || ''],
    studyPackage.exam_pipeline_metadata
      ? ['课程讲义', '']
      : ['学习讲义', studyPackage.study_notes_markdown || ''],
  ];
  for (const [srcLabel, md] of sources) {
    if (!md) continue;
    const sections = md.split(/\n(?=##+ )/).slice(0, 10);
    sections.forEach((sec, idx) => {
      const lines = sec.trim().split('\n');
      const heading = (lines[0] || '').replace(/^#+\s*/, '').replace(/\*\*/g, '').trim();
      const body = lines.slice(1).join('\n').trim();
      if (!heading || !body || /例题|答案|自测|目录/.test(heading)) return;
      const bullets = lines
        .slice(1)
        .map((ln) => ln.replace(/^[-*+\d.、\s]+/, '').trim())
        .filter((ln) => ln && !ln.startsWith('#'));
      addCard(
        `kf_sec_${srcLabel}_${idx}`,
        `**【知识点梳理】** 回忆「${heading}」的核心概念、公式表达或关键结论。`,
        (bullets[0] || body.split('\n')[0] || heading).slice(0, 140),
        body.slice(0, 420) + (body.length > 420 ? '\n...' : ''),
        body.includes('$') ? '核心公式与概念' : '知识模块',
        `${srcLabel} · ${heading}`
      );
    });
  }

  // 2c. Knowledge tags & conceptual takeaways from quiz explanations (strictly excluding q.question & q.options)
  if (cards.length < 12 && studyPackage.quiz_paper?.questions) {
    studyPackage.quiz_paper.questions.forEach((q, idx) => {
      const kp = q.knowledge_tags?.[0] || q.source_chapter || '';
      const cleanExp = stripQuizOptionLeakage(q.explanation || '');
      if (!kp || !cleanExp) return;
      addCard(
        `kf_tag_${idx}`,
        `**【考点与避坑记忆】** 关于「${kp}」，其核心规律与易错点是什么？`,
        kp,
        cleanExp.slice(0, 380) + (cleanExp.length > 380 ? '...' : ''),
        '考点规律',
        q.source_chapter || '核心知识点'
      );
    });
  }

  // 2d. Document chapters key terms
  if (cards.length < 6 && documentIr?.chapters) {
    documentIr.chapters.forEach((ch, idx) => {
      (ch.key_terms || []).slice(0, 3).forEach((term, ti) => {
        addCard(
          `kf_ch_${idx}_${ti}`,
          `**【核心概念辨析】** 结合《${ch.title}》，简述「${term}」的核心定义与作用。`,
          term,
          ch.summary_preview || ch.content_text.slice(0, 260),
          '核心术语',
          `${ch.title} · P${ch.start_page}`
        );
      });
    });
  }

  return cards;
}

export const StudyStudio: React.FC<Props> = ({
  studyPackage,
  documentIr,
  activeTab,
  onChangeTab,
  onUpdatePackage,
  onRequestAuth,
  darkMode,
}) => {
  const scenarioMeta = useMemo(
    () => getScenarioMeta(studyPackage.blueprint_used.scenario_type),
    [studyPackage.blueprint_used.scenario_type]
  );

  // Combine main paper and extra papers for Scenario A / B multi-paper support
  const allPapers: QuizPaper[] = useMemo(() => {
    const raw = [studyPackage.quiz_paper, ...(studyPackage.extra_quiz_papers || [])];
    const unique: QuizPaper[] = [];
    const seen = new Set<string>();
    for (const p of raw) {
      if (!p) continue;
      if (seen.has(p.paper_id)) continue;
      seen.add(p.paper_id);
      if (p.questions.length > 0 || unique.length === 0) {
        unique.push(p);
      }
    }
    return unique;
  }, [studyPackage.quiz_paper, studyPackage.extra_quiz_papers]);

  const [selectedPaperId, setSelectedPaperId] = useState<string>(
    studyPackage.quiz_paper?.paper_id || 'default'
  );

  const activePaper: QuizPaper = useMemo(() => {
    return (
      allPapers.find((p) => p.paper_id === selectedPaperId) ||
      allPapers[0] ||
      studyPackage.quiz_paper
    );
  }, [allPapers, selectedPaperId, studyPackage.quiz_paper]);

  // Quiz state scoped by paper_id -> question_id
  const [answersByPaper, setAnswersByPaper] = useState<Record<string, Record<string, string>>>({});
  const [checkedBlankByPaper, setCheckedBlankByPaper] = useState<
    Record<string, Record<string, boolean>>
  >({});
  const [openDrawerIds, setOpenDrawerIds] = useState<Record<string, boolean>>({});
  const [wrongBookIds, setWrongBookIds] = useState<Record<string, boolean>>({});
  const [wrongBookFilterOnly, setWrongBookFilterOnly] = useState<boolean>(false);
  const [currentCardIdx, setCurrentCardIdx] = useState<number>(0);
  const [shakeQuestionId, setShakeQuestionId] = useState<string | null>(null);
  const [generatingVariantId, setGeneratingVariantId] = useState<string | null>(null);
  const [variantError, setVariantError] = useState<string | null>(null);

  // Flashcards state + 3D single-face Chromium-safe flip animation
  const [flashDeck, setFlashDeck] = useState<FlashcardItem[]>([]);
  const [flashIdx, setFlashIdx] = useState<number>(0);
  const [isFlashFlipped, setIsFlashFlipped] = useState<boolean>(false);
  const [visualFlipDeg, setVisualFlipDeg] = useState<number>(0);
  const [masteredFlashIds, setMasteredFlashIds] = useState<Record<string, boolean>>({});
  const [reviewFlashIds, setReviewFlashIds] = useState<Record<string, boolean>>({});
  const [flashRoundFinished, setFlashRoundFinished] = useState<boolean>(false);
  const flipRafRef = useRef<number | null>(null);

  // PDF / Print / Mermaid states
  const [exportingPdfKey, setExportingPdfKey] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [previewSpec, setPreviewSpec] = useState<{
    docType: 'quiz' | 'study_guide' | 'cheatsheet';
    paperSize: 'a4' | 'a3';
    includeAnswers: boolean;
  } | null>(null);

  const mermaidRef = useRef<HTMLDivElement | null>(null);
  const [mermaidSvg, setMermaidSvg] = useState<string>('');
  const [mermaidError, setMermaidError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(1);

  const isExamMode =
    documentIr?.project_type === 'exam_paper' || Boolean(studyPackage.exam_pipeline_metadata);
  const isQuizTab =
    activeTab === 'quiz' || activeTab === 'quiz_similar' || activeTab === 'quiz_original';

  // Keep selected paper synchronized with Top Bar tabs (`变式卷` / `原卷`) in exam paper mode
  useEffect(() => {
    if (
      activeTab === 'quiz_similar' &&
      allPapers.some((p) => p.paper_id === 'similar_style_paper')
    ) {
      setSelectedPaperId('similar_style_paper');
      setCurrentCardIdx(0);
      setWrongBookFilterOnly(false);
    } else if (
      activeTab === 'quiz_original' &&
      allPapers.some((p) => p.paper_id === 'original_exam_bank')
    ) {
      setSelectedPaperId('original_exam_bank');
      setCurrentCardIdx(0);
      setWrongBookFilterOnly(false);
    }
  }, [activeTab, allPapers]);

  // Reset per package generation
  useEffect(() => {
    setSelectedPaperId(studyPackage.quiz_paper?.paper_id || 'default');
    setAnswersByPaper({});
    setCheckedBlankByPaper({});
    setOpenDrawerIds({});
    setWrongBookIds({});
    setWrongBookFilterOnly(false);
    setCurrentCardIdx(0);
    setVariantError(null);
  }, [studyPackage.generated_at, studyPackage.project_id]);

  // Rebuild dedicated knowledge-point flashcard deck per generated study package
  const baseFlashDeck = useMemo(
    () => buildKnowledgeFlashcardDeck(studyPackage, documentIr),
    [studyPackage, documentIr]
  );

  useEffect(() => {
    setFlashDeck(baseFlashDeck);
    setFlashIdx(0);
    setIsFlashFlipped(false);
    setVisualFlipDeg(0);
    setMasteredFlashIds({});
    setReviewFlashIds({});
    setFlashRoundFinished(false);
  }, [baseFlashDeck]);

  // Smooth RAF-driven angle animation for 3D single-face flip (0 <-> 180)
  useEffect(() => {
    if (flipRafRef.current) cancelAnimationFrame(flipRafRef.current);
    const target = isFlashFlipped ? 180 : 0;
    const start = visualFlipDeg;
    if (Math.abs(target - start) < 0.5) {
      setVisualFlipDeg(target);
      return;
    }
    const startTime = performance.now();
    const duration = 340;
    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / duration);
      // ease-out cubic mimicking spring-card curve
      const eased = 1 - Math.pow(1 - t, 3);
      setVisualFlipDeg(start + (target - start) * eased);
      if (t < 1) {
        flipRafRef.current = requestAnimationFrame(step);
      }
    };
    flipRafRef.current = requestAnimationFrame(step);
    return () => {
      if (flipRafRef.current) cancelAnimationFrame(flipRafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFlashFlipped]);

  // Render Mermaid diagram
  useEffect(() => {
    if (activeTab !== 'mindmap' || !studyPackage.mindmap_mermaid) return;
    let cancelled = false;
    (async () => {
      try {
        setMermaidError(null);
        mermaid.initialize({
          startOnLoad: false,
          theme: darkMode ? 'dark' : 'default',
          securityLevel: 'loose',
        });
        const id = `mm_${Date.now()}`;
        const sanitized = sanitizeMermaidClient(studyPackage.mindmap_mermaid);
        const { svg } = await mermaid.render(id, sanitized);
        if (!cancelled) setMermaidSvg(svg);
      } catch (e: any) {
        if (!cancelled) {
          setMermaidSvg('');
          setMermaidError(e?.message || 'Mermaid 语法渲染失败');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab, studyPackage.mindmap_mermaid, darkMode]);

  const currentPaperAnswers = answersByPaper[activePaper.paper_id] || {};
  const currentPaperChecked = checkedBlankByPaper[activePaper.paper_id] || {};

  const visibleQuestions: QuizQuestion[] = useMemo(() => {
    const qs = activePaper?.questions || [];
    if (!wrongBookFilterOnly) return qs;
    return qs.filter((q) => Boolean(wrongBookIds[q.id]));
  }, [activePaper?.questions, wrongBookFilterOnly, wrongBookIds]);

  useEffect(() => {
    if (currentCardIdx >= visibleQuestions.length && visibleQuestions.length > 0) {
      setCurrentCardIdx(visibleQuestions.length - 1);
    } else if (visibleQuestions.length === 0 && currentCardIdx !== 0) {
      setCurrentCardIdx(0);
    }
  }, [visibleQuestions.length, currentCardIdx]);

  const currentQuestion = visibleQuestions[currentCardIdx];

  const handleSelectMcqOption = (q: QuizQuestion, opt: string, optIdx: number) => {
    const letter = extractOptionLetter(opt, optIdx);
    setAnswersByPaper((prev) => ({
      ...prev,
      [activePaper.paper_id]: {
        ...(prev[activePaper.paper_id] || {}),
        [q.id]: letter,
      },
    }));
    const correct = isMcqOptionCorrect(opt, optIdx, q.answer);
    if (!correct) {
      setShakeQuestionId(q.id);
      setTimeout(() => setShakeQuestionId((id) => (id === q.id ? null : id)), 420);
      setOpenDrawerIds((prev) => ({ ...prev, [q.id]: true }));
      setWrongBookIds((prev) => ({ ...prev, [q.id]: true }));
    }
  };

  const handleSubmitNonMcq = (q: QuizQuestion) => {
    setCheckedBlankByPaper((prev) => ({
      ...prev,
      [activePaper.paper_id]: {
        ...(prev[activePaper.paper_id] || {}),
        [q.id]: true,
      },
    }));
    setOpenDrawerIds((prev) => ({ ...prev, [q.id]: true }));
    if (q.type === 'fill_blank') {
      const userAns = normalizeBlankAnswer(currentPaperAnswers[q.id] || '');
      const stdAns = normalizeBlankAnswer(q.answer);
      if (userAns && stdAns && userAns !== stdAns) {
        setWrongBookIds((prev) => ({ ...prev, [q.id]: true }));
      }
    }
  };

  const toggleWrongBook = (qId: string) => {
    setWrongBookIds((prev) => ({
      ...prev,
      [qId]: !prev[qId],
    }));
  };

  const handleGenerateVariant = async (q: QuizQuestion) => {
    setGeneratingVariantId(q.id);
    setVariantError(null);
    try {
      const selectedChapterIds = studyPackage.blueprint_used?.selected_chapter_ids || [];
      const res = await api.generateVariantQuestion(
        studyPackage.project_id,
        q,
        selectedChapterIds
      );
      const newQ = res.question;
      if (onUpdatePackage) {
        const injectIntoPaper = (paper: QuizPaper): QuizPaper => {
          if (paper.paper_id !== activePaper.paper_id) return paper;
          const idx = paper.questions.findIndex((item) => item.id === q.id);
          const nextQuestions = [...paper.questions];
          nextQuestions.splice(idx >= 0 ? idx + 1 : nextQuestions.length, 0, newQ);
          return {
            ...paper,
            total_score: paper.total_score + (newQ.score || 0),
            questions: nextQuestions,
          };
        };

        const updatedPkg: StudyPackage = {
          ...studyPackage,
          quiz_paper: injectIntoPaper(studyPackage.quiz_paper),
          extra_quiz_papers: (studyPackage.extra_quiz_papers || []).map(injectIntoPaper),
        };
        onUpdatePackage(updatedPkg);
      }
      setWrongBookFilterOnly(false);
      setCurrentCardIdx((prev) => prev + 1);
    } catch (e: any) {
      const msg = e?.message || '变式题生成失败';
      setVariantError(msg);
      if (
        msg.includes('AUTH_REQUIRED') ||
        msg.includes('未授权') ||
        msg.includes('CLOUD_NOT_CONFIGURED')
      ) {
        onRequestAuth?.();
      }
    } finally {
      setGeneratingVariantId(null);
    }
  };

  const advanceFlashcard = useCallback(
    (status: 'mastered' | 'review') => {
      if (flashRoundFinished || flashDeck.length === 0) return;
      const cur = flashDeck[flashIdx];
      if (!cur) return;

      if (status === 'mastered') {
        setMasteredFlashIds((prev) => ({ ...prev, [cur.id]: true }));
        setReviewFlashIds((prev) => {
          const next = { ...prev };
          delete next[cur.id];
          return next;
        });
      } else {
        setReviewFlashIds((prev) => ({ ...prev, [cur.id]: true }));
        setMasteredFlashIds((prev) => {
          const next = { ...prev };
          delete next[cur.id];
          return next;
        });
      }

      setIsFlashFlipped(false);
      setVisualFlipDeg(0);
      if (flashIdx + 1 >= flashDeck.length) {
        setFlashRoundFinished(true);
      } else {
        setFlashIdx((i) => i + 1);
      }
    },
    [flashDeck, flashIdx, flashRoundFinished]
  );

  const handleReviewPendingFlashcards = () => {
    const needReview = baseFlashDeck.filter((c) => reviewFlashIds[c.id]);
    const nextDeck = needReview.length > 0 ? needReview : flashDeck.filter((c) => reviewFlashIds[c.id]);
    if (nextDeck.length === 0) return;
    setFlashDeck(nextDeck);
    setFlashIdx(0);
    setIsFlashFlipped(false);
    setVisualFlipDeg(0);
    setFlashRoundFinished(false);
  };

  const handleShuffleRestartFlashcards = () => {
    setFlashDeck(shuffleArray(baseFlashDeck));
    setFlashIdx(0);
    setIsFlashFlipped(false);
    setVisualFlipDeg(0);
    setMasteredFlashIds({});
    setReviewFlashIds({});
    setFlashRoundFinished(false);
  };

  // Global keyboard shortcuts when Quiz or Knowledge Flashcards tab is open
  useEffect(() => {
    if ((!isQuizTab && activeTab !== 'flashcards') || previewSpec) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (isQuizTab) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setCurrentCardIdx((i) => Math.max(0, i - 1));
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          setCurrentCardIdx((i) => Math.min(Math.max(0, visibleQuestions.length - 1), i + 1));
        }
      } else if (activeTab === 'flashcards' && !flashRoundFinished) {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          setIsFlashFlipped((f) => !f);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          advanceFlashcard('review');
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          advanceFlashcard('mastered');
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activeTab,
    isQuizTab,
    previewSpec,
    visibleQuestions.length,
    flashRoundFinished,
    advanceFlashcard,
  ]);

  const handleExportPdf = async (
    docType: 'quiz' | 'study_guide' | 'cheatsheet',
    paperSize: 'a4' | 'a3',
    includeAnswers = true,
    overridePaperId?: string
  ) => {
    const paperId = docType === 'quiz' ? overridePaperId || activePaper.paper_id : undefined;
    const key = `${docType}-${paperSize}-${paperId || 'main'}`;
    setExportingPdfKey(key);
    setPdfError(null);
    try {
      await api.exportPdf(studyPackage.project_id, {
        doc_type: docType,
        paper_size: paperSize,
        include_answers: includeAnswers,
        paper_id: paperId,
      });
    } catch (e: any) {
      setPdfError(e?.message || 'PDF 导出失败');
    } finally {
      setExportingPdfKey(null);
    }
  };

  const handleCopyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleExportMindmapSvg = () => {
    if (mermaidSvg) {
      downloadText(
        `${studyPackage.blueprint_used.blueprint_title || 'mindmap'}.svg`,
        mermaidSvg,
        'image/svg+xml;charset=utf-8'
      );
      return;
    }
    const svgEl = mermaidRef.current?.querySelector('svg');
    if (svgEl) {
      const serializer = new XMLSerializer();
      downloadText(
        `${studyPackage.blueprint_used.blueprint_title || 'mindmap'}.svg`,
        serializer.serializeToString(svgEl),
        'image/svg+xml;charset=utf-8'
      );
    }
  };

  // Statistics for progress bar & wrongbook count
  const answeredCount = useMemo(() => {
    const qs = activePaper?.questions || [];
    return qs.filter((q) => {
      const ans = currentPaperAnswers[q.id];
      if (q.type === 'mcq') return Boolean(ans);
      return Boolean(currentPaperChecked[q.id] || (ans && ans.trim().length > 0));
    }).length;
  }, [activePaper?.questions, currentPaperAnswers, currentPaperChecked]);

  const wrongBookCount = useMemo(() => {
    const qs = activePaper?.questions || [];
    return qs.filter((q) => Boolean(wrongBookIds[q.id])).length;
  }, [activePaper?.questions, wrongBookIds]);

  const progressPercent =
    activePaper?.questions?.length > 0
      ? Math.round((answeredCount / activePaper.questions.length) * 100)
      : 0;

  // Derived counters for flashcards end-of-round settlement
  const masteredCount = Object.keys(masteredFlashIds).length;
  const reviewCount = Object.keys(reviewFlashIds).length;

  const hasNotes = Boolean(studyPackage.study_notes_markdown?.trim());
  const hasCheatsheet = Boolean(studyPackage.cheatsheet_markdown?.trim());
  const hasQuiz = (activePaper?.questions?.length || 0) > 0;
  const hasMindmap = Boolean(studyPackage.mindmap_mermaid?.trim());

  const showFrontSide = visualFlipDeg <= 90;
  const uprightFlipAngle = visualFlipDeg > 90 ? visualFlipDeg - 180 : visualFlipDeg;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {pdfError && (
        <div
          className="no-print"
          style={{
            borderRadius: '10px',
            border: '1px solid rgba(217, 119, 6, 0.35)',
            backgroundColor: darkMode ? '#3B2E17' : '#FEF3C7',
            color: darkMode ? '#FBBF24' : '#92400E',
            padding: '10px 14px',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>{pdfError}</span>
          <button
            onClick={() => setPdfError(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ================= TAB 1: NOTES / KEY EXTRACTION ================= */}
      {activeTab === 'notes' && (
        <section
          className="asg-card"
          data-glass-panel="true"
          style={{ padding: '24px' }}
        >
          {!hasNotes ? (
            <EmptyDeliverableBanner
              title="本次学习包未勾选讲义笔记类产物"
              hint="你可以切换到「在线练习」「考前速记」或「MindMap」，或在左侧步骤 3 中勾选生成对应资料。"
              onSwitch={() => onChangeTab('quiz')}
              switchLabel="前往在线练习"
            />
          ) : (
            <>
              <div
                className="no-print"
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  paddingBottom: '16px',
                  borderBottom: '1px solid var(--asg-border-default)',
                  marginBottom: '20px',
                }}
              >
                <div>
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: 'var(--asg-brand-primary)',
                      backgroundColor: 'var(--asg-brand-tint)',
                      padding: '3px 10px',
                      borderRadius: '9999px',
                      marginBottom: '6px',
                    }}
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>{isExamMode ? '试卷核心知识点提取与深度解析' : scenarioMeta.tag}</span>
                  </div>
                  <h2
                    style={{
                      fontSize: '20px',
                      fontWeight: 700,
                      color: 'var(--asg-text-primary)',
                      margin: 0,
                    }}
                  >
                    {isExamMode ? '知识点提取与讲解' : scenarioMeta.notesTitle} · {studyPackage.blueprint_used.blueprint_title}
                  </h2>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
                  <SpringButton
                    springLabel="打印预览讲义"
                    onClick={() =>
                      setPreviewSpec({ docType: 'study_guide', paperSize: 'a4', includeAnswers: true })
                    }
                    className="asg-btn-spring"
                    style={secondaryToolbarBtnStyle}
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>打印预览</span>
                  </SpringButton>
                  <SpringButton
                    springLabel="导出A4讲义"
                    disabled={Boolean(exportingPdfKey)}
                    onClick={() => handleExportPdf('study_guide', 'a4', true)}
                    className="asg-btn-spring"
                    style={primaryToolbarBtnStyle}
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{exportingPdfKey?.startsWith('study_guide-a4') ? '生成中...' : '导出 A4 PDF'}</span>
                  </SpringButton>
                  <SpringButton
                    springLabel="导出A3讲义"
                    disabled={Boolean(exportingPdfKey)}
                    onClick={() => handleExportPdf('study_guide', 'a3', true)}
                    className="asg-btn-spring"
                    style={secondaryToolbarBtnStyle}
                  >
                    <Columns2 className="w-3.5 h-3.5" />
                    <span>A3 双栏 PDF</span>
                  </SpringButton>
                  <button
                    type="button"
                    onClick={() =>
                      downloadText(
                        `${scenarioMeta.notesTitle}.md`,
                        studyPackage.study_notes_markdown
                      )
                    }
                    style={secondaryToolbarBtnStyle}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>导出 MD</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCopyText('notes', studyPackage.study_notes_markdown)}
                    style={secondaryToolbarBtnStyle}
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>{copiedKey === 'notes' ? '已复制' : '复制'}</span>
                  </button>
                </div>
              </div>

              <div className="asg-academic-prose" style={{ maxWidth: '760px', margin: '0 auto' }}>
                <MathMarkdown>{studyPackage.study_notes_markdown}</MathMarkdown>
              </div>
            </>
          )}
        </section>
      )}

      {/* ================= TAB 2: CARD-SWITCHING QUIZ + KEYBOARD FLASHCARDS ================= */}
      {isQuizTab && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {!hasQuiz ? (
            <div className="asg-card" data-glass-panel="true" style={{ padding: '28px' }}>
              <EmptyDeliverableBanner
                title="当前试卷暂无习题内容"
                hint="你可以在左侧栏重新配置参数后生成，或先查看知识点提取与讲解。"
                onSwitch={() => onChangeTab('notes')}
                switchLabel={isExamMode ? '查看知识点提取与讲解' : '查看知识讲义'}
              />
            </div>
          ) : (
            <>
              {/* Workspace Controls & Multi-Paper Bar */}
              <div
                className="asg-card no-print"
                data-glass-panel="true"
                style={{
                  padding: '16px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                  }}
                >
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '13px',
                        fontWeight: 700,
                        color: 'var(--asg-brand-primary)',
                        backgroundColor: 'var(--asg-brand-tint)',
                        padding: '5px 12px',
                        borderRadius: '9999px',
                      }}
                    >
                      <ClipboardCheck className="w-3.5 h-3.5" />
                      <span>
                        {activeTab === 'quiz_similar'
                          ? '变式卷 · 在线作答（← / → 切题）'
                          : activeTab === 'quiz_original'
                          ? '原卷 · 在线作答（← / → 切题）'
                          : '在线练习卡片（← / → 切题）'}
                      </span>
                    </span>

                    {allPapers.length > 1 && activeTab === 'quiz' && (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '12px', color: 'var(--asg-text-muted)', fontWeight: 600 }}>
                          切换试卷：
                        </span>
                        {allPapers.map((p) => {
                          const isAct = p.paper_id === activePaper.paper_id;
                          return (
                            <button
                              key={p.paper_id}
                              type="button"
                              onClick={() => {
                                setSelectedPaperId(p.paper_id);
                                setCurrentCardIdx(0);
                                setWrongBookFilterOnly(false);
                              }}
                              style={{
                                borderRadius: '9999px',
                                border: isAct
                                  ? '1px solid var(--asg-brand-primary)'
                                  : '1px solid var(--asg-border-default)',
                                backgroundColor: isAct
                                  ? 'var(--asg-brand-tint)'
                                  : 'var(--asg-bg-surface)',
                                color: isAct
                                  ? 'var(--asg-brand-primary)'
                                  : 'var(--asg-text-secondary)',
                                padding: '4px 12px',
                                fontSize: '12px',
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              {p.title} ({p.questions.length}题)
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={() => {
                        setWrongBookFilterOnly((v) => !v);
                        setCurrentCardIdx(0);
                      }}
                      style={{
                        ...secondaryToolbarBtnStyle,
                        borderColor: wrongBookFilterOnly
                          ? 'var(--asg-semantic-warning)'
                          : 'var(--asg-border-default)',
                        backgroundColor: wrongBookFilterOnly
                          ? 'var(--asg-warning-tint)'
                          : 'var(--asg-bg-surface)',
                        color: wrongBookFilterOnly
                          ? 'var(--asg-semantic-warning)'
                          : 'var(--asg-text-primary)',
                      }}
                    >
                      <BookmarkCheck className="w-3.5 h-3.5" />
                      <span>
                        {wrongBookFilterOnly
                          ? `仅看错题本 (${wrongBookCount})`
                          : `错题本 (${wrongBookCount})`}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setPreviewSpec({ docType: 'quiz', paperSize: 'a4', includeAnswers: true })
                      }
                      style={secondaryToolbarBtnStyle}
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>排版预览</span>
                    </button>
                    <SpringButton
                      springLabel="导出试卷A4"
                      disabled={Boolean(exportingPdfKey)}
                      onClick={() => handleExportPdf('quiz', 'a4', true, activePaper.paper_id)}
                      className="asg-btn-spring"
                      style={primaryToolbarBtnStyle}
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>导出试卷 A4</span>
                    </SpringButton>
                    <SpringButton
                      springLabel="导出试卷A3"
                      disabled={Boolean(exportingPdfKey)}
                      onClick={() => handleExportPdf('quiz', 'a3', true, activePaper.paper_id)}
                      className="asg-btn-spring"
                      style={secondaryToolbarBtnStyle}
                    >
                      <Columns2 className="w-3.5 h-3.5" />
                      <span>A3 双栏密封线</span>
                    </SpringButton>
                  </div>
                </div>

                {/* Practice Progress Bar + Question Pill Navigator */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: '12.5px',
                        color: 'var(--asg-text-secondary)',
                      }}
                    >
                      <span>
                        <strong>{activePaper.title}</strong> · 建议用时 {activePaper.suggested_minutes} 分钟 · 满分 {activePaper.total_score} 分
                      </span>
                      <span>
                        已作答 <strong>{answeredCount}</strong> / {activePaper.questions.length} 题（{progressPercent}%）
                      </span>
                    </div>

                    <div
                      style={{
                        width: '100%',
                        height: '6px',
                        borderRadius: '9999px',
                        backgroundColor: 'var(--asg-bg-subtle)',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${progressPercent}%`,
                          height: '100%',
                          backgroundColor: 'var(--asg-brand-primary)',
                          borderRadius: '9999px',
                          transition: 'width 320ms cubic-bezier(0.22, 1, 0.36, 1)',
                        }}
                      />
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {visibleQuestions.map((q, idx) => {
                        const isCur = idx === currentCardIdx;
                        const selected = currentPaperAnswers[q.id];
                        let pillBg = 'var(--asg-bg-subtle)';
                        let pillColor = 'var(--asg-text-secondary)';
                        let pillBorder = 'var(--asg-border-default)';

                        if (q.type === 'mcq' && selected) {
                          const optIdx = q.options.findIndex(
                            (o, oi) => extractOptionLetter(o, oi) === selected
                          );
                          const ok =
                            optIdx >= 0 && isMcqOptionCorrect(q.options[optIdx], optIdx, q.answer);
                          if (ok) {
                            pillBg = 'var(--asg-success-tint)';
                            pillColor = 'var(--asg-semantic-success)';
                            pillBorder = 'var(--asg-semantic-success)';
                          } else {
                            pillBg = 'var(--asg-warning-tint)';
                            pillColor = 'var(--asg-semantic-warning)';
                            pillBorder = 'var(--asg-semantic-warning)';
                          }
                        } else if (wrongBookIds[q.id]) {
                          pillBg = 'var(--asg-warning-tint)';
                          pillColor = 'var(--asg-semantic-warning)';
                          pillBorder = 'var(--asg-semantic-warning)';
                        } else if (currentPaperChecked[q.id] || (selected && selected.trim())) {
                          pillBg = 'var(--asg-brand-tint)';
                          pillColor = 'var(--asg-brand-primary)';
                          pillBorder = 'var(--asg-brand-primary)';
                        }

                        return (
                          <button
                            key={q.id}
                            type="button"
                            onClick={() => setCurrentCardIdx(idx)}
                            style={{
                              minWidth: '30px',
                              height: '30px',
                              padding: '0 8px',
                              borderRadius: '8px',
                              border: `1.5px solid ${isCur ? 'var(--asg-brand-primary)' : pillBorder}`,
                              backgroundColor: isCur ? 'var(--asg-brand-primary)' : pillBg,
                              color: isCur ? '#FFFFFF' : pillColor,
                              fontSize: '12px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              transition: 'transform 160ms ease',
                            }}
                            title={`跳转到第 ${idx + 1} 题`}
                          >
                            {idx + 1}
                          </button>
                        );
                      })}
                    </div>
                  </div>
              </div>

              {/* ---------- SINGLE-CARD QUIZ PRACTICE ---------- */}
              <div style={{ maxWidth: '760px', width: '100%', margin: '0 auto' }}>
                  {visibleQuestions.length === 0 ? (
                    <div
                      className="asg-card"
                      data-glass-panel="true"
                      style={{ padding: '40px 24px', textAlign: 'center' }}
                    >
                      <BookmarkCheck
                        className="w-10 h-10 mx-auto mb-3"
                        style={{ color: 'var(--asg-semantic-success)' }}
                      />
                      <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--asg-text-primary)' }}>
                        错题本目前为空
                      </div>
                      <p style={{ fontSize: '13.5px', color: 'var(--asg-text-secondary)', marginTop: '6px' }}>
                        答错题目或点击解析区「+ 加入错题本」后，可在这里集中针对复习。
                      </p>
                      <button
                        type="button"
                        onClick={() => setWrongBookFilterOnly(false)}
                        style={{ ...primaryToolbarBtnStyle, marginTop: '14px' }}
                      >
                        返回全部题目 ({activePaper.questions.length} 题)
                      </button>
                    </div>
                  ) : (
                    currentQuestion && (
                      <article
                        key={currentQuestion.id}
                        className={`asg-card ${shakeQuestionId === currentQuestion.id ? 'asg-shake' : ''}`}
                        data-glass-panel="true"
                        style={{
                          padding: '24px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '20px',
                        }}
                      >
                        {/* Card Metadata Header */}
                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '8px',
                          }}
                        >
                          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
                            <span
                              style={{
                                fontFamily: 'JetBrains Mono, monospace',
                                fontSize: '12px',
                                fontWeight: 700,
                                color: 'var(--asg-brand-primary)',
                                backgroundColor: 'var(--asg-brand-tint)',
                                padding: '3px 10px',
                                borderRadius: '6px',
                              }}
                            >
                              第 {currentCardIdx + 1} / {visibleQuestions.length} 题
                            </span>
                            <span style={metaTagStyle}>
                              {currentQuestion.type === 'mcq'
                                ? '单选题'
                                : currentQuestion.type === 'fill_blank'
                                ? '填空题'
                                : '简答 / 计算题'}
                            </span>
                            <span style={metaTagStyle}>{currentQuestion.difficulty || '核心'}</span>
                            <span style={metaTagStyle}>{currentQuestion.score} 分</span>
                          </div>

                          {/* Academic Citation Badge */}
                          <span
                            style={{
                              fontSize: '12px',
                              fontWeight: 500,
                              color: 'var(--asg-brand-primary)',
                              backgroundColor: 'var(--asg-brand-tint)',
                              padding: '2px 8px',
                              borderRadius: '6px',
                            }}
                          >
                            [溯源：{currentQuestion.source_chapter || '教材精讲'}{' '}
                            {currentQuestion.source_page || ''}]
                          </span>
                        </div>

                        {/* Question Stem (with full KaTeX support) */}
                        <div
                          className="asg-academic-prose"
                          style={{
                            fontSize: '16px',
                            fontWeight: 600,
                            lineHeight: 1.65,
                            color: 'var(--asg-text-primary)',
                          }}
                        >
                          <MathMarkdown>{currentQuestion.question}</MathMarkdown>
                        </div>

                        {/* Interactive MCQ State Machine */}
                        {currentQuestion.type === 'mcq' && currentQuestion.options.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {currentQuestion.options.map((opt, oi) => {
                              const letter = extractOptionLetter(opt, oi);
                              const chosenLetter = currentPaperAnswers[currentQuestion.id];
                              const hasAnswered = Boolean(chosenLetter);
                              const isThisChosen = chosenLetter === letter;
                              const isThisRight = isMcqOptionCorrect(
                                opt,
                                oi,
                                currentQuestion.answer
                              );

                              let stateClass = '';
                              if (hasAnswered) {
                                if (isThisRight) stateClass = 'is-correct';
                                else if (isThisChosen) stateClass = 'is-wrong';
                              }

                              const cleanLabel = opt
                                .trim()
                                .replace(/^[A-D][.、:：\s]+/i, '')
                                .trim();

                              return (
                                <button
                                  key={`${currentQuestion.id}-opt-${oi}`}
                                  type="button"
                                  onClick={() => handleSelectMcqOption(currentQuestion, opt, oi)}
                                  className={`asg-quiz-opt ${stateClass}`}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: '12px',
                                    width: '100%',
                                    padding: '12px 14px',
                                    textAlign: 'left',
                                    cursor: 'pointer',
                                  }}
                                >
                                  <span
                                    style={{
                                      width: '26px',
                                      height: '26px',
                                      borderRadius: '9999px',
                                      flexShrink: 0,
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      fontSize: '12.5px',
                                      fontWeight: 700,
                                      marginTop: '1px',
                                      backgroundColor:
                                        hasAnswered && isThisRight
                                          ? 'var(--asg-semantic-success)'
                                          : hasAnswered && isThisChosen && !isThisRight
                                          ? 'var(--asg-semantic-warning)'
                                          : 'var(--asg-bg-subtle)',
                                      color:
                                        hasAnswered && (isThisRight || isThisChosen)
                                          ? '#FFFFFF'
                                          : 'var(--asg-text-secondary)',
                                    }}
                                  >
                                    {hasAnswered && isThisRight ? (
                                      <CheckCircle2 className="w-4 h-4" />
                                    ) : hasAnswered && isThisChosen && !isThisRight ? (
                                      <XCircle className="w-4 h-4" />
                                    ) : (
                                      letter
                                    )}
                                  </span>

                                  <div
                                    style={{
                                      flex: 1,
                                      fontSize: '14.5px',
                                      lineHeight: 1.55,
                                      color: 'var(--asg-text-primary)',
                                    }}
                                  >
                                    <MathMarkdown inline>{cleanLabel || opt}</MathMarkdown>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {/* Fill-in-the-blank & Short-answer Inputs */}
                        {currentQuestion.type !== 'mcq' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {currentQuestion.type === 'fill_blank' ? (
                              <input
                                type="text"
                                value={currentPaperAnswers[currentQuestion.id] || ''}
                                onChange={(e) =>
                                  setAnswersByPaper((prev) => ({
                                    ...prev,
                                    [activePaper.paper_id]: {
                                      ...(prev[activePaper.paper_id] || {}),
                                      [currentQuestion.id]: e.target.value,
                                    },
                                  }))
                                }
                                placeholder="请输入你的填空答案（支持公式文本）..."
                                style={{
                                  width: '100%',
                                  padding: '11px 14px',
                                  borderRadius: '10px',
                                  border: '1px solid var(--asg-border-default)',
                                  backgroundColor: 'var(--asg-bg-subtle)',
                                  color: 'var(--asg-text-primary)',
                                  fontSize: '14px',
                                  outline: 'none',
                                }}
                              />
                            ) : (
                              <textarea
                                rows={4}
                                value={currentPaperAnswers[currentQuestion.id] || ''}
                                onChange={(e) =>
                                  setAnswersByPaper((prev) => ({
                                    ...prev,
                                    [activePaper.paper_id]: {
                                      ...(prev[activePaper.paper_id] || {}),
                                      [currentQuestion.id]: e.target.value,
                                    },
                                  }))
                                }
                                placeholder="在此梳理你的解题步骤或关键得分点，提交后核对参考解答与解析..."
                                style={{
                                  width: '100%',
                                  padding: '11px 14px',
                                  borderRadius: '10px',
                                  border: '1px solid var(--asg-border-default)',
                                  backgroundColor: 'var(--asg-bg-subtle)',
                                  color: 'var(--asg-text-primary)',
                                  fontSize: '14px',
                                  lineHeight: 1.6,
                                  resize: 'vertical',
                                  outline: 'none',
                                }}
                              />
                            )}

                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <button
                                type="button"
                                onClick={() => handleSubmitNonMcq(currentQuestion)}
                                style={primaryToolbarBtnStyle}
                              >
                                <CheckCircle2 className="w-4 h-4" />
                                <span>提交并核对解析</span>
                              </button>
                              {currentPaperChecked[currentQuestion.id] &&
                                currentQuestion.type === 'fill_blank' && (
                                  <span
                                    style={{
                                      fontSize: '13px',
                                      fontWeight: 600,
                                      color:
                                        normalizeBlankAnswer(
                                          currentPaperAnswers[currentQuestion.id] || ''
                                        ) === normalizeBlankAnswer(currentQuestion.answer)
                                          ? 'var(--asg-semantic-success)'
                                          : 'var(--asg-semantic-warning)',
                                    }}
                                  >
                                    {normalizeBlankAnswer(
                                      currentPaperAnswers[currentQuestion.id] || ''
                                    ) === normalizeBlankAnswer(currentQuestion.answer)
                                      ? '核对一致，答对了！'
                                      : '与标准答案有差异，请核对下方解析'}
                                  </span>
                                )}
                            </div>
                          </div>
                        )}

                        {/* Quick Toggle Explanation Button if not yet opened */}
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            borderTop: '1px solid var(--asg-border-default)',
                            paddingTop: '14px',
                          }}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setOpenDrawerIds((prev) => ({
                                ...prev,
                                [currentQuestion.id]: !prev[currentQuestion.id],
                              }))
                            }
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              cursor: 'pointer',
                              fontSize: '13px',
                              fontWeight: 600,
                              color: 'var(--asg-brand-primary)',
                            }}
                          >
                            {openDrawerIds[currentQuestion.id]
                              ? '收起答案与解析 ▲'
                              : '查看参考答案与 AI 解析 ▼'}
                          </button>

                          <span style={{ fontSize: '12px', color: 'var(--asg-text-muted)' }}>
                            支持键盘 ← / → 快速切题
                          </span>
                        </div>

                        {/* AI Explanation Drawer */}
                        {(openDrawerIds[currentQuestion.id] ||
                          (currentQuestion.type === 'mcq' &&
                            Boolean(currentPaperAnswers[currentQuestion.id]))) && (
                          <div
                            className="asg-drawer-enter"
                            style={{
                              borderRadius: '12px',
                              border: '1px solid var(--asg-border-default)',
                              backgroundColor: 'var(--asg-bg-subtle)',
                              padding: '16px 18px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '12px',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                fontSize: '14px',
                                fontWeight: 700,
                                color: 'var(--asg-semantic-success)',
                              }}
                            >
                              <CheckCircle2 className="w-4 h-4" />
                              <span>参考答案：</span>
                              <span style={{ color: 'var(--asg-text-primary)' }}>
                                <MathMarkdown inline>{currentQuestion.answer}</MathMarkdown>
                              </span>
                            </div>

                            <div
                              className="asg-academic-prose"
                              style={{ fontSize: '14px', lineHeight: 1.65, color: 'var(--asg-text-secondary)' }}
                            >
                              <MathMarkdown>{currentQuestion.explanation}</MathMarkdown>
                            </div>

                            {((currentQuestion.applied_strategies && currentQuestion.applied_strategies.length > 0) ||
                              currentQuestion.blind_review_summary ||
                              currentQuestion.reverse_design) && (
                              <div
                                style={{
                                  padding: '10px 12px',
                                  borderRadius: '10px',
                                  border: '1px solid var(--asg-border-default)',
                                  backgroundColor: 'var(--asg-bg-surface)',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '8px',
                                }}
                              >
                                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
                                  {currentQuestion.applied_strategies?.map((st) => (
                                    <span
                                      key={st}
                                      style={{
                                        fontSize: '11px',
                                        fontWeight: 700,
                                        fontFamily: 'JetBrains Mono, monospace',
                                        padding: '2px 8px',
                                        borderRadius: '999px',
                                        backgroundColor: 'var(--asg-bg-subtle)',
                                        border: '1px solid var(--asg-border-default)',
                                        color: 'var(--asg-brand-primary)',
                                      }}
                                    >
                                      {st}
                                    </span>
                                  ))}
                                  {currentQuestion.blind_review_summary && (
                                    <span
                                      style={{
                                        fontSize: '11.5px',
                                        fontWeight: 600,
                                        padding: '2px 8px',
                                        borderRadius: '999px',
                                        backgroundColor: 'var(--asg-bg-subtle)',
                                        color: 'var(--asg-semantic-success)',
                                      }}
                                    >
                                      {currentQuestion.blind_review_summary}
                                    </span>
                                  )}
                                </div>

                                {currentQuestion.reverse_design && (
                                  <details style={{ fontSize: '12.5px', color: 'var(--asg-text-secondary)' }}>
                                    <summary
                                      style={{
                                        cursor: 'pointer',
                                        fontWeight: 600,
                                        color: 'var(--asg-text-primary)',
                                      }}
                                    >
                                      查看 Agent C 逆向命题靶向设计思路
                                    </summary>
                                    <div className="asg-academic-prose" style={{ marginTop: '6px', lineHeight: 1.6 }}>
                                      <MathMarkdown>{currentQuestion.reverse_design}</MathMarkdown>
                                    </div>
                                  </details>
                                )}
                              </div>
                            )}

                            {variantError && (
                              <div
                                style={{
                                  fontSize: '12.5px',
                                  color: 'var(--asg-semantic-warning)',
                                  backgroundColor: 'var(--asg-warning-tint)',
                                  padding: '8px 12px',
                                  borderRadius: '8px',
                                }}
                              >
                                {variantError}
                              </div>
                            )}

                            {/* Fixed Low-Distraction Quick Actions */}
                            <div
                              style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                alignItems: 'center',
                                gap: '10px',
                                paddingTop: '6px',
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => toggleWrongBook(currentQuestion.id)}
                                style={{
                                  ...secondaryToolbarBtnStyle,
                                  borderColor: wrongBookIds[currentQuestion.id]
                                    ? 'var(--asg-semantic-warning)'
                                    : 'var(--asg-border-default)',
                                  color: wrongBookIds[currentQuestion.id]
                                    ? 'var(--asg-semantic-warning)'
                                    : 'var(--asg-text-primary)',
                                  backgroundColor: wrongBookIds[currentQuestion.id]
                                    ? 'var(--asg-warning-tint)'
                                    : 'var(--asg-bg-surface)',
                                }}
                              >
                                {wrongBookIds[currentQuestion.id] ? (
                                  <>
                                    <BookmarkCheck className="w-3.5 h-3.5" />
                                    <span>已在错题本（点击移出）</span>
                                  </>
                                ) : (
                                  <>
                                    <BookmarkPlus className="w-3.5 h-3.5" />
                                    <span>+ 加入错题本</span>
                                  </>
                                )}
                              </button>

                              <button
                                type="button"
                                disabled={generatingVariantId === currentQuestion.id}
                                onClick={() => handleGenerateVariant(currentQuestion)}
                                style={{
                                  ...secondaryToolbarBtnStyle,
                                  borderColor: 'var(--asg-brand-primary)',
                                  color: 'var(--asg-brand-primary)',
                                  backgroundColor: 'var(--asg-brand-tint)',
                                  cursor:
                                    generatingVariantId === currentQuestion.id ? 'wait' : 'pointer',
                                }}
                              >
                                <Sparkles className="w-3.5 h-3.5" />
                                <span>
                                  {generatingVariantId === currentQuestion.id
                                    ? 'AI 正在命制同考点变式题...'
                                    : '针对此知识点再出一题'}
                                </span>
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Prev / Next Card Switcher Footer */}
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            paddingTop: '8px',
                          }}
                        >
                          <button
                            type="button"
                            disabled={currentCardIdx <= 0}
                            onClick={() => setCurrentCardIdx((i) => Math.max(0, i - 1))}
                            style={{
                              ...secondaryToolbarBtnStyle,
                              opacity: currentCardIdx <= 0 ? 0.45 : 1,
                              cursor: currentCardIdx <= 0 ? 'not-allowed' : 'pointer',
                            }}
                          >
                            <ArrowLeft className="w-4 h-4" />
                            <span>上一题 (←)</span>
                          </button>

                          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--asg-text-secondary)' }}>
                            {currentCardIdx + 1} / {visibleQuestions.length}
                          </span>

                          <button
                            type="button"
                            disabled={currentCardIdx >= visibleQuestions.length - 1}
                            onClick={() =>
                              setCurrentCardIdx((i) =>
                                Math.min(visibleQuestions.length - 1, i + 1)
                              )
                            }
                            style={{
                              ...primaryToolbarBtnStyle,
                              opacity: currentCardIdx >= visibleQuestions.length - 1 ? 0.45 : 1,
                              cursor:
                                currentCardIdx >= visibleQuestions.length - 1
                                  ? 'not-allowed'
                                  : 'pointer',
                            }}
                          >
                            <span>下一题 (→)</span>
                            <ArrowRight className="w-4 h-4" />
                          </button>
                        </div>
                      </article>
                    )
                  )}
                </div>
            </>
          )}
        </section>
      )}

      {/* ================= TAB 2B: DEDICATED KNOWLEDGE-POINT 3D FLASHCARDS ================= */}
      {activeTab === 'flashcards' && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Dedicated Header Card (Decoupled from Quiz) */}
          <div
            className="asg-card no-print"
            data-glass-panel="true"
            style={{
              padding: '16px 20px',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
                <Layers className="w-4.5 h-4.5" style={{ color: 'var(--asg-brand-primary)' }} />
                <h2
                  style={{
                    fontSize: '17px',
                    fontWeight: 700,
                    color: 'var(--asg-text-primary)',
                    margin: 0,
                  }}
                >
                  知识点记忆反转闪卡 · Active Recall
                </h2>
                <span
                  style={{
                    fontSize: '11.5px',
                    fontWeight: 700,
                    color: 'var(--asg-brand-primary)',
                    backgroundColor: 'var(--asg-brand-tint)',
                    padding: '2px 9px',
                    borderRadius: '9999px',
                  }}
                >
                  共 {baseFlashDeck.length} 张概念与考点卡
                </span>
              </div>
              <p style={{ fontSize: '12.5px', color: 'var(--asg-text-secondary)', margin: 0 }}>
                专注核心概念、公式定理、机理规律与命题设错陷阱的主动回忆，已与「在线练习卡片」完全分离。
              </p>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                onClick={() => onChangeTab('quiz')}
                style={secondaryToolbarBtnStyle}
              >
                <ClipboardCheck className="w-3.5 h-3.5" />
                <span>前往在线练习做题</span>
              </button>
              <SpringButton
                springLabel="打乱重来"
                disabled={baseFlashDeck.length === 0}
                onClick={handleShuffleRestartFlashcards}
                className="asg-btn-spring"
                style={primaryToolbarBtnStyle}
              >
                <Shuffle className="w-3.5 h-3.5" />
                <span>打乱顺序重背</span>
              </SpringButton>
            </div>
          </div>

          {baseFlashDeck.length === 0 ? (
            <div className="asg-card" data-glass-panel="true" style={{ padding: '28px' }}>
              <EmptyDeliverableBanner
                title="当前学习包暂无可提取的知识点闪卡"
                hint="可重新生成包含讲义或考前速记的学习包，系统将自动提炼核心概念、公式与考点记忆卡。"
                onSwitch={() => onChangeTab('quiz')}
                switchLabel="前往在线练习"
              />
            </div>
          ) : (
            <div
              style={{
                maxWidth: '680px',
                width: '100%',
                margin: '4px auto 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
              }}
            >
                  {flashRoundFinished ? (
                    /* End-of-Round Settlement Card */
                    <div
                      className="asg-card"
                      data-glass-panel="true"
                      style={{
                        padding: '32px 28px',
                        textAlign: 'center',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '16px',
                      }}
                    >
                      <div
                        style={{
                          width: '56px',
                          height: '56px',
                          borderRadius: '9999px',
                          backgroundColor: 'var(--asg-brand-tint)',
                          color: 'var(--asg-brand-primary)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <CheckCircle2 className="w-7 h-7" />
                      </div>

                      <div>
                        <h3
                          style={{
                            fontSize: '20px',
                            fontWeight: 700,
                            color: 'var(--asg-text-primary)',
                            margin: 0,
                          }}
                        >
                          本轮闪卡记忆已完成！
                        </h3>
                        <p
                          style={{
                            fontSize: '14px',
                            color: 'var(--asg-text-secondary)',
                            marginTop: '6px',
                          }}
                        >
                          本轮共复习 {flashDeck.length} 张核心卡片：
                          <strong style={{ color: 'var(--asg-semantic-success)' }}>
                            已掌握 {masteredCount} 张
                          </strong>
                          ，
                          <strong style={{ color: 'var(--asg-semantic-warning)' }}>
                            待巩固复习 {reviewCount} 张
                          </strong>
                        </p>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          justifyContent: 'center',
                          gap: '12px',
                          marginTop: '6px',
                        }}
                      >
                        <SpringButton
                          springLabel="复习需巩固闪卡"
                          disabled={reviewCount === 0}
                          onClick={handleReviewPendingFlashcards}
                          className="asg-btn-spring"
                          style={{
                            ...primaryToolbarBtnStyle,
                            padding: '10px 20px',
                            fontSize: '14px',
                            backgroundColor:
                              reviewCount > 0
                                ? 'var(--asg-semantic-warning)'
                                : 'var(--asg-bg-subtle)',
                            color: reviewCount > 0 ? '#FFFFFF' : 'var(--asg-text-muted)',
                            cursor: reviewCount > 0 ? 'pointer' : 'not-allowed',
                          }}
                        >
                          <RotateCcw className="w-4 h-4" />
                          <span>
                            {reviewCount > 0
                              ? `仅复习需巩固的闪卡 (${reviewCount} 张)`
                              : '本轮已全部掌握（无需补习）'}
                          </span>
                        </SpringButton>

                        <SpringButton
                          springLabel="打乱从头开始"
                          onClick={handleShuffleRestartFlashcards}
                          className="asg-btn-spring"
                          style={{
                            ...secondaryToolbarBtnStyle,
                            padding: '10px 20px',
                            fontSize: '14px',
                            borderColor: 'var(--asg-brand-primary)',
                            color: 'var(--asg-brand-primary)',
                          }}
                        >
                          <Shuffle className="w-4 h-4" />
                          <span>打乱顺序从头开始 (全部 {baseFlashDeck.length} 张)</span>
                        </SpringButton>
                      </div>
                    </div>
                  ) : (
                    flashDeck[flashIdx] && (
                      <>
                        {/* Deck Progress & Stats Header */}
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            fontSize: '13px',
                            color: 'var(--asg-text-secondary)',
                          }}
                        >
                          <span>
                            卡片进度 <strong>{flashIdx + 1}</strong> / {flashDeck.length}
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                            <span style={{ color: 'var(--asg-semantic-warning)', fontWeight: 600 }}>
                              需复习: {reviewCount}
                            </span>
                            <span style={{ color: 'var(--asg-semantic-success)', fontWeight: 600 }}>
                              已掌握: {masteredCount}
                            </span>
                          </div>
                        </div>

                        {/* Stacked 3D Single-Face Flip Container (Chromium safe) */}
                        <div style={{ position: 'relative', paddingBottom: '10px' }}>
                          {/* Bottom 8px card stack peek */}
                          {flashIdx + 1 < flashDeck.length && (
                            <div
                              style={{
                                position: 'absolute',
                                left: '16px',
                                right: '16px',
                                bottom: '2px',
                                height: '16px',
                                borderRadius: '0 0 16px 16px',
                                backgroundColor: 'var(--asg-bg-subtle)',
                                border: '1px solid var(--asg-border-default)',
                                zIndex: 0,
                              }}
                            />
                          )}

                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => setIsFlashFlipped((f) => !f)}
                            className="asg-card"
                            data-glass-panel="true"
                            style={{
                              position: 'relative',
                              zIndex: 1,
                              minHeight: '360px',
                              padding: '28px 30px',
                              cursor: 'pointer',
                              display: 'flex',
                              flexDirection: 'column',
                              justifyContent: 'space-between',
                              transform: `perspective(1200px) rotateY(${uprightFlipAngle}deg)`,
                              transformStyle: 'flat',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                              }}
                            >
                              <span
                                style={{
                                  fontSize: '12px',
                                  fontWeight: 700,
                                  color: showFrontSide
                                    ? 'var(--asg-brand-primary)'
                                    : 'var(--asg-semantic-success)',
                                  backgroundColor: showFrontSide
                                    ? 'var(--asg-brand-tint)'
                                    : 'var(--asg-success-tint)',
                                  padding: '3px 10px',
                                  borderRadius: '9999px',
                                }}
                              >
                                {showFrontSide
                                  ? `知识点追问 · ${flashDeck[flashIdx].badge}`
                                  : '核心结论与记忆要点'}
                              </span>
                              <span style={{ fontSize: '12px', color: 'var(--asg-text-muted)' }}>
                                {flashDeck[flashIdx].source}
                              </span>
                            </div>

                            <div
                              className="asg-academic-prose"
                              style={{
                                flex: 1,
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'center',
                                padding: '20px 0',
                              }}
                            >
                              {showFrontSide ? (
                                <div style={{ fontSize: '17px', fontWeight: 600, lineHeight: 1.7 }}>
                                  <MathMarkdown>{flashDeck[flashIdx].front}</MathMarkdown>
                                </div>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                                  <div
                                    style={{
                                      padding: '12px 16px',
                                      borderRadius: '10px',
                                      backgroundColor: 'var(--asg-success-tint)',
                                      color: 'var(--asg-semantic-success)',
                                      fontWeight: 700,
                                      fontSize: '15.5px',
                                    }}
                                  >
                                    核心结论 / 记忆要点：<MathMarkdown inline>{flashDeck[flashIdx].answer}</MathMarkdown>
                                  </div>
                                  <div
                                    style={{
                                      fontSize: '14px',
                                      color: 'var(--asg-text-secondary)',
                                      lineHeight: 1.65,
                                    }}
                                  >
                                    <MathMarkdown>{flashDeck[flashIdx].explanation}</MathMarkdown>
                                  </div>
                                </div>
                              )}
                            </div>

                            <div
                              style={{
                                textAlign: 'center',
                                fontSize: '12px',
                                color: 'var(--asg-text-muted)',
                              }}
                            >
                              点击卡片或按 Space 键翻转 · ← 需复习 · → 已掌握
                            </div>
                          </div>
                        </div>

                        {/* Keyboard / Mouse Controls Footer */}
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr auto 1fr',
                            gap: '12px',
                            alignItems: 'center',
                          }}
                        >
                          <SpringButton
                            springLabel="需复习左键"
                            onClick={() => advanceFlashcard('review')}
                            className="asg-btn-spring"
                            style={{
                              justifyContent: 'center',
                              padding: '11px 16px',
                              borderRadius: '12px',
                              border: '1px solid var(--asg-semantic-warning)',
                              backgroundColor: 'var(--asg-warning-tint)',
                              color: 'var(--asg-semantic-warning)',
                              fontWeight: 700,
                              fontSize: '14px',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                            }}
                          >
                            <ArrowLeft className="w-4 h-4" />
                            <span>需复习 (←)</span>
                          </SpringButton>

                          <button
                            type="button"
                            onClick={() => setIsFlashFlipped((f) => !f)}
                            style={{
                              ...secondaryToolbarBtnStyle,
                              padding: '11px 18px',
                              borderRadius: '12px',
                            }}
                          >
                            <RotateCcw className="w-4 h-4" />
                            <span>翻转 (Space)</span>
                          </button>

                          <SpringButton
                            springLabel="已掌握右键"
                            onClick={() => advanceFlashcard('mastered')}
                            className="asg-btn-spring"
                            style={{
                              justifyContent: 'center',
                              padding: '11px 16px',
                              borderRadius: '12px',
                              border: '1px solid var(--asg-semantic-success)',
                              backgroundColor: 'var(--asg-success-tint)',
                              color: 'var(--asg-semantic-success)',
                              fontWeight: 700,
                              fontSize: '14px',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                            }}
                          >
                            <span>已掌握 (→)</span>
                            <ArrowRight className="w-4 h-4" />
                          </SpringButton>
                        </div>
                      </>
                    )
                  )}
            </div>
          )}
        </section>
      )}

      {/* ================= TAB 3: CHEATSHEET ================= */}
      {activeTab === 'cheatsheet' && (
        <section
          className="asg-card"
          data-glass-panel="true"
          style={{ padding: '24px' }}
        >
          {!hasCheatsheet ? (
            <EmptyDeliverableBanner
              title="本次学习包未包含考前速记卡"
              hint="可以在左侧步骤 3 中勾选「考前速记」重新生成。"
              onSwitch={() => onChangeTab('notes')}
              switchLabel="返回讲义笔记"
            />
          ) : (
            <>
              <div
                className="no-print"
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  paddingBottom: '16px',
                  borderBottom: '1px solid var(--asg-border-default)',
                  marginBottom: '20px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Zap className="w-5 h-5" style={{ color: 'var(--asg-brand-primary)' }} />
                  <h2
                    style={{
                      fontSize: '20px',
                      fontWeight: 700,
                      color: 'var(--asg-text-primary)',
                      margin: 0,
                    }}
                  >
                    {scenarioMeta.cheatsheetTitle}
                  </h2>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
                  <SpringButton
                    springLabel="打印预览速记"
                    onClick={() =>
                      setPreviewSpec({ docType: 'cheatsheet', paperSize: 'a4', includeAnswers: false })
                    }
                    className="asg-btn-spring"
                    style={secondaryToolbarBtnStyle}
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>打印预览</span>
                  </SpringButton>
                  <SpringButton
                    springLabel="导出速记A4"
                    disabled={Boolean(exportingPdfKey)}
                    onClick={() => handleExportPdf('cheatsheet', 'a4', false)}
                    className="asg-btn-spring"
                    style={primaryToolbarBtnStyle}
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{exportingPdfKey?.startsWith('cheatsheet-a4') ? '生成中...' : '导出 A4 速记 PDF'}</span>
                  </SpringButton>
                  <SpringButton
                    springLabel="导出速记A3"
                    disabled={Boolean(exportingPdfKey)}
                    onClick={() => handleExportPdf('cheatsheet', 'a3', false)}
                    className="asg-btn-spring"
                    style={secondaryToolbarBtnStyle}
                  >
                    <Columns2 className="w-3.5 h-3.5" />
                    <span>A3 横版速记卡</span>
                  </SpringButton>
                  <button
                    type="button"
                    onClick={() =>
                      downloadText('考前速记.md', studyPackage.cheatsheet_markdown)
                    }
                    style={secondaryToolbarBtnStyle}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>导出 MD</span>
                  </button>
                </div>
              </div>

              <div className="asg-academic-prose" style={{ maxWidth: '760px', margin: '0 auto' }}>
                <MathMarkdown>{studyPackage.cheatsheet_markdown}</MathMarkdown>
              </div>
            </>
          )}
        </section>
      )}

      {/* ================= TAB 4: MINDMAP ================= */}
      {activeTab === 'mindmap' && (
        <section
          className="asg-card"
          data-glass-panel="true"
          style={{ padding: '24px' }}
        >
          {!hasMindmap ? (
            <EmptyDeliverableBanner
              title="本次学习包未生成 MindMap 思维导图"
              hint="在入门学习（A）或巩固提高（B）场景中勾选 MindMap 即可自动生成知识图谱。"
              onSwitch={() => onChangeTab('notes')}
              switchLabel="查看知识讲义"
            />
          ) : (
            <>
              <div
                className="no-print"
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  paddingBottom: '16px',
                  borderBottom: '1px solid var(--asg-border-default)',
                  marginBottom: '18px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Network className="w-5 h-5" style={{ color: 'var(--asg-brand-primary)' }} />
                  <h2
                    style={{
                      fontSize: '20px',
                      fontWeight: 700,
                      color: 'var(--asg-text-primary)',
                      margin: 0,
                    }}
                  >
                    课程知识体系 MindMap
                  </h2>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.15).toFixed(2)))}
                    style={secondaryToolbarBtnStyle}
                    title="缩小"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--asg-text-secondary)' }}>
                    {Math.round(zoom * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.min(2.0, +(z + 0.15).toFixed(2)))}
                    style={secondaryToolbarBtnStyle}
                    title="放大"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleExportMindmapSvg}
                    style={primaryToolbarBtnStyle}
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>导出矢量 SVG</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      downloadText('mindmap.mmd', studyPackage.mindmap_mermaid, 'text/plain;charset=utf-8')
                    }
                    style={secondaryToolbarBtnStyle}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>下载 .mmd</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCopyText('mermaid', studyPackage.mindmap_mermaid)}
                    style={secondaryToolbarBtnStyle}
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>{copiedKey === 'mermaid' ? '已复制' : '复制源码'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => window.print()}
                    style={secondaryToolbarBtnStyle}
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>打印导图</span>
                  </button>
                </div>
              </div>

              {mermaidError ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div
                    style={{
                      fontSize: '12.5px',
                      color: 'var(--asg-semantic-warning)',
                      backgroundColor: 'var(--asg-warning-tint)',
                      padding: '8px 12px',
                      borderRadius: '8px',
                    }}
                  >
                    已启用内置矢量图谱兼容渲染：{mermaidError}
                  </div>
                  <div ref={mermaidRef}>
                    <FallbackMindmapSvg
                      mermaidCode={studyPackage.mindmap_mermaid}
                      darkMode={darkMode}
                      zoom={zoom}
                    />
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    overflow: 'auto',
                    borderRadius: '14px',
                    border: '1px solid var(--asg-border-default)',
                    backgroundColor: 'var(--asg-bg-subtle)',
                    padding: '20px',
                    minHeight: '340px',
                  }}
                >
                  <div
                    ref={mermaidRef}
                    style={{
                      transform: `scale(${zoom})`,
                      transformOrigin: 'top left',
                      display: 'inline-block',
                    }}
                    dangerouslySetInnerHTML={{ __html: mermaidSvg }}
                  />
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* ================= TAB 5: BLUEPRINT TRACE & AUDIT ================= */}
      {activeTab === 'blueprint_trace' && (
        <section
          className="asg-card"
          data-glass-panel="true"
          style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ClipboardCheck className="w-5 h-5" style={{ color: 'var(--asg-brand-primary)' }} />
              <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--asg-text-primary)', margin: 0 }}>
                出题蓝图溯源与质量审计
              </h2>
            </div>
            <span
              style={{
                fontSize: '12.5px',
                fontWeight: 700,
                padding: '4px 12px',
                borderRadius: '9999px',
                backgroundColor: 'var(--asg-brand-tint)',
                color: 'var(--asg-brand-primary)',
              }}
            >
              {scenarioMeta.tag}
            </span>
          </div>

          {/* Metrics Overview */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '12px',
            }}
          >
            <MetricTile label="蓝图方案名称" value={studyPackage.blueprint_used.blueprint_title} />
            <MetricTile
              label="涵盖章节数"
              value={`${studyPackage.blueprint_used.selected_chapter_ids.length} 个章节`}
            />
            <MetricTile
              label="试卷产出数量"
              value={`${allPapers.length} 份（共 ${allPapers.reduce((acc, p) => acc + p.questions.length, 0)} 题）`}
            />
            <MetricTile
              label="目标难度定位"
              value={
                studyPackage.blueprint_used.target_difficulty === 'beginner'
                  ? '零基础入门（Beginner）'
                  : studyPackage.blueprint_used.target_difficulty === 'advanced'
                  ? '拔高拓展（Advanced）'
                  : studyPackage.blueprint_used.target_difficulty === 'exam_sprint'
                  ? '考前冲刺（Sprint）'
                  : '巩固进阶（Intermediate）'
              }
            />
          </div>

          {/* Routing Trace per Stage */}
          <div>
            <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--asg-text-primary)', marginBottom: '10px' }}>
              各生成阶段模型调度轨迹
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {Object.entries(studyPackage.routing_trace || {}).map(([stage, trace]) => (
                <div
                  key={stage}
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                    padding: '10px 14px',
                    borderRadius: '10px',
                    border: '1px solid var(--asg-border-default)',
                    backgroundColor: 'var(--asg-bg-subtle)',
                    fontSize: '13px',
                  }}
                >
                  <span style={{ fontWeight: 700, color: 'var(--asg-text-primary)' }}>{stage}</span>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--asg-brand-primary)' }}>
                    {trace}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Quality Audit Report */}
          {studyPackage.quality_audit_report && (
            <div>
              <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--asg-text-primary)', marginBottom: '10px' }}>
                AI 教研审校报告
              </h3>
              <div
                className="asg-academic-prose"
                style={{
                  padding: '16px',
                  borderRadius: '12px',
                  border: '1px solid var(--asg-border-default)',
                  backgroundColor: 'var(--asg-bg-subtle)',
                }}
              >
                <MathMarkdown>{studyPackage.quality_audit_report}</MathMarkdown>
              </div>
            </div>
          )}

          {/* 4-Agent Exam Pipeline Metadata (a / b / c / d + OXR) */}
          {studyPackage.exam_pipeline_metadata && (() => {
            const meta = studyPackage.exam_pipeline_metadata;
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '8px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--asg-text-primary)', margin: 0 }}>
                  试卷 OXR 识别与四子 Agent (a / b / c / d) 命题盲测明细
                </h3>

                {/* OXR & Uploaded Soul Files Summary */}
                <div
                  style={{
                    padding: '14px 16px',
                    borderRadius: '12px',
                    border: '1px solid var(--asg-border-default)',
                    backgroundColor: 'var(--asg-bg-subtle)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    fontSize: '13px',
                  }}
                >
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
                    <span>
                      <strong>生成方向：</strong>
                      {meta.direction === 'original_to_bank'
                        ? '原卷转在线题库'
                        : meta.direction === 'similar_paper'
                        ? '生成类似风格卷（四子 Agent）'
                        : '原卷题库 + 类似风格卷'}
                    </span>
                    <span>
                      <strong>OXR 引擎：</strong>
                      <code>{meta.oxr_engine_used}</code>
                    </span>
                  </div>
                  {meta.oxr_probe_summary && (
                    <div style={{ fontSize: '12px', color: 'var(--asg-text-secondary)' }}>
                      探查结果：{meta.oxr_probe_summary}
                    </div>
                  )}
                  {meta.user_requirements && (
                    <div style={{ fontSize: '12.5px', color: 'var(--asg-text-primary)' }}>
                      <strong>用户额外需求：</strong>
                      {meta.user_requirements}
                    </div>
                  )}
                  {meta.soul_files_uploaded.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                      <span style={{ fontSize: '12px', color: 'var(--asg-text-secondary)' }}>随任务上传魂文件：</span>
                      {meta.soul_files_uploaded.map((sf) => (
                        <span
                          key={sf}
                          style={{
                            fontSize: '11px',
                            fontFamily: 'JetBrains Mono, monospace',
                            padding: '2px 8px',
                            borderRadius: '999px',
                            border: '1px solid var(--asg-border-default)',
                            backgroundColor: 'var(--asg-bg-surface)',
                            color: 'var(--asg-brand-primary)',
                          }}
                        >
                          {sf}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Agent A Style Profile */}
                {meta.style_profile && (
                  <div
                    style={{
                      padding: '14px 16px',
                      borderRadius: '12px',
                      border: '1px solid var(--asg-border-default)',
                      backgroundColor: 'var(--asg-bg-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      fontSize: '13px',
                    }}
                  >
                    <div style={{ fontWeight: 700, color: 'var(--asg-text-primary)' }}>
                      Agent A（soul_a.md）· 原卷命题风格指纹与全局硬性约束
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '8px' }}>
                      <div>
                        <strong>学科与学段：</strong>
                        {meta.style_profile.subject_and_level}
                      </div>
                      <div>
                        <strong>整体难度：</strong>
                        {meta.style_profile.overall_difficulty}
                      </div>
                    </div>
                    <div>
                      <strong>题干包装风格：</strong>
                      {meta.style_profile.tone_and_persona?.stem_style}
                    </div>
                    <div>
                      <strong>选项结构特征：</strong>
                      {meta.style_profile.tone_and_persona?.option_length_style}
                    </div>
                    {meta.style_profile.formatting_rules && (
                      <div>
                        <strong>公式与排版规范：</strong>
                        {meta.style_profile.formatting_rules}
                      </div>
                    )}
                    {meta.style_profile.user_override_directives?.length > 0 && (
                      <div>
                        <strong>高优先级全局指令：</strong>
                        <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
                          {meta.style_profile.user_override_directives.map((dir, i) => (
                            <li key={i}>{dir}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* Agent B Blueprints */}
                {meta.question_blueprints.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--asg-text-primary)' }}>
                      Agent B（soul_b.md）· 三维解构与变异策略蓝图 ({meta.question_blueprints.length} 题)
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px' }}>
                      {meta.question_blueprints.map((bp) => (
                        <div
                          key={bp.question_id}
                          style={{
                            padding: '12px 14px',
                            borderRadius: '10px',
                            border: '1px solid var(--asg-border-default)',
                            backgroundColor: 'var(--asg-bg-subtle)',
                            fontSize: '12.5px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '5px',
                          }}
                        >
                          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                            <strong style={{ color: 'var(--asg-text-primary)' }}>
                              第 {bp.question_id} 题 · {bp.target_question_type}（{bp.target_difficulty}）
                            </strong>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                              {bp.assigned_strategies.map((st) => (
                                <span
                                  key={st}
                                  style={{
                                    fontSize: '11px',
                                    fontFamily: 'JetBrains Mono, monospace',
                                    padding: '1px 7px',
                                    borderRadius: '999px',
                                    backgroundColor: 'var(--asg-bg-surface)',
                                    border: '1px solid var(--asg-border-default)',
                                    color: 'var(--asg-brand-primary)',
                                  }}
                                >
                                  {st}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div>
                            <strong>考点：</strong>
                            {bp.knowledge_points.join(' / ')}
                          </div>
                          <div>
                            <strong>逻辑骨架：</strong>
                            {bp.original_skeleton}
                          </div>
                          <div>
                            <strong>新题指导：</strong>
                            {bp.generation_directive}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Agent C <-> Agent D Blind Review Log */}
                {meta.blind_reviews.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--asg-text-primary)' }}>
                      Agent C ⇄ Agent D（soul_c.md / soul_d.md）· 盲测校验与打回重写轨迹 ({meta.blind_reviews.length} 条记录)
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {meta.blind_reviews.map((rev, idx) => (
                        <div
                          key={`${rev.question_id}_${rev.attempt}_${idx}`}
                          style={{
                            padding: '12px 14px',
                            borderRadius: '10px',
                            border: `1px solid ${rev.passed ? 'var(--asg-border-default)' : 'var(--asg-semantic-warning)'}`,
                            backgroundColor: rev.passed ? 'var(--asg-bg-subtle)' : 'var(--asg-warning-tint)',
                            fontSize: '12.5px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '5px',
                          }}
                        >
                          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                            <strong>
                              第 {rev.question_id} 题 · 第 {rev.attempt} 轮盲测
                            </strong>
                            <span
                              style={{
                                fontSize: '11.5px',
                                fontWeight: 700,
                                color: rev.passed ? 'var(--asg-semantic-success)' : 'var(--asg-semantic-warning)',
                              }}
                            >
                              {rev.passed ? '✓ 盲测一致通过' : '🔄 盲测未通过 / 打回 Agent C 重写'}
                            </span>
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
                            <span>
                              <strong>盲测作答 (my_answer)：</strong>
                              {rev.my_answer || '（无）'}
                            </span>
                            <span>
                              <strong>命题答案 (correct_answer)：</strong>
                              {rev.expected_answer || '（无）'}
                            </span>
                          </div>
                          {rev.defect_report && (
                            <div style={{ color: 'var(--asg-semantic-warning)' }}>
                              <strong>defect_report：</strong>
                              {rev.defect_report}
                            </div>
                          )}
                          {rev.reasoning_process && (
                            <details>
                              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>查看 Agent D 独立盲算推导过程</summary>
                              <div className="asg-academic-prose" style={{ marginTop: '6px' }}>
                                <MathMarkdown>{rev.reasoning_process}</MathMarkdown>
                              </div>
                            </details>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </section>
      )}

      {/* ================= PRINT PREVIEW MODAL ================= */}
      {previewSpec && (
        <PrintPreviewModal
          studyPackage={studyPackage}
          activeQuiz={activePaper}
          docType={previewSpec.docType}
          paperSize={previewSpec.paperSize}
          includeAnswers={previewSpec.includeAnswers}
          exporting={Boolean(exportingPdfKey)}
          onChangeSpec={setPreviewSpec}
          onDownload={() =>
            handleExportPdf(
              previewSpec.docType,
              previewSpec.paperSize,
              previewSpec.includeAnswers,
              activePaper.paper_id
            )
          }
          onClose={() => setPreviewSpec(null)}
        />
      )}
    </div>
  );
};

/* ---------------- Helper Components ---------------- */

function FallbackMindmapSvg({
  mermaidCode,
  darkMode,
  zoom,
}: {
  mermaidCode: string;
  darkMode: boolean;
  zoom: number;
}) {
  const nodes = new Map<string, string>();
  const edges: [string, string][] = [];
  const inDegree = new Map<string, number>();

  for (const rawLine of (mermaidCode || '').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('flowchart') || line.startsWith('graph')) continue;

    const nodeMatches = line.matchAll(/([A-Za-z0-9_]+)\s*\[["']?([^"'\]]+)["']?\]/g);
    for (const m of nodeMatches) {
      nodes.set(m[1], m[2].trim());
    }

    const edgeMatch = line.match(
      /([A-Za-z0-9_]+)(?:\[[^\]]*\])?\s*--+>?\s*([A-Za-z0-9_]+)(?:\[[^\]]*\])?/
    );
    if (edgeMatch) {
      const from = edgeMatch[1];
      const to = edgeMatch[2];
      if (!nodes.has(from)) nodes.set(from, from);
      if (!nodes.has(to)) nodes.set(to, to);
      edges.push([from, to]);
      inDegree.set(to, (inDegree.get(to) || 0) + 1);
      if (!inDegree.has(from)) inDegree.set(from, 0);
    }
  }

  if (nodes.size === 0) {
    return (
      <pre style={{ padding: '12px', borderRadius: '10px', fontSize: '12px', overflowX: 'auto' }}>
        {mermaidCode}
      </pre>
    );
  }

  const layerMap = new Map<string, number>();
  const queue: string[] = [];
  for (const [id] of nodes) {
    if ((inDegree.get(id) || 0) === 0) {
      layerMap.set(id, 0);
      queue.push(id);
    }
  }
  if (queue.length === 0) {
    const firstId = Array.from(nodes.keys())[0];
    layerMap.set(firstId, 0);
    queue.push(firstId);
  }
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const curLayer = layerMap.get(cur) || 0;
    for (const [f, t] of edges) {
      if (f === cur && !layerMap.has(t)) {
        layerMap.set(t, Math.min(3, curLayer + 1));
        queue.push(t);
      }
    }
  }
  for (const [id] of nodes) {
    if (!layerMap.has(id)) layerMap.set(id, 1);
  }

  const columns = new Map<number, string[]>();
  for (const [id] of nodes) {
    const col = layerMap.get(id) || 0;
    const arr = columns.get(col) || [];
    arr.push(id);
    columns.set(col, arr);
  }

  const colCount = Math.max(1, ...Array.from(columns.keys())) + 1;
  const maxRows = Math.max(1, ...Array.from(columns.values()).map((a) => a.length));
  const nodeW = 190;
  const nodeH = 42;
  const colGap = 250;
  const rowGap = 62;
  const width = Math.max(680, colCount * colGap + 40);
  const height = Math.max(280, maxRows * rowGap + 50);

  const coords = new Map<string, { x: number; y: number }>();
  for (const [colIdx, ids] of columns.entries()) {
    const totalColH = ids.length * rowGap;
    const startY = (height - totalColH) / 2 + rowGap / 2;
    ids.forEach((id, rIdx) => {
      coords.set(id, {
        x: 30 + colIdx * colGap,
        y: startY + rIdx * rowGap - nodeH / 2,
      });
    });
  }

  const strokeColor = darkMode ? '#475569' : '#94A3B8';
  const nodeFill = darkMode ? '#1C1E22' : '#FFFFFF';
  const nodeBorder = darkMode ? '#5C7CFA' : '#3B5BDB';
  const textFill = darkMode ? '#E5E7EB' : '#111827';

  return (
    <div
      style={{
        overflow: 'auto',
        borderRadius: '14px',
        border: '1px solid var(--asg-border-default)',
        backgroundColor: 'var(--asg-bg-subtle)',
        padding: '20px',
        minHeight: '340px',
      }}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ transform: `scale(${zoom})`, transformOrigin: 'top left', display: 'block' }}
      >
        {edges.map(([f, t], i) => {
          const a = coords.get(f);
          const b = coords.get(t);
          if (!a || !b) return null;
          const x1 = a.x + nodeW;
          const y1 = a.y + nodeH / 2;
          const x2 = b.x;
          const y2 = b.y + nodeH / 2;
          const mx = (x1 + x2) / 2;
          return (
            <path
              key={`${f}-${t}-${i}`}
              d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke={strokeColor}
              strokeWidth={1.8}
            />
          );
        })}
        {Array.from(nodes.entries()).map(([id, label]) => {
          const pt = coords.get(id);
          if (!pt) return null;
          const isRoot = (layerMap.get(id) || 0) === 0;
          const short = label.length > 16 ? `${label.slice(0, 15)}…` : label;
          return (
            <g key={id}>
              <rect
                x={pt.x}
                y={pt.y}
                width={nodeW}
                height={nodeH}
                rx={10}
                fill={isRoot ? (darkMode ? '#3B5BDB' : '#3B5BDB') : nodeFill}
                stroke={isRoot ? '#5C7CFA' : nodeBorder}
                strokeWidth={1.5}
              />
              <text
                x={pt.x + nodeW / 2}
                y={pt.y + nodeH / 2 + 4}
                textAnchor="middle"
                fontSize="12"
                fontWeight={isRoot ? '700' : '600'}
                fill={isRoot ? '#FFFFFF' : textFill}
              >
                {short}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: '12px 14px',
        borderRadius: '10px',
        border: '1px solid var(--asg-border-default)',
        backgroundColor: 'var(--asg-bg-subtle)',
      }}
    >
      <div style={{ fontSize: '12px', color: 'var(--asg-text-muted)' }}>{label}</div>
      <div
        style={{
          fontSize: '14px',
          fontWeight: 700,
          color: 'var(--asg-text-primary)',
          marginTop: '4px',
        }}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * 已生成过的印刷版式 PDF：同一组参数（含学习包生成时间）直接复用 blob，
 * 避免在 A4/A3、含答案/不含答案之间来回切换时反复触发 2-15s 的后端排版。
 */
const pdfBlobCache = new Map<string, Blob>();
const PDF_BLOB_CACHE_LIMIT = 3;

async function fetchPdfBlob(cacheKey: string, url: string, signal: AbortSignal): Promise<Blob> {
  const cached = pdfBlobCache.get(cacheKey);
  if (cached) return cached;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(await readPdfErrorDetail(res));
  const blob = await res.blob();
  if (!blob.size) throw new Error('后端返回了空 PDF，请重试。');
  pdfBlobCache.set(cacheKey, blob);
  if (pdfBlobCache.size > PDF_BLOB_CACHE_LIMIT) {
    const oldestKey = pdfBlobCache.keys().next().value;
    if (oldestKey !== undefined) pdfBlobCache.delete(oldestKey);
  }
  return blob;
}

/** 把导出 PDF 接口的失败响应折叠成一段可读文案（后端可能返回 JSON detail 或纯文本）。 */
async function readPdfErrorDetail(res: Response): Promise<string> {
  let raw = '';
  try {
    raw = await res.text();
  } catch {
    raw = '';
  }
  const fallback = `印刷版式 PDF 生成失败（HTTP ${res.status}）`;
  if (!raw.trim()) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'string' && parsed.trim()) return parsed.slice(0, 500);
    if (parsed && typeof parsed === 'object') {
      const record = parsed as { detail?: unknown; message?: unknown };
      const detail = record.detail ?? record.message;
      if (typeof detail === 'string' && detail.trim()) return detail.slice(0, 500);
      if (detail !== undefined) return JSON.stringify(detail).slice(0, 500);
    }
  } catch {
    // 非 JSON 响应：直接展示原始文本
  }
  return raw.slice(0, 500);
}

function PrintPreviewModal({
  studyPackage,
  activeQuiz,
  docType,
  paperSize,
  includeAnswers,
  exporting,
  onChangeSpec,
  onDownload,
  onClose,
}: {
  studyPackage: StudyPackage;
  activeQuiz: QuizPaper;
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
  // 预览直接消费后端真实分页 PDF（inline），不再用 DOM 模拟单张纸。
  const projectId = studyPackage.project_id;
  const quizPaperId = docType === 'quiz' ? activeQuiz?.paper_id || '' : '';

  const pdfRequestUrl = useMemo(() => {
    if (!projectId) return '';
    const params = new URLSearchParams({
      doc_type: docType,
      paper_size: paperSize,
      include_answers: includeAnswers ? 'true' : 'false',
      inline: 'true',
    });
    if (docType === 'quiz' && quizPaperId) params.set('paper_id', quizPaperId);
    return `/api/projects/${encodeURIComponent(projectId)}/export-pdf?${params.toString()}`;
  }, [projectId, docType, paperSize, includeAnswers, quizPaperId]);

  // 学习包重新生成后 generated_at 变化 => 缓存键变化，不会拿到旧 PDF。
  const pdfCacheKey = useMemo(
    () => `${pdfRequestUrl}::${studyPackage.generated_at || ''}`,
    [pdfRequestUrl, studyPackage.generated_at]
  );

  const pdfObjectUrlRef = useRef<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(true);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfAttempt, setPdfAttempt] = useState(0);

  const revokePdfUrl = useCallback(() => {
    if (pdfObjectUrlRef.current) {
      URL.revokeObjectURL(pdfObjectUrlRef.current);
      pdfObjectUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!pdfRequestUrl) {
      setPdfLoading(false);
      setPdfError('缺少项目 ID，无法生成印刷版式 PDF。');
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    // 切换文稿/纸张/答案即视为新请求：先释放上一份 blob，避免多次导出堆积内存。
    revokePdfUrl();
    setPdfUrl(null);
    setPdfError(null);
    setPdfLoading(true);

    // 后端排一次版需要 2-15s 且吃 CPU，快速切换开关时做防抖，只保留最后一次请求。
    const timer = window.setTimeout(() => {
      fetchPdfBlob(pdfCacheKey, pdfRequestUrl, controller.signal)
        .then((blob) => {
          if (cancelled) return;
          const objectUrl = URL.createObjectURL(blob);
          if (cancelled) {
            URL.revokeObjectURL(objectUrl);
            return;
          }
          pdfObjectUrlRef.current = objectUrl;
          setPdfUrl(objectUrl);
          setPdfLoading(false);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setPdfUrl(null);
          setPdfLoading(false);
          setPdfError(err instanceof Error ? err.message : '印刷版式 PDF 生成失败，请重试。');
        });
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [pdfCacheKey, pdfRequestUrl, pdfAttempt, revokePdfUrl]);

  // 关闭预览（组件卸载）时释放最后一次创建的 object URL。
  useEffect(() => () => revokePdfUrl(), [revokePdfUrl]);

  // 预览打开期间按 Ctrl+P 时隐藏主应用，只留一张空白页，避免打印出残缺版式。
  useEffect(() => {
    document.body.classList.add('print-preview-open');
    return () => document.body.classList.remove('print-preview-open');
  }, []);

  const handleOpenInNewWindow = () => {
    if (!pdfUrl) return;
    const opened = window.open(pdfUrl, '_blank');
    if (!opened) {
      // 弹窗被拦截时退化为下载，保证用户仍能拿到同一份 PDF。
      const link = document.createElement('a');
      link.href = pdfUrl;
      link.download = `study_export_${paperSize}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      return;
    }
    try {
      opened.opener = null;
    } catch {
      // 忽略跨源 opener 限制
    }
  };

  return createPortal(
    <div
      className="no-print print-preview-root"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
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
          border: '1px solid #E5E7EB',
          boxShadow: '0 30px 70px -15px rgba(0, 0, 0, 0.35)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '12px 18px',
            borderBottom: '1px solid #E5E7EB',
            backgroundColor: '#FAF9F6',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13.5px', fontWeight: 700, color: '#111827' }}>
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
                  color: '#374151',
                  cursor: 'pointer',
                  padding: '4px 10px',
                  borderRadius: '9999px',
                  backgroundColor: '#FFFFFF',
                  border: '1px solid #E5E7EB',
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
                borderRadius: '9999px',
                border: 'none',
                backgroundColor: '#3B5BDB',
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
              type="button"
              onClick={handleOpenInNewWindow}
              disabled={!pdfUrl}
              title={
                pdfUrl
                  ? '在新标签页中打开当前分页 PDF（使用浏览器自带的分页与缩放控件）'
                  : 'PDF 生成完成后可在新窗口打开'
              }
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                borderRadius: '9999px',
                border: '1px solid #E5E7EB',
                backgroundColor: '#FFFFFF',
                color: '#374151',
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: pdfUrl ? 'pointer' : 'not-allowed',
                opacity: pdfUrl ? 1 : 0.55,
              }}
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>在新窗口打开</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                borderRadius: '9999px',
                border: '1px solid #E5E7EB',
                backgroundColor: '#FFFFFF',
                padding: '6px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="关闭预览"
            >
              <X className="w-4 h-4 text-[#4B5563]" />
            </button>
          </div>
        </div>

        <div
          style={{
            position: 'relative',
            flex: 1,
            minHeight: 0,
            backgroundColor: '#CBD5E1',
            display: 'flex',
          }}
        >
          {pdfUrl ? (
            <iframe
              key={pdfUrl}
              title="印刷版式 PDF 分页预览"
              src={pdfUrl}
              style={{
                flex: 1,
                width: '100%',
                height: '100%',
                border: 'none',
                backgroundColor: '#FFFFFF',
                display: 'block',
              }}
            />
          ) : pdfError ? (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '12px',
                padding: '32px',
                textAlign: 'center',
              }}
            >
              <XCircle className="w-8 h-8" style={{ color: '#B91C1C' }} />
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#111827' }}>
                印刷版式 PDF 生成失败
              </div>
              <div
                style={{
                  fontSize: '12.5px',
                  color: '#4B5563',
                  maxWidth: '560px',
                  lineHeight: 1.7,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {pdfError}
              </div>
              <button
                type="button"
                onClick={() => setPdfAttempt((n) => n + 1)}
                style={{
                  marginTop: '4px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  borderRadius: '9999px',
                  border: '1px solid #E5E7EB',
                  backgroundColor: '#FFFFFF',
                  color: '#374151',
                  padding: '6px 14px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>重试</span>
              </button>
            </div>
          ) : pdfLoading ? (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '14px',
                padding: '32px',
              }}
            >
              <div
                className="animate-pulse"
                style={{
                  width: 'min(560px, 84%)',
                  height: '62%',
                  minHeight: '220px',
                  borderRadius: '4px',
                  backgroundColor: '#FFFFFF',
                  border: '1px solid #94A3B8',
                  boxShadow: '0 22px 50px -14px rgba(15, 23, 42, 0.28)',
                  padding: '28px 30px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}
              >
                {[88, 100, 96, 72, 100, 92, 58].map((w, i) => (
                  <div
                    key={i}
                    style={{
                      height: i === 0 ? '14px' : '9px',
                      width: `${w}%`,
                      borderRadius: '9999px',
                      backgroundColor: i === 0 ? '#E2E8F0' : '#EEF2F7',
                    }}
                  />
                ))}
              </div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                正在生成印刷版式 PDF…
              </div>
              <div style={{ fontSize: '12px', color: '#64748B' }}>
                后端正按 {paperSize.toUpperCase()} 真实分页排版，通常需要 2–15 秒。
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
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
    <div style={{ textAlign: 'center', padding: '32px 16px' }}>
      <Layers className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--asg-text-muted)' }} />
      <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--asg-text-primary)' }}>
        {title}
      </div>
      <p style={{ fontSize: '13.5px', color: 'var(--asg-text-secondary)', marginTop: '6px' }}>
        {hint}
      </p>
      <button type="button" onClick={onSwitch} style={{ ...primaryToolbarBtnStyle, marginTop: '14px' }}>
        {switchLabel}
      </button>
    </div>
  );
}

const primaryToolbarBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  borderRadius: '10px',
  border: 'none',
  backgroundColor: 'var(--asg-brand-primary)',
  color: '#FFFFFF',
  padding: '7px 14px',
  fontSize: '12.5px',
  fontWeight: 600,
  cursor: 'pointer',
};

const secondaryToolbarBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  borderRadius: '10px',
  border: '1px solid var(--asg-border-default)',
  backgroundColor: 'var(--asg-bg-surface)',
  color: 'var(--asg-text-primary)',
  padding: '7px 12px',
  fontSize: '12.5px',
  fontWeight: 600,
  cursor: 'pointer',
};

const metaTagStyle: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 600,
  padding: '2px 8px',
  borderRadius: '6px',
  backgroundColor: 'var(--asg-bg-subtle)',
  color: 'var(--asg-text-secondary)',
};
