const INLINE_TABLE_SEP_RE = /\|\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|/;
const PURE_TABLE_SEP_RE = /^\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?$/;

function unescapedPipePositions(s: string): number[] {
  const pos: number[] = [];
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === '|' && (i === 0 || s[i - 1] !== '\\')) {
      pos.push(i);
    }
  }
  return pos;
}

export function expandInlineMarkdownTables(text: string): string {
  if (!text || !text.includes('|')) return text;

  const outLines: string[] = [];
  for (const line of text.split('\n')) {
    const stripped = line.trim();
    if (!stripped || PURE_TABLE_SEP_RE.test(stripped)) {
      outLines.push(line);
      continue;
    }

    const match = INLINE_TABLE_SEP_RE.exec(line);
    if (!match) {
      outLines.push(line);
      continue;
    }

    const sepStr = match[0].trim();
    const numCols = sepStr.replace(/^\|/, '').replace(/\|$/, '').split('|').length;
    if (numCols < 2) {
      outLines.push(line);
      continue;
    }

    const beforeR = line.slice(0, match.index).replace(/\s+$/, '');
    const after = line.slice(match.index + match[0].length);

    let prefixText = '';
    let headerRow = '';
    if (beforeR.endsWith('|')) {
      const beforePipes = unescapedPipePositions(beforeR);
      if (beforePipes.length >= numCols + 1) {
        const hdrStart = beforePipes[beforePipes.length - (numCols + 1)];
        prefixText = beforeR.slice(0, hdrStart).trimEnd();
        headerRow = beforeR.slice(hdrStart).trim();
      } else if (beforePipes.length === numCols) {
        const firstPipe = beforePipes[0];
        const prefixCandidate = beforeR.slice(0, firstPipe);
        const punctIdx = Math.max(
          prefixCandidate.lastIndexOf('：'),
          prefixCandidate.lastIndexOf(':'),
          prefixCandidate.lastIndexOf('。'),
          prefixCandidate.lastIndexOf('；')
        );
        if (punctIdx >= 0) {
          prefixText = beforeR.slice(0, punctIdx + 1).trim();
          headerRow = `| ${beforeR.slice(punctIdx + 1).trim()}`;
        } else {
          headerRow = `| ${beforeR.trim()}`;
        }
      }
    }

    if (!headerRow) {
      outLines.push(line);
      continue;
    }

    const dataRows: string[] = [];
    let pos = 0;
    while (pos < after.length) {
      while (pos < after.length && /\s/.test(after[pos])) pos += 1;
      if (pos >= after.length || after[pos] !== '|') break;
      const rowPipes: number[] = [pos];
      let scan = pos + 1;
      while (scan < after.length && rowPipes.length < numCols + 1) {
        if (after[scan] === '|' && after[scan - 1] !== '\\') {
          rowPipes.push(scan);
        }
        scan += 1;
      }
      if (rowPipes.length === numCols + 1) {
        const lastPipe = rowPipes[rowPipes.length - 1];
        dataRows.push(after.slice(pos, lastPipe + 1).trim());
        pos = lastPipe + 1;
      } else {
        break;
      }
    }

    const suffixText = after.slice(pos).trim();
    if (prefixText) {
      outLines.push(prefixText);
      outLines.push('');
    }
    outLines.push(headerRow);
    outLines.push(sepStr);
    outLines.push(...dataRows);
    if (suffixText) {
      outLines.push('');
      outLines.push(expandInlineMarkdownTables(suffixText));
    } else if (after && dataRows.length === 0) {
      outLines.push(after.trim());
    }
  }

  return outLines.join('\n');
}

const TABLE_SEP_ROW_RE = /^\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?\s*$/;
const PIPE_ROW_RE = /^\|.*\|\s*$/;

/** 讲义分页标记：与后端 `PAGE_BREAK_TOKEN` 保持一致。 */
export const PAGE_BREAK_TOKEN = '@@ASG_PAGE_BREAK@@';
const PAGE_BREAK_HTML_RE =
  /<div[^>]*class\s*=\s*["']?page-break["']?[^>]*>\s*<\/div>|<!--\s*page-?break\s*-->/gi;

/**
 * 把 `<div class="page-break"></div>` 换成统一 token。
 * 否则 react-markdown 会把它当成普通文字直接印在讲义正文里。
 */
export function normalizePageBreaks(text: string): string {
  if (!text) return text;
  if (!/page-?break/i.test(text) && !text.includes(PAGE_BREAK_TOKEN)) return text;
  return text
    .replace(PAGE_BREAK_HTML_RE, `\n\n${PAGE_BREAK_TOKEN}\n\n`)
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * Restore the separator row of a GFM table the model pasted without one.
 *
 * A two-row table glued into a sentence (`如下表：` then two `| … |` lines) has no
 * `|---|---|` row, so GFM renders it as one long paragraph instead of a table.
 */
export function repairPipeTables(text: string): string {
  if (!text || !text.includes('|')) return text;

  const lines = text.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim().startsWith('|')) {
      out.push(line);
      i += 1;
      continue;
    }

    const run: string[] = [];
    let j = i;
    while (j < lines.length && lines[j].trim().startsWith('|')) {
      run.push(lines[j].trim());
      j += 1;
    }

    const rows = run.map((row) => row.replace(/^\|/, '').replace(/\|$/, '').split('|'));
    const widths = new Set(rows.map((r) => r.length));
    const looksLikeTable =
      run.length >= 2 &&
      !run.some((row) => TABLE_SEP_ROW_RE.test(row)) &&
      widths.size === 1 &&
      Math.min(...widths) >= 2 &&
      run.every((row) => PIPE_ROW_RE.test(row)) &&
      rows.some((r) => r.some((cell) => cell.trim()));

    if (!looksLikeTable) {
      out.push(...run);
      i = j;
      continue;
    }

    if (out.length > 0 && out[out.length - 1].trim()) out.push('');
    out.push(run[0]);
    out.push(`|${new Array(rows[0].length).fill('---').join('|')}|`);
    out.push(...run.slice(1));
    if (j < lines.length && lines[j].trim()) out.push('');
    i = j;
  }

  return out.join('\n');
}

