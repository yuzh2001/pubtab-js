# pubtab-js 浏览器端移植实施计划

> **给 Claude：** 必需子技能：使用 superpowers-zh:executing-plans 逐任务实施此计划。

**目标：** 将包演进为 `pubtab-js`，在不破坏现有 Node CLI/API 的前提下，把核心表格转换能力拆分为可在浏览器中运行的 API，并补齐浏览器测试与一个最小可用的 Vue playground。

**架构：** 保留 `render` / `readTex` / `readTexAll` 这类纯逻辑模块不动，把当前 `src/excel.ts` 中混杂的“ExcelJS 工作簿读写逻辑”和“Node 文件系统路径逻辑”拆开。新增浏览器入口接受 `ArrayBuffer` / `File` / `Blob` / 字符串 / 结构化表格结果，Node 入口继续负责文件路径、单文件转换和 CLI。面向前端的核心输出不直接产出 HTML，而是返回适合 Vue + TanStack Table 风格消费的结构化结果。

**技术栈：** TypeScript, ExcelJS, Vitest, Vitest Browser Mode, Playwright provider, Vite, Vue, TanStack Table

---

### 任务 1：确认产品边界与包名调整

**文件：**
- 修改：`package.json`
- 修改：`README.md`
- 修改：`README_zh.md`
- 创建：`docs/plans/2026-03-12-browser-port-plan.md`

**步骤 1：写下默认边界**

明确以下默认边界并写入文档/README：
- 支持浏览器内存态转换：`.xlsx(ArrayBuffer) -> .tex(string)`
- 支持浏览器内存态转换：`.tex(string) -> .xlsx(ArrayBuffer)`
- 支持浏览器内读取/写入单工作簿
- 支持浏览器内返回结构化表格结果，供前端自行渲染
- 不支持浏览器内直接读写本地路径
- 不支持浏览器内配置文件加载
- CLI 继续保留在 Node 侧

**步骤 2：统一包名方向**

要求：
- npm 包名目标调整为 `pubtab-js`
- Node CLI 名称同步评估为 `pubtab-js`
- 文档中不再把项目定位为纯 Node 包，而是双端包

**步骤 3：运行现有测试建立基线**

运行：`pnpm test`
预期：PASS

**步骤 4：记录迁移验收条件**

验收条件至少包含：
- Node API/CLI 现有行为不回退
- 浏览器入口能在真实浏览器中完成一次 `.xlsx -> .tex`
- 浏览器入口能在真实浏览器中完成一次 `.tex -> .xlsx`
- 浏览器入口能产出可供前端渲染的结构化结果
- playground 能上传文件、展示结构化结果、下载结果

---

### 任务 2：提炼纯核心 API，切开 Node I/O 与工作簿逻辑

**文件：**
- 创建：`src/core/workbook.ts`
- 创建：`src/core/table.ts`
- 创建：`src/core/view-model.ts`
- 修改：`src/excel.ts`
- 修改：`src/index.ts`
- 测试：`tests/browser/core.browser.test.ts`

**步骤 1：先写失败的纯核心测试**

新增测试覆盖：
- 从 ExcelJS `Worksheet` 读取为 `TableData`
- 从 `TableData` 写回 ExcelJS `Workbook`
- 从 `TableData` 派生前端消费结果
- 不依赖 `fs/path/process`

测试样例优先复用现有 fixture 语义：
- merged cells
- rich text
- headerRows
- rotation / bgColor / alignment
- header/body 分区
- 可稳定映射到前端列定义与单元格矩阵

**步骤 2：运行测试验证失败**

运行：`pnpm vitest run tests/browser/core.browser.test.ts`
预期：FAIL，提示缺少新核心 API 或导出错误

**步骤 3：写最小实现**

抽出两层纯函数：
- `tableFromWorksheet(worksheet, opts) => TableData`
- `workbookFromTable(table) => Workbook`
- `tableToViewModel(table) => TableViewModel`

要求：
- 纯函数文件禁止引入 `node:` 模块
- `src/excel.ts` 只保留 Node 路径/目录包装逻辑
- 复用现有 `readTex`、`render`、`models`、`themes`、`utils`
- `TableViewModel` 的设计参考 TanStack Table 消费方式，而不是直接生成 HTML

**步骤 4：运行测试验证通过**

运行：`pnpm vitest run tests/browser/core.browser.test.ts`
预期：PASS

---

### 任务 3：新增浏览器入口 API 与前端消费结果

**文件：**
- 创建：`src/browser.ts`
- 修改：`src/index.ts`
- 修改：`package.json`
- 测试：`tests/browser/api.browser.test.ts`

**步骤 1：写失败的浏览器 API 测试**

