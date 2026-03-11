import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import ExcelJS from 'exceljs';

import { xlsx2tex, texToExcel, readTex, render, type TableData } from '../src/index.js';

async function mkTmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

describe('pubtab-ts core', () => {
  it('fixture: .tmp/table1.xlsx 的输出在语义上与 pubtab 生成的 tex1_sheet01/02 一致', async () => {
    const fixtureXlsx = path.resolve('.tmp/table1.xlsx');
    const pubtabSheet01 = path.resolve('.tmp/tex1_sheet01.tex');
    const pubtabSheet02 = path.resolve('.tmp/tex1_sheet02.tex');

    // Local-only fixture. Skip if not present.
    if (!(await fileExists(fixtureXlsx)) || !(await fileExists(pubtabSheet01)) || !(await fileExists(pubtabSheet02))) {
      return;
    }

    const dir = await mkTmpDir('pubtab-ts-fixture-');
    const outBase = path.join(dir, 'tex1.tex');

    await xlsx2tex(fixtureXlsx, outBase);

    const ours01 = path.join(dir, 'tex1_sheet01.tex');
    const ours02 = path.join(dir, 'tex1_sheet02.tex');
    expect(await fs.stat(ours01)).toBeTruthy();
    expect(await fs.stat(ours02)).toBeTruthy();

    const normalize = (v: unknown): unknown => {
      if (typeof v === 'number') {
        // Avoid microscopic float drift; pubtab may render formatted decimals.
        return Math.round(v * 1e12) / 1e12;
      }
      if (v == null) return '';
      return String(v).trim();
    };

    const extractNumericRows = (t: ReturnType<typeof readTex>) => {
      // Ignore section header rows (e.g. rowcolor+multicolumn) by keeping only rows with any numeric payload.
      return t.cells
        .map((row) => row.map((c) => normalize(c.value)))
        .filter((row) => row.some((x) => typeof x === 'number'));
    };

    const pub01 = readTex(await fs.readFile(pubtabSheet01, 'utf8'));
    const our01 = readTex(await fs.readFile(ours01, 'utf8'));
    expect(extractNumericRows(our01)).toEqual(extractNumericRows(pub01));

    const pub02 = readTex(await fs.readFile(pubtabSheet02, 'utf8'));
    const our02 = readTex(await fs.readFile(ours02, 'utf8'));
    expect(extractNumericRows(our02)).toEqual(extractNumericRows(pub02));
  });

  it('xlsx2tex 默认导出全部 sheet', async () => {
    const dir = await mkTmpDir('pubtab-ts-');
    const xlsxPath = path.join(dir, 'multi.xlsx');
    const outPath = path.join(dir, 'multi.tex');

    const wb = new ExcelJS.Workbook();
    const ws1 = wb.addWorksheet('Main Sheet');
    ws1.getCell('A1').value = 'MAINCELL';
    const ws2 = wb.addWorksheet('Aux-2');
    ws2.getCell('A1').value = 'AUXCELL';
    await wb.xlsx.writeFile(xlsxPath);

    await xlsx2tex(xlsxPath, outPath);

    const tex1 = path.join(dir, 'multi_sheet01.tex');
    const tex2 = path.join(dir, 'multi_sheet02.tex');
    expect(await fs.stat(tex1)).toBeTruthy();
    expect(await fs.stat(tex2)).toBeTruthy();
    expect(await fs.readFile(tex1, 'utf8')).toContain('MAINCELL');
    expect(await fs.readFile(tex2, 'utf8')).toContain('AUXCELL');
  });

  it('xlsx2tex 指定 sheet 只导出一个文件', async () => {
    const dir = await mkTmpDir('pubtab-ts-');
    const xlsxPath = path.join(dir, 'single.xlsx');
    const outPath = path.join(dir, 'single.tex');

    const wb = new ExcelJS.Workbook();
    const ws1 = wb.addWorksheet('Main');
    ws1.getCell('A1').value = 'MAIN';
    const ws2 = wb.addWorksheet('Aux-2');
    ws2.getCell('A1').value = 'AUX';
    await wb.xlsx.writeFile(xlsxPath);

    await xlsx2tex(xlsxPath, outPath, { sheet: 'Aux-2' });

    const tex = await fs.readFile(outPath, 'utf8');
    expect(tex).toContain('AUX');
    expect(tex).not.toContain('MAIN');
  });

  it('渲染结果包含 package hints，resizebox 时包含 graphicx', () => {
    const table: TableData = {
      cells: [
        [{ value: 'H', style: {}, rowspan: 1, colspan: 1 }],
        [{ value: 'V', style: {}, rowspan: 1, colspan: 1 }],
      ],
      numRows: 2,
      numCols: 1,
      headerRows: 1,
      groupSeparators: {},
    };

    const tex = render(table, { resizebox: '0.8\\textwidth' });
    expect(tex.startsWith('% Theme package hints for this table')).toBe(true);
    expect(tex).toContain('% \\usepackage{booktabs}');
    expect(tex).toContain('% \\usepackage{multirow}');
    expect(tex).toContain('% \\usepackage[table]{xcolor}');
    expect(tex).toContain('% \\usepackage{graphicx}');
  });

  it('texToExcel 支持目录批量转换', async () => {
    const dir = await mkTmpDir('pubtab-ts-');
    const inDir = path.join(dir, 'tex-in');
    const outDir = path.join(dir, 'xlsx-out');
    await fs.mkdir(inDir, { recursive: true });

    const tex1 = String.raw`\begin{tabular}{cc}
\toprule
A & B \\
\midrule
1 & 2 \\
\bottomrule
\end{tabular}`;
    const tex2 = tex1.replace('1 & 2', '3 & 4');
    await fs.writeFile(path.join(inDir, 'a.tex'), tex1, 'utf8');
    await fs.writeFile(path.join(inDir, 'b.tex'), tex2, 'utf8');

    await texToExcel(inDir, outDir);

    const wa = new ExcelJS.Workbook();
    await wa.xlsx.readFile(path.join(outDir, 'a.xlsx'));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join(outDir, 'b.xlsx'));

    expect(wa.worksheets[0].getCell('A2').value).toBe(1);
    expect(wb.worksheets[0].getCell('A2').value).toBe(3);
  });

  it('xlsx2tex：目录输入时 output 不能是 .tex 文件路径', async () => {
    const dir = await mkTmpDir('pubtab-ts-');
    const inDir = path.join(dir, 'xlsx-in');
    await fs.mkdir(inDir, { recursive: true });

    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('S1').getCell('A1').value = 'X';
    await wb.xlsx.writeFile(path.join(inDir, 'a.xlsx'));

    const outFile = path.join(dir, 'out.tex');
    await expect(xlsx2tex(inDir, outFile)).rejects.toThrow(/output.*directory/i);
  });

  it('texToExcel：目录输入时 output 不能是 .xlsx 文件路径', async () => {
    const dir = await mkTmpDir('pubtab-ts-');
    const inDir = path.join(dir, 'tex-in');
    await fs.mkdir(inDir, { recursive: true });

    const tex = String.raw`\begin{tabular}{c}
A \\
\end{tabular}`;
    await fs.writeFile(path.join(inDir, 'a.tex'), tex, 'utf8');

    const outFile = path.join(dir, 'out.xlsx');
    await expect(texToExcel(inDir, outFile)).rejects.toThrow(/output.*directory/i);
  });

  it('xlsx2tex：单文件输入时 output 允许传目录并按输入名落盘', async () => {
    const dir = await mkTmpDir('pubtab-ts-');
    const xlsxPath = path.join(dir, 'one.xlsx');
    const outDir = path.join(dir, 'out');

    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('S1').getCell('A1').value = 'ONLY';
    await wb.xlsx.writeFile(xlsxPath);

    await xlsx2tex(xlsxPath, outDir);

    const outTex = path.join(outDir, 'one.tex');
    expect(await fs.readFile(outTex, 'utf8')).toContain('ONLY');
  });

  it('texToExcel：单文件输入时 output 允许传目录并按输入名落盘', async () => {
    const dir = await mkTmpDir('pubtab-ts-');
    const texPath = path.join(dir, 'one.tex');
    const outDir = path.join(dir, 'out');

    const tex = String.raw`\begin{tabular}{c}
Z \\
\end{tabular}`;
    await fs.writeFile(texPath, tex, 'utf8');

    await texToExcel(texPath, outDir);

    const outXlsx = path.join(outDir, 'one.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(outXlsx);
    expect(wb.worksheets[0].getCell('A1').value).toBe('Z');
  });

  it('readTex 与 render 的最小往返保持结构', () => {
    const src = String.raw`\begin{tabular}{cc}
\toprule
X & Y \\
\midrule
u & v \\
\bottomrule
\end{tabular}`;

    const parsed = readTex(src);
    expect(parsed.numRows).toBe(2);
    expect(parsed.numCols).toBe(2);

    const rendered = render(parsed);
    const parsed2 = readTex(rendered);
    expect(parsed2.numRows).toBe(2);
    expect(parsed2.numCols).toBe(2);
    expect(parsed2.cells[1][0].value).toBe('u');
  });
});
