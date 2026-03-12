import ExcelJS from 'exceljs';

import type { TableData, TableResult, Xlsx2TexOptions } from './models.js';
import { readTex } from './texReader.js';
import { render } from './renderer.js';
import { readWorkbook } from './core/table.js';
import { workbookFromTable } from './core/workbook.js';
import { tableToResult } from './core/view-model.js';

type BinaryInput = ArrayBuffer | Blob | File | Uint8Array;

function isBlobLike(input: BinaryInput): input is Blob | File {
  return typeof Blob !== 'undefined' && input instanceof Blob;
}

function toArrayBufferFromView(input: ArrayBufferView): ArrayBuffer {
  return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
}

function normalizeBinaryOutput(output: unknown): ArrayBuffer {
  if (output instanceof ArrayBuffer) return output;
  if (ArrayBuffer.isView(output)) return toArrayBufferFromView(output);
  throw new Error(`Unsupported binary output type: ${Object.prototype.toString.call(output)}`);
}

function excelBinaryInput(input: ArrayBuffer): Uint8Array {
  return new Uint8Array(input);
}

async function toArrayBuffer(input: BinaryInput): Promise<ArrayBuffer> {
  if (input instanceof ArrayBuffer) return input;
  if (input instanceof Uint8Array) return toArrayBufferFromView(input);
  if (isBlobLike(input)) return input.arrayBuffer();
  return input;
}

function toFilename(source: string, fallback: string): string {
  const trimmed = source.trim();
  if (!trimmed) return fallback;
  return trimmed;
}

function tableFromWorkbookResult(table: TableData): TableResult {
  return tableToResult(table);
}

export async function readWorkbookBuffer(input: ArrayBuffer, opts: Xlsx2TexOptions = {}): Promise<TableData> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(excelBinaryInput(input) as any);
  return readWorkbook(wb, opts);
}

export async function xlsxBufferToTex(input: ArrayBuffer, opts: Xlsx2TexOptions = {}): Promise<string> {
  const table = await readWorkbookBuffer(input, opts);
  return render(table, opts);
}

export async function tableToXlsxBuffer(table: TableData): Promise<ArrayBuffer> {
  const wb = workbookFromTable(table);
  return normalizeBinaryOutput(await wb.xlsx.writeBuffer());
}

export async function texToXlsxBuffer(tex: string): Promise<ArrayBuffer> {
  const table = readTex(tex);
  return tableToXlsxBuffer(table);
}

export async function xlsxToTableResult(input: BinaryInput, opts: Xlsx2TexOptions = {}): Promise<TableResult> {
  const buffer = await toArrayBuffer(input);
  const table = await readWorkbookBuffer(buffer, opts);
  return tableFromWorkbookResult(table);
}

export async function texToTableResult(input: string): Promise<TableResult> {
  const table = readTex(input);
  return tableToResult(table);
}

export async function xlsxToTex(
  input: BinaryInput,
  opts: Xlsx2TexOptions = {},
): Promise<{ tex: string; table: TableResult }> {
  const buffer = await toArrayBuffer(input);
  const tableData = await readWorkbookBuffer(buffer, opts);
  return {
    tex: render(tableData, opts),
    table: tableFromWorkbookResult(tableData),
  };
}

export async function texToXlsx(
  input: string,
  opts: { filename?: string } = {},
): Promise<{ buffer: ArrayBuffer; blob: Blob; table: TableResult; filename: string; mimeType: string }> {
  const table = readTex(input);
  const buffer = await tableToXlsxBuffer(table);
  const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return {
    buffer,
    blob: new Blob([buffer], { type: mimeType }),
    table: tableToResult(table),
    filename: toFilename(opts.filename ?? '', 'table.xlsx'),
    mimeType,
  };
}
