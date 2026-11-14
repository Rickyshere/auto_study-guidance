/**
 * Normalize LaTeX delimiters (`\(...\)` -> `$...$`, `\[...\]` -> `$$...$$`)
 * and protect bare LaTeX math expressions so remark-math + rehype-katex render reliably.
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

  // 3. Convert legacy/raw `$$ ... $$` inline runs safely and trim excess whitespace inside `$ ... $`
  out = out.replace(/(?<!\$)\$(?!\$)([^$\n]+?)(?<!\$)\$(?!\$)/g, (_match, inner: string) => {
    const trimmed = inner.trim();
    return trimmed ? `$${trimmed}$` : '';
  });

  // 4. Inside Markdown table lines, replace `\|` norm delimiters inside $...$ with `\parallel`
  out = out
    .split('\n')
    .map((line) => {
      const trimmed = line.trimStart();
      if (!trimmed.startsWith('|')) return line;
      return line.replace(/\$[^$\n]+\$/g, (mathSeg) => mathSeg.replace(/\\\|/g, ' \\parallel '));
    })
    .join('\n');

  // 5. Fallback heuristic: if a short inline segment contains `\frac{` or `\sqrt{` without any `$` delimiter nearby, wrap it
  out = out.replace(
    /(^|[\s(：:])((?:\\(?:frac|dfrac|sqrt|sum|int|nabla|theta|alpha|beta|gamma|sigma|partial)\b[^$\n，。；、]*))/g,
    (full, prefix: string, expr: string) => {
      if (full.includes('$')) return full;
      return `${prefix}$${expr.trim()}$`;
    }
  );

  return out;
}
