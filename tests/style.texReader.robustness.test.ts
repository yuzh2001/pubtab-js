import { describe, it, expect } from 'vitest';

import { readTex } from '../src/index.js';

describe('texReader robust cases（参考 pubtab-python）', () => {
  it('解析行内注释后仍能还原表格', () => {
    const tex = String.raw`
\begin{tabular}{cc}
\toprule
A & B \\ % header comment
\midrule
1 & 2 \\ % data comment
\bottomrule
\end{tabular}
`;
    const table = readTex(tex);
    expect(table.numRows).toBe(2);
    expect(table.cells[1][0].value).toBe(1);
  });

  it('解析 multicolumn', () => {
    const tex = String.raw`
\begin{tabular}{ccc}
\toprule
\multicolumn{2}{c}{Header} & C \\
\midrule
a & b & c \\
\bottomrule
\end{tabular}
`;
    const table = readTex(tex);
    expect(table.cells[0][0].colspan).toBe(2);
    expect(table.cells[0][0].value).toBe('Header');
  });

  it('解析 multirow', () => {
    const tex = String.raw`
\begin{tabular}{cc}
\toprule
\multirow{2}{*}{A} & B \\
 & C \\
\bottomrule
\end{tabular}
`;
    const table = readTex(tex);
    expect(table.cells[0][0].rowspan).toBe(2);
    expect(table.cells[0][1].value).toBe('B');
  });

  it('解析 diagbox', () => {
    const tex = String.raw`
\begin{tabular}{cc}
\toprule
\diagbox{Row}{Col} & Data \\
\midrule
a & 1 \\
\bottomrule
\end{tabular}
`;
    const table = readTex(tex);
    expect(table.cells[0][0].style.diagbox).toEqual(['Row', 'Col']);
  });

  it('抽取简单文本样式', () => {
    const tex = String.raw`
\begin{tabular}{ccc}
\toprule
\textbf{Bold} & \textit{Italic} & \underline{Under} \\
\bottomrule
\end{tabular}
`;
    const table = readTex(tex);
    expect(table.cells[0][0].style.bold).toBe(true);
    expect(table.cells[0][1].style.italic).toBe(true);
    expect(table.cells[0][2].style.underline).toBe(true);
  });

  it('清理 math text 的文本样式表达', () => {
    const tex = String.raw`
\begin{tabular}{c}
\toprule
$D_\text{stage 1}$ \\
\bottomrule
\end{tabular}
`;
    const table = readTex(tex);
    expect(table.cells[0][0].value).toBe('D_stage 1');
  });

  it('保留 pm 符号', () => {
    const tex = String.raw`
\begin{tabular}{c}
\toprule
0.626 {$\pm$0.018} \\
\bottomrule
\end{tabular}
`;
    const table = readTex(tex);
    expect(table.cells[0][0].value).toBe('0.626±0.018');
  });

  it('保留 makecell 断行', () => {
    const tex = String.raw`
\begin{tabular}{c}
\toprule
\makecell{Things-\\EEG} \\
\bottomrule
\end{tabular}
`;
    const table = readTex(tex);
    expect(table.cells[0][0].value).toBe('Things-\nEEG');
  });

  it('处理转义分隔符作为分隔符（\\&) 的场景', () => {
    const tex = String.raw`
\begin{tabular}{ccc}
\toprule
A \& B \& C \\
\bottomrule
\end{tabular}
`;
    const table = readTex(tex);
    expect(table.numCols).toBe(3);
    expect(table.cells[0][0].value).toBe('A');
    expect(table.cells[0][1].value).toBe('B');
    expect(table.cells[0][2].value).toBe('C');
  });

  it('处理 \\% 异常转义不会把后续行误拼', () => {
    const tex = String.raw`
\begin{tabular}{cc}
\toprule
A & B \\
\midrule
M1 & 2\\%Tag & 1 \\
\bottomrule
\end{tabular}
`;
    const table = readTex(tex);
    expect(table.numRows).toBe(3);
    expect(table.cells[1][0].value).toBe('M1');
    expect(table.cells[2][0].value).toBe('%Tag');
    expect(table.cells[2][1].value).toBe(1);
  });

  it('处理 \\# 异常转义不会把后续行误拼', () => {
    const tex = String.raw`
\begin{tabular}{ccc}
\toprule
Metric & \#P (M) & Score \\
\midrule
18 & 11.23 & 86.41 \\
\bottomrule
\end{tabular}
`;
    const table = readTex(tex);
    expect(table.numRows).toBe(2);
    expect(table.cells[0][1].value).toBe('#P (M)');
  });

  it('装饰分隔行应被去掉，不污染数据', () => {
    const tex = String.raw`
\begin{tabular}{ll}
\toprule
Lang & Value \\
\midrule
English
-\/-\/-\/-\/-\/-\/-\/-
\multirow{2}{*}{English} & 1 \\
 & 2 \\
\bottomrule
\end{tabular}
`;
    const table = readTex(tex);
    expect(table.numRows).toBe(3);
    expect(table.cells[1][0].value).toBe('English');
    const allValues = table.cells.flat().map((c) => String(c.value || ''));
    expect(allValues.some((v) => v.includes('-/-'))).toBe(false);
    expect(allValues.some((v) => v.includes('---'))).toBe(false);
  });

  it('处理 \\\\% 行内场景不应污染行头', () => {
    const tex = String.raw`
\begin{tabular}{cc}
\toprule
A & B \\
\midrule
v1 & v2\\%Tag & 1 \\
\bottomrule
\end{tabular}
`;
    const table = readTex(tex);
    expect(table.numRows).toBe(3);
    expect(table.cells[1][0]).toBeDefined();
    expect(table.cells[1][0].value).toBe('v1');
    expect(table.cells[2][0].value).toBe('%Tag');
  });

  it('处理 \\\\# 行内场景不应污染行头', () => {
    const tex = String.raw`
\begin{tabular}{cc}
\toprule
A & B \\
\midrule
v1 & v2\\#Tag & 1 \\
\bottomrule
\end{tabular}
`;
    const table = readTex(tex);
    expect(table.numRows).toBe(3);
    expect(table.cells[1][0]).toBeDefined();
    expect(table.cells[1][0].value).toBe('v1');
    expect(table.cells[2][0].value).toBe('#Tag');
  });

  it('\\& 在非标准场景下应保持为单元内字符', () => {
    const tex = String.raw`
\begin{tabular}{ccc}
\toprule
Method & Input & Score \\
\midrule
OpenOcc & C\\&L & 70.59 \\
\bottomrule
\end{tabular}
`;
    const table = readTex(tex);
    expect(table.numRows).toBe(2);
    expect(table.cells[1][1].value).toBe('C&L');
    expect(table.cells[1][2].value).toBe(70.59);
  });

  it('仅包含转义分隔符的行应该仍能拆出多个列', () => {
    const tex = String.raw`
\begin{tabular}{ccc}
\toprule
A \& B \& C \\
\bottomrule
\end{tabular}
`;
    const table = readTex(tex);
    expect(table.numRows).toBe(1);
    expect(table.numCols).toBe(3);
    expect(table.cells[0][0].value).toBe('A');
    expect(table.cells[0][1].value).toBe('B');
    expect(table.cells[0][2].value).toBe('C');
  });

  it('三重反斜杠中的 rule 命令不应泄露到内容', () => {
    const tex = String.raw`
\begin{tabular}{ll}
\toprule
A & B \\\hline
C & D \\\cline{1-2}
E & F \\\bottomrule[0.8pt]
\end{tabular}
`;
    const table = readTex(tex);
    expect(table.numRows).toBe(3);
    const values = table.cells.flat().map((cell) => String(cell.value || ''));
    const joined = values.join(' | ').toLowerCase();
    expect(joined.includes('hline')).toBe(false);
    expect(joined.includes('cline')).toBe(false);
    expect(joined.includes('bottomrule')).toBe(false);
  });

  it('嵌套 makebox 应清理为纯内容', () => {
    const tex = String.raw`
\begin{tabular}{c}
\toprule
\makebox[1.25em][c]{{\color{ForestGreen}\textsf{\textbf{P}}}} \\
\bottomrule
\end{tabular}
`;
    const table = readTex(tex);
    expect(table.cells[0][0].value).toBe('P');
  });

  it('内嵌的装饰分隔符行应被清理', () => {
    const tex = String.raw`
\begin{tabular}{ll}
\toprule
Lang & Value \\
\midrule
Korean -\/-\/-\/-\/-\/-\/-\/-
\multirow{2}{*}{Korean} & 1 \\
 & 2 \\
\bottomrule
\end{tabular}
`;
    const table = readTex(tex);
    expect(table.numRows).toBe(3);
    expect(table.cells[1][0].value).toBe('Korean');
    const allValues = table.cells.flat().map((c) => String(c.value || ''));
    expect(allValues.some((v) => v.includes('-/-'))).toBe(false);
    expect(allValues.some((v) => v.includes('---'))).toBe(false);
  });

  it('有 makecell 内联内容时不应把 makecell 片段泄露到 rich segment', () => {
    const tex = String.raw`
\begin{tabular}{ll}
\toprule
Q & A \\
\midrule
Qwen2 response & \begin{tabular}[c]{@{}l@{}}He Ain't Heavy was written by \textcolor{red}{Mike D'Abo}. \\ $\cdots$\end{tabular} \\
\bottomrule
\end{tabular}
`;
    const table = readTex(tex);
    const cell = table.cells[1][1];
    expect(String(cell.value || '').toLowerCase()).not.toContain('makecell');
    expect(cell.richSegments).not.toBeNull();
    expect((cell.richSegments as any[]).length).toBeGreaterThan(0);
    expect(String((cell.richSegments as any[])[0][0]).toLowerCase()).not.toContain('makecell');
  });

  it('跨两行的第一列空白应正确延展 rowspan', () => {
    const tex = String.raw`
\begin{tabular}{ccc}
\toprule
Iter & Balls & Score \\
\midrule
1 & 5 & 0.1 \\
 & 15 & 0.2 \\
 & 30 & 0.3 \\
\hline
2 & 5 & 0.4 \\
 & 15 & 0.5 \\
 & 30 & 0.6 \\
\bottomrule
\end{tabular}
`;
    const table = readTex(tex);
    expect(table.cells[1][0].rowspan).toBe(3);
    expect(table.cells[4][0].rowspan).toBe(3);
    expect(table.cells[2][0].value).toBe('');
    expect(table.cells[3][0].value).toBe('');
    expect(table.cells[5][0].value).toBe('');
    expect(table.cells[6][0].value).toBe('');
  });

  it('保留中间空列而不裁剪', () => {
    const tex = String.raw`
\begin{tabular}{ccc}
\toprule
Left &  & Right \\
\midrule
L1 &  & R1 \\
\bottomrule
\end{tabular}
`;
    const table = readTex(tex);
    expect(table.numCols).toBe(3);
    expect(table.cells[0][1].value).toBe('');
    expect(table.cells[1][1].value).toBe('');
  });
});
