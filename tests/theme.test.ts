import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import ExcelJS from 'exceljs';

import { render, xlsx2tex } from '../src/index.js';
import { getTheme, listThemes } from '../src/themes.js';

async function mkTmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeWorkbook(dir: string, filename: string): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('S1');
  ws.getCell('A1').value = 'A';
  ws.getCell('B1').value = 'B';
  const out = path.join(dir, filename);
  await wb.xlsx.writeFile(out);
  return out;
}

describe('xlsx2tex theme', () => {
  it('three_line theme 会暴露与原版兼容的 spacing 默认值', () => {
    const theme = getTheme('three_line');

    expect(theme.description).toContain('three-line');
    expect(theme.spacing).toEqual({
      tabcolsep: null,
      arraystretch: null,
      heavyrulewidth: '1.0pt',
      lightrulewidth: '0.5pt',
      arrayrulewidth: '0.5pt',
      aboverulesep: '0pt',
      belowrulesep: '0pt',
    });
  });

  it('listThemes 会包含 three_line', () => {
    expect(listThemes()).toEqual(['three_line']);
  });

  it('render 仍会从 theme 读取 captionPosition', () => {
    const tex = render({
      cells: [[{ value: 'A', style: {}, rowspan: 1, colspan: 1 }]],
      numRows: 1,
      numCols: 1,
      headerRows: 0,
      groupSeparators: {},
    }, {
      theme: 'three_line',
      caption: 'Caption from theme',
    });

    expect(tex).toContain('\\caption{Caption from theme}');
    expect(tex.indexOf('\\caption{Caption from theme}')).toBeLessThan(tex.indexOf('\\begin{tabular}{c}'));
  });

  it('默认 theme 为 three_line，默认会包含完整主题包提示', async () => {
    const dir = await mkTmpDir('pubtab-ts-theme-default-');
    const xlsxPath = await writeWorkbook(dir, 'input.xlsx');
    const outTex = path.join(dir, 'out.tex');

    const tex = await xlsx2tex(xlsxPath, outTex);

    expect(tex).toContain('% \\usepackage{booktabs}');
    expect(tex).toContain('% \\usepackage{multirow}');
    expect(tex).toContain('% \\usepackage[table]{xcolor}');
    expect(tex).toContain('% \\usepackage{diagbox}');
    expect(tex).toContain('% \\usepackage{makecell}');
    expect(tex).toContain('% \\usepackage{adjustbox}');
    expect(tex).toContain('% \\usepackage{amssymb}');
    expect(tex).toContain('% \\usepackage{pifont}');
  });

  it('主题配置来自迁移过来的原版 config.yaml', () => {
    const theme = getTheme('three_line');

    expect(theme.name).toBe('three_line');
    expect(theme.packages).toEqual([
      'booktabs',
      'multirow',
      'xcolor',
      'diagbox',
      'makecell',
      'adjustbox',
      'amssymb',
      'pifont',
    ]);
  });
});
