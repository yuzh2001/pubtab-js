import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';

import { tableFromWorksheet, workbookFromTable, tableToResult } from '../../src/index.js';

describe('core browser-safe helpers', () => {
  it('tableFromWorksheet: 读取 worksheet 为纯 TableData', () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');

    ws.getCell('A1').value = 'Group';
    ws.getCell('A2').value = 'Sub';
    ws.getCell('B2').value = 'Value';
    ws.mergeCells('A1:B1');
    ws.getCell('B3').value = 42;
    ws.getCell('B3').font = { bold: true, color: { argb: 'FFFF0000' } };

    const table = tableFromWorksheet(ws, { headerRows: 2 });

    expect(table.numRows).toBe(3);
    expect(table.numCols).toBe(2);
    expect(table.headerRows).toBe(2);
    expect(table.cells[0][0].colspan).toBe(2);
    expect(table.cells[2][1].style.bold).toBe(true);
    expect(table.cells[2][1].style.color).toBe('#FF0000');
  });

  it('workbookFromTable: 从 TableData 写回 workbook', () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.getCell('A1').value = 'Top';
    ws.getCell('A1').alignment = { textRotation: 90 };
    ws.getCell('B2').value = 'Body';
    ws.mergeCells('A1:B1');

    const table = tableFromWorksheet(ws, { headerRows: 'auto' });
    const generated = workbookFromTable(table);
    const outSheet = generated.worksheets[0];

    expect(outSheet.getCell('A1').value).toBe('Top');
    expect(outSheet.getCell('A1').alignment?.textRotation).toBe(90);
    expect(outSheet.getCell('B2').value).toBe('Body');
    expect((outSheet.model as { merges?: string[] }).merges).toContain('A1:B1');
  });

  it('tableToResult: 产出适合前端消费的结构结果', () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');

    ws.getCell('A1').value = 'Region';
    ws.getCell('B1').value = 'Q1';
    ws.getCell('A2').value = 'North';
    ws.getCell('B2').value = 12;
    ws.getCell('A3').value = 'South';
    ws.getCell('B3').value = 18;
    ws.mergeCells('A1:A2');

    const table = tableFromWorksheet(ws, { headerRows: 'auto' });
    const result = tableToResult(table);

    expect(result.columns).toHaveLength(2);
    expect(result.headerRows).toHaveLength(2);
    expect(result.bodyRows).toHaveLength(1);
    expect(result.rows[0].cells[0].rowspan).toBe(2);
    expect(result.rows[1].cells[0].isPlaceholder).toBe(true);
    expect(result.rows[1].cells[0].originRowIndex).toBe(0);
    expect(result.spans).toEqual([{ row: 0, col: 0, rowspan: 2, colspan: 1 }]);
    expect(result.table.headerRows).toBe(2);
  });
});
