import path from 'node:path';
import fs from 'node:fs/promises';
import ExcelJS from 'exceljs';

import type { Cell, RichSegment, TableData, Xlsx2TexOptions } from './models.js';
import { readTex } from './texReader.js';
import { render } from './renderer.js';

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
  // ExcelJS tends to expose ARGB like 'FFRRGGBB'
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

  // Background color
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

function tableFromWorksheet(ws: ExcelJS.Worksheet, opts: Xlsx2TexOptions): TableData {
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

      // Auto-detect diagbox: "X / Y" in top-left (non-numeric labels only).
      if (typeof value === 'string' && value.includes(' / ') && r === 1 && c === 1) {
        const parts = value.split(' / ', 2);
        if (parts.length === 2 && !isNumericDiagbox(parts)) {
          style.diagbox = parts;
          value = '';
        }
      }

      // Auto-detect raw LaTeX (mirror pubtab-python): if cell contains \command
      if (typeof value === 'string' && /\\[a-zA-Z]/u.test(value)) {
        style.rawLatex = true;
      }

      row.push({ value: value ?? '', style, rowspan, colspan, richSegments });
    }
    rows.push(row);
  }

  // Trim trailing empty rows (keep at least 1)
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
    // Match pubtab-python: start with first-row rowspans, then extend while inside header.
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

export async function readExcel(inputFile: string, opts: ReadExcelOptions = {}): Promise<TableData> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(inputFile);
  const selectedSheets = opts.sheet == null
    ? [wb.worksheets[0]]
    : [typeof opts.sheet === 'number' ? wb.worksheets[opts.sheet] : wb.getWorksheet(opts.sheet)].filter(Boolean) as ExcelJS.Worksheet[];

  if (selectedSheets.length === 0) {
    throw new Error(`No matching sheet for selector: ${String(opts.sheet)}`);
  }
  return tableFromWorksheet(selectedSheets[0], { headerRows: opts.headerRows });
}

function outputPathsForSheets(inputFile: string, output: string, count: number): string[] {
  const parsed = path.parse(output);
  const outIsTexFile = parsed.ext.toLowerCase() === '.tex';
  if (count <= 1) {
    // For single-sheet output, allow either a direct .tex path or an output directory.
    if (outIsTexFile) return [output];
    const baseStem = path.parse(inputFile).name;
    return [path.join(output, `${baseStem}.tex`)];
  }
  const baseDir = outIsTexFile ? parsed.dir : output;
  const baseStem = outIsTexFile ? parsed.name : path.parse(inputFile).name;
  return Array.from({ length: count }, (_, i) => path.join(baseDir, `${baseStem}_sheet${String(i + 1).padStart(2, '0')}.tex`));
}

