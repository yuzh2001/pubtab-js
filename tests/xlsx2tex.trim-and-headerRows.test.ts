import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import ExcelJS from 'exceljs';

import { xlsx2tex } from '../src/index.js';

async function mkTmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe('xlsx2tex: trims + headerRows', () => {
  it('裁剪尾部全空列，但要保留宽标题合并单元格覆盖到的列', async () => {
    const dir = await mkTmpDir('pubtab-ts-trim-');
    const xlsxPath = path.join(dir, 't.xlsx');
    const outTex = path.join(dir, 't.tex');

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('S1');

    ws.getCell('A1').value = 'HDR';
    ws.mergeCells('A1:C1');

    // Force the worksheet to have trailing columns counted, but keep them "empty" semantically.
    ws.getCell('D1').value = '';
    ws.getCell('E1').value = '';

    ws.getCell('A2').value = 1;
    ws.getCell('B2').value = 2;
    ws.getCell('C2').value = 3;
    ws.getCell('D2').value = '';
    ws.getCell('E2').value = '';

    await wb.xlsx.writeFile(xlsxPath);

    const tex = await xlsx2tex(xlsxPath, outTex);

    expect(tex).toContain('\\begin{tabular}{ccc}');
    expect(tex).not.toContain('\\begin{tabular}{c}');
    expect(tex).not.toContain('\\begin{tabular}{ccccc}');
  });

  it('headerRows=auto：前两行是字符串、第三行出现数字时推断 headerRows=2', async () => {
    const dir = await mkTmpDir('pubtab-ts-headerRows-');
    const xlsxPath = path.join(dir, 'h.xlsx');
    const outTex = path.join(dir, 'h.tex');

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('S1');
    // Align with pubtab-python: auto header_rows is derived from header rowspans, not numeric heuristics.
    // Make a 2-row-tall header by merging A1:A2.
    ws.getCell('A1').value = 'H1';
    ws.mergeCells('A1:A2');
    ws.getCell('B1').value = 'H2';
    ws.getCell('B2').value = 'H2-2';
    ws.getCell('A3').value = 1;
    ws.getCell('B3').value = 2;
    await wb.xlsx.writeFile(xlsxPath);

    const tex = await xlsx2tex(xlsxPath, outTex, { headerRows: 'auto' });

    const lines = tex.split('\n').map((l) => l.trim());
    const midIdx = lines.indexOf('\\midrule');
    expect(midIdx).toBeGreaterThanOrEqual(0);
    const rowLinesBefore = lines.slice(0, midIdx).filter((l) => l.endsWith('\\\\'));
    expect(rowLinesBefore.length).toBe(2);
  });

  it('headerRows=数字：可配置 midrule 位置（headerRows=1）', async () => {
    const dir = await mkTmpDir('pubtab-ts-headerRows-n-');
    const xlsxPath = path.join(dir, 'n.xlsx');
    const outTex = path.join(dir, 'n.tex');

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('S1');
    ws.getCell('A1').value = 'H';
    ws.getCell('A2').value = 'V';
    await wb.xlsx.writeFile(xlsxPath);

    const tex = await xlsx2tex(xlsxPath, outTex, { headerRows: 1 });

    const lines = tex.split('\n').map((l) => l.trim());
    const midIdx = lines.indexOf('\\midrule');
    expect(midIdx).toBeGreaterThanOrEqual(0);
    const rowLinesBefore = lines.slice(0, midIdx).filter((l) => l.endsWith('\\\\'));
    expect(rowLinesBefore.length).toBe(1);
  });
});
