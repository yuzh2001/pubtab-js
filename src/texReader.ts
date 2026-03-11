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
  // This is intentionally conservative and only targets nested tabular blocks.
  return text.replace(
    /\\begin\{tabular\}(?:\[[^\]]*\])?\{[^}]*\}([\s\S]*?)\\end\{tabular\}/gu,
    (_m, body: string) => body.replace(/\\\\/g, '\n'),
  );
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

  const multiCol = value.match(/^\\multicolumn\{(\d+)\}\{[^}]*\}\{([\s\S]*)\}$/u);
  if (multiCol) {
    colspan = Number(multiCol[1]);
    value = multiCol[2];
  }

  const multiRow = value.match(/^\\multirow\{(\d+)\}\{\*\}\{([\s\S]*)\}$/u);
  if (multiRow) {
    rowspan = Number(multiRow[1]);
    value = multiRow[2];
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

  value = stripLatexWrappers(value).trim();

  const numeric = Number(value);
  const finalValue = Number.isFinite(numeric) && value !== '' ? numeric : value;

  return { value: finalValue, style, rowspan, colspan, richSegments };
}

function extractTabularAll(tex: string): string[] {
  const re = /\\begin\{tabular\}\{[^}]*\}([\s\S]*?)\\end\{tabular\}/gu;
  const out: string[] = [];
  for (;;) {
    const m = re.exec(tex);
    if (!m) break;
    out.push(m[1]);
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

function parseTabularBody(bodyRaw: string): TableData {
  const body = bodyRaw
    .replace(/%.*$/gmu, '')
    .replace(/\\toprule|\\midrule|\\bottomrule|\\hline/g, '')
    .trim();

  const rawRows = splitUnescaped(body, '\\\\')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);

  const rows: Cell[][] = rawRows
    .map((row) => {
      // pubtab often inserts rule/color commands as standalone lines between rows;
      // after splitting by `\\`, they can become prefixes of the next segment.
      let r = row
        .replace(/^\s*\\cline\{[^}]+\}\s*/u, '')
        .replace(/^\s*\\cmidrule\{[^}]+\}\s*/u, '');
      // Strip leading rowcolor so the first cell parses correctly.
      r = r.replace(/^\s*\\rowcolor(?:\[[^\]]+\])?\{[^}]+\}\s*/u, '');
      return r.trim();
    })
    .filter((row) => row.length > 0)
    .map((row) => splitUnescaped(row, '&').map((c) => parseCell(c)));

  // Expand multicolumn and insert placeholders for multirow so each row becomes a rectangular grid.
  const activeRowspans: number[] = [];
  const expanded: Cell[][] = [];
  let maxCols = 0;

  for (const rawCells of rows) {
    const rawWidth = rawCells.reduce((sum, c) => sum + Math.max(1, c.colspan || 1), 0);
    const expectedCols = Math.max(maxCols, rawWidth, 1);

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
        for (let j = 0; j < spanCols; j += 1) {
          const idx = colIdx + j;
          activeRowspans[idx] = Math.max(activeRowspans[idx] ?? 0, spanRows);
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
        colIdx += 1;
      }

      const cell = rawCells[rawIdx];
      rawIdx += 1;
      const spanCols = Math.max(1, cell.colspan || 1);
      const spanRows = Math.max(0, (cell.rowspan || 1) - 1);

      outRow.push(cell);
      if (spanRows > 0) {
        for (let j = 0; j < spanCols; j += 1) {
          const idx = colIdx + j;
          activeRowspans[idx] = Math.max(activeRowspans[idx] ?? 0, spanRows);
        }
      }
      for (let j = 1; j < spanCols; j += 1) {
        outRow.push(emptyCell());
      }
      colIdx += spanCols;
    }

    maxCols = Math.max(maxCols, outRow.length);
    expanded.push(outRow);
  }

  const numCols = Math.max(maxCols, 1);
  for (const r of expanded) {
    while (r.length < numCols) r.push(emptyCell());
  }

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
