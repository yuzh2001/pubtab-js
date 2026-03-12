import type { Cell, RenderOptions, RichSegment, SpacingConfig, TableData } from './models.js';
import { formatNumber, hexToLatexColor, latexEscape } from './utils.js';
import { getTheme } from './themes.js';

const SUBSCRIPT_CHAR_MAP: Record<string, string> = {
  'α': '\\alpha',
  'β': '\\beta',
  'γ': '\\gamma',
  'δ': '\\delta',
  'ε': '\\epsilon',
  'θ': '\\theta',
  'λ': '\\lambda',
  'μ': '\\mu',
  'π': '\\pi',
  'σ': '\\sigma',
  'φ': '\\phi',
  'ω': '\\omega',
  'Γ': '\\Gamma',
  'Δ': '\\Delta',
  'Θ': '\\Theta',
  'Ω': '\\Omega',
};

function normalizeUnicodeSubscript(text: string): string {
  return text.replace(/\\_([^\s\\{])/gu, (_m, ch) => {
    const escaped = SUBSCRIPT_CHAR_MAP[ch] ?? ch;
    return `$_{${escaped}}$`;
  });
}

function cellToLatex(cell: Cell): string {
  const style = cell.style ?? {};
  let text: string;
  if (style.rawLatex) {
    text = String(cell.value ?? '');
  } else if (style.fmt && typeof cell.value === 'number') {
    text = formatNumber(cell.value, style.fmt, style.stripLeadingZero !== false);
  } else {
    text = latexEscape(cell.value ?? '');
    text = normalizeUnicodeSubscript(text);
  }

  if (!style.rawLatex && cell.richSegments && cell.richSegments.length > 1) {
    const parts: string[] = [];
    for (const seg of cell.richSegments as RichSegment[]) {
      const [segText, segColor, segBold, segItalic, segUnderline] = seg;
      let s = latexEscape(segText);
      if (segBold) s = `\\textbf{${s}}`;
      if (segItalic) s = `\\textit{${s}}`;
      if (segUnderline) s = `\\underline{${s}}`;
      if (segColor) s = `\\textcolor[RGB]{${hexToLatexColor(segColor)}}{${s}}`;
      parts.push(s);
    }
    text = parts.join('');
  }

  if (!style.rawLatex && text.includes('\n')) {
    text = `\\makecell{${text.replace(/\n/g, '\\\\')}}`;
  }

  if (!style.rawLatex && style.diagbox && style.diagbox.length >= 2) {
    text = `\\diagbox{${latexEscape(style.diagbox[0])}}{${latexEscape(style.diagbox[1])}}`;
  }

  if (!style.rawLatex && !(cell.richSegments && cell.richSegments.length > 1)) {
    if (style.bold) text = `\\textbf{${text}}`;
    if (style.italic) text = `\\textit{${text}}`;
    if (style.underline) text = `\\underline{${text}}`;
    if (style.color) text = `\\textcolor[RGB]{${hexToLatexColor(style.color)}}{${text}}`;
    if (style.bgColor && cell.colspan <= 1) {
      text = `\\cellcolor[RGB]{${hexToLatexColor(style.bgColor)}}{${text}}`;
    }
  }

  if (!style.rawLatex && style.rotation) {
    if (cell.rowspan > 1) {
      // Match pubtab-python: omit origin=c for multirow to avoid bottomrule overflow.
      text = `\\rotatebox{${style.rotation}}{${text}}`;
    } else {
      text = `\\rotatebox[origin=c]{${style.rotation}}{${text}}`;
    }
  }

  if (cell.rowspan > 1) {
    text = `\\multirow{${cell.rowspan}}{*}{${text}}`;
  }

  if (cell.colspan > 1) {
    const align = style.alignment?.[0] ?? 'c';
    if (style.bgColor) {
      text = `\\multicolumn{${cell.colspan}}{>{\\columncolor[RGB]{${hexToLatexColor(style.bgColor)}}}${align}}{${text}}`;
    } else {
      text = `\\multicolumn{${cell.colspan}}{${align}}{${text}}`;
    }
  }

  return text;
}

function buildPackageHints(table: TableData, opts: RenderOptions): string {
  const theme = getTheme(opts.theme);
  const base = [...theme.packages];
  const needGraphicx = Boolean(opts.resizebox) || table.cells.some((r) => r.some((c) => (c.style.rotation ?? 0) !== 0));
  if (needGraphicx) base.push('graphicx');
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const pkg of base) {
    if (!seen.has(pkg)) {
      seen.add(pkg);
      unique.push(pkg);
    }
  }
  const packages = unique;

  const lines = ['% Theme package hints for this table (add in your preamble):'];
  for (const pkg of packages) {
    if (pkg === 'xcolor') {
      lines.push('% \\usepackage[table]{xcolor}');
    } else {
      lines.push(`% \\usepackage{${pkg}}`);
    }
  }
  let result = lines.join('\n');
  if (opts.uprightScripts) {
    result = result.replace(/([_^])\{([^}\\]+)\}/gu, '$1{\\mathrm{$2}}');
  }
  result += '\n';
  return result;
}

