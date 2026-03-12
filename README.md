# pubtab-js

![Node >=18](https://img.shields.io/badge/node-%3E%3D18-2f6f3e)
![License ISC](https://img.shields.io/badge/license-ISC-1f4b99)
![TypeScript](https://img.shields.io/badge/language-TypeScript-3178c6)

[`pubtab`](https://github.com/Galaxy-Dawn/pubtab) is a feature-rich, well-tested tool for converting between LaTeX tables and Excel spreadsheets.

`pubtab-js` is a TypeScript port of the original Python `pubtab`, providing two-way conversion between Excel workbooks and LaTeX `tabular`.

The current package is being shaped as a dual-runtime package:

- Node side: file-path based API and CLI
- Browser side: single-file, in-memory API built around `ArrayBuffer` / `Blob` / `File`
- Frontend consumption: structured table results for app-specific rendering

Compared with the Python version, `pubtab-js` currently keeps the core conversion pipeline while omitting preview:

- `.xlsx -> .tex`
- `.tex -> .xlsx`
- basic CLI
- theme support
- programmable API

## Installation

### Install the CLI globally

```bash
pnpm add -g pubtab-js
```

After installation:

```bash
pubtab-js --help
```

### Install as a library

```bash
pnpm add pubtab-js
```

## CLI Usage

### Excel to LaTeX

```bash
pubtab-js xlsx2tex table.xlsx out/table.tex
```

Export by sheet:

```bash
pubtab-js xlsx2tex table.xlsx out/table.tex --sheet 0
pubtab-js xlsx2tex table.xlsx out/table.tex --sheet Sheet1
```

Add caption / label / position:

```bash
pubtab-js xlsx2tex table.xlsx out/table.tex \
  --caption "My Table" \
  --label "tab:my_table" \
  --position htbp
```

### LaTeX to Excel

```bash
pubtab-js tex2xlsx table.tex out/table.xlsx
```

### Use a YAML config file

```yaml
sheet: 1
caption: Example Table
label: tab:example
position: htbp
theme: three_line
headerRows: auto
```

```bash
pubtab-js xlsx2tex table.xlsx out/table.tex --config pubtab.yml
```

Explicit CLI flags override fields with the same name in the config file.

### CLI help

```bash
pubtab-js --help
```

Currently supported top-level commands:

- `pubtab-js xlsx2tex`
- `pubtab-js tex2xlsx`

## API Usage

It is recommended to wrap LaTeX strings with `String.raw` to avoid escape issues.

```ts
// Backslashes inside String.raw do not need to be escaped.
const noNeedToUseEscapes = String.raw`\begin{something}`;
const latexString = String.raw`
    \begin{tabular}{cc}
    A & B\\
    \end{tabular}\
`;

// Not recommended: backslashes must be escaped manually.
const latexStringNotRecommended =
  '\\begin{tabular}{cc}A & B\\\\ \\end{tabular}';
```

```ts
import { xlsx2tex, texToExcel, readTex, render } from 'pubtab-js';

await xlsx2tex('table.xlsx', 'out/table.tex');
await texToExcel('table.tex', 'out/table.xlsx');

const table = readTex(String.raw`\begin{tabular}{cc}A & B\\ \end{tabular}`);
const tex = render(table);
```

Main exported APIs:

- `xlsx2tex(input, output, options?)`
- `texToExcel(input, output)`
- `render(table, options?)`
- `readTex(tex)`
- `readTexAll(tex)`

Browser-facing APIs are memory-oriented rather than path-oriented:

- browser input/output is limited to single-file conversion
- browser APIs will accept `ArrayBuffer`, `Blob`, and `File`
- browser APIs will return structured table results so frontend apps can decide how to render them
- CLI remains Node-only

```ts
import { xlsxToTex, texToXlsx, xlsxToTableResult } from 'pubtab-js/browser';

const xlsxFile = new File([buffer], 'table.xlsx');
const { tex, table } = await xlsxToTex(xlsxFile, { headerRows: 'auto' });

const workbook = await texToXlsx(tex, { filename: 'table.xlsx' });
const tableOnly = await xlsxToTableResult(xlsxFile);
```

`TableResult` is the frontend-oriented shape returned by browser APIs. It includes:

- `columns`: stable column descriptors
- `rows`: row objects with per-cell display values
- `headerRows` / `bodyRows`: pre-split sections
- `spans`: merge/span metadata
- `table`: original `TableData` for lower-level consumers

## Current Capabilities

### Supported

- read `.xlsx` and output `.tex`
- read `.tex` and output `.xlsx`
- browser-side single-file in-memory conversion via `pubtab-js/browser`
- browser-side structured `TableResult` for frontend rendering
- export all worksheets when `sheet` is not specified
- export a single sheet when requested
- batch conversion for directory inputs
- `output` supports both file paths and directory paths
- preserve the basic semantics of merged cells
- automatic or explicit `headerRows`
- `caption`, `label`, `position`, `resizebox`, `colSpec`
- core style round-trip for bold, italic, underline, text color, background color, rotation, and rich text runs

### Not included yet

- preview pipeline
- `.xls` input
- browser-side local-path I/O
- browser-side directory batch conversion
- the full theme system and every rendering detail from the original project
- stronger TeX fault tolerance
- full support for expanding `definecolor` / `newcommand` macros
- writing multiple tables from a single `.tex` file into multiple sheets

## Gaps Compared with the Original `pubtab`

This project is a TypeScript port of the original Python `pubtab`, but it is currently "core usable" rather than fully aligned.

The main remaining gaps are:

- no `preview` support yet
- `.xls` is not supported yet
- the theme system and layout details are not fully aligned with the original implementation
- tolerance for malformed or unusual TeX input is still being improved
- some original test scenarios have not been migrated one by one yet

## Testing and Development

Development environment:

```bash
git clone https://github.com/Galaxy-Dawn/pubtab .pubtab-python # local reference clone of the original Python project; not included in the npm package
pnpm i
pnpm test:node
pnpm test:browser
pnpm test
pnpm build
pnpm build:playground
```

This repository is primarily managed with `pnpm`. Prefer `pnpm i`, `pnpm test`, `pnpm test:browser`, `pnpm build`, and `pnpm build:playground` for local development and release verification.

`pnpm test:browser` currently runs DOM-path browser-facing tests in `jsdom`, covering the browser API surface and playground interactions without relying on local file paths.

To launch the playground locally:

```bash
pnpm playground
```

This repository includes fixtures, round-trip tests, CLI config tests, and compatibility tests. The published package itself only includes `dist`, `README.md`, and `package.json`, and does not ship the test directories.

## Repository Notes

- main implementation: `src/`
- tests: `tests/`
- `tests/fixtures` contains samples used for round-trip comparisons
- `./.pubtab-python` is a local reference clone of the original Python project and is not included in the npm package

## Acknowledgements

The design goals, behavior-alignment direction, and part of the test migration work in this project all directly benefit from the original Python `pubtab`.

Thanks to the original project for providing a clear abstraction of the problem domain, a useful behavioral reference, and many valuable test fixtures that make it possible to keep pushing this conversion workflow forward in the TypeScript ecosystem.
