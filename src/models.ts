export type GroupSeparators = Record<number, string | string[]> | number[];

export interface CellStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  bgColor?: string;
  alignment?: 'left' | 'center' | 'right' | string;
  fmt?: string;
  rawLatex?: boolean;
  rotation?: number;
}

export interface Cell {
  value: unknown;
  style: CellStyle;
  rowspan: number;
  colspan: number;
}

export interface TableData {
  cells: Cell[][];
  numRows: number;
  numCols: number;
  headerRows: number;
  groupSeparators: GroupSeparators;
}

export interface RenderOptions {
  caption?: string;
  label?: string;
  position?: string;
  resizebox?: string | null;
  colSpec?: string;
  spanColumns?: boolean;
}

export interface Xlsx2TexOptions extends RenderOptions {
  sheet?: string | number;
  headerRows?: number | 'auto';
}