function cellHasPayload(cell: Cell): boolean {
  return (cell.value !== '' && cell.value !== null && cell.value !== undefined)
    || (cell.richSegments?.length ?? 0) > 0
    || (cell.style.diagbox?.length ?? 0) > 0;
}

function rowIsSection(row: Cell[], numCols: number): boolean {
  if (!row.length) return false;
  const first = row[0];
  if (first.colspan >= numCols) return true;
  if (first.colspan >= numCols - 1 && row.slice(1).every((cell) => !cellHasPayload(cell))) {
    return true;
  }

  const payloadIdx = row.reduce<number[]>((acc, cell, idx) => {
    if (cellHasPayload(cell)) acc.push(idx);
    return acc;
  }, []);

  if (payloadIdx.length === 1) {
    const idx = payloadIdx[0];
    const sec = row[idx];
    return sec.colspan > 1 && idx + sec.colspan >= (numCols - 1);
  }

  if (payloadIdx.length === 2) {
    const [a, b] = payloadIdx;
    for (const [labelIdx, secIdx] of [[a, b], [b, a]] as Array<[number, number]>) {
      const label = row[labelIdx];
      const sec = row[secIdx];
      if (label.rowspan > 1 && sec.colspan > 1 && (secIdx + sec.colspan) >= (numCols - 1)) {
        return true;
      }
    }
  }

  return false;
}

function hasActiveFirstColMultirow(bodyCells: Cell[][], bodyRowIdx: number): boolean {
  for (let r = 0; r < bodyRowIdx; r += 1) {
    const row = bodyCells[r];
    if (!row[0]) continue;
    const cell = row[0];
    if (cell.rowspan > 1 && (r + cell.rowspan) > bodyRowIdx) return true;
  }

  if (bodyRowIdx < bodyCells.length && bodyCells[bodyRowIdx][0]?.rowspan > 1) return true;
  return false;
}

function sectionSeparator(bodyCells: Cell[][], bodyRowIdx: number, numCols: number): string {
  if (numCols > 1 && hasActiveFirstColMultirow(bodyCells, bodyRowIdx)) {
    return `\\cmidrule(lr){2-${numCols}}`;
  }
  return '\\midrule';
}

function normalizeGroupSeparators(
  gs: TableData['groupSeparators'],
): Record<number, string | string[]> {
  if (Array.isArray(gs)) {
    const out: Record<number, string> = {};
    for (const idx of gs) out[idx] = '\\midrule';
    return out;
  }
  return gs || {};
}

function buildColSpec(table: TableData): string {
  const specs: string[] = [];
  for (let c = 0; c < table.numCols; c += 1) {
    if (table.cells.length > 0 && c < table.cells[0].length) {
      const alignment = table.cells[0][c]?.style.alignment?.[0] ?? 'c';
      specs.push(alignment);
    } else {
      specs.push('c');
    }
  }
  return specs.join('');
}

