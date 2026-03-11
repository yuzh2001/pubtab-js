# pubtab-ts

`pubtab` 的 TypeScript 复刻版（当前为核心可用实现）。

## 已实现

- `xlsx2tex(input, output, options?)`
  - 支持单文件转换。
  - 未指定 `sheet` 时，默认导出所有工作表为 `*_sheetNN.tex`。
  - 指定 `sheet`（名称或索引）时，只导出一个 `.tex`。
  - 支持目录输入批量处理（`.xlsx` -> `.tex`）。
- `texToExcel(input, output)`
  - 支持单文件转换。
  - 支持目录批量处理（`.tex` -> `.xlsx`）。
- `render(table, options?)`
  - 生成带 package hints 的 LaTeX 表格。
  - 基础样式：`bold/italic/underline/text color/bg color`。
  - `multicolumn` / `multirow`。
- `readTex(tex)`
  - 解析基本 `tabular`（含 `toprule/midrule/bottomrule`）。

## 快速使用

```ts
import { xlsx2tex, texToExcel } from 'pubtab-ts';

await xlsx2tex('table.xlsx', 'out/table.tex');
await texToExcel('table.tex', 'out/table.xlsx');
```

## 开发

```bash
npm i
npm test
npm run build
```

## 当前差距（相对 Python 原版）

- 还未完整覆盖 rich text、复杂颜色定义、旋转/diagbox、主题系统、preview(PNG/PDF) 管线。
- 目前测试覆盖的是核心 I/O 与最小往返，适合作为后续对齐上游功能的基础版本。
