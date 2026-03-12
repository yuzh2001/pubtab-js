import type { Cell, CellStyle, RichSegment, TableData } from './models.js';
import { latexRgbToHex, splitUnescaped, stripLatexWrappers } from './utils.js';

const LATEX_COLOR_NAMES: Record<string, string> = {
  // Common named colors + dvipsnames subset used by pubtab-python
  red: '#FF0000',
  blue: '#0000FF',
  green: '#008000',
  black: '#000000',
  white: '#FFFFFF',
  gray: '#808080',
  grey: '#808080',
  forestgreen: '#009B55',
  dandelion: '#FDBC42',
};

function normalizeColor(raw: string, optModel: string | null = null): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (optModel && optModel.toUpperCase() === 'RGB') {
    return latexRgbToHex(s);
  }
  if (s.startsWith('#') && s.length === 7) return s.toUpperCase();
  if (/^[0-9a-fA-F]{6}$/u.test(s)) return `#${s.toUpperCase()}`;
  const hit = LATEX_COLOR_NAMES[s] ?? LATEX_COLOR_NAMES[s.toLowerCase()];
  return hit ?? null;
}

function readBracketGroup(input: string, i: number): { value: string; next: number } | null {
  if (input[i] !== '[') return null;
  const end = input.indexOf(']', i + 1);
  if (end < 0) return null;
  return { value: input.slice(i + 1, end), next: end + 1 };
}

function readBraceGroup(input: string, i: number): { value: string; next: number } | null {
  if (input[i] !== '{') return null;
  let depth = 0;
  for (let j = i; j < input.length; j += 1) {
    const ch = input[j];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    if (depth === 0) {
      return { value: input.slice(i + 1, j), next: j + 1 };
    }
  }
  return null;
}

function unwrapMakebox(text: string): string {
  // \makebox[...][...]{...} => ...
  let i = 0;
  while (i < text.length) {
    const idx = text.indexOf('\\makebox', i);
    if (idx < 0) break;
    let j = idx + '\\makebox'.length;
    while (j < text.length && /\s/u.test(text[j])) j += 1;
    for (;;) {
      const bg = readBracketGroup(text, j);
      if (!bg) break;
      j = bg.next;
      while (j < text.length && /\s/u.test(text[j])) j += 1;
    }
    const arg = readBraceGroup(text, j);
    if (!arg) {
      i = j;
      continue;
    }
    let inner = arg.value;
    // \makebox often wraps another {...} group; peel one layer if present.
    const nested = readBraceGroup(`{${inner}}`, 0);
    if (nested && nested.next === inner.length + 2) inner = nested.value;
    text = text.slice(0, idx) + inner + text.slice(arg.next);
    i = idx + inner.length;
  }
  return text;
}

function convertColorSwitchGroups(text: string): string {
  // Convert "{\color{X} content}" to "\textcolor{X}{content}" so rich segment logic can detect it.
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '{' && text.slice(i + 1, i + 7) === '\\color') {
      let j = i + 1 + '\\color'.length;
      const opt = readBracketGroup(text, j);
      if (opt) j = opt.next;
      const colorArg = readBraceGroup(text, j);
      if (!colorArg) continue;
      j = colorArg.next;
      while (j < text.length && /\s/u.test(text[j])) j += 1;
      // consume content up to matching outer brace
      let depth = 1;
      let k = j;
      for (; k < text.length; k += 1) {
        if (text[k] === '{') depth += 1;
        else if (text[k] === '}') depth -= 1;
        if (depth === 0) break;
      }
      if (depth !== 0) continue;
      const content = text.slice(j, k).trim();
      const repl = `\\textcolor${opt ? `[${opt.value}]` : ''}{${colorArg.value}}{${content}}`;
      out += repl;
      i = k; // skip closing brace
      continue;
    }
    out += text[i];
  }
  return out;
}

function unwrapInnerTabular(text: string): string {
  // Convert in-cell tabular used for line breaks into plain content with \n.
  // This must handle nested braces in column specs like `p{0.8cm}` and optional args.
  return replaceTabularEnvs(text, (body) => body.replace(/\\\\/g, '\n'));
}

