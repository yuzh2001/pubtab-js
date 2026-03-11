# pubtab-ts

`pubtab` 的 TypeScript 复刻版（当前为“核心可用”实现），目标是逐步对齐 Python 原版（参考 `./.pubtab-python`）。

## 范围与非目标

- 本仓库当前优先保证：基础双向转换管线可跑、输出文件命名规则稳定、能够用测试锁定行为。
- 非目标（当前阶段）：完全对齐原版的排版细节、主题系统、preview 管线、复杂 tex 容错解析与富样式回转。

## 功能对照（相对 Python 原版）

说明：用 `TODO` 标记尚未实现或未对齐的点。

### Excel -> LaTeX（xlsx2tex）

- 已实现：读取 `.xlsx`（基于 `exceljs`）并输出 `.tex`。
- 已实现：未指定 `sheet` 时默认导出全部工作表为 `*_sheetNN.tex`。
- 已实现：指定 `sheet`（名称或索引）时只导出单个 `.tex`。
- 已实现：目录输入批量转换（目录内 `.xlsx` -> 输出目录内 `.tex`）。
- 已实现：合并单元格“非 master 置空”的语义（避免重复值）。
- 已实现：输出头部包含注释版 package hints（`booktabs/multirow/xcolor`，resizebox 时额外包含 `graphicx`）。
- TODO：支持 `.xls` 输入（原版支持）。
- TODO：header_rows 自动识别与可配置（原版支持）。
- TODO：样式高保真（粗斜体/下划线/颜色/背景色/旋转/富文本 rich segments 等）从 Excel 读取并回转。
- TODO：尾部空列裁剪逻辑与“宽标题合并单元格”裁剪兼容（原版有多条测试覆盖）。
- TODO：主题系统（Jinja2 themes / three_line 等）与参数（caption/label/position/font_size/col_spec 等）完整对齐。
- TODO：生成的 LaTeX 结构与原版尽量一致（目前只做语义层面验证，排版差异较大）。

### LaTeX -> Excel（texToExcel / readTex）

- 已实现：解析基本 `tabular`（忽略 `toprule/midrule/bottomrule/hline`）。
- 已实现：基础拆行列（`\\` / `&`），支持 `multicolumn/multirow` 的最小展开。
- 已实现：解包常见包装器（`textbf/textit/underline/textcolor/cellcolor/makecell/diagbox` 的保守剥壳），用于提取值。
- 已实现：写出 `.xlsx`（基于 `exceljs`）。
- 已实现：目录输入批量转换（目录内 `.tex` -> 输出目录内 `.xlsx`）。
- TODO：单个 `.tex` 内多表解析并写入多 sheet（原版支持）。
- TODO：完整样式回写到 Excel（字体/颜色/背景色/旋转/富文本分段等）。
- TODO：强健的 tex 容错解析（处理 docx/OCR 导致的异常反斜杠、转义分隔符、嵌套 tabular 等；原版有大量测试覆盖）。
- TODO：`definecolor/newcommand` 宏展开与颜色模型解析（原版支持）。
- TODO：目录输入时的参数校验（例如：目录输入要求输出为目录；原版有测试覆盖）。

### Preview（tex -> PNG/PDF）

- TODO：未实现（原版有 `pubtab preview`，包含 TinyTeX 自举、缺包自动安装、批量输出等）。

### CLI / Config

- TODO：未实现 CLI（原版 `pubtab xlsx2tex/tex2xlsx/preview/themes`）。
- TODO：未实现 YAML config（原版支持 config + 显式参数覆盖）。

## API（当前）

- `xlsx2tex(input, output, options?)`
- `texToExcel(input, output)`
- `render(table, options?)`
- `readTex(tex)`

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

## 测试覆盖（对照原版 pytest）

说明：下面的“原版测试名”来自 `./.pubtab-python/tests`，用于跟踪我们还缺哪些行为锁定。

### 已实现（本仓库 vitest）

- `xlsx2tex_default_exports_all_sheets`：默认导出全部 sheet（`tests/pubtab.test.ts`）。
- `xlsx2tex_sheet_option_exports_single_sheet`：指定 `sheet` 只导出一个（`tests/pubtab.test.ts`）。
- `xlsx2tex_includes_commented_package_hints`：输出包含 package hints（`tests/pubtab.test.ts`）。
- `xlsx2tex_package_hints_include_graphicx_when_resizebox_enabled`：resizebox 时包含 `graphicx` hint（`tests/pubtab.test.ts`）。
- `tex2xlsx_directory_input_exports_all_tex_files`：目录批量 `.tex` -> `.xlsx`（`tests/pubtab.test.ts`）。
- 额外：fixture 语义对比（`.tmp/table1.xlsx` vs pubtab 输出 `.tmp/tex1_sheet01/02.tex`；缺文件自动跳过）。
- `readTex <-> render` 最小往返结构测试（`tests/pubtab.test.ts`）。

### TODO（原版存在但本仓库尚未覆盖）

- `test_tex_to_xlsx_dimensions / values_match / merged_cells`：从 `.tex` 生成 `.xlsx` 的维度、值、合并范围对齐。
- `test_xlsx_to_tex_roundtrip`：`.xlsx -> .tex -> (parse) TableData` 的维度一致（以及更强的值一致回归）。
- `test_xlsx2tex_directory_input_requires_output_directory`：目录输入时 output 参数校验。
- `test_tex2xlsx_directory_input_requires_output_directory`：目录输入时 output 参数校验。
- `test_preview_*` 与 `test_preview_download_*`：preview 管线与 TinyTeX/缺包安装相关（我们未实现 preview）。
- `test_read_excel_trims_*`：Excel 读取裁剪逻辑（我们未实现裁剪）。
- `test_tex_reader_*` 大量容错与语义解析用例（我们目前只做最小解析与保守剥壳）。
- `test_render_*`：three_line 主题渲染细节、特殊字符、section row 规则、unicode 下标等（我们 renderer 尚未对齐）。
- `test_load_config_*`：YAML config 行为（我们未实现）。

## 目录与参考

- Python 原版参考：`./.pubtab-python`；这个目录在.gitignore里，开发前请先 git clone https://ghfast.top/github.com/Galaxy-Dawn/pubtab.git ./.pubtab-python。
- 本仓库测试：`tests/pubtab.test.ts`
- 主要实现：`src/excel.ts`, `src/texReader.ts`, `src/renderer.ts`
