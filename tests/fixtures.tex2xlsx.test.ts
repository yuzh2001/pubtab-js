import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import ExcelJS from 'exceljs';

import { texToExcel } from '../src/index.js';

const FIXTURES = path.resolve('tests/fixtures');
const TABLES = ['table1', 'table2', 'table3', 'table4', 'table5', 'table6', 'table8'] as const;

async function mkTmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function mergeCount(ws: ExcelJS.Worksheet): number {
  const merges = (ws.model as { merges?: string[] } | undefined)?.merges ?? [];
  return merges.length;
}

function cellValueToComparable(v: unknown): { kind: 'num'; num: number } | { kind: 'str'; str: string } {
  const unwrap = (x: unknown): unknown => {
    if (x && typeof x === 'object') {
      const any = x as any;
      if (Array.isArray(any.richText)) {
        return any.richText.map((b: any) => String(b?.text ?? '')).join('');
      }
      if (typeof any.formula === 'string' && 'result' in any) return any.result;
      if (typeof any.text === 'string') return any.text;
    }
    return x;
  };

  const raw = unwrap(v);
  if (typeof raw === 'number' && Number.isFinite(raw)) return { kind: 'num', num: raw };
  if (raw == null) return { kind: 'str', str: '' };

  const s = String(raw).trim();
  if (!s) return { kind: 'str', str: '' };

  // Mirror Python's `float(s)` attempt (be conservative about what counts as numeric).
  if (/^-?\d+(\.\d+)?([eE]-?\d+)?$/u.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return { kind: 'num', num: n };
  }
  return { kind: 'str', str: s };
}

function compareCells(wsA: ExcelJS.Worksheet, wsB: ExcelJS.Worksheet): Array<[number, number, unknown, unknown]> {
  const diffs: Array<[number, number, unknown, unknown]> = [];
  const maxR = Math.max(wsA.rowCount || 0, wsB.rowCount || 0);
  const maxC = Math.max(wsA.columnCount || 0, wsB.columnCount || 0);

  for (let r = 1; r <= maxR; r += 1) {
    for (let c = 1; c <= maxC; c += 1) {
      const va = wsA.getCell(r, c).value;
      const vb = wsB.getCell(r, c).value;
      const ca = cellValueToComparable(va);
      const cb = cellValueToComparable(vb);

      if (ca.kind === 'num' && cb.kind === 'num') {
        if (Math.abs(ca.num - cb.num) < 1e-9) continue;
        diffs.push([r, c, va, vb]);
        continue;
      }
      if (ca.kind === 'str' && cb.kind === 'str') {
        if (ca.str === cb.str) continue;
        diffs.push([r, c, va, vb]);
        continue;
      }
      // num vs str: treat as diff (Python would have stringified both before float-cast,
      // but our comparable already attempted numeric parse for strings).
      diffs.push([r, c, va, vb]);
    }
  }
  return diffs;
}

describe('fixtures: tex -> xlsx（迁移 pubtab-python test_tex_to_xlsx_*）', () => {
  it.each(TABLES)('texToExcel: %s 维度应与 fixture xlsx 一致', async (name) => {
    const dir = await mkTmpDir('pubtab-ts-fixture-tex2xlsx-');
    const texFile = path.join(FIXTURES, `${name}.tex`);
    const origXlsx = path.join(FIXTURES, `${name}.xlsx`);
    const genXlsx = path.join(dir, `${name}.xlsx`);

    await texToExcel(texFile, genXlsx);

    const wbOrig = new ExcelJS.Workbook();
    await wbOrig.xlsx.readFile(origXlsx);
    const wbGen = new ExcelJS.Workbook();
    await wbGen.xlsx.readFile(genXlsx);
    const wsOrig = wbOrig.worksheets[0];
    const wsGen = wbGen.worksheets[0];

    expect(wsGen.rowCount).toBe(wsOrig.rowCount);
    expect(wsGen.columnCount).toBe(wsOrig.columnCount);
  });

  it.each(TABLES)('texToExcel: %s 单元格值应与 fixture xlsx 一致', async (name) => {
    const dir = await mkTmpDir('pubtab-ts-fixture-tex2xlsx-');
    const texFile = path.join(FIXTURES, `${name}.tex`);
    const origXlsx = path.join(FIXTURES, `${name}.xlsx`);
    const genXlsx = path.join(dir, `${name}.xlsx`);

    await texToExcel(texFile, genXlsx);

    const wbOrig = new ExcelJS.Workbook();
    await wbOrig.xlsx.readFile(origXlsx);
    const wbGen = new ExcelJS.Workbook();
    await wbGen.xlsx.readFile(genXlsx);
    const wsOrig = wbOrig.worksheets[0];
    const wsGen = wbGen.worksheets[0];

    const diffs = compareCells(wsOrig, wsGen);
    expect(diffs).toEqual([]);
  });

  it.each(TABLES)('texToExcel: %s 合并单元格数量应一致', async (name) => {
    const dir = await mkTmpDir('pubtab-ts-fixture-tex2xlsx-');
    const texFile = path.join(FIXTURES, `${name}.tex`);
    const origXlsx = path.join(FIXTURES, `${name}.xlsx`);
    const genXlsx = path.join(dir, `${name}.xlsx`);

    await texToExcel(texFile, genXlsx);

    const wbOrig = new ExcelJS.Workbook();
    await wbOrig.xlsx.readFile(origXlsx);
    const wbGen = new ExcelJS.Workbook();
    await wbGen.xlsx.readFile(genXlsx);
    const wsOrig = wbOrig.worksheets[0];
    const wsGen = wbGen.worksheets[0];

    expect(mergeCount(wsGen)).toBe(mergeCount(wsOrig));
  });
});

