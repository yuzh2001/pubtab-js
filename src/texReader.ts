import type { Cell, CellStyle, TableData } from './models.js';
import { splitUnescaped, stripLatexWrappers } from './utils.js';

function parseCell(raw: string): Cell {
  const s = raw.trim();

  let colspan = 1;
  let rowspan = 1;
  let style: CellStyle = {};
  let value = s;

  const multiCol = s.match(/^\\multicolumn\{(\d+)\}\{[^}]*\}\{([\s\S]*)\}$/u);
  if (multiCol) {
    colspan = Number(multiCol[1]);
    value = multiCol[2];
  }

  const multiRow = value.match(/^\\multirow\{(\d+)\}\{\*\}\{([\s\S]*)\}$/u);
  if (multiRow) {
    rowspan = Number(multiRow[1]);
    value = multiRow[2];
  }

  if (/^\\textbf\{[\s\S]*\}$/u.test(value)) style.bold = true;
  if (/^\\textit\{[\s\S]*\}$/u.test(value)) style.italic = true;
  if (/^\\underline\{[\s\S]*\}$/u.test(value)) style.underline = true;

  const colorMatch = value.match(/^\\textcolor(?:\[[^\]]+\])?\{([^}]+)\}\{([\s\S]*)\}$/u);
  if (colorMatch) {
    style.color = colorMatch[1];
    value = colorMatch[2];
  }

  value = stripLatexWrappers(value).trim();

  const numeric = Number(value);
  const finalValue = Number.isFinite(numeric) && value !== '' ? numeric : value;

  return { value: finalValue, style, rowspan, colspan };
}

function extractTabular(tex: string): string {
  const m = tex.match(/\\begin\{tabular\}\{[^}]*\}([\s\S]*?)\\end\{tabular\}/u);
  if (!m) {
    throw new Error('No tabular environment found');
  }
  return m[1];
}

export function readTex(tex: string): TableData {
  const body = extractTabular(tex)
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
    .filter((row) => row.includes('&')) // skip pure rule lines
    .map((row) => splitUnescaped(row, '&').map((c) => parseCell(c)));
  const numCols = Math.max(...rows.map((r) => r.reduce((sum, c) => sum + (c.colspan || 1), 0)), 1);

  const expanded = rows.map((row) => {
    const out: Cell[] = [];
    for (const c of row) {
      out.push(c);
      for (let i = 1; i < c.colspan; i += 1) {
        out.push({ value: '', style: {}, rowspan: 1, colspan: 1 });
      }
    }
    while (out.length < numCols) {
      out.push({ value: '', style: {}, rowspan: 1, colspan: 1 });
    }
    return out;
  });

  return {
    cells: expanded,
    numRows: expanded.length,
    numCols,
    headerRows: Math.min(1, expanded.length),
    groupSeparators: {},
  };
}
