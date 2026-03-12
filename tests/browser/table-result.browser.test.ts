import { describe, expect, it } from 'vitest';

import { texToTableResult, xlsxToTableResult } from '../../src/browser.js';
import { browserFixtures, loadFixtureXlsx } from './fixtures.js';

describe('browser fixture: table result', () => {
  it('xlsx 结果包含前端可消费的列、行、grid、spans', async () => {
    const buffer = await loadFixtureXlsx(browserFixtures.table4XlsxPath);
    const result = await xlsxToTableResult(buffer, { headerRows: 'auto' });

    expect(result.columns.length).toBeGreaterThan(0);
    expect(result.rows.length).toBe(result.table.numRows);
    expect(result.grid.length).toBe(result.rows.length);
    expect(result.headerRows.length).toBe(result.table.headerRows);
    expect(result.bodyRows.length).toBe(result.rows.length - result.headerRows.length);
  });

  it('tex 结果保留单元格文本、section 和 span 原点信息', async () => {
    const result = await texToTableResult(browserFixtures.table1Tex);
    const first = result.rows[0]?.cells[0];

    expect(first).toBeTruthy();
    expect(first.section).toBe('header');
    expect(typeof first.text).toBe('string');
    expect(first.originRowIndex).toBe(0);
    expect(first.originColIndex).toBe(0);
  });
});
