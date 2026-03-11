import { describe, it, expect } from 'vitest';

import { readTex, readTexAll } from '../src/index.js';

describe('texReader: multi tabular', () => {
  it('readTexAll: 一个 .tex 内多个 tabular 都能解析', () => {
    const tex = String.raw`
Before text
\begin{tabular}{c}
A \\
\end{tabular}
Middle text
\begin{tabular}{cc}
X & Y \\
1 & 2 \\
\end{tabular}
After text`;

    const tables = readTexAll(tex);
    expect(tables).toHaveLength(2);
    expect(tables[0].numRows).toBe(1);
    expect(tables[0].numCols).toBe(1);
    expect(tables[0].cells[0][0].value).toBe('A');

    expect(tables[1].numRows).toBe(2);
    expect(tables[1].numCols).toBe(2);
    expect(tables[1].cells[0][0].value).toBe('X');
    expect(tables[1].cells[1][1].value).toBe(2);
  });

  it('multirow: 下一行应插入空占位，避免列左移', () => {
    const tex = String.raw`
\begin{tabular}{cc}
\multirow{2}{*}{A} & B \\
C & D \\
\end{tabular}`;

    const t = readTex(tex);
    expect(t.numRows).toBe(2);
    expect(t.numCols).toBe(2);
    expect(t.cells[0][0].value).toBe('A');
    expect(t.cells[0][1].value).toBe('B');

    // 第二行第一列被上方 multirow 占用，因此这里应为空占位，且 D 仍在第二列
    expect(t.cells[1][0].value).toBe('');
    expect(t.cells[1][1].value).toBe('D');
  });
});

