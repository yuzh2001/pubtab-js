import ExcelJS from 'exceljs';

import type { RichSegment, TableData } from '../models.js';

export function workbookFromTable(table: TableData): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Table 1');

  const toArgb = (hex: string | undefined): string | undefined => {
    if (!hex) return undefined;
    const h = hex.replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return undefined;
    return `FF${h.toUpperCase()}`;
  };

  const merged = new Set<string>();

  for (let r = 0; r < table.cells.length; r += 1) {
    const row = table.cells[r];
    for (let c = 0; c < row.length; c += 1) {
      const cell = row[c];
      const mergedKey = `${r},${c}`;
      if (merged.has(mergedKey)) {
        if (cell.value === '' || cell.value == null) continue;
        merged.delete(mergedKey);
      }
      const target = ws.getCell(r + 1, c + 1);

      if (cell.richSegments && cell.richSegments.length > 1) {
        target.value = {
          richText: cell.richSegments.map((seg) => {
            const [text, color, bold, italic, underline] = seg as RichSegment;
            const argb = toArgb(color ?? '#000000') ?? 'FF000000';
            return {
              text,
              font: {
                bold: bold || undefined,
                italic: italic || undefined,
                underline: underline || undefined,
                color: { argb: color ? argb : 'FF000000' },
              },
            };
          }),
        } as any;
      } else {
        target.value = cell.value as ExcelJS.CellValue;
      }

      if (!(cell.richSegments && cell.richSegments.length > 1)) {
        const fontColor = toArgb(cell.style.color);
        target.font = {
          bold: cell.style.bold || undefined,
          italic: cell.style.italic || undefined,
          underline: cell.style.underline ? true : undefined,
          color: fontColor ? { argb: fontColor } : undefined,
        } as any;
      }

      const bg = toArgb(cell.style.bgColor);
      if (bg) {
        target.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: bg },
          bgColor: { argb: bg },
        } as any;
      }

      const rotation = cell.style.rotation ?? 0;
      const wrapText = typeof cell.value === 'string' && cell.value.includes('\n');
      target.alignment = {
        horizontal: cell.style.alignment as any,
        vertical: 'middle',
        wrapText: wrapText || undefined,
        textRotation: rotation || undefined,
      } as any;

      if (cell.rowspan > 1 || cell.colspan > 1) {
        let actualRowspan = Math.min(cell.rowspan, table.cells.length - r);
        if (actualRowspan > 1) {
          for (let dr = 1; dr < actualRowspan; dr += 1) {
            const nr = r + dr;
            if (nr < table.cells.length && table.cells[nr][c]?.value != null && table.cells[nr][c]?.value !== '') {
              actualRowspan = dr;
              break;
            }
          }
        }
        const endRow = r + actualRowspan;
        const endCol = c + cell.colspan;
        if (endRow > r + 1 || endCol > c + 1) {
          ws.mergeCells(r + 1, c + 1, endRow, endCol);
        }
        for (let mr = r; mr < r + actualRowspan; mr += 1) {
          for (let mc = c; mc < c + cell.colspan; mc += 1) {
            if (mr === r && mc === c) continue;
            merged.add(`${mr},${mc}`);
          }
        }
      }
    }
  }

  return wb;
}
