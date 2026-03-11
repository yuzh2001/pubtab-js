import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import ExcelJS from 'exceljs';

import { xlsx2tex } from '../src/index.js';

async function mkTmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe('style: xlsx2tex（对齐 Python reader.py + renderer.py 的样式语义）', () => {
  it('xlsx2tex: 从 Excel 读取粗/斜/下划线/颜色/背景色/旋转并渲染到 LaTeX', async () => {
    const dir = await mkTmpDir('pubtab-ts-style-xlsx2tex-');
    const xlsxPath = path.join(dir, 'style.xlsx');
    const outTex = path.join(dir, 'style.tex');

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

    await wb.xlsx.writeFile(xlsxPath);

    const tex = await xlsx2tex(xlsxPath, outTex);

    // 这些断言对应 Python renderer.py 的输出约定：
    // - \textbf/\textit/\underline
    // - \textcolor[RGB]{r,g,b}{...} / \cellcolor[RGB]{r,g,b}{...}
    // - \rotatebox[origin=c]{angle}{...}
    expect(tex).toContain(String.raw`\textbf{Bold}`);
    expect(tex).toContain(String.raw`\textit{Italic}`);
    expect(tex).toContain(String.raw`\underline{Under}`);

    expect(tex).toContain(String.raw`\textcolor[RGB]{255,0,0}{Red}`);
    expect(tex).toContain(String.raw`\cellcolor[RGB]{0,255,0}{BG}`);
    expect(tex).toContain(String.raw`\rotatebox[origin=c]{90}{Rot}`);
  });

  it('xlsx2tex: richText 分段应输出为 rich segments（逐段样式）', async () => {
    const dir = await mkTmpDir('pubtab-ts-style-xlsx2tex-rt-');
    const xlsxPath = path.join(dir, 'rich.xlsx');
    const outTex = path.join(dir, 'rich.tex');

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('S1');

    ws.getCell('A1').value = {
      richText: [
        { text: 'P', font: { bold: true, color: { argb: 'FFFDBC42' } } }, // #FDBC42
        { text: '/', font: {} },
        { text: 'Q', font: { color: { argb: 'FF00AA00' } } }, // 0,170,0
      ],
    } as any;

    await wb.xlsx.writeFile(xlsxPath);

    const tex = await xlsx2tex(xlsxPath, outTex);

    // Python renderer.py：rich_segments 会变成按段包裹的 \textcolor/\textbf 拼接。
    expect(tex).toContain(String.raw`\textcolor[RGB]{253,188,66}{\textbf{P}}`);
    expect(tex).toContain(String.raw`\textcolor[RGB]{0,170,0}{Q}`);
  });
});

