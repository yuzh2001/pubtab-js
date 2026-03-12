export type GroupSeparators = Record<number, string | string[]> | number[];

export interface SpacingConfig {
  tabcolsep?: string | null;
  arraystretch?: string | null;
  heavyrulewidth?: string | null;
  lightrulewidth?: string | null;
  arrayrulewidth?: string | null;
  aboverulesep?: string | null;
  belowrulesep?: string | null;
}

// Mirror pubtab-python: ((text, color_hex_or_None, bold, italic, underline), ...)
export type RichSegment = [text: string, color: string | null, bold: boolean, italic: boolean, underline: boolean];

export interface CellStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  bgColor?: string;
  alignment?: 'left' | 'center' | 'right' | string;
  fmt?: string;
  stripLeadingZero?: boolean;
  rawLatex?: boolean;
  diagbox?: string[]; // e.g. ["Row", "Col"]
  rotation?: number;
}

export interface Cell {
  value: unknown;
  style: CellStyle;
  rowspan: number;
  colspan: number;
  richSegments?: RichSegment[] | null;
}

export interface TableData {
  cells: Cell[][];
  numRows: number;
  numCols: number;
  headerRows: number;
  groupSeparators: GroupSeparators;
}

export interface TableColumnView {
  id: string;
  key: string;
  index: number;
  label: string;
}

export interface TableSpanView {
  row: number;
  col: number;
  rowspan: number;
  colspan: number;
}

export interface TableCellView {
  id: string;
  rowIndex: number;
  colIndex: number;
  columnId: string;
  value: unknown;
  text: string;
  style: CellStyle;
  richSegments: RichSegment[] | null;
  rowspan: number;
  colspan: number;
  originRowIndex: number;
  originColIndex: number;
  isPlaceholder: boolean;
  section: 'header' | 'body';
}

export interface TableRowView {
  id: string;
  index: number;
  section: 'header' | 'body';
  cells: TableCellView[];
  values: unknown[];
}

export interface TableViewModel {
  columns: TableColumnView[];
  rows: TableRowView[];
  headerRows: TableRowView[];
  bodyRows: TableRowView[];
  grid: TableCellView[][];
  spans: TableSpanView[];
  size: {
    rows: number;
    cols: number;
  };
}

export interface TableResult extends TableViewModel {
  table: TableData;
}

export interface RenderOptions {
  caption?: string;
  label?: string;
  position?: string;
  resizebox?: string | null;
  colSpec?: string;
  theme?: string;
  spanColumns?: boolean;
  spacing?: SpacingConfig;
  fontSize?: string | null;
  headerSep?: string | string[];
  headerCmidrule?: boolean;
  uprightScripts?: boolean;
}

export interface Xlsx2TexOptions extends RenderOptions {
  sheet?: string | number;
  headerRows?: number | 'auto';
}
