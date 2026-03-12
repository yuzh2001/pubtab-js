import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';

import { texToTableResult, texToXlsx, texToXlsxBuffer } from '../../src/browser.js';
import { browserFixtures } from './fixtures.js';

describe('browser fixture: tex -> xlsx', () => {
  it('table4 fixture 可以在浏览器路径下转成 xlsx 和结构结果', async () => {
    const tex = browserFixtures.table4Tex;

    const buffer = await texToXlsxBuffer(tex);
    const combined = await texToXlsx(tex, { filename: 'table4.xlsx' });
    const table = await texToTableResult(tex);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(new Uint8Array(buffer));
    const ws = wb.worksheets[0];

    expect(combined.filename).toBe('table4.xlsx');
    expect(combined.blob.size).toBeGreaterThan(0);
    expect(table.columns.length).toBeGreaterThan(0);
    expect(table.rows.length).toBeGreaterThan(0);
    expect(ws.rowCount).toBeGreaterThan(0);
    expect(ws.columnCount).toBeGreaterThan(0);
  });
});
