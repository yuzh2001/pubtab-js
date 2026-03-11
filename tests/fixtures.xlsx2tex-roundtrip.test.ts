import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import ExcelJS from 'exceljs';

import { xlsx2tex, readTex } from '../src/index.js';

const FIXTURES = path.resolve('tests/fixtures');
const TABLES = ['table1', 'table2', 'table3', 'table4', 'table5', 'table6', 'table8'] as const;

async function mkTmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe('fixtures: xlsx -> tex -> (parse)（迁移 pubtab-python test_xlsx_to_tex_roundtrip）', () => {
  it.each(TABLES)('xlsx2tex roundtrip: %s 维度应一致', async (name) => {
    const dir = await mkTmpDir('pubtab-ts-fixture-xlsx2tex-');
    const xlsxFile = path.join(FIXTURES, `${name}.xlsx`);
    const outTex = path.join(dir, `${name}.tex`);

    await xlsx2tex(xlsxFile, outTex);
    const tex = await fs.readFile(outTex, 'utf8');
    const table = readTex(tex);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(xlsxFile);
    const ws = wb.worksheets[0];

    expect(table.numRows).toBe(ws.rowCount);
    expect(table.numCols).toBe(ws.columnCount);
  });
});