async function listFiles(dir: string, ext: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(ext))
    .map((e) => path.join(dir, e.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

async function ensureDirectoryOutputForDirectoryInput(output: string, disallowedExt: string): Promise<void> {
  if (path.extname(output).toLowerCase() === disallowedExt) {
    throw new Error(`When input is a directory, output must be a directory (not a ${disallowedExt} file path): ${output}`);
  }
  try {
    const st = await fs.stat(output);
    if (!st.isDirectory()) {
      throw new Error(`When input is a directory, output must be a directory: ${output}`);
    }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException | undefined)?.code;
    if (code !== 'ENOENT') throw e;
  }
  await fs.mkdir(output, { recursive: true });
}

export async function xlsx2tex(inputFile: string, output: string, opts: Xlsx2TexOptions = {}): Promise<string> {
  const stat = await fs.stat(inputFile);

  if (stat.isDirectory()) {
    const files = await listFiles(inputFile, '.xlsx');
    await ensureDirectoryOutputForDirectoryInput(output, '.tex');
    let first = '';
    for (const file of files) {
      const out = path.join(output, `${path.parse(file).name}.tex`);
      const tex = await xlsx2tex(file, out, opts);
      if (!first) first = tex;
    }
    return first;
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(inputFile);

  const selectedSheets = opts.sheet == null
    ? wb.worksheets
    : [typeof opts.sheet === 'number' ? wb.worksheets[opts.sheet] : wb.getWorksheet(opts.sheet)].filter(Boolean) as ExcelJS.Worksheet[];

  const outs = outputPathsForSheets(inputFile, output, selectedSheets.length);
  let first = '';
  for (let i = 0; i < selectedSheets.length; i += 1) {
    const table = tableFromWorksheet(selectedSheets[i], opts);
    const tex = render(table, opts);
    await fs.mkdir(path.dirname(outs[i]), { recursive: true });
    await fs.writeFile(outs[i], tex, 'utf8');
    if (!first) first = tex;
  }
  return first;
}

async function writeTableToExcel(table: TableData, output: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Table 1');

  const toArgb = (hex: string | undefined): string | undefined => {
    if (!hex) return undefined;
    const h = hex.replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return undefined;
    return `FF${h.toUpperCase()}`;
  };

  const merged = new Set<string>();

  for (let r = 0; r < table.cells.length; r += 1) {
    const row = table.cells[r];
    for (let c = 0; c < row.length; c += 1) {
      const cell = row[c];
      const mergedKey = `${r},${c}`;
      if (merged.has(mergedKey)) {
        if (cell.value === '' || cell.value == null) continue;
        merged.delete(mergedKey);
      }
      const target = ws.getCell(r + 1, c + 1);

      if (cell.richSegments && cell.richSegments.length > 1) {
        target.value = {
          richText: cell.richSegments.map((seg) => {
            const [text, color, bold, italic, underline] = seg as RichSegment;
            const argb = toArgb(color ?? '#000000') ?? 'FF000000';
            return {
              text,
              font: {
                bold: bold || undefined,
                italic: italic || undefined,
                underline: underline || undefined,
                // Explicit black for uncolored segments mirrors pubtab-python's behavior and
                // avoids segment boundary collapse when a bg fill exists.
                color: { argb: color ? argb : 'FF000000' },
              },
            };
          }),
        } as any;
      } else {
        target.value = cell.value as ExcelJS.CellValue;
      }

      if (!(cell.richSegments && cell.richSegments.length > 1)) {
        const fontColor = toArgb(cell.style.color);
        target.font = {
          bold: cell.style.bold || undefined,
          italic: cell.style.italic || undefined,
          underline: cell.style.underline ? true : undefined,
          color: fontColor ? { argb: fontColor } : undefined,
        } as any;
      }

      const bg = toArgb(cell.style.bgColor);
      if (bg) {
        target.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: bg },
          bgColor: { argb: bg },
        } as any;
      }

      const rotation = cell.style.rotation ?? 0;
      const wrapText = typeof cell.value === 'string' && cell.value.includes('\n');
      target.alignment = {
        horizontal: cell.style.alignment as any,
        vertical: 'middle',
        wrapText: wrapText || undefined,
        textRotation: rotation || undefined,
      } as any;

      if (cell.rowspan > 1 || cell.colspan > 1) {
        let actualRowspan = Math.min(cell.rowspan, table.cells.length - r);
        if (actualRowspan > 1) {
          for (let dr = 1; dr < actualRowspan; dr += 1) {
            const nr = r + dr;
            if (nr < table.cells.length && table.cells[nr][c]?.value != null && table.cells[nr][c]?.value !== '') {
              actualRowspan = dr;
              break;
            }
          }
        }
        const endRow = r + actualRowspan;
        const endCol = c + cell.colspan;
        if (endRow > r + 1 || endCol > c + 1) {
          ws.mergeCells(r + 1, c + 1, endRow, endCol);
        }
        for (let mr = r; mr < r + actualRowspan; mr += 1) {
          for (let mc = c; mc < c + cell.colspan; mc += 1) {
            if (mr === r && mc === c) continue;
            merged.add(`${mr},${mc}`);
          }
        }
      }
    }
  }

  await fs.mkdir(path.dirname(output), { recursive: true });
  await wb.xlsx.writeFile(output);
}

export async function texToExcel(inputFile: string, output: string): Promise<string> {
  const stat = await fs.stat(inputFile);
  if (stat.isDirectory()) {
    await ensureDirectoryOutputForDirectoryInput(output, '.xlsx');
    const files = await listFiles(inputFile, '.tex');
    for (const file of files) {
      const text = await fs.readFile(file, 'utf8');
      const table = readTex(text);
      const out = path.join(output, `${path.parse(file).name}.xlsx`);
      await writeTableToExcel(table, out);
    }
    return output;
  }

  if (path.extname(output).toLowerCase() !== '.xlsx') {
    output = path.join(output, `${path.parse(inputFile).name}.xlsx`);
  }
  const text = await fs.readFile(inputFile, 'utf8');
  const table = readTex(text);
  await writeTableToExcel(table, output);
  return output;
}
