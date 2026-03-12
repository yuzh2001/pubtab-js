import type {
  Cell,
  TableCellView,
  TableColumnView,
  TableData,
  TableResult,
  TableRowView,
  TableSpanView,
  TableViewModel,
} from '../models.js';

function cellText(cell: Cell): string {
  if (cell.richSegments && cell.richSegments.length > 0) {
    return cell.richSegments.map((seg) => seg[0]).join('');
  }
  if (cell.style.diagbox && cell.style.diagbox.length >= 2) {
    return `${cell.style.diagbox[0]} / ${cell.style.diagbox[1]}`;
  }
  return String(cell.value ?? '');
}

function buildCoverageMap(table: TableData): Map<string, { row: number; col: number }> {
  const covered = new Map<string, { row: number; col: number }>();
  for (let rowIndex = 0; rowIndex < table.cells.length; rowIndex += 1) {
    const row = table.cells[rowIndex];
    for (let colIndex = 0; colIndex < row.length; colIndex += 1) {
      const cell = row[colIndex];
      const rowspan = Math.max(1, cell.rowspan || 1);
      const colspan = Math.max(1, cell.colspan || 1);
      if (rowspan === 1 && colspan === 1) continue;
      for (let r = rowIndex; r < rowIndex + rowspan; r += 1) {
        for (let c = colIndex; c < colIndex + colspan; c += 1) {
          if (r === rowIndex && c === colIndex) continue;
          covered.set(`${r},${c}`, { row: rowIndex, col: colIndex });
        }
      }
    }
  }
  return covered;
}

export function tableToViewModel(table: TableData): TableViewModel {
  const columns: TableColumnView[] = Array.from({ length: table.numCols }, (_, index) => ({
    id: `col_${index}`,
    key: `c${index}`,
    index,
    label: `C${index + 1}`,
  }));
  const coverage = buildCoverageMap(table);
  const spans: TableSpanView[] = [];
  const rows: TableRowView[] = [];
  const headerRows: TableRowView[] = [];
  const bodyRows: TableRowView[] = [];
  const grid: TableCellView[][] = [];

  for (let rowIndex = 0; rowIndex < table.cells.length; rowIndex += 1) {
    const section = rowIndex < table.headerRows ? 'header' : 'body';
    const row = table.cells[rowIndex];
    const cells: TableCellView[] = [];
    const values: unknown[] = [];

    for (let colIndex = 0; colIndex < table.numCols; colIndex += 1) {
      const raw = row[colIndex] ?? { value: '', style: {}, rowspan: 1, colspan: 1, richSegments: null };
      const coveredBy = coverage.get(`${rowIndex},${colIndex}`);
      const isPlaceholder = Boolean(coveredBy);
      const originRowIndex = coveredBy?.row ?? rowIndex;
      const originColIndex = coveredBy?.col ?? colIndex;
      const cell: TableCellView = {
        id: `r${rowIndex}c${colIndex}`,
        rowIndex,
        colIndex,
        columnId: columns[colIndex].id,
        value: raw.value,
        text: cellText(raw),
        style: raw.style,
        richSegments: raw.richSegments ?? null,
        rowspan: raw.rowspan,
        colspan: raw.colspan,
        originRowIndex,
        originColIndex,
        isPlaceholder,
        section,
      };
      cells.push(cell);
      values.push(raw.value);
      if (!isPlaceholder && (raw.rowspan > 1 || raw.colspan > 1)) {
        spans.push({ row: rowIndex, col: colIndex, rowspan: raw.rowspan, colspan: raw.colspan });
      }
    }

    const rowView: TableRowView = {
      id: `row_${rowIndex}`,
      index: rowIndex,
      section,
      cells,
      values,
    };
    rows.push(rowView);
    grid.push(cells);
    if (section === 'header') headerRows.push(rowView);
    else bodyRows.push(rowView);
  }

  return {
    columns,
    rows,
    headerRows,
    bodyRows,
    grid,
    spans,
    size: {
      rows: table.numRows,
      cols: table.numCols,
    },
  };
}

export function tableToResult(table: TableData): TableResult {
  return {
    ...tableToViewModel(table),
    table,
  };
}
