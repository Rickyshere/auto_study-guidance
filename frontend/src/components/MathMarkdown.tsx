import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { normalizeMathMarkdown } from '../utils/mathMarkdown';

interface MathMarkdownProps {
  children: string;
  inline?: boolean;
  className?: string;
}

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
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
};
