import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Bug, Highlighter, Loader2, Pin, Sparkles, Trash2, Waves, X, Zap } from 'lucide-react';
import { api } from '../api';
import {
  AnnotationColor,
  HandoutAnnotation,
  MicroTutorAction,
  MicroQuizPayload,
} from '../types';
import { MathMarkdown } from './MathMarkdown';
import { MarginCardLayout, resolveMarginCardsCollision } from '../utils/marginLayout';

const BLOCK_SELECTOR = 'p, li, blockquote, .math-block, table, h1, h2, h3, h4, pre';

interface Props {
  markdown: string;
  projectId?: string;
  studyMode: string;
  documentTitle: string;
  /** 打印模式：clean 纯净讲义 / cornell 带页边批注 */
  printMode: 'clean' | 'cornell';
}

interface PillState {
  left: number;
  top: number;
  blockId: string;
  quote: string;
  start: number;
  end: number;
}

interface LiveCard {
  id: string;
  title: string;
  body: string;
  quiz?: MicroQuizPayload | null;
  anchorTop: number;
  pinned: boolean;
  quote: string;
}

const COLOR_CLASS: Record<AnnotationColor, string> = {
  AMBER_YELLOW: 'hl-yellow',
  MINT_GREEN: 'hl-green',
  CORAL_RED: 'hl-red-wave',
};

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 某个文本节点位置在块内的字符偏移 */
function offsetWithin(root: Element, node: Node, offset: number): number {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let acc = 0;
  let current: Node | null;
  while ((current = walker.nextNode())) {
    if (current === node) return acc + offset;
    acc += (current as Text).data.length;
  }
  return -1;
}

/** 把块内 [start,end) 区间用 <mark> 包起来（按文本节点切片，避免 surroundContents 抛错） */
function wrapBlockRange(block: Element, start: number, end: number, cls: string, annId: string): boolean {
  if (start < 0 || end <= start) return false;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const targets: { node: Text; from: number; to: number }[] = [];
  let acc = 0;
  let current: Node | null;
  while ((current = walker.nextNode())) {
    const text = current as Text;
    const len = text.data.length;
    const nodeStart = acc;
    const nodeEnd = acc + len;
    acc = nodeEnd;
    if (nodeEnd <= start || nodeStart >= end) continue;
    targets.push({
      node: text,
      from: Math.max(0, start - nodeStart),
      to: Math.min(len, end - nodeStart),
    });
  }
  let wrapped = false;
  for (const item of targets) {
    if (item.from >= item.to) continue;
    const { node, from, to } = item;
    try {
      const after = node.splitText(to);
      const mid = from > 0 ? node.splitText(from) : node;
      const mark = document.createElement('mark');
      mark.className = cls;
      mark.dataset.annotationId = annId;
      mark.textContent = mid.data;
      mid.parentNode?.replaceChild(mark, mid);
      void after;
      wrapped = true;
    } catch {
      /* 跨节点切割失败就跳过这一片，不影响其余部分 */
    }
  }
  return wrapped;
}

