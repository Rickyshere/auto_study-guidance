/**
 * Normalize LaTeX delimiters so remark-math + rehype-katex + remark-gfm render cleanly
 * without broken parenthesized LaTeX or GFM table pipe collisions.
 */

const LATEX_CMD_PATTERN =
  /\\(?:frac|dfrac|sigma|theta|eta|lambda|alpha|beta|gamma|delta|nabla|partial|sqrt|left|right|lfloor|rfloor|cdot|times|mathrm|text|infty|leftarrow|rightarrow|parallel|sum|int|log|exp|tanh|le|ge|neq|approx)/;

function replaceTablePipesInMath(line: string): string {
  if (!line.trimStart().startsWith('|')) return line;
  return line.replace(/(?<!\$)\$(?!\$)([^\n$]+?)(?<!\$)\$(?!\$)/g, (_m, inner: string) => {
    const fixed = inner.replace(/\\\|/g, '\\parallel ');
    return `$${fixed}$`;
  });
}

function wrapBareParenthesizedLatex(line: string): string {
  if (line.includes('`') || line.includes('$') || !LATEX_CMD_PATTERN.test(line)) {
    return line;
  }
  const chars: string[] = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    const ch = line[i];
    const prev = i > 0 ? line[i - 1] : '';
    if (ch === '(' && prev !== '\\' && prev !== '$' && !/[A-Za-z0-9]/.test(prev)) {
      let depth = 1;
      let j = i + 1;
      while (j < n && depth > 0) {
        if (line[j] === '(') depth += 1;
        else if (line[j] === ')') depth -= 1;
        j += 1;
      }
      if (depth === 0) {
        const inner = line.slice(i + 1, j - 1);
        if (LATEX_CMD_PATTERN.test(inner) || inner.includes('^{') || inner.includes('_{')) {
          chars.push(`$${inner.trim()}$`);
          i = j;
          continue;
        }
      }
    }
    chars.push(ch);
    i += 1;
  }
  return chars.join('');
}

export function normalizeMathMarkdown(raw: string): string {
  if (!raw) return raw;

  let out = raw
    .replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (_m, expr: string) => `\n$$\n${expr.trim()}\n$$\n`)
    .replace(/\\\(\s*([\s\S]*?)\s*\\\)/g, (_m, expr: string) => `$${expr.trim()}$`);

  out = out
    .split('\n')
    .map((line) => replaceTablePipesInMath(wrapBareParenthesizedLatex(line)))
    .join('\n');

  return out;
}
