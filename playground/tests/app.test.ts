import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

function run(command: string, args: string[], cwd: string): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('close', (code) => {
      resolve({ code, stderr });
    });
  });
}

describe('playground app', () => {
  it('生产构建产物包含真实合并单元格预览入口', async () => {
    const repoRoot = path.resolve(import.meta.dirname, '..', '..');
    const distDir = path.resolve(repoRoot, 'dist-playground');
    const result = await run('pnpm', ['build:playground'], repoRoot);

    expect(result.code, result.stderr).toBe(0);

    const indexHtml = await readFile(path.join(distDir, 'index.html'), 'utf8');
    const assets = await readdir(path.join(distDir, 'assets'));
    const jsAsset = assets.find((file) => file.endsWith('.js'));

    expect(indexHtml).toContain('/assets/');
    expect(jsAsset).toBeTruthy();

    const bundle = await readFile(path.join(distDir, 'assets', jsAsset!), 'utf8');
    expect(bundle).toContain('result-table');
    expect(bundle).toContain('Leaf Columns');
    expect(bundle).toContain('Download ');
    expect(bundle).toContain('tex-input');
    expect(bundle).toContain('Convert TeX Text');
  });
});