function parseFormatting(raw: string): { bold: boolean; italic: boolean; underline: boolean; text: string } {
  let s = raw.trim();
  let bold = false;
  let italic = false;
  let underline = false;
  for (let i = 0; i < 5; i += 1) {
    const prev = s;
    const b = s.match(/^\\textbf\{([\s\S]*)\}$/u);
    if (b) {
      bold = true;
      s = b[1];
    }
    const it = s.match(/^\\textit\{([\s\S]*)\}$/u);
    if (it) {
      italic = true;
      s = it[1];
    }
    const un = s.match(/^\\underline\{([\s\S]*)\}$/u);
    if (un) {
      underline = true;
      s = un[1];
    }
    const sf = s.match(/^\\textsf\{([\s\S]*)\}$/u);
    if (sf) s = sf[1];
    const br = s.match(/^\{([\s\S]*)\}$/u);
    if (br) s = br[1];
    if (s === prev) break;
  }
  return { bold, italic, underline, text: s };
}

function extractTextcolorSegments(text: string): RichSegment[] | null {
  const matches: Array<{ start: number; end: number; model: string | null; color: string; content: string }> = [];
  for (let i = 0; i < text.length; i += 1) {
    const idx = text.indexOf('\\textcolor', i);
    if (idx < 0) break;
    let j = idx + '\\textcolor'.length;
    const opt = readBracketGroup(text, j);
    const model = opt ? opt.value : null;
    if (opt) j = opt.next;
    const c1 = readBraceGroup(text, j);
    if (!c1) {
      i = j;
      continue;
    }
    const c2 = readBraceGroup(text, c1.next);
    if (!c2) {
      i = c1.next;
      continue;
    }
    matches.push({ start: idx, end: c2.next, model, color: c1.value, content: c2.value });
    i = idx + 1;
  }
  if (matches.length < 1) return null;

  const segs: RichSegment[] = [];
  let pos = 0;
  for (const m of matches) {
    if (m.start > pos) {
      const rawPre = text.slice(pos, m.start);
      const { bold, italic, underline, text: plainRaw } = parseFormatting(rawPre.trim());
      let plain = stripLatexWrappers(plainRaw).trim().replace(/\s+/g, ' ');
      plain = plain.replace(/\\quad/g, ' ').replace(/\\,/g, ' ').replace(/\\;/g, ' ');
      // preserve one trailing space before a colored segment
      if (plain && rawPre && /\s/u.test(rawPre[rawPre.length - 1]) && !plain.endsWith(' ')) plain += ' ';
      if (plain) segs.push([plain, null, bold, italic, underline]);
    }
    const colorHex = normalizeColor(m.color, m.model);
    const { bold, italic, underline, text: innerRaw } = parseFormatting(m.content);
    const inner = stripLatexWrappers(innerRaw).trim();
    if (inner) segs.push([inner, colorHex, bold, italic, underline]);
    pos = m.end;
  }

  if (pos < text.length) {
    const rawRem = text.slice(pos);
    const { bold, italic, underline, text: remRaw } = parseFormatting(rawRem.trim());
    let remaining = stripLatexWrappers(remRaw).trim().replace(/\s+/g, ' ');
    remaining = remaining.replace(/\\quad/g, ' ').replace(/\\,/g, ' ').replace(/\\;/g, ' ');
    if (remaining && rawRem && rawRem[0] === ' ' && !remaining.startsWith(' ')) remaining = ` ${remaining}`;
    if (remaining) segs.push([remaining, null, bold, italic, underline]);
  }

  return segs.length > 1 ? segs : null;
}