function rowUniformBg(cells: Cell[]): string | null {
  let skip = 0;
  let color: string | null = null;
  for (const cell of cells) {
    if (skip > 0) {
      skip -= 1;
      continue;
    }
    if (cell.colspan > 1) skip = cell.colspan - 1;
    if (!cell.style.bgColor) return null;
    if (color == null) {
      color = cell.style.bgColor;
    } else if (color !== cell.style.bgColor) {
      return null;
    }
  }
  return color;
}

function autoHeaderRule(tableCells: Cell[][], rowIdx: number, numCols: number): string | null {
  const skipCols = new Set<number>();
  for (let r = 0; r <= rowIdx; r += 1) {
    let col = 1;
    for (const cell of tableCells[r] ?? []) {
      if (cell.rowspan > 1 && (r + cell.rowspan) > (rowIdx + 1)) {
        const span = Math.max(cell.colspan, 1);
        for (let c = col; c < col + span; c += 1) skipCols.add(c);
      }
      col += Math.max(cell.colspan, 1);
    }
  }

  if (skipCols.size >= numCols) return null;

  const rules: string[] = [];
  let start: number | null = null;
  for (let c = 1; c <= numCols; c += 1) {
    if (!skipCols.has(c)) {
      if (start == null) start = c;
      continue;
    }
    if (start != null) {
      rules.push(`\\cline{${start}-${c - 1}}`);
      start = null;
    }
  }
  if (start != null) rules.push(`\\cline{${start}-${numCols}}`);
  return rules.length > 0 ? rules.join(' ') : null;
}

type VmergeState = {
  bg: Map<string, string>;
  neg: Map<string, { rowspan: number; styled: string }>;
  suppress: Set<string>;
};

function buildVmergeState(table: TableData): VmergeState {
  const bg = new Map<string, string>();
  const neg = new Map<string, { rowspan: number; styled: string }>();
  const suppress = new Set<string>();

  for (let ri = 0; ri < table.cells.length; ri += 1) {
    const row = table.cells[ri];
    for (let ci = 0; ci < row.length; ci += 1) {
      const cell = row[ci];
      if (cell.rowspan <= 1 || !cell.style.bgColor) continue;

      suppress.add(`${ri},${ci}`);
      for (let dr = 1; dr < cell.rowspan; dr += 1) {
        bg.set(`${ri + dr},${ci}`, cell.style.bgColor);
      }
      neg.set(`${ri + cell.rowspan - 1},${ci}`, {
        rowspan: cell.rowspan,
        styled: cellToLatex({
          ...cell,
          rowspan: 1,
          style: { ...cell.style, bgColor: undefined },
        }),
      });
    }
  }

  return { bg, neg, suppress };
}

function renderCells(
  row: Cell[],
  hasPCols: boolean = false,
  context?: { rowIndex: number; vmerge: VmergeState },
): string {
  const rendered: string[] = [];
  let skip = 0;
  let ci = 0;
  const rowBg = rowUniformBg(row);

  for (const cell of row) {
    if (skip > 0) {
      skip -= 1;
      ci += 1;
      continue;
    }
    if (cell.colspan > 1) skip = cell.colspan - 1;

    let text: string;
    if (context && context.vmerge.suppress.has(`${context.rowIndex},${ci}`)) {
      text = `\\cellcolor[RGB]{${hexToLatexColor(cell.style.bgColor ?? '')}}`;
    } else if (context) {
      const negative = context.vmerge.neg.get(`${context.rowIndex},${ci}`);
      const bg = context.vmerge.bg.get(`${context.rowIndex},${ci}`);
      if (negative) {
        text = `\\cellcolor[RGB]{${hexToLatexColor(bg ?? '')}}\\multirow{-${negative.rowspan}}{*}{${negative.styled}}`;
      } else if ((cell.value === '' || cell.value == null) && bg) {
        text = `\\cellcolor[RGB]{${hexToLatexColor(bg ?? '')}}`;
      } else {
        text = cellToLatex(cell);
      }
    } else {
      text = cellToLatex(cell);
    }

    if (hasPCols && cell.colspan === 1 && text && !text.startsWith('\\multicolumn')) {
      text = `\\multicolumn{1}{c}{${text}}`;
    }
    rendered.push(text);
    ci += 1;
  }

  if (rowBg && rendered.length > 0) {
    rendered[0] = `\\rowcolor[RGB]{${hexToLatexColor(rowBg)}}${rendered[0]}`;
  }
  return `${rendered.join(' & ')} \\\\`;
}

