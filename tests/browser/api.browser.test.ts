import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';

import {
  readWorkbookBuffer,
  tableToXlsxBuffer,
  texToTableResult,
  texToXlsx,
  texToXlsxBuffer,
  xlsxBufferToTex,
  xlsxToTableResult,
  xlsxToTex,
} from '../../src/browser.js';

async function buildWorkbookBuffer(): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.getCell('A1').value = 'Name';
  ws.getCell('B1').value = 'Score';
  ws.getCell('A2').value = 'Alice';
  ws.getCell('B2').value = 9;
  const out = await wb.xlsx.writeBuffer();
  return out instanceof ArrayBuffer ? out : out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

describe('browser api', () => {
  it('readWorkbookBuffer / xlsxBufferToTex: 从内存 workbook 读取并渲染 tex', async () => {
    const buffer = await buildWorkbookBuffer();

    const table = await readWorkbookBuffer(buffer, { headerRows: 1 });
    const tex = await xlsxBufferToTex(buffer, { headerRows: 1 });

    expect(table.headerRows).toBe(1);
    expect(table.cells[1][0].value).toBe('Alice');
    expect(tex).toContain('Alice');
    expect(tex).toContain('Score');
  });

  it('xlsxToTableResult / xlsxToTex: 支持 ArrayBuffer 与 Blob 输入，并同时返回结构结果', async () => {
    const buffer = await buildWorkbookBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    const result = await xlsxToTableResult(blob, { headerRows: 1 });
    const combined = await xlsxToTex(buffer, { headerRows: 1 });

    expect(result.columns).toHaveLength(2);
    expect(result.bodyRows[0].cells[0].text).toBe('Alice');
    expect(combined.table.columns[1].label).toBe('C2');
    expect(combined.tex).toContain('Alice');
  });

  it('tableToXlsxBuffer / texToXlsxBuffer / texToXlsx / texToTableResult: 生成 xlsx buffer、blob 和结构结果', async () => {
    const tex = String.raw`\begin{tabular}{cc}
Name & Score \\
Alice & 9 \\
\end{tabular}`;

    const tableResult = await texToTableResult(tex);
    const directBuffer = await texToXlsxBuffer(tex);
    const combined = await texToXlsx(tex, { filename: 'scores.xlsx' });
    const roundtripBuffer = await tableToXlsxBuffer(tableResult.table);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(new Uint8Array(combined.buffer));
    const ws = wb.worksheets[0];

    expect(directBuffer.byteLength).toBeGreaterThan(0);
    expect(roundtripBuffer.byteLength).toBeGreaterThan(0);
    expect(combined.filename).toBe('scores.xlsx');
    expect(combined.mimeType).toContain('spreadsheetml');
    expect(combined.blob.type).toContain('spreadsheetml');
    expect(tableResult.rows[1].cells[0].text).toBe('Alice');
    expect(ws.getCell('A2').value).toBe('Alice');
    expect(ws.getCell('B2').value).toBe(9);
  });
});