function parseCell(raw: string): Cell {
  const s = raw.trim();

  let colspan = 1;
  let rowspan = 1;
  const style: CellStyle = {};
  let value = s;

  const parseMulticolumn = (input: string): { colspan: number; content: string } | null => {
    if (!input.startsWith('\\multicolumn')) return null;
    let i = '\\multicolumn'.length;
    i = skipWs(input, i);
    const g1 = readBraceGroup(input, i);
    if (!g1) return null;
    const n = Number(g1.value.trim());
    if (!Number.isFinite(n) || n <= 0) return null;
    i = skipWs(input, g1.next);
    const _align = readBraceGroup(input, i);
    if (!_align) return null;
    i = skipWs(input, _align.next);
    const g3 = readBraceGroup(input, i);
    if (!g3) return null;
    return { colspan: Math.trunc(n), content: g3.value };
  };

  const parseMultirow = (input: string): { rowspan: number; content: string } | null => {
    if (!input.startsWith('\\multirow')) return null;
    let i = '\\multirow'.length;
    i = skipWs(input, i);
    const opt = readBracketGroup(input, i);
    if (opt) i = skipWs(input, opt.next);
    const g1 = readBraceGroup(input, i);
    if (!g1) return null;
    const n = Math.round(Number(g1.value.trim()));
    if (!Number.isFinite(n) || n === 0) return null;
    i = skipWs(input, g1.next);
    const opt2 = readBracketGroup(input, i);
    if (opt2) i = skipWs(input, opt2.next);

    // width arg: either '*' or {...}
    if (input[i] === '*') {
      i += 1;
      i = skipWs(input, i);
    } else {
      const w = readBraceGroup(input, i);
      if (w) i = skipWs(input, w.next);
    }

    const g2 = readBraceGroup(input, i);
    if (!g2) return null;
    return { rowspan: Math.abs(n), content: g2.value };
  };

  const mc = parseMulticolumn(value.trim());
  if (mc) {
    colspan = mc.colspan;
    value = mc.content;
    // If inner content is also a multicolumn, unwrap once (Python keeps outer alignment, we ignore align anyway).
    const inner = parseMulticolumn(value.trim());
    if (inner) value = inner.content;
  }

  const mr = parseMultirow(value.trim());
  if (mr) {
    rowspan = mr.rowspan;
    value = mr.content;
  }

  const diag = value.match(/^\\diagbox\{([^{}]+)\}\{([^{}]+)\}$/u);
  if (diag) {
    style.diagbox = [diag[1], diag[2]];
    value = '';
  }

  // Unwrap wrappers that otherwise leak into prefixes.
  value = unwrapMakebox(value);
  value = unwrapInnerTabular(value);
  value = convertColorSwitchGroups(value);

  // Extract background first.
  for (let i = 0; i < 5; i += 1) {
    const m = value.match(/^\\cellcolor(?:\[([^\]]+)\])?\{([^}]+)\}\{([\s\S]*)\}$/u);
    if (!m) break;
    const model = m[1] ?? null;
    const hex = normalizeColor(m[2], model);
    if (hex && !style.bgColor) style.bgColor = hex;
    value = m[3];
  }

  // Extract rotatebox before rich segment detection (matches pubtab-python order).
  const rot = value.match(/^\\rotatebox(?:\[[^\]]*\])?\{(\d+)\}\{([\s\S]*)\}$/u);
  if (rot) {
    style.rotation = Number(rot[1]);
    value = rot[2];
  }

  // Detect rich segments (multiple \textcolor pieces).
  const segs = extractTextcolorSegments(value);
  let richSegments: RichSegment[] | null = segs;

  if (!richSegments) {
    // Single textcolor wrapper as cell style (not rich).
    const tc = value.match(/^\\textcolor(?:\[([^\]]+)\])?\{([^}]+)\}\{([\s\S]*)\}$/u);
    if (tc) {
      const hex = normalizeColor(tc[2], tc[1] ?? null);
      if (hex) style.color = hex;
      value = tc[3];
    }
  }

  // Extract formatting for non-rich cells.
  if (!richSegments) {
    const fmt = parseFormatting(value);
    if (fmt.bold) style.bold = true;
    if (fmt.italic) style.italic = true;
    if (fmt.underline) style.underline = true;
    value = fmt.text;
  }

  value = value.replace(/\\\\([#%&])/g, '\\$1').trim();
  value = stripLatexWrappers(value).trim();
  value = value.replace(/\\\\([#%&])/g, '\\$1').trim();
  value = value.replace(/\\([#%&])/g, '$1').trim();

  const numeric = Number(value);
  const finalValue = Number.isFinite(numeric) && value !== '' ? numeric : value;

  return { value: finalValue, style, rowspan, colspan, richSegments };
}

const TABULAR_BEGIN = '\\begin{tabular}';
const TABULAR_END = '\\end{tabular}';

function skipWs(input: string, i: number): number {
  while (i < input.length && /\s/u.test(input[i])) i += 1;
  return i;
}

function readTabularHeader(input: string, beginIdx: number): { bodyStart: number } | null {
  let i = beginIdx + TABULAR_BEGIN.length;
  i = skipWs(input, i);
  const opt = readBracketGroup(input, i);
  if (opt) {
    i = skipWs(input, opt.next);
  }
  const spec = readBraceGroup(input, i);
  if (!spec) return null;
  return { bodyStart: spec.next };
}

function findMatchingTabularEnd(input: string, bodyStart: number): number | null {
  let depth = 1;
  let i = bodyStart;
  for (;;) {
    const nb = input.indexOf(TABULAR_BEGIN, i);
    const ne = input.indexOf(TABULAR_END, i);
    if (ne < 0) return null;
    if (nb >= 0 && nb < ne) {
      depth += 1;
      i = nb + TABULAR_BEGIN.length;
      continue;
    }
    depth -= 1;
    if (depth === 0) return ne;
    i = ne + TABULAR_END.length;
  }
}

function replaceTabularEnvs(input: string, replacer: (body: string) => string): string {
  let out = '';
  let i = 0;
  for (;;) {
    const begin = input.indexOf(TABULAR_BEGIN, i);
    if (begin < 0) {
      out += input.slice(i);
      break;
    }
    out += input.slice(i, begin);
    const hdr = readTabularHeader(input, begin);
    if (!hdr) {
      // If malformed, keep scanning after the marker to avoid infinite loops.
      out += TABULAR_BEGIN;
      i = begin + TABULAR_BEGIN.length;
      continue;
    }
    const endIdx = findMatchingTabularEnd(input, hdr.bodyStart);
    if (endIdx == null) {
      out += input.slice(begin);
      break;
    }
    const body = input.slice(hdr.bodyStart, endIdx);
    out += replacer(body);
    i = endIdx + TABULAR_END.length;
  }
  return out;
}

function stripLatexCommentsPreservingEscapes(input: string): string {
  // Remove `% ...` comments, but keep escaped percent like `\%` (and malformed `\\%` artifacts).
  const lines = input.split(/\r?\n/u);
  const out: string[] = [];
  for (const line of lines) {
    let cut = line.length;
    for (let i = 0; i < line.length; i += 1) {
      if (line[i] !== '%') continue;
      if (i > 0 && line[i - 1] === '\\') continue;
      cut = i;
      break;
    }
    out.push(line.slice(0, cut));
  }
  return out.join('\n');
}

function normalizeDecorativeLines(input: string): string {
  const decoToken = /-\\\/(?:-\\\/)+/u; // e.g. -\/-\/-\/
  const lines = input.split(/\r?\n/u);
  const out: string[] = [];
  const isPureDecorLine = (compact: string): boolean => /^-(?:\\\/-){2,}$/u.test(compact);
  const isLabelLine = (line: string): boolean => /^[A-Za-z][A-Za-z .'\-]{0,40}$/u.test(line.trim());

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const compact = line.replace(/\s/gu, '');
    if (!compact) {
      out.push(line);
      continue;
    }

    const next = (lines[i + 1] ?? '').trim();
    const nextIsMultirow = /^\\multirow/gu.test(next);
    const nextIsPureDecor = (() => {
      const nextCompact = next.replace(/\s/gu, '');
      return isPureDecorLine(nextCompact);
    })();
    const hasDecorative = /-\\\/(?:-\\\/)+/u.test(compact);

    if (isLabelLine(line) && nextIsPureDecor) {
      continue;
    }
    if (hasDecorative) {
      if (isPureDecorLine(compact) || (isLabelLine(line) && nextIsPureDecor) || nextIsMultirow) {
        continue;
      }
      const cleaned = line.replace(decoToken, '').trim();
      if (cleaned) {
        out.push(cleaned);
      }
      continue;
    }

    if (decoToken.test(compact)) {
      if (isLabelLine(line)) {
        const cleaned = line.replace(decoToken, '').trim();
        if (cleaned) out.push(cleaned);
        continue;
      }
      const cleaned = line.replace(decoToken, '').trim();
      if (cleaned) out.push(cleaned);
      continue;
    }

    out.push(line);
  }

  return out.join('\n');
}

function rowPayloadCount(row: Cell[], startCol = 0): number {
  if (startCol >= row.length) return 0;
  let n = 0;
  for (let i = startCol; i < row.length; i += 1) {
    if (cellHasPayload(row[i])) n += 1;
  }
  return n;
}

function mergeVisualMultirow(
  rows: Cell[][],
  headerRows: number,
  hlineBefore: boolean[],
): void {
  if (rows.length <= headerRows + 1) return;
  const numRows = rows.length;

  for (let r = headerRows; r < numRows; r += 1) {
    const cell = rows[r][0];
    if (!cellHasPayload(cell) || (cell.rowspan ?? 1) > 1) continue;

    const bgColor = cell.style.bgColor;
    if (!bgColor && rowPayloadCount(rows[r], 1) < 2) continue;

    let top = r;
    while (top > headerRows) {
      if (hlineBefore[top]) break;
      if (hlineBefore[top - 1]) break;
      const above = rows[top - 1][0];
      if (cellHasPayload(above)) break;
      if (bgColor) {
        if ((above.style.bgColor ?? '') !== bgColor) break;
      } else {
        if (above.style.bgColor) break;
        if (rowPayloadCount(rows[top - 1], 1) < 2) break;
      }
      top -= 1;
    }

    let bottom = r;
    while (bottom < numRows - 1) {
      const below = rows[bottom + 1][0];
      if (cellHasPayload(below)) break;
      if (bgColor) {
        if ((below.style.bgColor ?? '') !== bgColor) break;
      } else {
        if (below.style.bgColor) break;
        if (rowPayloadCount(rows[bottom + 1], 1) < 2) break;
      }
      if (bottom + 1 < hlineBefore.length && hlineBefore[bottom + 1]) break;
      bottom += 1;
    }

    const span = bottom - top + 1;
    if (span <= 1) continue;
    rows[top][0] = { ...cell, rowspan: span };
    if (top !== r) {
      rows[r][0] = emptyCell();
    }
    for (let clearRow = top + 1; clearRow <= bottom; clearRow += 1) {
      rows[clearRow][0] = emptyCell();
    }
  }
}

function extractTabularAll(tex: string): string[] {
  const out: string[] = [];
  let i = 0;
  for (;;) {
    const begin = tex.indexOf(TABULAR_BEGIN, i);
    if (begin < 0) break;
    const hdr = readTabularHeader(tex, begin);
    if (!hdr) {
      i = begin + TABULAR_BEGIN.length;
      continue;
    }
    const endIdx = findMatchingTabularEnd(tex, hdr.bodyStart);
    if (endIdx == null) break;
    out.push(tex.slice(hdr.bodyStart, endIdx));
    i = endIdx + TABULAR_END.length;
  }
  if (out.length === 0) throw new Error('No tabular environment found');
  return out;
}

function countRemainingOccupied(activeRowspans: number[], from: number, to: number): number {
  let n = 0;
  for (let i = from; i < to; i += 1) {
    if ((activeRowspans[i] ?? 0) > 0) n += 1;
  }
  return n;
}

function emptyCell(): Cell {
  return { value: '', style: {}, rowspan: 1, colspan: 1, richSegments: null };
}

function cellHasPayload(cell: Cell): boolean {
  const v = cell.value;
  if (typeof v === 'string') {
    if (v.trim()) return true;
  } else if (v !== '' && v != null) {
    return true;
  }
  if (cell.richSegments && cell.richSegments.length > 0) return true;
  if (cell.style.diagbox && cell.style.diagbox.length > 0) return true;
  return false;
}

function splitByDoubleBackslashLikePython(input: string): string[] {
  // Mirrors pubtab-python `_split_by_double_backslash`:
  // split on `\\` outside `{...}`, tolerate malformed extra `}`, and collapse runs like `\\\\` into one.
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === '{') {
      depth += 1;
      cur += ch;
      continue;
    }
    if (ch === '}') {
      depth = Math.max(0, depth - 1);
      cur += ch;
      continue;
    }
    if (ch === '\\' && input[i + 1] === '\\' && depth === 0) {
      // Keep inline `\\&` as literal, but not row breaks to the next line.
      if (input[i + 2] === '&' && input[i - 1] !== '\\') {
        cur += '\\\\';
        continue;
      }

      let after = i + 2;
      while (after < input.length && /\s/u.test(input[after])) after += 1;

      parts.push(cur);
      cur = '';
      i += 1; // consume second slash
      // Collapse consecutive `\\` pairs to avoid producing artificial empty rows.
      while (i + 2 < input.length && input[i + 1] === '\\' && input[i + 2] === '\\') {
        i += 2;
      }
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

function stripRowRuleCommandsLikePython(chunk: string): { cleaned: string; hasHlineBefore: boolean; originalEmpty: boolean } {
  const original = chunk.trim();
  const originalEmpty = original.length === 0;
  const hasHlineBefore = /^\s*\\(?:hline|hdashline|thickhline|Xhline(?:\{[^}]*\}|[\d.]*)|addlinespace(?:\[[^\]]*\])?|toprule|midrule|bottomrule(?:\[[^\]]*\])?|specialrule\{[^}]*\}\{[^}]*\}\{[^}]*\}|cmidrule(?:\([^)]*\))?\{[^}]*\}|cline(?:\([^)]*\))?(?:\[[^\]]*\])?\{[^}]*\}|cdashline(?:\([^)]*\))?(?:\[[^\]]*\])?\{[^}]*\}|cdashlinelr\{[^}]*\})/u.test(original);
  let s = original;
  s = s.replace(/^\s*\\hline\s*/u, '');
  s = s.replace(/\\(hdashline|thickhline)\s*/gu, '');
  s = s.replace(/\\Xhline(?:\{[^}]*\}|[\d.]+\w*)\s*/gu, '');
  s = s.replace(/\\addlinespace(?:\[[^\]]*\])?\s*/gu, '');
  s = s.replace(/\\(toprule|bottomrule|midrule)(?:\[[^\]]*\])?\s*/gu, '');
  s = s.replace(/\\specialrule\{[^}]*\}\{[^}]*\}\{[^}]*\}\s*/gu, '');
  s = s.replace(/\\cmidrule(\([^)]*\))?\{[^}]*\}\s*/gu, '');
  s = s.replace(/\\cline(\([^)]*\))?(?:\[[^\]]*\])?\{[^}]*\}\s*/gu, '');
  s = s.replace(/\\cdashline(\([^)]*\))?(?:\[[^\]]*\])?\{[^}]*\}\s*/gu, '');
  s = s.replace(/\\cdashlinelr\{[^}]*\}\s*/gu, '');
  s = s.trim();
  return { cleaned: s, hasHlineBefore, originalEmpty };
}

