import path from 'node:path';
import fs from 'node:fs/promises';
import ExcelJS from 'exceljs';

import type { Cell, TableData, Xlsx2TexOptions } from './models.js';
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

function minColsDueToHeaderMerges(ws: ExcelJS.Worksheet): number {
  const merges = (ws.model as { merges?: string[] } | undefined)?.merges ?? [];
  let minKeep = 0;
  for (const raw of merges) {
    const m = raw.match(/^([A-Za-z]+)(\d+):([A-Za-z]+)(\d+)$/u);
    if (!m) continue;
    const startCol = colLettersToNumber(m[1]);
    const startRow = Number(m[2]);
    const endCol = colLettersToNumber(m[3]);
    if (startCol <= 0 || endCol <= 0 || !Number.isFinite(startRow)) continue;
    if (startRow !== 1) continue;
    const masterValue = ws.getCell(startRow, startCol).value;
    if (isEmptyValue(masterValue)) continue;
    minKeep = Math.max(minKeep, endCol);
  }
  return minKeep;
}

function tableFromWorksheet(ws: ExcelJS.Worksheet, opts: Xlsx2TexOptions): TableData {
  const rowCount = Math.max(ws.rowCount || 0, ws.actualRowCount || 0);
  const colCount = Math.max(ws.columnCount || 0, ws.actualColumnCount || 0);

  const rows: Cell[][] = [];
  for (let r = 1; r <= rowCount; r += 1) {
    const row: Cell[] = [];
    for (let c = 1; c <= colCount; c += 1) {
      const cell = ws.getCell(r, c) as unknown as {
        value: ExcelJS.CellValue | null | undefined;
        address: string;
        isMerged?: boolean;
        master?: { address: string; value: ExcelJS.CellValue | null | undefined };
      };
      // ExcelJS returns the master value for every cell in a merged range.
      // pubtab's semantics are closer to Excel display: only the master cell carries the value.
      const v =
        cell.isMerged && cell.master && cell.address !== cell.master.address
          ? ''
          : cell.value;
      row.push({ value: v ?? '', style: {}, rowspan: 1, colspan: 1 });
    }
    rows.push(row);
  }

  const minKeepCols = minColsDueToHeaderMerges(ws);
  let lastNonEmpty = 0;
  for (let c = 0; c < colCount; c += 1) {
    const hasAny = rows.some((r) => !isEmptyValue(r[c]?.value));
    if (hasAny) lastNonEmpty = c + 1;
  }
  const keepCols = Math.max(1, Math.max(lastNonEmpty, minKeepCols));
  const trimmedRows = rows.map((r) => r.slice(0, keepCols));

  let headerRows: number;
  if (typeof opts.headerRows === 'number') {
    headerRows = Math.max(0, Math.min(Math.trunc(opts.headerRows), trimmedRows.length));
  } else {
    let count = 0;
    for (const r of trimmedRows) {
      const hasNumeric = r.some((c) => typeof c.value === 'number' && Number.isFinite(c.value));
      if (hasNumeric) break;
      count += 1;
    }
    headerRows = trimmedRows.length === 0 ? 0 : Math.max(1, Math.min(count, trimmedRows.length));
  }

  return {
    cells: trimmedRows,
    numRows: trimmedRows.length,
    numCols: keepCols,
    headerRows,
    groupSeparators: {},
  };
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

  for (let r = 0; r < table.cells.length; r += 1) {
    const row = table.cells[r];
    for (let c = 0; c < row.length; c += 1) {
      ws.getCell(r + 1, c + 1).value = row[c].value as ExcelJS.CellValue;
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
