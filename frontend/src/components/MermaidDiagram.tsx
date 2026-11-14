import React, { useEffect, useMemo, useState } from 'react';
import mermaid from 'mermaid';

export interface MermaidDiagramProps {
  code: string;
  className?: string;
}

type MermaidTheme = 'default' | 'dark';
type RenderPhase = 'loading' | 'ready' | 'error' | 'empty';

/**
 * Module-level guards: mermaid is initialized once, and only re-initialized when the
 * effective theme actually changes (mermaid config is global).
 */
let initializedTheme: MermaidTheme | null = null;
let renderIdCounter = 0;

function ensureMermaidInitialized(theme: MermaidTheme): void {
  if (initializedTheme === theme) return;
  mermaid.initialize({
    startOnLoad: false,
    theme,
    securityLevel: 'loose',
  });
  initializedTheme = theme;
}

/**
 * Copy of StudyStudio's `sanitizeMermaidClient` so a diagram that already renders in the
 * mindmap tab renders identically here:
 *  - drop a leading ```/```mermaid fence and a trailing ```
 *  - wrap bare `[label]` in double quotes (`A[中文]` -> `A["中文"]`)
 *  - prepend `flowchart LR` when no known diagram header is present
 */
function sanitizeMermaidClient(raw: string): string {
  if (!raw) return 'flowchart LR\n  A["知识核心"] --> B["内容空"]';
  let text = raw
    .trim()
    .replace(/^```(?:mermaid)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  text = text.replace(/\[([^\]"'\n]+)\]/g, (_match, inner: string) => {
    const clean = inner.replace(/"/g, "'").trim();
    return `["${clean}"]`;
  });
  if (!/^(flowchart|graph|mindmap|sequenceDiagram)/m.test(text)) {
    text = `flowchart LR\n${text}`;
  }
  return text;
}

/**
 * The app toggles `<html data-theme="dark">` and also adds a `dark-theme` class on
 * <html>/<body>; honour the attribute first and fall back to the class.
 */
function isDarkTheme(): boolean {
  if (typeof document === 'undefined') return false;
  const root = document.documentElement;
  const attr = root.getAttribute('data-theme');
  if (attr) return attr === 'dark';
  return root.classList.contains('dark-theme');
}

function nextRenderId(): string {
  renderIdCounter += 1;
  return `mmd_${Date.now()}_${renderIdCounter}`;
}

/**
 * mermaid.render keeps global state, so a note with several diagrams mounts them one at a
 * time instead of letting concurrent renders interleave.
 */
let renderQueue: Promise<unknown> = Promise.resolve();

function enqueueRender<T>(task: () => Promise<T>): Promise<T> {
  const run = renderQueue.then(task, task);
  renderQueue = run.catch(() => undefined);
  return run;
}

/** Mermaid can leave an orphaned measuring node behind when parsing fails. */
function cleanupMermaidArtifacts(id: string): void {
  if (typeof document === 'undefined') return;
  document.getElementById(id)?.remove();
  document.getElementById(`d${id}`)?.remove();
}

const diagramStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  overflowX: 'auto',
  margin: '0.75rem 0',
};

const placeholderStyle: React.CSSProperties = {
  minHeight: 24,
  margin: '0.35rem 0',
};

const fallbackPreStyle: React.CSSProperties = {
  margin: 0,
  padding: '0.6rem 0.75rem',
  borderRadius: '0.5rem',
  background: 'rgba(148, 163, 184, 0.12)',
  color: 'inherit',
  fontSize: '0.78rem',
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  overflowX: 'auto',
};

const fallbackHintStyle: React.CSSProperties = {
  margin: '0.3rem 0 0',
  fontSize: '0.72rem',
  color: 'rgba(148, 163, 184, 0.95)',
};

export const MermaidDiagram: React.FC<MermaidDiagramProps> = ({ code, className = '' }) => {
  const [svg, setSvg] = useState('');
  const [phase, setPhase] = useState<RenderPhase>('loading');
  const [theme, setTheme] = useState<MermaidTheme>(() => (isDarkTheme() ? 'dark' : 'default'));

  const source = useMemo(() => (code || '').trim(), [code]);

  // Follow global theme switches (<html data-theme="dark"> / .dark-theme class).
  useEffect(() => {
    const root = document.documentElement;
    const syncTheme = () => {
      const next: MermaidTheme = isDarkTheme() ? 'dark' : 'default';
      setTheme((prev) => (prev === next ? prev : next));
    };
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    syncTheme();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!source) {
      setSvg('');
      setPhase('empty');
      return;
    }

    let cancelled = false;
    const id = nextRenderId();
    setSvg('');
    setPhase('loading');

    void (async () => {
      try {
        ensureMermaidInitialized(theme);
        const { svg: rendered } = await enqueueRender(() => mermaid.render(id, sanitizeMermaidClient(source)));
        if (cancelled) {
          cleanupMermaidArtifacts(id);
          return;
        }
        setSvg(rendered);
        setPhase('ready');
      } catch {
        cleanupMermaidArtifacts(id);
        if (cancelled) return;
        setSvg('');
        setPhase('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [source, theme]);

  if (phase === 'error') {
    return (
      <div className={className || undefined}>
        <pre className="code-box" style={fallbackPreStyle}>
          {code}
        </pre>
        <p style={fallbackHintStyle}>图谱渲染失败，已显示 Mermaid 源码</p>
      </div>
    );
  }

  if (phase === 'empty') return null;

  if (phase !== 'ready' || !svg) {
    return <div className={className || undefined} aria-busy="true" style={placeholderStyle} />;
  }

  return (
    <div
      className={`mermaid-diagram ${className}`.trim()}
      style={diagramStyle}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};

export default MermaidDiagram;