function mergeSpacing(themeSpacing: SpacingConfig, userSpacing: SpacingConfig | undefined): Required<SpacingConfig> {
  return {
    tabcolsep: userSpacing?.tabcolsep ?? themeSpacing.tabcolsep ?? null,
    arraystretch: userSpacing?.arraystretch ?? themeSpacing.arraystretch ?? null,
    heavyrulewidth: userSpacing?.heavyrulewidth ?? themeSpacing.heavyrulewidth ?? '1.0pt',
    lightrulewidth: userSpacing?.lightrulewidth ?? themeSpacing.lightrulewidth ?? '0.5pt',
    arrayrulewidth: userSpacing?.arrayrulewidth ?? themeSpacing.arrayrulewidth ?? '0.5pt',
    aboverulesep: userSpacing?.aboverulesep ?? themeSpacing.aboverulesep ?? '0pt',
    belowrulesep: userSpacing?.belowrulesep ?? themeSpacing.belowrulesep ?? '0pt',
  };
}

function pushSpacing(lines: string[], spacing: Required<SpacingConfig>): void {
  if (spacing.tabcolsep) lines.push(`\\setlength{\\tabcolsep}{${spacing.tabcolsep}}`);
  if (spacing.arraystretch) lines.push(`\\renewcommand{\\arraystretch}{${spacing.arraystretch}}`);
  if (spacing.heavyrulewidth) lines.push(`\\setlength{\\heavyrulewidth}{${spacing.heavyrulewidth}}`);
  if (spacing.lightrulewidth) lines.push(`\\setlength{\\lightrulewidth}{${spacing.lightrulewidth}}`);
  if (spacing.arrayrulewidth) lines.push(`\\setlength{\\arrayrulewidth}{${spacing.arrayrulewidth}}`);
  if (spacing.aboverulesep) lines.push(`\\setlength{\\aboverulesep}{${spacing.aboverulesep}}`);
  if (spacing.belowrulesep) lines.push(`\\setlength{\\belowrulesep}{${spacing.belowrulesep}}`);
}

