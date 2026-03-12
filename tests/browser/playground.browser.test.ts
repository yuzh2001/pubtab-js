import { expect, test } from 'vitest';

import { mountApp } from '../../playground/main.ts';
import { browserFixtures, loadFixtureXlsx } from './fixtures.js';

async function uploadFile(input: HTMLInputElement, file: File): Promise<void> {
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [file],
  });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 50));
}

test('playground: xlsx -> tex 可以渲染文本输出、表格预览和合并单元格', async () => {
  document.body.innerHTML = '<div id="app"></div>';
  mountApp('#app');

  const input = document.querySelector('[data-testid="file-input"]') as HTMLInputElement;
  const buffer = await loadFixtureXlsx(browserFixtures.table4XlsxPath);
  const file = new File([buffer], 'table4.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  await uploadFile(input, file);

  const tex = document.querySelector('[data-testid="tex-output"]');
  const table = document.querySelector('[data-testid="result-table"]');
  const summary = document.querySelector('[data-testid="summary"]');
  const mergedHeader = Array.from(document.querySelectorAll('[data-testid="result-table"] th'))
    .find((cell) => cell.textContent?.includes('Models / Datasets')) as HTMLTableCellElement | undefined;

  expect(tex?.textContent).toContain('\\begin{tabular}');
  expect(table).toBeTruthy();
  expect(summary?.textContent).toContain('Rows');
  expect(mergedHeader).toBeTruthy();
  expect(mergedHeader?.getAttribute('rowspan')).toBe('3');
  expect(mergedHeader?.getAttribute('colspan')).toBe('2');
});

test('playground: tex -> xlsx 可以产出下载链接和结构预览', async () => {
  document.body.innerHTML = '<div id="app"></div>';
  mountApp('#app');

  const mode = document.querySelector('[data-testid="mode-select"]') as HTMLSelectElement;
  mode.value = 'tex-to-xlsx';
  mode.dispatchEvent(new Event('change', { bubbles: true }));

  const input = document.querySelector('[data-testid="file-input"]') as HTMLInputElement;
  const file = new File([browserFixtures.table1Tex], 'table1.tex', { type: 'text/plain' });

  await uploadFile(input, file);

  const link = document.querySelector('[data-testid="download-link"]') as HTMLAnchorElement | null;
  const json = document.querySelector('[data-testid="result-json"]');

  expect(link?.getAttribute('download')).toBe('table1.xlsx');
  expect(link?.href.startsWith('blob:')).toBe(true);
  expect(json?.textContent).toContain('"columns"');
});