export const HandoutReader: React.FC<Props> = ({
  markdown,
  projectId,
  studyMode,
  documentTitle,
  printMode,
}) => {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [annotations, setAnnotations] = useState<HandoutAnnotation[]>([]);
  const [pill, setPill] = useState<PillState | null>(null);
  const [liveCards, setLiveCards] = useState<LiveCard[]>([]);
  const [busyAction, setBusyAction] = useState<MicroTutorAction | null>(null);
  const [sideHeights, setSideHeights] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<string>('');

  const studyKey = useMemo(() => `${projectId || 'p'}:${markdown.length}`, [projectId, markdown.length]);

  // 1) 载入既有批注
  useEffect(() => {
    let cancelled = false;
    if (!projectId) return;
    api
      .listAnnotations(projectId)
      .then((res) => {
        if (!cancelled) setAnnotations(res.items || []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId, studyKey]);

  // 2) 渲染后注入块级 id / SVG 热点，并回填已有高亮
  useEffect(() => {
    const root = bodyRef.current;
    if (!root) return;
    const blocks = Array.from(root.querySelectorAll(BLOCK_SELECTOR)).filter(
      (node) => !node.closest('table') || node.tagName.toLowerCase() === 'table'
    );
    blocks.forEach((node, idx) => {
      node.setAttribute('data-block-id', `blk-${String(idx).padStart(4, '0')}`);
    });
    root.querySelectorAll('svg').forEach((svg, figIdx) => {
      svg.setAttribute('data-figure-id', `fig-${figIdx + 1}`);
      svg.classList.add('handout-svg');
      Array.from(svg.querySelectorAll('text, path, circle, rect, line, polyline')).forEach((el, nodeIdx) => {
        el.classList.add('interactive-hotspot');
        el.setAttribute('data-node-id', `node-${figIdx + 1}-${nodeIdx + 1}`);
        const label = (el.textContent || '').trim().slice(0, 40);
        el.setAttribute('data-concept', label || '图示节点');
      });
    });

    // 回填已存高亮（按块 id + 原文引用重定位）
    for (const ann of annotations) {
      if (ann.target_type !== 'TEXT_RANGE' || !ann.anchor.block_id) continue;
      if (root.querySelector(`mark[data-annotation-id="${ann.annotation_id}"]`)) continue;
      const block = root.querySelector(`[data-block-id="${ann.anchor.block_id}"]`);
      if (!block) continue;
      const text = block.textContent || '';
      const quote = ann.anchor.exact_quote || '';
      if (!quote) continue;
      const at = text.indexOf(quote);
      if (at < 0) continue;
      wrapBlockRange(block, at, at + quote.length, COLOR_CLASS[ann.style.color], ann.annotation_id);
    }
  }, [markdown, annotations]);

  // 3) 划词 → 悬浮胶囊
  const handleSelection = useCallback(() => {
    const root = bodyRef.current;
    if (!root) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setPill(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) {
      setPill(null);
      return;
    }
    const quote = sel.toString().trim();
    if (quote.length < 2) {
      setPill(null);
      return;
    }
    const anchorEl =
      range.startContainer.nodeType === 1
        ? (range.startContainer as Element)
        : (range.startContainer.parentElement as Element | null);
    const block = anchorEl?.closest('[data-block-id]') as HTMLElement | null;
    if (!block) {
      setPill(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    const start = offsetWithin(block, range.startContainer, range.startOffset);
    const end = offsetWithin(block, range.endContainer, range.endOffset);
    setPill({
      left: Math.max(12, rect.left + rect.width / 2),
      top: Math.max(12, rect.top - 12),
      blockId: block.dataset.blockId || '',
      quote,
      start: Math.max(0, start),
      end: end > 0 ? end : Math.max(0, start) + quote.length,
    });
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.selection-action-pill')) return;
      if (!target?.closest('.handout-workspace')) setPill(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // 4) 调用 Agent 5
  const requestCard = async (action: MicroTutorAction, focus: string, context: string) => {
    if (!projectId) return;
    setBusyAction(action);
    setStatus('');
    try {
      const res = await api.microTutor(projectId, {
        study_mode: studyMode,
        action_type: action,
        selected_focus: focus,
        surrounding_context: context,
        document_title: documentTitle,
      });
      if (!res.content_markdown) {
        setStatus('没拿到批注内容，请重试');
        return;
      }
      const root = bodyRef.current;
      const anchorTop = root ? Math.max(0, root.scrollTop) : 0;
      setLiveCards((prev) => [
        ...prev,
        {
          id: makeId('card'),
          title: res.card_title || '页边批注',
          body: res.content_markdown,
          quiz: res.micro_quiz || null,
          anchorTop,
          pinned: false,
          quote: focus,
        },
      ]);
      setStatus(res.fallback ? '当前 AI 引擎不可用，已给出本地兜底提示' : '');
    } catch (e: any) {
      setStatus(e?.message || '页边批注生成失败');
    } finally {
      setBusyAction(null);
    }
  };

  // 5) 高亮 + 批注落库
  const applyHighlight = async (color: AnnotationColor, action: MicroTutorAction) => {
    if (!pill || !projectId) return;
    const root = bodyRef.current;
    const block = root?.querySelector(`[data-block-id="${pill.blockId}"]`) as HTMLElement | null;
    const annId = makeId('note');
    if (block) wrapBlockRange(block, pill.start, pill.end, COLOR_CLASS[color], annId);

    const annotation: HandoutAnnotation = {
      annotation_id: annId,
      project_id: projectId,
      target_type: 'TEXT_RANGE',
      anchor: {
        block_id: pill.blockId,
        start_offset: pill.start,
        end_offset: pill.end,
        exact_quote: pill.quote,
        svg_node_id: null,
      },
      style: {
        type: color === 'CORAL_RED' ? 'UNDERLINE_WAVE' : 'HIGHLIGHT',
        color,
      },
      margin_card: {
        is_pinned: false,
        trigger_action: action,
        card_title: '',
        user_custom_note: '',
        ai_response_markdown: '',
        micro_quiz: null,
      },
    };
    try {
      const saved = await api.saveAnnotation(projectId, annotation);
      setAnnotations((prev) => [...prev, saved]);
    } catch (e: any) {
      setStatus(e?.message || '批注保存失败');
    }
    window.getSelection()?.removeAllRanges();
    setPill(null);
    if (action !== 'EXPLAIN_SIMPLE' || color !== 'AMBER_YELLOW') {
      await requestCard(action, pill.quote, block?.textContent?.slice(0, 600) || '');
    }
  };

  const pinCard = async (card: LiveCard) => {
    if (!projectId) return;
    const annotation: HandoutAnnotation = {
      annotation_id: makeId('note'),
      project_id: projectId,
      target_type: 'TEXT_RANGE',
      anchor: {
        block_id: '',
        start_offset: 0,
        end_offset: 0,
        exact_quote: card.quote,
        svg_node_id: null,
      },
      style: { type: 'HIGHLIGHT', color: 'MINT_GREEN' },
      margin_card: {
        is_pinned: true,
        trigger_action: 'EXPLAIN_SIMPLE',
        card_title: card.title,
        user_custom_note: '',
        ai_response_markdown: card.body,
        micro_quiz: card.quiz || null,
      },
    };
    try {
      const saved = await api.saveAnnotation(projectId, annotation);
      setAnnotations((prev) => [...prev, saved]);
      setLiveCards((prev) => prev.filter((c) => c.id !== card.id));
      setStatus('已钉在页边，导出「带笔记康奈尔版」时会一并打印');
    } catch (e: any) {
      setStatus(e?.message || '钉住失败');
    }
  };

  // 6) SVG 热点 → 关联段落高亮 + 看图说话
  const handleNodeClick = async (e: React.MouseEvent) => {
    const target = (e.target as Element | null)?.closest('[data-node-id]');
    if (!target) return;
    const concept = target.getAttribute('data-concept') || '';
    const linked = target.getAttribute('data-linked-block');
    bodyRef.current?.querySelectorAll('.block-linked-active').forEach((el) => el.classList.remove('block-linked-active'));
    if (linked) {
      const block = bodyRef.current?.querySelector(`[data-block-id="${linked}"]`);
      block?.classList.add('block-linked-active');
    }
    await requestCard('EXPLAIN_SVG_NODE', concept || '图示节点', concept);
  };

  // 7) 页边卡片防重叠
  const pinnedCards = useMemo(
    () => annotations.filter((a) => a.margin_card.is_pinned),
    [annotations]
  );
  const layout: MarginCardLayout[] = useMemo(() => {
    const cards = [
      ...pinnedCards.map((ann, idx) => ({
        id: ann.annotation_id,
        idealTop: idx * 96,
        actualTop: 0,
        height: sideHeights[ann.annotation_id] || 96,
      })),
      ...liveCards.map((card, idx) => ({
        id: card.id,
        idealTop: pinnedCards.length * 96 + idx * 96,
        actualTop: 0,
        height: sideHeights[card.id] || 96,
      })),
    ];
    return resolveMarginCardsCollision(cards, 12);
  }, [pinnedCards, liveCards, sideHeights]);

  const topFor = (id: string) => layout.find((c) => c.id === id)?.actualTop || 0;

  const removeAnnotation = async (annotationId: string) => {
    if (!projectId) return;
    try {
      await api.deleteAnnotation(projectId, annotationId);
      setAnnotations((prev) => prev.filter((a) => a.annotation_id !== annotationId));
    } catch (e: any) {
      setStatus(e?.message || '删除失败');
    }
  };

  return (
    <div
      ref={wrapRef}
      className={`handout-workspace ${printMode === 'cornell' ? 'print-mode-cornell' : 'print-mode-clean'}`}
    >
      <div className="handout-main" onMouseUp={handleSelection} onTouchEnd={handleSelection} onClick={handleNodeClick}>
        <div className="asg-academic-prose handout-body" ref={bodyRef}>
          <MathMarkdown>{markdown}</MathMarkdown>
        </div>
      </div>

      <aside className="margin-sidecar-column no-print" aria-label="页边批注栏">
        {pinnedCards.map((ann) => (
          <div
            key={ann.annotation_id}
            className="margin-note-card is-pinned"
            style={{ top: `${topFor(ann.annotation_id)}px` }}
            onLoad={(e) => {
              const h = (e.currentTarget as HTMLElement).offsetHeight;
              setSideHeights((prev) => (prev[ann.annotation_id] === h ? prev : { ...prev, [ann.annotation_id]: h }));
            }}
          >
            <div className="margin-card-head">
              <span className="margin-card-title">{ann.margin_card.card_title || '页边批注'}</span>
              <button type="button" className="margin-card-x" onClick={() => removeAnnotation(ann.annotation_id)} title="删除批注">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
            {ann.anchor.exact_quote && <div className="margin-quote">「{ann.anchor.exact_quote.slice(0, 60)}」</div>}
            <div className="margin-body">
              <MathMarkdown inline>{ann.margin_card.ai_response_markdown || ''}</MathMarkdown>
            </div>
          </div>
        ))}

        {liveCards.map((card) => (
          <div
            key={card.id}
            className="margin-note-card"
            style={{ top: `${topFor(card.id)}px` }}
            ref={(el) => {
              if (!el) return;
              const h = el.offsetHeight;
              setSideHeights((prev) => (prev[card.id] === h ? prev : { ...prev, [card.id]: h }));
            }}
          >
            <div className="margin-card-head">
              <span className="margin-card-title">{card.title}</span>
              <div className="margin-card-actions">
                <button type="button" onClick={() => pinCard(card)} title="钉在页边（导出带笔记版时打印）">
                  <Pin className="w-3 h-3" />
                </button>
                <button type="button" onClick={() => setLiveCards((prev) => prev.filter((c) => c.id !== card.id))} title="收起">
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
            <div className="margin-body">
              <MathMarkdown inline>{card.body}</MathMarkdown>
            </div>
            {card.quiz && (
              <div className="margin-quiz">
                <div className="margin-quiz-q">⚡ {card.quiz.question}</div>
                {Object.entries(card.quiz.options || {}).map(([key, val]) => (
                  <div key={key} className="margin-quiz-opt">
                    <strong>{key}.</strong> {val}
                  </div>
                ))}
                <div className="margin-quiz-a">答案：{card.quiz.answer}</div>
              </div>
            )}
          </div>
        ))}

        {busyAction && (
          <div className="margin-note-card" style={{ top: '0px' }}>
            <div className="margin-card-head">
              <span className="margin-card-title">
                <Loader2 className="w-3 h-3 animate-spin inline mr-1" />
                Agent 5 正在写页边批注…
              </span>
            </div>
          </div>
        )}

        {status && <div className="margin-status">{status}</div>}
        {pinnedCards.length === 0 && liveCards.length === 0 && !busyAction && (
          <div className="margin-hint">
            <Sparkles className="w-3.5 h-3.5" />
            划选正文任意一句，可以高亮、讲懂它、举栗子或当场考你一下。
          </div>
        )}
      </aside>

      {pill && (
        <div className="selection-action-pill" style={{ left: `${pill.left}px`, top: `${pill.top}px` }}>
          <button type="button" title="黄色荧光笔" onClick={() => applyHighlight('AMBER_YELLOW', 'EXPLAIN_SIMPLE')}>
            <Highlighter className="w-3.5 h-3.5" />
          </button>
          <button type="button" title="薄荷高亮" onClick={() => applyHighlight('MINT_GREEN', 'EXPLAIN_SIMPLE')}>
            <BookOpen className="w-3.5 h-3.5" />
          </button>
          <button type="button" title="红色波浪线" onClick={() => applyHighlight('CORAL_RED', 'TRAP_ALERT')}>
            <Waves className="w-3.5 h-3.5" />
          </button>
          <span className="pill-divider" />
          <button type="button" title="讲懂它" disabled={Boolean(busyAction)} onClick={() => applyHighlight('AMBER_YELLOW', 'EXPLAIN_SIMPLE')}>
            <Zap className="w-3.5 h-3.5" />
          </button>
          <button type="button" title="举个栗子" disabled={Boolean(busyAction)} onClick={() => applyHighlight('MINT_GREEN', 'GIVE_ANALOGY')}>
            🌰
          </button>
          <button type="button" title="考我一下" disabled={Boolean(busyAction)} onClick={() => applyHighlight('AMBER_YELLOW', 'MICRO_QUIZ')}>
            <Bug className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};