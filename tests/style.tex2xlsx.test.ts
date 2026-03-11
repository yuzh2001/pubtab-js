import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import ExcelJS from 'exceljs';

import { texToExcel } from '../src/index.js';

async function mkTmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe('style: tex2xlsx（对齐 Python tex_reader.py + writer.py 的样式语义）', () => {
  it('tex2xlsx: 格式化/颜色/背景色/旋转应写回 Excel 样式', async () => {
    const dir = await mkTmpDir('pubtab-ts-style-tex2xlsx-');
    const texPath = path.join(dir, 'in.tex');
    const outXlsx = path.join(dir, 'out.xlsx');

    const tex = String.raw`
\begin{tabular}{cccccc}
\toprule
\textbf{Bold} & \textit{Italic} & \underline{Under} &
\textcolor[RGB]{255,0,0}{Red} & \cellcolor[RGB]{0,255,0}{BG} &
\rotatebox[origin=c]{90}{Rot} \\
\bottomrule
\end{tabular}
`;
    await fs.writeFile(texPath, tex, 'utf8');

    await texToExcel(texPath, outXlsx);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(outXlsx);
    const ws = wb.worksheets[0];

    const cBold = ws.getCell('A1');
    const cItalic = ws.getCell('B1');
    const cUnder = ws.getCell('C1');
    const cRed = ws.getCell('D1');
    const cBg = ws.getCell('E1');
    const cRot = ws.getCell('F1');

    expect(cBold.font?.bold).toBe(true);
    expect(cItalic.font?.italic).toBe(true);
    expect(Boolean(cUnder.font?.underline)).toBe(true);

    expect(cRed.font?.color?.argb).toBe('FFFF0000');
    expect((cBg.fill as any)?.fgColor?.argb).toBe('FF00FF00');
    expect(cRot.alignment?.textRotation).toBe(90);
  });
});