/**
 * Normalize LaTeX delimiters (`\(...\)` -> `$...$`, `\[...\]` -> `$$...$$`),
 * expand single-line collapsed GFM tables, and protect bare LaTeX math expressions
 * so remark-math + rehype-katex render reliably.
 */
export function normalizeMathMarkdown(text: string): string {
  if (!text) return '';

  // 1. Convert \[ ... \] display math to $$ ... $$
  let out = text.replace(/\\\[([\s\S]*?)\\\]/g, (_match, inner: string) => {
    const body = inner.trim();
    return body ? `\n$$\n${body}\n$$\n` : '';
  });

  // 2. Convert \( ... \) inline math to $ ... $
  out = out.replace(/\\\(([\s\S]*?)\\\)/g, (_match, inner: string) => {
    const body = inner.trim();
    return body ? `$${body}$` : '';
  });

  // 3. Protect fenced code blocks and display math ($$ ... $$, possibly multi-line) so that
  //    none of the plain-text heuristics below can inject stray `$` inside them.
  const vault: string[] = [];
  const stash = (s: string) => {
    vault.push(s);
    return `\u0000${vault.length - 1}\u0000`;
  };
  out = out.replace(/```[\s\S]*?```/g, (m) => stash(m));
  out = out.replace(/\$\$([\s\S]+?)\$\$/g, (_m, inner: string) => {
    const body = inner.trim();
    if (!body) return '';
    // Multi-line or standalone display math -> keep as a block on its own lines
    return stash(`$$\n${body}\n$$`);
  });
  // Put display blocks on their own lines (remark-math needs block delimiters on separate lines)
  out = out.replace(/([^\n])(\u0000\d+\u0000)/g, (m, pre: string, ph: string) => {
    const idx = Number(ph.slice(1, -1));
    return vault[idx].startsWith('$$') ? `${pre}\n\n${ph}` : m;
  });
  out = out.replace(/(\u0000\d+\u0000)([^\n\u0000])/g, (m, ph: string, post: string) => {
    const idx = Number(ph.slice(1, -1));
    return vault[idx].startsWith('$$') ? `${ph}\n\n${post}` : m;
  });

  // 4. Trim excess whitespace inside single-line `$ ... $`
  out = out.replace(/(?<!\$)\$(?!\$)([^$\n]+?)(?<!\$)\$(?!\$)/g, (_match, inner: string) => {
    const trimmed = inner.trim();
    return trimmed ? `$${trimmed}$` : '';
  });

  // 5. Expand collapsed inline Markdown tables into multi-line GFM tables
  out = expandInlineMarkdownTables(out);
  // 5b. Re-add the separator row to tables pasted without one (otherwise they print as text)
  out = repairPipeTables(out);
  // 5c. 统一分页标记，避免原始 <div> 被当成正文渲染
  out = normalizePageBreaks(out);

  // 6. Protect inline math, inline code and images; then repair bare LaTeX only in plain text
  out = out.replace(/\$[^$\n]+\$|`[^`\n]+`|!\[[^\]]*\]\([^)]+\)/g, (m) => stash(m));

  out = out
    .split('\n')
    .map((line) => {
      let seg = line;
      if (seg.includes('\\')) {
        seg = seg.replace(/\\%/g, '%').replace(/\\(?=[ \t])/g, '');
      }
      // Fallback: a bare run starting with a LaTeX command -> wrap as inline math
      seg = seg.replace(
        /(^|[\s(（：:])(\\(?:frac|dfrac|tfrac|sqrt|sum|prod|int|oint|lim|nabla|partial|delta|Delta|theta|alpha|beta|gamma|sigma|lambda|mu|eta|omega|pi|log|ln|exp|mathbf|mathrm|boldsymbol|hat|bar|vec)\b[^\u0000\n，。；、]*)/g,
        (_full, prefix: string, expr: string) => `${prefix}${stash(`$${expr.trim()}$`)}`
      );
      // Wrap bare K_m^{app}, V_{max}, V_T, V_D, 4K_m
      seg = seg.replace(
        /\b([A-Za-z0-9]+(?:_(?:\{[^{}]+\}|[A-Za-z0-9]+))?\^\{[^{}]+\}|[A-Za-z0-9]+_\{[^{}]+\})/g,
        (_m, expr: string) => stash(`$${expr}$`)
      );
      seg = seg.replace(
        /(?<![A-Za-z_$\\])([0-9]*[A-Z]_[A-Za-z0-9]{1,3})(?![A-Za-z0-9_$])/g,
        (_m, expr: string) => stash(`$${expr}$`)
      );
      return seg;
    })
    .join('\n');

  // 7. Restore protected segments (nested placeholders resolve iteratively)
  for (let guard = 0; guard < 5 && out.includes('\u0000'); guard += 1) {
    out = out.replace(/\u0000(\d+)\u0000/g, (_m, idx: string) => vault[Number(idx)] ?? '');
  }

  // 8. Inside table rows, `\|` within inline math would split cells
  out = out
    .split('\n')
    .map((line) =>
      line.trimStart().startsWith('|')
        ? line.replace(/\$[^$\n]+\$/g, (mathSeg) => mathSeg.replace(/\\\|/g, ' \\parallel '))
        : line
    )
    .join('\n');

  return out;
}