测试覆盖以下 API 形态：
- `xlsxBufferToTex(input: ArrayBuffer, options?) => Promise<string>`
- `texToXlsxBuffer(tex: string) => Promise<ArrayBuffer>`
- `readWorkbookBuffer(input: ArrayBuffer, options?) => Promise<TableData>`
- `tableToXlsxBuffer(table: TableData) => Promise<ArrayBuffer>`
- `xlsxToTableResult(input: ArrayBuffer | Blob | File, options?) => Promise<TableResult>`
- `texToTableResult(input: string, options?) => Promise<TableResult>`
- `xlsxToTex(input: ArrayBuffer | Blob | File, options?) => Promise<{ tex: string; table: TableResult }>`
- `texToXlsx(input: string, options?) => Promise<{ buffer: ArrayBuffer; blob: Blob; table: TableResult; filename: string; mimeType: string }>`

**步骤 2：运行测试验证失败**

运行：`pnpm vitest run tests/browser/api.browser.test.ts`
预期：FAIL，提示缺少浏览器入口

**步骤 3：写最小实现**

实现方式：
- 使用 `new ExcelJS.Workbook()`
- 浏览器读入走 `workbook.xlsx.load(buffer)`
- 浏览器写出走 `workbook.xlsx.writeBuffer()`
- API 中不接受文件路径，只接受内存对象
- 对 `File/Blob` 做薄包装，底层统一到 `ArrayBuffer`
- 高层 API 同时返回原始转换产物和结构化 `TableResult`

**步骤 4：调整导出策略**

要求：
- `src/index.ts` 不再无条件把 Node 版 `xlsx2tex/texToExcel/readExcel` 暴露给浏览器 bundle
- 增加明确入口，例如：
  - Node：`pubtab-js`
  - Browser：`pubtab-js/browser`
- `package.json` 增加 `exports` 显式入口，避免浏览器打包时误入 `src/excel.ts`

**步骤 5：运行测试验证通过**

运行：`pnpm vitest run tests/browser/api.browser.test.ts`
预期：PASS

---

### 任务 4：保住 Node 兼容层与 CLI

**文件：**
- 修改：`src/excel.ts`
- 修改：`src/cli.ts`
- 修改：`src/config.ts`
- 测试：`tests/pubtab.test.ts`
- 测试：`tests/cli.test.ts`
- 测试：`tests/cli.config.test.ts`

**步骤 1：写或补失败回归测试**

如果拆分导出后有风险，补一组回归：
- `xlsx2tex(path, out, opts)` 仍可用
- `texToExcel(path, out)` 仍可用
- CLI 两个命令仍可用
- config 读取行为不变

**步骤 2：运行 Node 回归测试验证失败**

运行：`pnpm vitest run tests/pubtab.test.ts tests/cli.test.ts tests/cli.config.test.ts`
预期：如果拆分破坏导出或行为，则 FAIL

**步骤 3：写最小修复**

要求：
- Node 层只做路径解析、单文件读写
- CLI 继续只依赖 Node 入口
- `config.ts` 保持 Node 专属，不进入浏览器入口依赖图

**步骤 4：运行测试验证通过**

运行：`pnpm vitest run tests/pubtab.test.ts tests/cli.test.ts tests/cli.config.test.ts`
预期：PASS

---

### 任务 5：建立真实浏览器测试项目

**文件：**
- 创建：`vitest.config.ts`
- 创建：`tests/browser/setup.ts`
- 创建：`tests/browser/fixtures.ts`
- 修改：`package.json`

**步骤 1：写测试配置**

采用 Vitest projects：
- `node` project 继续跑现有测试
- `browser` project 只跑 `tests/browser/**/*.browser.test.ts`

浏览器项目配置：
- `browser.enabled = true`
- `browser.provider = playwright()`
- `browser.instances = [{ browser: 'chromium' }]`
- 默认 headless

**步骤 2：安装缺失依赖**

运行：`pnpm add -D vite @vitest/browser-playwright playwright`
预期：依赖安装成功

**步骤 3：跑空配置验证**

运行：`pnpm vitest run --project browser`
预期：可以启动 Chromium，即使测试数为 0 或少量 PASS

**步骤 4：把浏览器测试接入 CI 预期命令**

在 `package.json` 增加：
- `test`
- `test:node`
- `test:browser`

建议命令：
- `pnpm test:node`
- `pnpm test:browser`
- `pnpm test`

---

### 任务 6：补浏览器端 fixture、结构结果与回归测试

**文件：**
- 创建：`tests/browser/xlsx-to-tex.browser.test.ts`
- 创建：`tests/browser/tex-to-xlsx.browser.test.ts`
- 创建：`tests/browser/table-result.browser.test.ts`
- 复用：`tests/fixtures/*`

**步骤 1：写失败的 `.xlsx -> .tex` 浏览器测试**

