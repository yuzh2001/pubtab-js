import ExcelJS from 'exceljs';

import type { Cell, RichSegment, TableData, Xlsx2TexOptions } from '../models.js';

function colLettersToNumber(s: string): number {
  let n = 0;
  const up = s.toUpperCase();
  for (let i = 0; i < up.length; i += 1) {
    const code = up.charCodeAt(i);
    if (code < 65 || code > 90) return 0;
    n = n * 26 + (code - 64);
  }
  return n;
}

function isEmptyValue(v: unknown): boolean {
  return v == null || v === '';
}

function isCellPayload(cell: Cell | undefined): boolean {
  if (!cell) return false;
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

type MergeInfo = { mr: number; mc: number; rowspan: number; colspan: number };

export interface ReadExcelOptions {
  sheet?: string | number;
  headerRows?: number | 'auto';
}

function parseA1(addr: string): { row: number; col: number } | null {
  const m = addr.match(/^([A-Za-z]+)(\d+)$/u);
  if (!m) return null;
  const col = colLettersToNumber(m[1]);
  const row = Number(m[2]);
  if (!Number.isFinite(row) || row <= 0 || col <= 0) return null;
  return { row, col };
}

function buildMergeMap(ws: ExcelJS.Worksheet): Map<string, MergeInfo> {
  const merges = (ws.model as { merges?: string[] } | undefined)?.merges ?? [];
  const map = new Map<string, MergeInfo>();
  for (const raw of merges) {
    const m = raw.match(/^([A-Za-z]+\d+):([A-Za-z]+\d+)$/u);
    if (!m) continue;
    const a = parseA1(m[1]);
    const b = parseA1(m[2]);
    if (!a || !b) continue;
    const r1 = Math.min(a.row, b.row);
    const r2 = Math.max(a.row, b.row);
    const c1 = Math.min(a.col, b.col);
    const c2 = Math.max(a.col, b.col);
    const rowspan = r2 - r1 + 1;
    const colspan = c2 - c1 + 1;
    for (let r = r1; r <= r2; r += 1) {
      for (let c = c1; c <= c2; c += 1) {
        map.set(`${r},${c}`, { mr: r1, mc: c1, rowspan, colspan });
      }
    }
  }
  return map;
}

function excelArgbToHex(argb: string | undefined | null): string | null {
  if (!argb || typeof argb !== 'string') return null;
  const a = argb.trim();
  if (!/^[0-9a-fA-F]{8}$/.test(a)) return null;
  if (a === '00000000') return null;
  return `#${a.slice(-6).toUpperCase()}`;
}

function extractRichSegmentsFromExcelJS(value: unknown): RichSegment[] | null {
  const v = value as { richText?: Array<{ text?: string; font?: any }> } | null | undefined;
  if (!v || typeof v !== 'object' || !Array.isArray(v.richText)) return null;
  const segs: RichSegment[] = [];
  let hasFormatting = false;
  for (const b of v.richText) {
    const text = String(b?.text ?? '');
    const font = b?.font ?? {};
    const color = excelArgbToHex(font?.color?.argb ?? font?.color?.value);
    const bold = Boolean(font?.bold);
    const italic = Boolean(font?.italic);
    const underline = Boolean(font?.underline);
    if (color || bold || italic || underline) hasFormatting = true;
    segs.push([text, color, bold, italic, underline]);
  }
  if (!hasFormatting || segs.length < 2) return null;
  return segs;
}

function excelFmtToPython(fmt: string | undefined | null): string | undefined {
  if (!fmt || fmt === 'General') return undefined;
  let m = fmt.match(/^[#0]*\.([0]+)$/u);
  if (m) return `.${m[1].length}f`;
  m = fmt.match(/^[#0]*\.?([0]*)%$/u);
  if (m) return m[1].length ? `.${m[1].length}%` : '.0%';
  return undefined;
}

function extractStyleFromExcelJS(cell: any): Cell['style'] {
  const style: Cell['style'] = {};
  const font = cell?.font ?? {};
  const align = cell?.alignment ?? {};
  const fill = cell?.fill ?? {};

  if (font.bold) style.bold = true;
  if (font.italic) style.italic = true;
  if (font.underline) style.underline = true;

  const color = excelArgbToHex(font?.color?.argb ?? font?.color?.value);
  if (color) style.color = color;

  if (fill && (fill.type === 'pattern' || fill.fillType === 'pattern')) {
    const fg = excelArgbToHex(fill?.fgColor?.argb ?? fill?.fgColor?.value);
    if (fg) style.bgColor = fg;
  }

  if (typeof align?.horizontal === 'string' && align.horizontal) style.alignment = align.horizontal;
  if (typeof align?.textRotation === 'number' && Number.isFinite(align.textRotation) && align.textRotation) style.rotation = align.textRotation;

  const fmt = excelFmtToPython(cell?.numFmt);
  if (fmt) style.fmt = fmt;

  return style;
}

function isNumericDiagbox(parts: string[]): boolean {
  return parts.every((p) => {
    const s = p.trim();
    if (!s) return true;
    if (s === '--') return true;
    return /^-?\d+(\.\d+)?$/u.test(s);
  });
}

function cellValueFromExcelJS(rawValue: unknown, richSegments: RichSegment[] | null): unknown {
  if (richSegments) return richSegments.map((s) => s[0]).join('');
  if (rawValue == null) return '';
  return rawValue;
}

function trimTrailingEmptyColsLikePython(cells: Cell[][], numCols: number): number {
  if (numCols <= 1 || cells.length === 0) return numCols;

  const colHasPayload = (colIdx: number): boolean => {
    for (const row of cells) {
      if (colIdx < 0 || colIdx >= row.length) continue;
      if (isCellPayload(row[colIdx])) return true;
    }
    return false;
  };

  const shrinkMasterSpanCrossing = (row: Cell[], colIdx: number): void => {
    for (let i = 0; i < row.length; i += 1) {
      const cell = row[i];
      if ((cell.colspan ?? 1) <= 1) continue;
      if (i <= colIdx && colIdx <= i + cell.colspan - 1) {
        row[i] = { ...cell, colspan: Math.max(1, cell.colspan - 1) };
        break;
      }
    }
  };

  while (numCols > 1) {
    const last = numCols - 1;
    if (colHasPayload(last)) break;
    for (const row of cells) {
      shrinkMasterSpanCrossing(row, last);
      if (last >= 0 && last < row.length) row.splice(last, 1);
    }
    numCols -= 1;
  }
  return numCols;
}

export function tableFromWorksheet(ws: ExcelJS.Worksheet, opts: Xlsx2TexOptions): TableData {
  const rowCount = Math.max(ws.rowCount || 0, ws.actualRowCount || 0);
  const colCount = Math.max(ws.columnCount || 0, ws.actualColumnCount || 0);

  const mergeMap = buildMergeMap(ws);
  const rows: Cell[][] = [];
  for (let r = 1; r <= rowCount; r += 1) {
    const row: Cell[] = [];
    for (let c = 1; c <= colCount; c += 1) {
      const cell = ws.getCell(r, c) as any;
      const mi = mergeMap.get(`${r},${c}`);
      const isMerged = Boolean(mi);
      const isMaster = !isMerged || (mi!.mr === r && mi!.mc === c);

      if (isMerged && !isMaster) {
        row.push({ value: '', style: {}, rowspan: 1, colspan: 1, richSegments: null });
        continue;
      }

      const richSegments = extractRichSegmentsFromExcelJS(cell.value);
      let value = cellValueFromExcelJS(cell.value, richSegments);
      const style = extractStyleFromExcelJS(cell);
      const rowspan = isMerged ? mi!.rowspan : 1;
      const colspan = isMerged ? mi!.colspan : 1;

      if (typeof value === 'string' && value.includes(' / ') && r === 1 && c === 1) {
        const parts = value.split(' / ', 2);
        if (parts.length === 2 && !isNumericDiagbox(parts)) {
          style.diagbox = parts;
          value = '';
        }
      }

      if (typeof value === 'string' && /\\[a-zA-Z]/u.test(value)) {
        style.rawLatex = true;
      }

      row.push({ value: value ?? '', style, rowspan, colspan, richSegments });
    }
    rows.push(row);
  }

  while (rows.length > 1 && rows[rows.length - 1].every((c) => isEmptyValue(c.value))) {
    rows.pop();
  }
  const numRows = rows.length;
  let numCols = colCount;
  numCols = trimTrailingEmptyColsLikePython(rows, numCols);
  const trimmedRows = rows.map((r) => r.slice(0, numCols));

  let headerRows: number;
  if (typeof opts.headerRows === 'number') {
    headerRows = Math.max(0, Math.min(Math.trunc(opts.headerRows), trimmedRows.length));
  } else {
    headerRows = trimmedRows.length === 0 ? 0 : Math.max(...trimmedRows[0].map((c) => c.rowspan || 1), 1);
    let r = 1;
    while (r < headerRows && r < trimmedRows.length) {
      for (const cell of trimmedRows[r]) {
        headerRows = Math.max(headerRows, r + (cell.rowspan || 1));
      }
      r += 1;
    }
  }

  return {
    cells: trimmedRows,
    numRows,
    numCols,
    headerRows,
    groupSeparators: {},
  };
}

export async function readWorkbook(
  workbook: ExcelJS.Workbook,
  opts: ReadExcelOptions = {},
): Promise<TableData> {
  const selectedSheets = opts.sheet == null
    ? [workbook.worksheets[0]]
    : [typeof opts.sheet === 'number' ? workbook.worksheets[opts.sheet] : workbook.getWorksheet(opts.sheet)].filter(Boolean) as ExcelJS.Worksheet[];

  if (selectedSheets.length === 0) {
    throw new Error(`No matching sheet for selector: ${String(opts.sheet)}`);
  }
  return tableFromWorksheet(selectedSheets[0], { headerRows: opts.headerRows });
}
