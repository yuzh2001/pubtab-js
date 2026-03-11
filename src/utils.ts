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
    // Unwrap color wrappers first so inner style wrappers can be peeled in the same pass.
    s = s.replace(/^\\textcolor(?:\[[^\]]+\])?\{[^}]+\}\{([\s\S]*)\}$/u, '$1');
    s = s.replace(/^\\cellcolor(?:\[[^\]]+\])?\{[^}]+\}\{([\s\S]*)\}$/u, '$1');
    s = s.replace(/^\\textbf\{([\s\S]*)\}$/u, '$1');
    s = s.replace(/^\\textit\{([\s\S]*)\}$/u, '$1');
    s = s.replace(/^\\underline\{([\s\S]*)\}$/u, '$1');
    s = s.replace(/^\{([\s\S]*)\}$/u, '$1');
    if (s === prev) break;
  }
  return s;
}

export function splitUnescaped(input: string, sep: '&' | '\\\\'): string[] {
  if (sep === '&') {
    const out: string[] = [];
    let cur = '';
    for (let i = 0; i < input.length; i += 1) {
      const ch = input[i];
      if (ch === '&' && input[i - 1] !== '\\') {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  }
  return input.split(/\\\\/g);
}
