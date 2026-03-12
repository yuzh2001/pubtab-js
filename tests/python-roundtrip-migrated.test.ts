import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import ExcelJS from 'exceljs';

import {
  readExcel,
  readTex,
  render,
  xlsx2tex,
  texToExcel,
} from '../src/index.js';

function toPlain(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

async function mkTmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function compareWorkbookValues(pathA: string, pathB: string): Promise<Array<[number, number, unknown, unknown]>> {
  const wb1 = new ExcelJS.Workbook();
  const wb2 = new ExcelJS.Workbook();
  await wb1.xlsx.readFile(pathA);
  await wb2.xlsx.readFile(pathB);

  const ws1 = wb1.getWorksheet(1) ?? wb1.worksheets[0];
  const ws2 = wb2.getWorksheet(1) ?? wb2.worksheets[0];

  const maxR = Math.max(ws1?.actualRowCount ?? 0, ws2?.actualRowCount ?? 0);
  const maxC = Math.max(ws1?.actualColumnCount ?? 0, ws2?.actualColumnCount ?? 0);
  const diffs: Array<[number, number, unknown, unknown]> = [];

  for (let r = 1; r <= maxR; r += 1) {
    for (let c = 1; c <= maxC; c += 1) {
      const v1 = ws1?.getCell(r, c).value;
      const v2 = ws2?.getCell(r, c).value;
      const s1 = toPlain(v1);
      const s2 = toPlain(v2);
      const n1 = Number(s1);
      const n2 = Number(s2);
      if (Number.isFinite(n1) && Number.isFinite(n2) && !Number.isNaN(n1) && !Number.isNaN(n2)) {
        if (Math.abs(n1 - n2) < 1e-9) continue;
      }
      if (s1 !== s2) diffs.push([r, c, v1, v2]);
    }
  }

  return diffs;
}

const FIXTURES = path.resolve('tests/fixtures');
const TABLES = ['table1', 'table2', 'table3', 'table4', 'table5', 'table6', 'table8'];

function tableFromFixture(name: string): { tex: string; xlsx: string } {
  return {
    tex: path.join(FIXTURES, `${name}.tex`),
    xlsx: path.join(FIXTURES, `${name}.xlsx`),
  };
}

describe('migrated python: round-trip tests', () => {
  describe('tex to xlsx round-trip', () => {
    it.each(TABLES)('test_tex_to_xlsx_dimensions: %s', async (name) => {
      const { tex, xlsx } = tableFromFixture(name);
      const dir = await mkTmpDir('pubtab-ts-migrate-tex2xlsx-');
      const outPath = path.join(dir, `${name}.xlsx`);

      await texToExcel(tex, outPath);

      const wbOrig = new ExcelJS.Workbook();
      const wbGen = new ExcelJS.Workbook();
      await wbOrig.xlsx.readFile(xlsx);
      await wbGen.xlsx.readFile(outPath);

      expect(wbGen.getWorksheet(1)?.actualRowCount).toBe(wbOrig.getWorksheet(1)?.actualRowCount);
      expect(wbGen.getWorksheet(1)?.actualColumnCount).toBe(wbOrig.getWorksheet(1)?.actualColumnCount);
    });

    it.each(TABLES)('test_tex_to_xlsx_values_match: %s', async (name) => {
      const { tex, xlsx } = tableFromFixture(name);
      const dir = await mkTmpDir('pubtab-ts-migrate-tex2xlsx-');
      const outPath = path.join(dir, `${name}.xlsx`);

      await texToExcel(tex, outPath);
      const diffs = await compareWorkbookValues(xlsx, outPath);
      expect(diffs).toEqual([]);
    });

    it.each(TABLES)('test_tex_to_xlsx_merged_cells: %s', async (name) => {
      const { tex, xlsx } = tableFromFixture(name);
      const dir = await mkTmpDir('pubtab-ts-migrate-tex2xlsx-');
      const outPath = path.join(dir, `${name}.xlsx`);

      await texToExcel(tex, outPath);

      const wbOrig = new ExcelJS.Workbook();
      const wbGen = new ExcelJS.Workbook();
      await wbOrig.xlsx.readFile(xlsx);
      await wbGen.xlsx.readFile(outPath);
      const wsOrig = wbOrig.getWorksheet(1) ?? wbOrig.worksheets[0];
      const wsGen = wbGen.getWorksheet(1) ?? wbGen.worksheets[0];

      const mergesGen = (wsGen?.model as { merges?: unknown[] } | undefined)?.merges;
      const mergesOrig = (wsOrig?.model as { merges?: unknown[] } | undefined)?.merges;
      expect(Array.isArray(mergesGen)).toBe(true);
      expect(Array.isArray(mergesOrig)).toBe(true);
      expect((mergesGen?.length ?? 0)).toBe(mergesOrig?.length ?? 0);
    });
  });

  describe('xlsx to tex to xlsx', () => {
    it.each(TABLES)('test_xlsx_to_tex_roundtrip: %s', async (name) => {
      const { xlsx } = tableFromFixture(name);
      const dir = await mkTmpDir('pubtab-ts-migrate-xlsx2xlsx-');
      const texPath = path.join(dir, `${name}.tex`);
      const outXlsx = path.join(dir, `${name}_rt.xlsx`);

      await xlsx2tex(xlsx, texPath);
      await texToExcel(texPath, outXlsx);

      const tableOrig = await readExcel(xlsx);
      const tableGen = readTex(await fs.readFile(texPath, 'utf8'));
      expect(tableGen.numRows).toBe(tableOrig.numRows);
      expect(tableGen.numCols).toBe(tableOrig.numCols);
    });
  });

  describe('xlsx2tex CLI behavior', () => {
    it('test_xlsx2tex_default_exports_all_sheets', async () => {
      const dir = await mkTmpDir('pubtab-ts-migrate-all-sheets-');
      const wb = new ExcelJS.Workbook();
      const ws1 = wb.addWorksheet('Main Sheet');
      const ws2 = wb.addWorksheet('Aux-2');
      ws1.getCell('A1').value = 'MAINCELL';
      ws2.getCell('A1').value = 'AUXCELL';

      const xlsxPath = path.join(dir, 'multi.xlsx');
      await wb.xlsx.writeFile(xlsxPath);

      const out = path.join(dir, 'multi.tex');
      await xlsx2tex(xlsxPath, out);

      const generated = (await fs.readdir(dir)).filter((f) => f.startsWith('multi_sheet') && f.endsWith('.tex')).sort();
      expect(generated).toHaveLength(2);
      expect(generated[0]).toBe('multi_sheet01.tex');
      expect(generated[1]).toBe('multi_sheet02.tex');
      const first = await fs.readFile(path.join(dir, generated[0]), 'utf8');
      const second = await fs.readFile(path.join(dir, generated[1]), 'utf8');
      expect(first).toContain('MAINCELL');
      expect(second).toContain('AUXCELL');
    });

    it('test_xlsx2tex_sheet_option_exports_single_sheet', async () => {
      const dir = await mkTmpDir('pubtab-ts-migrate-single-sheet-');
      const wb = new ExcelJS.Workbook();
      const ws1 = wb.addWorksheet('Main Sheet');
      const ws2 = wb.addWorksheet('Aux-2');
      ws1.getCell('A1').value = 'MAINCELL';
      ws2.getCell('A1').value = 'AUXCELL';

      const xlsxPath = path.join(dir, 'single.xlsx');
      await wb.xlsx.writeFile(xlsxPath);

      const out = path.join(dir, 'single.tex');
      await xlsx2tex(xlsxPath, out, { sheet: 'Aux-2' });

      const generated = (await fs.readdir(dir)).filter((f) => f.startsWith('single') && f.endsWith('.tex')).sort();
      expect(generated).toEqual(['single.tex']);
      const text = await fs.readFile(out, 'utf8');
      expect(text).toContain('AUXCELL');
      expect(text).not.toContain('MAINCELL');
    });

    it('test_xlsx2tex_directory_input_exports_all_workbooks', async () => {
      const inDir = await mkTmpDir('pubtab-ts-migrate-in-');
      const outDir = path.join(inDir, 'tex_out');
      await fs.mkdir(outDir);

      const wb1 = new ExcelJS.Workbook();
      wb1.addWorksheet().getCell('A1').value = 'ONE';
      await wb1.xlsx.writeFile(path.join(inDir, 'a.xlsx'));

      const wb2 = new ExcelJS.Workbook();
      wb2.addWorksheet().getCell('A1').value = 'TWO';
      await wb2.xlsx.writeFile(path.join(inDir, 'b.xlsx'));

      await xlsx2tex(inDir, outDir);
      expect(await fs.readFile(path.join(outDir, 'a.tex'), 'utf8')).toContain('ONE');
      expect(await fs.readFile(path.join(outDir, 'b.tex'), 'utf8')).toContain('TWO');
      const a = await fs.readFile(path.join(outDir, 'a.tex'), 'utf8');
      const b = await fs.readFile(path.join(outDir, 'b.tex'), 'utf8');
      expect(a).toContain('ONE');
      expect(b).toContain('TWO');
    });

    it('test_xlsx2tex_directory_input_requires_output_directory', async () => {
      const inDir = await mkTmpDir('pubtab-ts-migrate-in-err-');
      const outTex = path.join(inDir, 'batch.tex');
      const wb = new ExcelJS.Workbook();
      wb.addWorksheet().getCell('A1').value = 'X';
      await wb.xlsx.writeFile(path.join(inDir, 'a.xlsx'));
      await expect(xlsx2tex(inDir, outTex)).rejects.toThrow(/output must be a directory/);
    });

    it('test_xlsx2tex_includes_commented_package_hints', async () => {
      const dir = await mkTmpDir('pubtab-ts-migrate-pkg-');
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet();
      ws.getCell('A1').value = 'Header';
      ws.getCell('A2').value = 'Value';
      const xlsxPath = path.join(dir, 'pkg_hint.xlsx');
      await wb.xlsx.writeFile(xlsxPath);

      const out = path.join(dir, 'pkg_hint.tex');
      await xlsx2tex(xlsxPath, out);
      const text = await fs.readFile(out, 'utf8');
      expect(text.startsWith('% Theme package hints for this table')).toBe(true);
      expect(text).toContain('% \\usepackage{booktabs}');
      expect(text).toContain('% \\usepackage{multirow}');
      expect(text).toContain('% \\usepackage[table]{xcolor}');
    });

    it('test_xlsx2tex_package_hints_include_graphicx_when_resizebox_enabled', async () => {
      const dir = await mkTmpDir('pubtab-ts-migrate-gfx-');
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet();
      ws.getCell('A1').value = 'H';
      ws.getCell('A2').value = 'V';
      const xlsxPath = path.join(dir, 'pkg_hint_graphicx.xlsx');
      await wb.xlsx.writeFile(xlsxPath);

      const out = path.join(dir, 'pkg_hint_graphicx.tex');
      await xlsx2tex(xlsxPath, out, { resizebox: '0.8\\textwidth' });
      const text = await fs.readFile(out, 'utf8');
      expect(text).toContain('% \\usepackage{graphicx}');
    });
  });

  describe('tex2xlsx behavior', () => {
    it('test_tex2xlsx_directory_input_exports_all_tex_files', async () => {
      const inDir = await mkTmpDir('pubtab-ts-migrate-tex-in-');
      const outDir = path.join(inDir, 'xlsx_out');
      await fs.mkdir(outDir);
      const tex = [
        '\\begin{tabular}{cc}',
        '\\toprule',
        'A & B \\\\',
        '\\midrule',
        '1 & 2 \\\\',
        '\\bottomrule',
        '\\end{tabular}',
        '',
      ].join('\n');
      await fs.writeFile(path.join(inDir, 'a.tex'), tex, 'utf8');
      await fs.writeFile(path.join(inDir, 'b.tex'), tex.replace('1 & 2', '3 & 4'), 'utf8');

      await texToExcel(inDir, outDir);

      const aXlsx = path.join(outDir, 'a.xlsx');
      const bXlsx = path.join(outDir, 'b.xlsx');
      expect(await fs.access(aXlsx).then(() => true)).toBe(true);
      expect(await fs.access(bXlsx).then(() => true)).toBe(true);

      const wbA = new ExcelJS.Workbook();
      const wbB = new ExcelJS.Workbook();
      await wbA.xlsx.readFile(aXlsx);
      await wbB.xlsx.readFile(bXlsx);
      expect(wbA.getWorksheet(1)?.getCell('A2').value).toBe(1);
      expect(wbB.getWorksheet(1)?.getCell('A2').value).toBe(3);
    });

    it('test_tex2xlsx_directory_input_requires_output_directory', async () => {
      const inDir = await mkTmpDir('pubtab-ts-migrate-tex-dir-');
      const out = path.join(inDir, 'batch.xlsx');
      await fs.mkdir(inDir, { recursive: true });
      await fs.writeFile(
        path.join(inDir, 'a.tex'),
        '\\begin{tabular}{c}\\toprule A \\\\ \\bottomrule\\end{tabular}',
        'utf8',
      );
      await expect(texToExcel(inDir, out)).rejects.toThrow(/output must be a directory/);
    });
  });

  describe('read_excel behavior', () => {
    it('test_read_excel_trims_only_trailing_empty_columns', async () => {
      const dir = await mkTmpDir('pubtab-ts-migrate-trim-cols-');
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet();
      ws.getCell('A1').value = 'H1';
      ws.getCell('B1').value = '';
      ws.getCell('C1').value = 'H3';
      ws.getCell('A2').value = 'v1';
      ws.getCell('C2').value = 'v3';
      ws.getCell('D1').value = '';
      ws.getCell('E1').value = '';
      const xlsxPath = path.join(dir, 'trim_cols.xlsx');
      await wb.xlsx.writeFile(xlsxPath);

      const table = await readExcel(xlsxPath);
      expect(table.numCols).toBe(3);
      expect(table.cells[0][1].value).toBe('');
    });

    it('test_read_excel_trims_trailing_columns_even_with_wide_merged_title', async () => {
      const dir = await mkTmpDir('pubtab-ts-migrate-trim-merge-');
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet();
      ws.getCell('A1').value = 'Title';
      ws.mergeCells('A1:E1');
      ws.getCell('A2').value = 'Method';
      ws.getCell('B2').value = 'Score';
      ws.getCell('A3').value = 'M1';
      ws.getCell('B3').value = '0.95';
      const xlsxPath = path.join(dir, 'trim_with_merge.xlsx');
      await wb.xlsx.writeFile(xlsxPath);

      const table = await readExcel(xlsxPath);
      expect(table.numCols).toBe(2);
      expect(table.cells[0][0].colspan).toBe(2);
    });
  });

  describe('tex_reader', () => {
    it('test_tex_reader_comments', () => {
      const tex = String.raw`
\begin{tabular}{cc}
\toprule
A & B \\ % header comment
\midrule
1 & 2 \\ % data comment
\bottomrule
\end{tabular}
`;
      const table = readTex(tex);
      expect(table.numRows).toBe(2);
      expect(table.cells[1][0].value).toBe(1);
    });

    it('test_tex_reader_multicolumn', () => {
      const tex = String.raw`
\begin{tabular}{ccc}
\toprule
\multicolumn{2}{c}{Header} & C \\
\midrule
a & b & c \\
\bottomrule
\end{tabular}
`;
      const table = readTex(tex);
      expect(table.cells[0][0].colspan).toBe(2);
      expect(table.cells[0][0].value).toBe('Header');
    });

    it('test_tex_reader_multirow', () => {
      const tex = String.raw`
\begin{tabular}{cc}
\toprule
\multirow{2}{*}{A} & B \\
 & C \\
\bottomrule
\end{tabular}
`;
      const table = readTex(tex);
      expect(table.cells[0][0].rowspan).toBe(2);
    });

    it('test_tex_reader_diagbox', () => {
      const tex = String.raw`
\begin{tabular}{cc}
\toprule
\diagbox{Row}{Col} & Data \\
\midrule
a & 1 \\
\bottomrule
\end{tabular}
`;
      const table = readTex(tex);
      expect(table.cells[0][0].style.diagbox).toEqual(['Row', 'Col']);
    });

    it('test_tex_reader_formatting', () => {
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

    it('test_tex_reader_math_cleanup', () => {
      const tex = String.raw`
\begin{tabular}{c}
\toprule
$D_\text{stage 1}$ \\
\bottomrule
\end{tabular}
`;
      const table = readTex(tex);
      expect(table.cells[0][0].value).toBe('D_stage 1');
    });

    it('test_tex_reader_pm_spacing', () => {
      const tex = String.raw`
\begin{tabular}{c}
\toprule
0.626 {$\pm$0.018} \\
\bottomrule
\end{tabular}
`;
      const table = readTex(tex);
      expect(String(table.cells[0][0].value)).toContain('0.626±0.018');
    });

    it('test_tex_reader_makecell_hyphen_linebreak_preserved', () => {
      const tex = String.raw`
\begin{tabular}{c}
\toprule
\makecell{Things-\\EEG} \\
\bottomrule
\end{tabular}
`;
      const table = readTex(tex);
      expect(table.cells[0][0].value).toBe('Things-\nEEG');
    });

    it('test_tex_reader_malformed_double_backslash_percent_does_not_split_row', () => {
      const tex = String.raw`
\begin{tabular}{cccc}
\toprule
Model & Chat & Delta & Score \\
\midrule
M1 & 68.2 & 27.0\\% & 83.2 \\
\bottomrule
\end{tabular}
`;
      const table = readTex(tex);
      expect(table.numRows).toBe(2);
      expect(table.cells[1][2].value).toBe('27.0%');
    });

    it('test_tex_reader_malformed_double_backslash_percent_keeps_header_cell', () => {
      const tex = String.raw`
\begin{tabular}{ccc}
\toprule
Metric & \\% Diff & Score \\
\midrule
M1 & 2.4\\% & 88.0 \\
\bottomrule
\end{tabular}
`;
      const table = readTex(tex);
      expect(table.numRows).toBe(2);
      expect(table.cells[0][1].value).toBe('% Diff');
      expect(table.cells[1][1].value).toBe('2.4%');
    });

    it('test_tex_reader_malformed_double_backslash_hash_keeps_header', () => {
      const tex = String.raw`
\begin{tabular}{ccc}
\toprule
Depth & \\#P (M) & Score \\
\midrule
18 & 11.23 & 86.41 \\
\bottomrule
\end{tabular}
`;
      const table = readTex(tex);
      expect(table.numRows).toBe(2);
      expect(table.cells[0][1].value).toBe('#P (M)');
    });

    it('test_tex_reader_rowbreak_followed_by_hash_is_not_collapsed', () => {
      const tex = String.raw`
\begin{tabular}{cc}
\toprule
A & B \\
\midrule
v1 & v2\\#Tag & 1 \\
\bottomrule
\end{tabular}
`;
      const table = readTex(tex);
      expect(table.numRows).toBe(3);
      expect(table.cells[1][0].value).toBe('v1');
      expect(table.cells[2][0].value).toBe('#Tag');
    });

    it('test_tex_reader_rowbreak_followed_by_percent_is_not_collapsed', () => {
      const tex = String.raw`
\begin{tabular}{cc}
\toprule
A & B \\
\midrule
v1 & v2\\%Tag & 1 \\
\bottomrule
\end{tabular}
`;
      const table = readTex(tex);
      expect(table.numRows).toBe(3);
      expect(table.cells[1][0].value).toBe('v1');
      expect(table.cells[2][0].value).toBe('%Tag');
    });

    it('test_tex_reader_malformed_double_backslash_ampersand_keeps_single_row', () => {
      const tex = String.raw`
\begin{tabular}{ccc}
\toprule
Method & Input & Score \\
\midrule
OpenOcc & C\\&L & 70.59 \\
\bottomrule
\end{tabular}
`;
      const table = readTex(tex);
      expect(table.numRows).toBe(2);
      expect(table.cells[1][1].value).toBe('C&L');
      expect(table.cells[1][2].value).toBe(70.59);
    });

    it('test_tex_reader_all_delimiters_escaped_as_ampersand_are_recovered', () => {
      const tex = String.raw`
\begin{tabular}{ccc}
\toprule
A \& B \& C \\
\bottomrule
\end{tabular}
`;
      const table = readTex(tex);
      expect(table.numRows).toBe(1);
      expect(table.numCols).toBe(3);
      expect(table.cells[0][0].value).toBe('A');
      expect(table.cells[0][1].value).toBe('B');
      expect(table.cells[0][2].value).toBe('C');
    });

    it('test_tex_reader_rowbreak_followed_by_ampersand_is_not_collapsed', () => {
      const tex = String.raw`
\begin{tabular}{ccc}
\toprule
M & NQ & ARC-C \\
\midrule
\multirow{2}{*}{Ours(Yi-6B)} & 23.28 & 76.54\\&(\textcolor{green}{+0.73})&(\textcolor{green}{+3.33}) \\
\bottomrule
\end{tabular}
`;
      const table = readTex(tex);
      expect(table.numRows).toBe(3);
      expect(table.cells[1][2].value).toBe(76.54);
      expect(table.cells[2][1].value).toBe('(+0.73)');
      expect(table.cells[2][2].value).toBe('(+3.33)');
    });

    it('test_tex_reader_triple_backslash_rule_commands_not_leaked', () => {
      const tex = String.raw`
\begin{tabular}{ll}
\toprule
A & B \\\hline
C & D \\\cline{1-2}
E & F \\\bottomrule[0.8pt]
\end{tabular}
`;
      const table = readTex(tex);
      const values = table.cells.flat().map((c) => String(c.value).trim()).filter(Boolean);
      const joined = values.join(' | ').toLowerCase();
      expect(joined.includes('hline')).toBe(false);
      expect(joined.includes('cline')).toBe(false);
      expect(joined.includes('bottomrule')).toBe(false);
    });

    it('test_tex_reader_nested_makebox_cleans_to_content', () => {
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

    it('test_tex_reader_decorative_separator_block_is_removed', () => {
      const tex = String.raw`
\begin{tabular}{ll}
\toprule
Lang & Value \\
\midrule
English
-\/-\/-\/-\/-\/-\/-\/-
\multirow{2}{*}{English} & 1 \\
 & 2 \\
\bottomrule
\end{tabular}
`;
      const table = readTex(tex);
      expect(table.numRows).toBe(3);
      expect(table.cells[1][0].value).toBe('English');
      const values = table.cells.flat().map((c) => String(c.value));
      expect(values.some((v) => v.includes('-/-') || v.includes('---'))).toBe(false);
    });

    it('test_tex_reader_mixed_case_dvips_color_is_preserved', () => {
      const tex = String.raw`
\begin{tabular}{c}
\toprule
\makebox[1.25em][c]{{\color{Dandelion}\textbf{P}}}\quad/\quad\makebox[1.25em][c]{{\color{ForestGreen}\ding{52}}} \\
\bottomrule
\end{tabular}
`;
      const table = readTex(tex);
      const cell = table.cells[0][0];
      expect(cell.richSegments).not.toBeNull();
      expect(cell.richSegments?.[0]?.[0]).toBe('P');
      expect(cell.richSegments?.[0]?.[1]).toBe('#FDBC42');
    });

    it('test_tex_reader_inline_decorative_separator_is_removed', () => {
      const tex = String.raw`
\begin{tabular}{ll}
\toprule
Lang & Value \\
\midrule
Korean -\/-\/-\/-\/-\/-\/-\/-
\multirow{2}{*}{Korean} & 1 \\
 & 2 \\
\bottomrule
\end{tabular}
`;
      const table = readTex(tex);
      expect(table.numRows).toBe(3);
      expect(table.cells[1][0].value).toBe('Korean');
      const values = table.cells.flat().map((c) => String(c.value));
      expect(values.some((v) => v.includes('-/-') || v.includes('---'))).toBe(false);
    });

    it('test_tex_reader_rich_segments_do_not_leak_makecell_prefix', () => {
      const tex = String.raw`
\begin{tabular}{ll}
\toprule
Q & A \\
\midrule
Qwen2 response & \begin{tabular}[c]{@{}l@{}}He Ain't Heavy was written by \textcolor{red}{Mike D\'Abo}. \\ \cdots\end{tabular} \\
\bottomrule
\end{tabular}
`;
      const table = readTex(tex);
      const cell = table.cells[1][1];
      const asText = String(cell.value).toLowerCase();
      expect(asText.includes('makecell')).toBe(false);
      expect(cell.richSegments).not.toBeNull();
      expect(String(cell.richSegments?.[0]?.[0] ?? '').toLowerCase().includes('makecell')).toBe(false);
      expect(String(cell.richSegments?.[0]?.[0] ?? '')).toMatch(/\s$/);
    });

    it('test_tex_reader_infers_first_column_rowspan_from_blank_continuation_rows', () => {
      const tex = String.raw`
\begin{tabular}{ccc}
\toprule
Iter & Balls & Score \\
\midrule
1 & 5 & 0.1 \\
 & 15 & 0.2 \\
 & 30 & 0.3 \\
\hline
2 & 5 & 0.4 \\
 & 15 & 0.5 \\
 & 30 & 0.6 \\
\bottomrule
\end{tabular}
`;
      const table = readTex(tex);
      expect(table.cells[1][0].rowspan).toBe(3);
      expect(table.cells[4][0].rowspan).toBe(3);
      expect(table.cells[2][0].value).toBe('');
      expect(table.cells[3][0].value).toBe('');
      expect(table.cells[5][0].value).toBe('');
      expect(table.cells[6][0].value).toBe('');
    });

    it('test_tex_reader_preserves_middle_spacer_column', () => {
      const tex = String.raw`
\begin{tabular}{ccc}
\toprule
Left &  & Right \\
\midrule
L1 &  & R1 \\
\bottomrule
\end{tabular}
`;
      const table = readTex(tex);
      expect(table.numCols).toBe(3);
      expect(table.cells[0][1].value).toBe('');
      expect(table.cells[1][1].value).toBe('');
    });
  });

  describe('renderer', () => {
    it('test_render_three_line', () => {
      const table = {
        cells: [
          [
            { value: 'A', style: { bold: true }, rowspan: 1, colspan: 1 },
            { value: 'B', style: { bold: true }, rowspan: 1, colspan: 1 },
          ],
          [
            { value: 'x', style: {}, rowspan: 1, colspan: 1 },
            { value: 0.5, style: {}, rowspan: 1, colspan: 1 },
          ],
        ],
        numRows: 2,
        numCols: 2,
        headerRows: 1,
        groupSeparators: {},
      };
      const tex = render(table);
      expect(tex).toContain('\\toprule');
      expect(tex).toContain('\\midrule');
      expect(tex).toContain('\\bottomrule');
    });

    it('test_render_default_heavyrulewidth', () => {
      const table = {
        cells: [
          [
            { value: 'a', style: {}, rowspan: 1, colspan: 1 },
            { value: 'b', style: {}, rowspan: 1, colspan: 1 },
          ],
        ],
        numRows: 1,
        numCols: 2,
        headerRows: 0,
        groupSeparators: {},
      };
      const tex = render(table);
      expect(tex).toContain('\\heavyrulewidth');
      expect(tex).toContain('1.0pt');
    });

    it('test_render_section_row_midrules_when_section_not_in_first_column', () => {
      const table = {
        cells: [
          [{ value: 'Dataset', style: {}, rowspan: 1, colspan: 1 }, { value: 'Method', style: {}, rowspan: 1, colspan: 1 }, { value: 'Score', style: {}, rowspan: 1, colspan: 1 }],
          [{ value: '', style: {}, rowspan: 1, colspan: 1 }, { value: 'GPT-3.5', style: {}, rowspan: 1, colspan: 2 }, { value: '', style: {}, rowspan: 1, colspan: 1 }],
          [{ value: 'Popular', style: {}, rowspan: 1, colspan: 1 }, { value: 'Direct', style: {}, rowspan: 1, colspan: 1 }, { value: '3.67', style: {}, rowspan: 1, colspan: 1 }],
        ],
        numRows: 3,
        numCols: 3,
        headerRows: 1,
        groupSeparators: {},
      };
      const tex = render(table);
      expect((tex.match(/\\midrule/g) ?? []).length).toBeGreaterThanOrEqual(2);
    });

    it('test_render_section_row_uses_partial_rule_when_first_col_is_active_multirow', () => {
      const table = {
        cells: [
          [{ value: 'Dataset', style: {}, rowspan: 1, colspan: 1 }, { value: 'Method', style: {}, rowspan: 1, colspan: 1 }, { value: 'Score', style: {}, rowspan: 1, colspan: 1 }],
          [{ value: 'Popular', style: {}, rowspan: 4, colspan: 1 }, { value: 'GPT-3.5', style: {}, rowspan: 1, colspan: 2 }, { value: '', style: {}, rowspan: 1, colspan: 1 }],
          [{ value: '', style: {}, rowspan: 1, colspan: 1 }, { value: 'Direct', style: {}, rowspan: 1, colspan: 1 }, { value: '3.67', style: {}, rowspan: 1, colspan: 1 }],
          [{ value: '', style: {}, rowspan: 1, colspan: 1 }, { value: 'Llama3.1', style: {}, rowspan: 1, colspan: 2 }, { value: '', style: {}, rowspan: 1, colspan: 1 }],
          [{ value: '', style: {}, rowspan: 1, colspan: 1 }, { value: 'Direct', style: {}, rowspan: 1, colspan: 1 }, { value: '3.60', style: {}, rowspan: 1, colspan: 1 }],
        ],
        numRows: 5,
        numCols: 3,
        headerRows: 1,
        groupSeparators: {},
      };
      const tex = render(table);
      expect(tex).toContain('\\cmidrule(lr){2-3}');
    });

    it('test_render_unicode_subscript_keeps_text_base', () => {
      const table = {
        cells: [
          [{ value: 'DRF_θ', style: {}, rowspan: 1, colspan: 1 }, { value: 'F_θ', style: {}, rowspan: 1, colspan: 1 }],
        ],
        numRows: 1,
        numCols: 2,
        headerRows: 0,
        groupSeparators: {},
      };
      const tex = render(table);
      expect(tex).toContain('DRF\\$_{\\\\theta}');
      expect(tex).toContain('F\\$_{\\\\theta}');
    });

    it('test_render_special_chars', () => {
      const table = {
        cells: [[{ value: '100%', style: {}, rowspan: 1, colspan: 1 }, { value: 'A & B', style: {}, rowspan: 1, colspan: 1 }]],
        numRows: 1,
        numCols: 2,
        headerRows: 0,
        groupSeparators: {},
      };
      const tex = render(table);
      expect(tex).toContain('100\\%');
      expect(tex).toContain('A \\& B');
    });
  });
});
