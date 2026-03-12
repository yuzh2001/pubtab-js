import path from 'node:path';
import fs from 'node:fs/promises';
import ExcelJS from 'exceljs';

import type { TableData, Xlsx2TexOptions } from './models.js';
import { tableFromWorksheet, type ReadExcelOptions, readWorkbook } from './core/table.js';
import { workbookFromTable } from './core/workbook.js';
import { readTex } from './texReader.js';
import { render } from './renderer.js';

export type { ReadExcelOptions } from './core/table.js';

export async function readExcel(inputFile: string, opts: ReadExcelOptions = {}): Promise<TableData> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(inputFile);
  return readWorkbook(wb, opts);
}

function outputPathsForSheets(inputFile: string, output: string, count: number): string[] {
  const parsed = path.parse(output);
  const outIsTexFile = parsed.ext.toLowerCase() === '.tex';
  if (count <= 1) {
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
  const wb = workbookFromTable(table);
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
