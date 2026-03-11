import type { Cell, RenderOptions, TableData } from './models.js';
import { hexToLatexColor, latexEscape } from './utils.js';

function cellToLatex(cell: Cell): string {
  const style = cell.style ?? {};
  let text = style.rawLatex ? String(cell.value ?? '') : latexEscape(cell.value ?? '');

  if (!style.rawLatex) {
    if (style.bold) text = `\\textbf{${text}}`;
    if (style.italic) text = `\\textit{${text}}`;
    if (style.underline) text = `\\underline{${text}}`;
    if (style.color) text = `\\textcolor[RGB]{${hexToLatexColor(style.color)}}{${text}}`;
    if (style.bgColor && cell.colspan <= 1) {
      text = `\\cellcolor[RGB]{${hexToLatexColor(style.bgColor)}}{${text}}`;
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
  const base = ['booktabs', 'multirow', 'xcolor'];
  const needGraphicx = Boolean(opts.resizebox) || table.cells.some((r) => r.some((c) => (c.style.rotation ?? 0) !== 0));
  if (needGraphicx) base.push('graphicx');

  const lines = ['% Theme package hints for this table (add in your preamble):'];
  for (const pkg of base) {
    if (pkg === 'xcolor') {
      lines.push('% \\usepackage[table]{xcolor}');
    } else {
      lines.push(`% \\usepackage{${pkg}}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

export function render(table: TableData, opts: RenderOptions = {}): string {
  const colSpec = opts.colSpec ?? 'c'.repeat(Math.max(1, table.numCols));
  const lines: string[] = [];
  lines.push(buildPackageHints(table, opts));

  const env = opts.spanColumns ? 'table*' : 'table';
  lines.push(`\\begin{${env}}[${opts.position ?? 'htbp'}]`);
  lines.push('\\centering');
  if (opts.caption) lines.push(`\\caption{${latexEscape(opts.caption)}}`);
  if (opts.label) lines.push(`\\label{${latexEscape(opts.label)}}`);
  lines.push(`\\begin{tabular}{${colSpec}}`);
  lines.push('\\toprule');

  for (let r = 0; r < table.cells.length; r += 1) {
    const row = table.cells[r];
    const rowLatex = row.map((c) => cellToLatex(c)).join(' & ');
    lines.push(`${rowLatex} \\\\`);
    if (r === table.headerRows - 1) lines.push('\\midrule');
  }

  lines.push('\\bottomrule');
  lines.push('\\end{tabular}');
  if (opts.resizebox) {
    lines.push(`% resizebox hint: \\resizebox{${opts.resizebox}}{!}{...}`);
  }
  lines.push(`\\end{${env}}`);
  lines.push('');
  return lines.join('\n');
}
