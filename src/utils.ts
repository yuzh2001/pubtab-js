const LATEX_SPECIAL: Record<string, string> = {
  '&': '\\&',
  '%': '\\%',
  '$': '\\$',
  '#': '\\#',
  '_': '\\_',
  '{': '\\{',
  '}': '\\}',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
  '\\': '\\textbackslash{}',
};

const LATEX_RE = new RegExp(`[${Object.keys(LATEX_SPECIAL).map((s) => `\\${s}`).join('')}]`, 'g');

export function latexEscape(input: unknown): string {
  const s = String(input ?? '');
  return s.replace(LATEX_RE, (m) => LATEX_SPECIAL[m] ?? m);
}

export function hexToLatexColor(hex: string): string {
  const h = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return '0,0,0';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r},${g},${b}`;
}

export function latexRgbToHex(rgb: string): string | null {
  const m = rgb.trim().match(/^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/u);
  if (!m) return null;
  const r = Number(m[1]);
  const g = Number(m[2]);
  const b = Number(m[3]);
  if (![r, g, b].every((n) => Number.isFinite(n) && n >= 0 && n <= 255)) return null;
  const toHex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function stripLatexWrappers(raw: string): string {
  // Common wrappers used by pubtab outputs.
  // Keep this conservative: we only unwrap when the whole cell is a wrapper.
  // Run a short fixed-point loop to peel nested wrappers like \cellcolor{ \textbf{...} }.
  let s = raw.trim();
  for (let i = 0; i < 5; i += 1) {
    const prev = s;
    s = s.trim();
    s = s.replace(/^\\makecell\{([\s\S]*)\}$/u, (_m, inner) => inner.replace(/\\\\/g, '\n'));
    s = s.replace(/^\\diagbox\{([\s\S]*?)\}\{([\s\S]*?)\}$/u, '$1 / $2');
    s = s.replace(/^\\var\{([\s\S]*)\}$/u, '$1');
    // Unwrap color wrappers first so inner style wrappers can be peeled in the same pass.
    s = s.replace(/^\\textcolor(?:\[[^\]]+\])?\{[^}]+\}\{([\s\S]*)\}$/u, '$1');
    s = s.replace(/^\\cellcolor(?:\[[^\]]+\])?\{[^}]+\}\{([\s\S]*)\}$/u, '$1');
    s = s.replace(/^\\rotatebox(?:\[[^\]]+\])?\{[^}]+\}\{([\s\S]*)\}$/u, '$1');
    s = s.replace(/^\\textbf\{([\s\S]*)\}$/u, '$1');
    s = s.replace(/^\\textit\{([\s\S]*)\}$/u, '$1');
    s = s.replace(/^\\underline\{([\s\S]*)\}$/u, '$1');
    s = s.replace(/^\$([\s\S]*)\$$/u, '$1');
    s = s.replace(/\\text\{([^}]*)\}/gu, '$1');
    s = s.replace(/^\{([\s\S]*)\}$/u, '$1');
    if (s === prev) break;
  }

  // Drop citations (fixture tables should keep the core label only).
  // Regex can't reliably handle nested braces; clean up any dangling braces later.
  s = s.replace(/~?\\cite[a-zA-Z*]*(?:\[[^\]]*\])?\{[^}]*\}/gu, '');

  // Inline wrappers that frequently appear inside numeric/text cells.
  s = s.replace(/\\var\{([\s\S]*?)\}/gu, '$1');
  s = s.replace(/\\underline\{([\s\S]*?)\}/gu, '$1');
  s = s.replace(/\\textbf\{([\s\S]*?)\}/gu, '$1');
  s = s.replace(/\\textit\{([\s\S]*?)\}/gu, '$1');
  s = s.replace(/\\textcolor(?:\[[^\]]+\])?\{[^}]+\}\{([\s\S]*?)\}/gu, '$1');

  // Normalize `{$\pm$0.01}` like patterns into unicode ±.
  s = s.replace(/\{\$\s*\\pm\s*\$\s*([0-9.]+)\s*\}/gu, '±$1');
  s = s.replace(/\$\s*\\pm\s*\$\s*([0-9.]+)/gu, '±$1');
  s = s.replace(/\s+±/gu, '±');

  // `\textemdash\` is common in captions and sometimes leaks into cells; map to unicode em dash.
  s = s.replace(/\\textemdash\\?/gu, '—');

  // Unescape common special chars used in tables.
  s = s
    .replace(/\\%/g, '%')
    .replace(/\\#/g, '#')
    .replace(/\\_/g, '_')
    .replace(/\\&/g, '&')
    .replace(/\\\$/g, '$')
    .replace(/\\\{/g, '{')
    .replace(/\\\}/g, '}');

  // Remove stray braces (pubtab-python `_clean_latex` does this as a late cleanup step).
  s = s.replace(/\{/g, '').replace(/\}/g, '');

  // If citation removal left a trailing unmatched '}', drop it.
  for (let i = 0; i < 5; i += 1) {
    if (!s.endsWith('}')) break;
    const opens = (s.match(/\{/gu) ?? []).length;
    const closes = (s.match(/\}/gu) ?? []).length;
    if (closes <= opens) break;
    s = s.slice(0, -1).trimEnd();
  }

  return s;
}

export function splitUnescaped(input: string, sep: '&' | '\\\\'): string[] {
  const out: string[] = [];
  let cur = '';
  let braceDepth = 0;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const prev = i > 0 ? input[i - 1] : '';

    if (ch === '{' && prev !== '\\') braceDepth += 1;
    if (ch === '}' && prev !== '\\') braceDepth = Math.max(0, braceDepth - 1);

    if (sep === '&') {
      if (ch === '&' && prev !== '\\' && braceDepth === 0) {
        out.push(cur);
        cur = '';
        continue;
      }
      cur += ch;
      continue;
    }

    // `\\` row break; do not split inside {...} (e.g. \makecell{a\\b}).
    if (ch === '\\' && input[i + 1] === '\\' && braceDepth === 0) {
      out.push(cur);
      cur = '';
      i += 1; // consume second backslash
      continue;
    }

    cur += ch;
  }

  out.push(cur);
  return out;
}
