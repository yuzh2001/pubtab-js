import { readFile } from 'node:fs/promises';

import table1Tex from '../fixtures/table1.tex?raw';
import table4Tex from '../fixtures/table4.tex?raw';

export async function loadFixtureXlsx(relativePath: string): Promise<ArrayBuffer> {
  const bytes = await readFile(new URL(relativePath, import.meta.url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export const browserFixtures = {
  table1Tex,
  table4Tex,
  table1XlsxPath: '../fixtures/table1.xlsx',
  table4XlsxPath: '../fixtures/table4.xlsx',
};
