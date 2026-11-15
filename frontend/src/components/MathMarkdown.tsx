import React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { normalizeMathMarkdown, PAGE_BREAK_TOKEN } from '../utils/mathMarkdown';
import { MermaidDiagram } from './MermaidDiagram';

interface MathMarkdownProps {
  children: string;
  inline?: boolean;
  className?: string;
}

const MERMAID_CLASS_RE = /(?:^|\s)language-mermaid(?:\s|$)/i;

function isMermaidBlock(className?: string): boolean {
  return typeof className === 'string' && MERMAID_CLASS_RE.test(className);
}

/** Fenced code children arrive as plain text; keep the raw source for the fallback view. */
function childrenToText(children: React.ReactNode): string {
  return React.Children.toArray(children)
    .map((child) => (typeof child === 'string' || typeof child === 'number' ? String(child) : ''))
    .join('');
}

/** 讲义里的分页标记：应用内显示为一条标注"分页"的虚线，而不是原始 HTML 文本。 */
const PageBreakDivider: React.FC = () => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      margin: '18px 0',
      color: '#94A3B8',
      fontSize: '11px',
      userSelect: 'none',
    }}
  >
    <span style={{ flex: 1, borderTop: '1px dashed #CBD5E1' }} />
    <span style={{ letterSpacing: '0.08em' }}>分页 · 打印时此处另起一页</span>
    <span style={{ flex: 1, borderTop: '1px dashed #CBD5E1' }} />
  </div>
);

const markdownComponents: Components = {
  code: ({ node: _node, className, children, ...props }) => {
    if (isMermaidBlock(className)) {
      return <MermaidDiagram code={childrenToText(children)} />;
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  // A fenced block is wrapped in <pre>; drop that wrapper for the diagram so the
  // inline <svg> is not rendered inside a `white-space: pre` container.
  pre: ({ node: _node, children, ...props }) => {
    const [firstChild] = React.Children.toArray(children);
    if (React.isValidElement<{ className?: string }>(firstChild) && isMermaidBlock(firstChild.props.className)) {
      return <>{firstChild}</>;
    }
    return <pre {...props}>{children}</pre>;
  },
  p: ({ node: _node, children, ...props }) => {
    if (childrenToText(children).trim() === PAGE_BREAK_TOKEN) {
      return <PageBreakDivider />;
    }
    return <p {...props}>{children}</p>;
  },
};

export const MathMarkdown: React.FC<MathMarkdownProps> = ({
  children,
  inline = false,
  className = '',
}) => {
  const normalized = normalizeMathMarkdown(children || '');

  if (inline) {
    return (
      <span className={`asg-math-inline ${className}`}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
          components={{
            p: ({ children: pChildren }) => <span>{pChildren}</span>,
          }}
        >
          {normalized}
        </ReactMarkdown>
      </span>
    );
  }

  return (
    <div className={`markdown-body ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
        components={markdownComponents}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
};
