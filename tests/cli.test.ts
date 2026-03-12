import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import ExcelJS from 'exceljs';

import { runCli } from '../src/cli.js';

async function mkTmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pubtab-js cli', () => {
  it('runCli: xlsx2tex 能生成 tex 文件', async () => {
    const dir = await mkTmpDir('pubtab-ts-cli-');
    const xlsxPath = path.join(dir, 'one.xlsx');
    const outTex = path.join(dir, 'out.tex');

    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('S1').getCell('A1').value = 'ONLY';
    await wb.xlsx.writeFile(xlsxPath);

    const code = await runCli(['node', 'pubtab-js', 'xlsx2tex', xlsxPath, outTex], dir);
    expect(code).toBe(0);

    const tex = await fs.readFile(outTex, 'utf8');
    expect(tex).toContain('ONLY');
  });

  it('runCli: 参数错误时返回非 0', async () => {
    const dir = await mkTmpDir('pubtab-ts-cli-');
    const code = await runCli(['node', 'pubtab-js', 'xlsx2tex'], dir);
    expect(code).not.toBe(0);
  });

  it('runCli: --help 返回 0 且帮助文案使用 pubtab-js', async () => {
    const dir = await mkTmpDir('pubtab-ts-cli-');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    const code = await runCli(['node', 'pubtab-js', '--help'], dir);

    expect(code).toBe(0);
    expect(log).toHaveBeenCalled();
    expect(log.mock.calls[0]?.[0]).toContain('pubtab-js xlsx2tex');
    expect(log.mock.calls[0]?.[0]).not.toContain('pubtab-node xlsx2tex');
  });
});
