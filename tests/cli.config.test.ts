import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import ExcelJS from 'exceljs';

import { runCli } from '../src/cli.js';
import { loadConfig } from '../src/config.js';

async function mkTmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeWorkbook(dir: string, filename: string, aa: string, bb: string): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const ws0 = wb.addWorksheet('S0');
  const ws1 = wb.addWorksheet('S1');
  ws0.getCell('A1').value = aa;
  ws1.getCell('A1').value = bb;
  const out = path.join(dir, filename);
  await wb.xlsx.writeFile(out);
  return out;
}

describe('CLI 配置迁移（xlsx2tex）', () => {
  it('loadConfig 会读取并规范化原版风格的嵌套 YAML', async () => {
    const dir = await mkTmpDir('pubtab-ts-cli-config-nested-');
    const cfgPath = path.join(dir, 'pubtab.yml');
    await fs.writeFile(
      cfgPath,
      [
        'theme: three_line',
        'header_rows: 2',
        'span_columns: true',
        'font_size: footnotesize',
        'col_spec: p{2cm}c',
        'spacing:',
        '  tabcolsep: 2.4pt',
        '  arraystretch: 1.0',
        '  heavyrulewidth: 1.2pt',
      ].join('\n'),
      'utf8',
    );

    const [cfg] = await loadConfig(cfgPath);

    expect(cfg).toEqual({
      theme: 'three_line',
      headerRows: 2,
      spanColumns: true,
      fontSize: 'footnotesize',
      colSpec: 'p{2cm}c',
      spacing: {
        tabcolsep: '2.4pt',
        arraystretch: '1.0',
        heavyrulewidth: '1.2pt',
      },
    });
  });

  it('loadConfig 会把 header_sep YAML 数组规范化为 headerSep 字符串数组', async () => {
    const dir = await mkTmpDir('pubtab-ts-cli-config-header-sep-');
    const cfgPath = path.join(dir, 'pubtab.yml');
    await fs.writeFile(
      cfgPath,
      [
        'header_sep:',
        '  - \\cmidrule(lr){1-2}',
        '  - \\midrule',
      ].join('\n'),
      'utf8',
    );

    const [cfg] = await loadConfig(cfgPath);

    expect(cfg).toEqual({
      headerSep: ['\\cmidrule(lr){1-2}', '\\midrule'],
    });
  });

  it('从 --config 读取 xlsx2tex 选项', async () => {
    const dir = await mkTmpDir('pubtab-ts-cli-config-');
    const xlsxPath = await writeWorkbook(dir, 'tables.xlsx', 'MAIN', 'AUX');
    const outPath = path.join(dir, 'out.tex');
    const cfgPath = path.join(dir, 'pubtab.yml');
    const cfg = [
      'sheet: 1',
      'caption: Config Caption',
      'label: "tab:cfg"',
    ].join('\n');
    await fs.writeFile(cfgPath, cfg, 'utf8');

    const code = await runCli(['node', 'pubtab-js', 'xlsx2tex', xlsxPath, outPath, '--config', cfgPath]);
    expect(code).toBe(0);
    const tex = await fs.readFile(outPath, 'utf8');
    expect(tex).toContain('\\caption{Config Caption}');
    expect(tex).toContain('\\label{tab:cfg}');
    expect(tex).toContain('AUX');
    expect(tex).not.toContain('MAIN');
  });

  it('CLI 显式参数覆盖 config 文件中的同名选项', async () => {
    const dir = await mkTmpDir('pubtab-ts-cli-config-overrides-');
    const xlsxPath = await writeWorkbook(dir, 'tables.xlsx', 'ROW-HEAD', 'ROW2');
    const outPath = path.join(dir, 'out.tex');
    const cfgPath = path.join(dir, 'pubtab.yml');
    await fs.writeFile(
      cfgPath,
      [
        'caption: Config Caption',
        'label: tab:cfg',
        'sheet: 1',
      ].join('\n'),
      'utf8',
    );

    const code = await runCli([
      'node',
      'pubtab-js',
      'xlsx2tex',
      xlsxPath,
      outPath,
      '--config',
      cfgPath,
      '--caption',
      'CLI Caption',
    ]);
    expect(code).toBe(0);
    const tex = await fs.readFile(outPath, 'utf8');
    expect(tex).toContain('\\caption{CLI Caption}');
    expect(tex).not.toContain('\\caption{Config Caption}');
    expect(tex).toContain('\\label{tab:cfg}');
    expect(tex).toContain('ROW2');
  });

  it('CLI 显式 theme 覆盖 config 文件中的同名选项', async () => {
    const dir = await mkTmpDir('pubtab-ts-cli-config-theme-');
    const xlsxPath = await writeWorkbook(dir, 'tables.xlsx', 'A', 'B');
    const outPath = path.join(dir, 'out.tex');
    const cfgPath = path.join(dir, 'pubtab.yml');
    await fs.writeFile(
      cfgPath,
      [
        'theme: not-exist-theme',
      ].join('\n'),
      'utf8',
    );

    const code = await runCli([
      'node',
      'pubtab-js',
      'xlsx2tex',
      xlsxPath,
      outPath,
      '--config',
      cfgPath,
      '--sheet',
      '1',
      '--theme',
      'three_line',
    ]);
    expect(code).toBe(0);
    const tex = await fs.readFile(outPath, 'utf8');
    expect(tex).toContain('% \\usepackage{diagbox}');
    expect(tex).toContain('% \\usepackage{makecell}');
  });

  it('无效 theme 会导致 CLI 失败', async () => {
    const dir = await mkTmpDir('pubtab-ts-cli-invalid-theme-');
    const xlsxPath = await writeWorkbook(dir, 'tables.xlsx', 'A', 'B');
    const outPath = path.join(dir, 'out.tex');

    const code = await runCli([
      'node',
      'pubtab-js',
      'xlsx2tex',
      xlsxPath,
      outPath,
      '--sheet',
      '1',
      '--theme',
      'not-exist-theme',
    ]);
    expect(code).toBe(2);
  });

  it('无效配置文件会导致 CLI 失败', async () => {
    const dir = await mkTmpDir('pubtab-ts-cli-config-invalid-');
    const xlsxPath = await writeWorkbook(dir, 'tables.xlsx', 'X', 'Y');
    const outPath = path.join(dir, 'out.tex');
    const cfgPath = path.join(dir, 'pubtab.yml');
    await fs.writeFile(cfgPath, ':::', 'utf8');

    const code = await runCli(['node', 'pubtab-js', 'xlsx2tex', xlsxPath, outPath, '--config', cfgPath]);
    expect(code).toBe(2);
  });
});
