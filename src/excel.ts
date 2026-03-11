import path from 'node:path';
import fs from 'node:fs/promises';
import ExcelJS from 'exceljs';

import type { Cell, TableData, Xlsx2TexOptions } from './models.js';
import { readTex } from './texReader.js';
import { render } from './renderer.js';

function tableFromWorksheet(ws: ExcelJS.Worksheet): TableData {
  const rowCount = ws.actualRowCount || ws.rowCount || 0;
  const colCount = ws.actualColumnCount || ws.columnCount || 0;

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

  return {
    cells: rows,
    numRows: rows.length,
    numCols: colCount,
    headerRows: Math.min(rows.length, 1),
    groupSeparators: {},
  };
}

function outputPathsForSheets(inputFile: string, output: string, count: number): string[] {
  if (count <= 1) return [output];
  const parsed = path.parse(output);
  const baseDir = parsed.ext.toLowerCase() === '.tex' ? parsed.dir : output;
  const baseStem = parsed.ext.toLowerCase() === '.tex' ? parsed.name : path.parse(inputFile).name;
  return Array.from({ length: count }, (_, i) => path.join(baseDir, `${baseStem}_sheet${String(i + 1).padStart(2, '0')}.tex`));
}

async function listFiles(dir: string, ext: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(ext))
    .map((e) => path.join(dir, e.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

export async function xlsx2tex(inputFile: string, output: string, opts: Xlsx2TexOptions = {}): Promise<string> {
  const stat = await fs.stat(inputFile);

  if (stat.isDirectory()) {
    const files = await listFiles(inputFile, '.xlsx');
    await fs.mkdir(output, { recursive: true });
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
    const table = tableFromWorksheet(selectedSheets[i]);
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
    await fs.mkdir(output, { recursive: true });
    const files = await listFiles(inputFile, '.tex');
    for (const file of files) {
      const text = await fs.readFile(file, 'utf8');
      const table = readTex(text);
      const out = path.join(output, `${path.parse(file).name}.xlsx`);
      await writeTableToExcel(table, out);
    }
    return output;
  }

  const text = await fs.readFile(inputFile, 'utf8');
  const table = readTex(text);
  await writeTableToExcel(table, output);
  return output;
}
