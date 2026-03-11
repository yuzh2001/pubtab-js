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
  return { value: '', style: {}, rowspan: 1, colspan: 1 };
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