function parseTabularBody(bodyRaw: string): TableData {
  const rawNoComments = stripLatexCommentsPreservingEscapes(bodyRaw);
  const body = normalizeDecorativeLines(
    replaceTabularEnvs(
      rawNoComments,
      // Convert nested tabular blocks (used as line breaks) into plain content.
      (inner) => inner.replace(/\\\\/g, '\n'),
    )
      .replace(/\\toprule(?:\[[^\]]+\])?|\\midrule|\\bottomrule(?:\[[^\]]+\])?/gu, '')
      .trim(),
  );

  // Row split that matches pubtab-python: keep explicit empty/rule-only rows as "" so
  // multirow headers can retain their required spacer line.
  const rawChunks = splitByDoubleBackslashLikePython(body);
  const rows: Array<Cell[] | { kind: 'spacer'; hasHlineBefore: boolean }> = [];
  const rowHlineFlags: boolean[] = [];
  let pendingBoundary = false;
  for (const chunk of rawChunks) {
    const { cleaned, hasHlineBefore, originalEmpty } = stripRowRuleCommandsLikePython(chunk);
    if (cleaned) {
      if (pendingBoundary && rows.length > 0 && rowHlineFlags.length > 0) {
        rowHlineFlags[rowHlineFlags.length - 1] = true;
      }
      // Strip leading rowcolor so the first cell parses correctly.
      const r = cleaned.replace(/^\s*\\rowcolor(?:\[[^\]]+\])?\{[^}]+\}\s*/u, '').trim();
      // Some docx exports escape every separator as `\&`; if there are no real '&' but many '\&',
      // treat them as separators (Python does this in `_parse_row`).
      const sepRow = !/(^|[^\\])&/u.test(r) && (r.match(/\\&/gu) ?? []).length >= 2 ? r.replace(/\\&/g, '&') : r;
      rows.push(splitUnescaped(sepRow, '&').map((c) => parseCell(c)));
      rowHlineFlags.push(pendingBoundary || hasHlineBefore);
      pendingBoundary = false;
      continue;
    }
    if (originalEmpty || hasHlineBefore) {
      rows.push({ kind: 'spacer', hasHlineBefore: pendingBoundary || hasHlineBefore });
      rowHlineFlags.push(pendingBoundary || hasHlineBefore);
    }
    if (hasHlineBefore) pendingBoundary = true;
  }
  // Expand multicolumn and insert placeholders for multirow so each row becomes a rectangular grid.
  const activeRowspans: number[] = [];
  const activeRowspanPayload: boolean[] = [];
  const expanded: Cell[][] = [];
  const expandedHlineBefore: boolean[] = [];
  let maxCols = 0;
  let lastDataRawWidth = 0;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const rawCells = rows[rowIndex];
    const hasHlineBefore = rowHlineFlags[rowIndex] ?? false;
    if (!Array.isArray(rawCells)) {
      // Keep spacer rows only when required by an active rowspan whose master had payload.
      const keep = activeRowspans.some((n, i) => (n ?? 0) > 0 && Boolean(activeRowspanPayload[i]));
      if (!keep) continue;
      const expectedCols = Math.max(maxCols, 1);
      const outRow: Cell[] = [];
      for (let colIdx = 0; colIdx < expectedCols; colIdx += 1) {
        outRow.push(emptyCell());
        if ((activeRowspans[colIdx] ?? 0) > 0) {
          activeRowspans[colIdx] = (activeRowspans[colIdx] ?? 0) - 1;
          if ((activeRowspans[colIdx] ?? 0) <= 0) activeRowspanPayload[colIdx] = false;
        }
      }
      expanded.push(outRow);
      expandedHlineBefore.push(hasHlineBefore);
      continue;
    }
    const rawWidth = rawCells.reduce((sum, c) => sum + Math.max(1, c.colspan || 1), 0);

    const expectedCols = Math.max(maxCols, rawWidth, 1);
    lastDataRawWidth = rawWidth;

    let remainingRawWidth = rawWidth;
    let rawIdx = 0;
    let colIdx = 0;
    const outRow: Cell[] = [];

    while (colIdx < expectedCols && rawIdx < rawCells.length) {
      const occupied = (activeRowspans[colIdx] ?? 0) > 0;
      if (occupied) {
        const remainingOccupied = countRemainingOccupied(activeRowspans, colIdx, expectedCols);
        const remainingFree = expectedCols - colIdx - remainingOccupied;

        // Forgiving alignment: if the source row still has too many cells to fit, discard a cell
        // into the occupied slot (common in messy/OCR tex) so the rest does not left-shift.
        if (remainingRawWidth > remainingFree) {
          remainingRawWidth -= Math.max(1, rawCells[rawIdx].colspan || 1);
          rawIdx += 1;
          continue;
        }

        outRow.push(emptyCell());
        activeRowspans[colIdx] = (activeRowspans[colIdx] ?? 0) - 1;
        if ((activeRowspans[colIdx] ?? 0) <= 0) activeRowspanPayload[colIdx] = false;
        colIdx += 1;
        continue;
      }

      const cell = rawCells[rawIdx];
      rawIdx += 1;
      const spanCols = Math.max(1, cell.colspan || 1);
      const spanRows = Math.max(0, (cell.rowspan || 1) - 1);
      remainingRawWidth -= spanCols;

      outRow.push(cell);
      if (spanRows > 0) {
        const payload = cellHasPayload(cell);
        for (let j = 0; j < spanCols; j += 1) {
          const idx = colIdx + j;
          activeRowspans[idx] = Math.max(activeRowspans[idx] ?? 0, spanRows);
          if (payload) activeRowspanPayload[idx] = true;
        }
      }
      for (let j = 1; j < spanCols; j += 1) {
        outRow.push(emptyCell());
      }
      colIdx += spanCols;
    }

    // Consume remaining occupied columns and pad to expectedCols.
    while (colIdx < expectedCols) {
      if ((activeRowspans[colIdx] ?? 0) > 0) {
        outRow.push(emptyCell());
        activeRowspans[colIdx] = (activeRowspans[colIdx] ?? 0) - 1;
        if ((activeRowspans[colIdx] ?? 0) <= 0) activeRowspanPayload[colIdx] = false;
      } else {
        outRow.push(emptyCell());
      }
      colIdx += 1;
    }

    // If the row still has cells, append them after expectedCols (table widens).
    while (rawIdx < rawCells.length) {
      while ((activeRowspans[colIdx] ?? 0) > 0) {
        outRow.push(emptyCell());
        activeRowspans[colIdx] = (activeRowspans[colIdx] ?? 0) - 1;
        if ((activeRowspans[colIdx] ?? 0) <= 0) activeRowspanPayload[colIdx] = false;
        colIdx += 1;
      }

      const cell = rawCells[rawIdx];
      rawIdx += 1;
      const spanCols = Math.max(1, cell.colspan || 1);
      const spanRows = Math.max(0, (cell.rowspan || 1) - 1);

      outRow.push(cell);
      if (spanRows > 0) {
        const payload = cellHasPayload(cell);
        for (let j = 0; j < spanCols; j += 1) {
          const idx = colIdx + j;
          activeRowspans[idx] = Math.max(activeRowspans[idx] ?? 0, spanRows);
          if (payload) activeRowspanPayload[idx] = true;
        }
      }
      for (let j = 1; j < spanCols; j += 1) {
        outRow.push(emptyCell());
      }
      colIdx += spanCols;
    }

    maxCols = Math.max(maxCols, outRow.length);
    expanded.push(outRow);
    expandedHlineBefore.push(hasHlineBefore);
  }

  const numCols = Math.max(maxCols, 1);
  for (const r of expanded) {
    while (r.length < numCols) r.push(emptyCell());
  }

  mergeVisualMultirow(expanded, 1, expandedHlineBefore);
  return {
    cells: expanded,
    numRows: expanded.length,
    numCols,
    headerRows: Math.min(1, expanded.length),
    groupSeparators: {},
  };
}

export function readTexAll(tex: string): TableData[] {
  return extractTabularAll(tex).map((body) => parseTabularBody(body));
}

export function readTex(tex: string): TableData {
  return readTexAll(tex)[0];
}