export function render(table: TableData, opts: RenderOptions = {}): string {
  const theme = getTheme(opts.theme);
  const spacing = mergeSpacing(theme.spacing, opts.spacing);
  const colSpec = opts.colSpec ?? buildColSpec(table);
  const hasPCols = colSpec.includes('p{');
  const vmerge = buildVmergeState(table);
  const lines: string[] = [];
  lines.push(buildPackageHints(table, opts));

  const env = opts.spanColumns ? 'table*' : 'table';
  pushSpacing(lines, spacing);
  lines.push(`\\begin{${env}}[${opts.position ?? 'htbp'}]`);
  lines.push('\\centering');
  const captionPosition = theme.captionPosition ?? 'top';
  if (opts.caption && captionPosition === 'top') {
    lines.push(`\\caption{${latexEscape(opts.caption)}}`);
  }
  if (opts.label) lines.push(`\\label{${latexEscape(opts.label)}}`);
  if (opts.resizebox) {
    lines.push(`\\resizebox{${opts.resizebox}}{!}{`);
  }
  const fontSize = opts.fontSize ?? theme.fontSize;
  if (fontSize) {
    lines.push(`\\${fontSize}`);
  }
  lines.push(`\\begin{tabular}{${colSpec}}`);
  lines.push('\\toprule');

  const bodyCells = table.cells.slice(table.headerRows);
  const groupSeparators = normalizeGroupSeparators(table.groupSeparators);
  const bodyRowsWithSep: string[] = [];
  const rawHeaderRows = table.cells.slice(0, table.headerRows).map((row, rowIndex) => renderCells(row, hasPCols, { rowIndex, vmerge }));
  let headerRowsWithSep = rawHeaderRows;
  let finalHeaderSep: string | undefined = typeof opts.headerSep === 'string' ? opts.headerSep : undefined;

  if (Array.isArray(opts.headerSep) && opts.headerSep.length >= rawHeaderRows.length) {
    headerRowsWithSep = [];
    for (let i = 0; i < rawHeaderRows.length; i += 1) {
      headerRowsWithSep.push(rawHeaderRows[i]);
      if (i < rawHeaderRows.length - 1) {
        headerRowsWithSep.push(opts.headerSep[i]);
      }
    }
    finalHeaderSep = opts.headerSep[opts.headerSep.length - 1];
  } else if (opts.headerSep == null && table.headerRows > 1 && opts.headerCmidrule !== false) {
    headerRowsWithSep = [];
    for (let i = 0; i < rawHeaderRows.length; i += 1) {
      headerRowsWithSep.push(rawHeaderRows[i]);
      if (i < rawHeaderRows.length - 1) {
        const rule = autoHeaderRule(table.cells, i, table.numCols);
        if (rule) headerRowsWithSep.push(rule);
      }
    }
  } else if (Array.isArray(opts.headerSep)) {
    finalHeaderSep = opts.headerSep.length > 0 ? opts.headerSep[opts.headerSep.length - 1] : undefined;
  }

  for (let i = 0; i < bodyCells.length; i += 1) {
    const row = bodyCells[i];
    const isSection = rowIsSection(row, table.numCols);
    const sep = isSection ? sectionSeparator(bodyCells, i, table.numCols) : '\\midrule';

    if (isSection && i > 0 && (bodyRowsWithSep.length === 0 || bodyRowsWithSep[bodyRowsWithSep.length - 1] !== sep)) {
      bodyRowsWithSep.push(sep);
    }

    bodyRowsWithSep.push(renderCells(row, hasPCols, { rowIndex: table.headerRows + i, vmerge }));

    const absoluteIdx = table.headerRows + i;
    const hasCustomSeparator = Object.prototype.hasOwnProperty.call(groupSeparators, absoluteIdx);
    if (isSection && !hasCustomSeparator) {
      bodyRowsWithSep.push(sep);
    }

    if (hasCustomSeparator) {
      const custom = groupSeparators[absoluteIdx];
      if (isSection && custom === '\\midrule') {
        bodyRowsWithSep.push(sep);
      } else if (Array.isArray(custom)) {
        bodyRowsWithSep.push(...custom);
      } else {
        bodyRowsWithSep.push(custom);
      }
    }
  }

  if (table.headerRows > 0) {
    lines.push(...headerRowsWithSep);
    lines.push(finalHeaderSep ?? '\\midrule');
  }
  lines.push(...bodyRowsWithSep);

  lines.push('\\bottomrule');
  lines.push('\\end{tabular}');
  if (opts.resizebox) {
    lines.push('}');
  }
  if (opts.caption && captionPosition === 'bottom') {
    lines.push(`\\caption{${latexEscape(opts.caption)}}`);
  }
  lines.push(`\\end{${env}}`);
  lines.push('');
  let result = lines.join('\n');
  if (opts.uprightScripts) {
    result = result.replace(/([_^])\{([^}\\]+)\}/gu, (_m, op, content) => `${op}{\\mathrm{${content}}}`);
  }
  return result;
}
