import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import ExcelJS from 'exceljs';

import { readTex, texToExcel, xlsx2tex } from '../src/index.js';

async function mkTmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe('style: roundtrip（对齐 Python 的 xlsx→tex→xlsx 样式回转语义）', () => {
  it('xlsx→tex→xlsx: 粗/斜/下划线/颜色/背景色/旋转应保持', async () => {
    const dir = await mkTmpDir('pubtab-ts-style-rt-');
    const xlsxIn = path.join(dir, 'in.xlsx');
    const texOut = path.join(dir, 'out.tex');
    const xlsxOut = path.join(dir, 'out.xlsx');

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('S1');

    ws.getCell('A1').value = 'Bold';
    ws.getCell('A1').font = { bold: true };

    ws.getCell('B1').value = 'Italic';
    ws.getCell('B1').font = { italic: true };

    ws.getCell('C1').value = 'Under';
    ws.getCell('C1').font = { underline: true };

    ws.getCell('D1').value = 'Red';
    ws.getCell('D1').font = { color: { argb: 'FFFF0000' } };

    ws.getCell('E1').value = 'BG';
    ws.getCell('E1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00FF00' } };

    ws.getCell('F1').value = 'Rot';
    ws.getCell('F1').alignment = { textRotation: 90 };

    await wb.xlsx.writeFile(xlsxIn);

    await xlsx2tex(xlsxIn, texOut);
    await texToExcel(texOut, xlsxOut);

    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.readFile(xlsxOut);
    const ws2 = wb2.worksheets[0];

    expect(ws2.getCell('A1').font?.bold).toBe(true);
    expect(ws2.getCell('B1').font?.italic).toBe(true);
    expect(Boolean(ws2.getCell('C1').font?.underline)).toBe(true);
    expect(ws2.getCell('D1').font?.color?.argb).toBe('FFFF0000');
    expect((ws2.getCell('E1').fill as any)?.fgColor?.argb).toBe('FF00FF00');
    expect(ws2.getCell('F1').alignment?.textRotation).toBe(90);
  });
});

describe('style: tex_reader rich segments（迁移 Python test_roundtrip.py 的 rich_segments 断言）', () => {
  it('readTex: \\\\textbf/\\\\textit/\\\\underline 应被提取到 cell.style（迁移 Python test_tex_reader_formatting）', () => {
    const tex = String.raw`
\begin{tabular}{ccc}
\toprule
\textbf{Bold} & \textit{Italic} & \underline{Under} \\
\bottomrule
\end{tabular}
`;
    const table = readTex(tex);
    expect(table.cells[0][0].style.bold).toBe(true);
    expect(table.cells[0][1].style.italic).toBe(true);
    expect(table.cells[0][2].style.underline).toBe(true);
  });

  it('readTex: 嵌套 makebox/color/textsf/textbf 应清理为纯内容（迁移 Python test_tex_reader_nested_makebox_cleans_to_content）', () => {
    const tex = String.raw`
\begin{tabular}{c}
\toprule
\makebox[1.25em][c]{{\color{ForestGreen}\textsf{\textbf{P}}}} \\
\bottomrule
\end{tabular}
`;
    const table = readTex(tex);
    expect(table.cells[0][0].value).toBe('P');
  });

  it('readTex: dvips mixed-case color 应被解析为 rich segments（Dandelion -> #FDBC42）', () => {
    const tex = String.raw`
\begin{tabular}{c}
\toprule
\makebox[1.25em][c]{{\color{Dandelion}\textbf{P}}}\quad/\quad\makebox[1.25em][c]{{\color{ForestGreen}\ding{52}}} \\
\bottomrule
\end{tabular}
`;
    const table = readTex(tex);
    const cell: any = table.cells[0][0];
    expect(cell.richSegments ?? cell.rich_segments).toBeTruthy();
    expect((cell.richSegments ?? cell.rich_segments)[0][0]).toBe('P');
    expect((cell.richSegments ?? cell.rich_segments)[0][1]).toBe('#FDBC42');
  });

  it('readTex: rich segments 不应泄漏 makecell 前缀残留', () => {
    const tex = String.raw`
\begin{tabular}{ll}
\toprule
Q & A \\
\midrule
Qwen2 response & \begin{tabular}[c]{@{}l@{}}He Ain't Heavy was written by \textcolor{red}{Mike D'Abo}. \\ $\cdots$\end{tabular} \\
\bottomrule
\end{tabular}
`;
    const table = readTex(tex);
    const cell: any = table.cells[1][1];
    const segs = cell.richSegments ?? cell.rich_segments;
    expect(segs).toBeTruthy();
    expect(String(segs[0][0]).toLowerCase()).not.toContain('makecell');
    expect(String(segs[0][0]).endsWith(' ')).toBe(true);
  });
});
