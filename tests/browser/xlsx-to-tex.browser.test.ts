import { describe, expect, it } from 'vitest';

import { readTex } from '../../src/index.js';
import { xlsxBufferToTex, xlsxToTableResult } from '../../src/browser.js';
import { browserFixtures, loadFixtureXlsx } from './fixtures.js';

describe('browser fixture: xlsx -> tex', () => {
  it('table1 fixture 可以在浏览器路径下转成 tex 和结构结果', async () => {
    const buffer = await loadFixtureXlsx(browserFixtures.table1XlsxPath);

    const tex = await xlsxBufferToTex(buffer, { headerRows: 'auto' });
    const table = await xlsxToTableResult(buffer, { headerRows: 'auto' });
    const parsed = readTex(tex);

    expect(tex).toContain('\\begin{tabular}');
    expect(parsed.numRows).toBeGreaterThan(0);
    expect(parsed.numCols).toBeGreaterThan(0);
    expect(table.columns.length).toBe(parsed.numCols);
    expect(table.rows.length).toBe(parsed.numRows);
    expect(table.spans.length).toBeGreaterThanOrEqual(0);
  });
});