测试方式：
- 读取 fixture `.xlsx` 为 `ArrayBuffer`
- 调用 `xlsxBufferToTex` 与 `xlsxToTableResult`
- 用 `readTex` 解析结果
- 断言 `numRows/numCols/headerRows` 与预期一致
- 对关键内容断言字符串包含或结构匹配
- 对 `columns`、`rows`、`cells`、span 元数据做结构断言

**步骤 2：写失败的 `.tex -> .xlsx` 浏览器测试**

测试方式：
- 读取 fixture `.tex`
- 调用 `texToXlsxBuffer`
- 调用 `texToTableResult`
- 再用 ExcelJS `workbook.xlsx.load` 读回
- 断言单元格值、合并信息、基础样式字段
- 断言结构结果足以支撑前端渲染

**步骤 3：运行浏览器测试验证失败**

运行：`pnpm vitest run --project browser`
预期：FAIL，暴露浏览器环境真实问题

**步骤 4：写最小修复直到通过**

重点处理：
- `ArrayBuffer` / `Uint8Array` 兼容
- ExcelJS 在浏览器中的细节差异
- 富文本、颜色、merge model 在浏览器/Node 下的一致性
- 结构结果与前端消费的稳定性

**步骤 5：运行测试验证通过**

运行：`pnpm vitest run --project browser`
预期：PASS

---

### 任务 7：实现 Vue + TanStack Table 风格的最小 playground

**文件：**
- 创建：`playground/index.html`
- 创建：`playground/main.ts`
- 创建：`playground/App.vue`
- 创建：`playground/style.css`
- 创建：`vite.config.ts`
- 修改：`package.json`

**步骤 1：写失败的 playground 冒烟测试**

新增浏览器测试覆盖：
- 选择 `.xlsx` 文件后可生成 `.tex`
- 选择 `.tex` 文件后可生成 `.xlsx`
- 结构化结果可被页面消费并渲染为表格
- 页面显示错误消息而不是静默失败

**步骤 2：运行测试验证失败**

运行：`pnpm vitest run tests/browser/playground.browser.test.ts`
预期：FAIL，页面或入口不存在

**步骤 3：写最小 playground**

UI 只保留最小闭环：
- 一个模式切换：`xlsx -> tex` / `tex -> xlsx`
- 一个文件上传控件
- 一个 options 区，只保留 `sheet` / `headerRows` / `caption` 等少量字段
- 一个输出区：tex 文本预览、结构结果预览、下载按钮
- 一个错误区

实现要求：
- 使用 Vue
- 结构结果的消费方式参考 TanStack Table 的列/数据分离思路
- 不在库内生成 HTML helper，playground 内自行把 `TableResult` 映射到表格 UI

**步骤 4：补开发命令**

在 `package.json` 增加：
- `playground`
- `build:playground`

建议命令：
- `pnpm playground`
- `pnpm build:playground`

**步骤 5：运行冒烟测试验证通过**

运行：`pnpm vitest run tests/browser/playground.browser.test.ts`
预期：PASS

---

### 任务 8：文档、示例与最终验证

**文件：**
- 修改：`README.md`
- 修改：`README_zh.md`
- 修改：`package.json`

**步骤 1：补文档**

README 至少新增：
- 浏览器 API 示例
- playground 本地启动方式
- Node 与 Browser 入口区别
- `TableResult` 数据结构说明
- 已知限制

**步骤 2：运行完整验证**

运行：`pnpm test`
预期：PASS

运行：`pnpm build`
预期：PASS

运行：`pnpm build:playground`
预期：PASS

**步骤 3：人工验证 playground**

运行：`pnpm playground`
预期：
- 上传 fixture `.xlsx` 能看到 tex 输出
- 上传 fixture `.tex` 能下载 xlsx
- 错误输入能在界面提示

---

### 任务 9：收口与发布前检查

**文件：**
- 修改：`package.json`
- 修改：`README.md`
- 修改：`README_zh.md`

**步骤 1：确认发布策略**

至少确认：
- npm 包名切换为 `pubtab-js` 的可用性与迁移策略
- 是否增加 `/browser` 子入口
- 是否需要把 playground 排除在发布产物之外

**步骤 2：检查最终风险**

重点风险：
- `src/index.ts` 当前直接导出 `src/excel.ts`，浏览器 bundler 很可能被 `node:path`/`node:fs/promises` 卡住
- ExcelJS 浏览器支持的是内存 I/O，不等于现有路径 API 可直接搬运
- 浏览器测试如果只跑 `jsdom`，很可能漏掉真实二进制与下载链路问题
- `TableResult` 如果过度贴近某个 UI 框架，会反过来限制库的长期 API 稳定性

**步骤 3：提交前最终验证**

运行：
- `pnpm test`
- `pnpm build`
- `pnpm build:playground`

预期：全部 PASS
