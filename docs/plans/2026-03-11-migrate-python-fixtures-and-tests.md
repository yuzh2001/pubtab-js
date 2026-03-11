# 迁移 pubtab-python fixtures 并补齐对应测试 实施计划

> **给 Codex：** 必需子技能：使用 superpowers-zh:test-driven-development + superpowers-zh:verification-before-completion 逐任务实施此计划。

**目标：** 将 `./.pubtab-python/tests/fixtures` 下的测试夹具迁移到本仓库 `tests/fixtures`，并把 Python 原版 `test_roundtrip.py` 中基于 fixtures 的 round-trip / tex2xlsx 断言迁移为 Vitest 用例，锁定核心语义一致性。

**架构：** 以 fixtures 为源数据，在 Vitest 中通过调用 `texToExcel`、`xlsx2tex`、`readTex`，对比生成文件与 fixtures 的维度、单元格值、合并区域数量等关键行为。对比逻辑尽量复刻 Python 的 `_compare_xlsx`（字符串 trim + 数值容差）。

**技术栈：** Node.js ESM, Vitest, ExcelJS

---

### 任务 1：迁移 fixtures 到 `tests/fixtures`

**文件：**
- 创建：`tests/fixtures/`（目录）
- 创建：`tests/fixtures/*.xlsx`
- 创建：`tests/fixtures/*.tex`

**步骤 1：拷贝夹具文件**

来源：`./.pubtab-python/tests/fixtures/*`
目标：`./tests/fixtures/*`

**步骤 2：运行测试验证无副作用**

运行：`npm test`
预期：测试可运行（可能因后续未补测试而仍为绿）

---

### 任务 2：迁移 Python 的 tex→xlsx fixtures 测试

**文件：**
- 创建：`tests/fixtures.tex2xlsx.test.ts`

**步骤 1：写失败的测试（先红）**

覆盖 Python：
- `test_tex_to_xlsx_dimensions`
- `test_tex_to_xlsx_values_match`
- `test_tex_to_xlsx_merged_cells`

每个 table fixture（`table1/table2/table3/table4/table5/table6/table8`）：
1) `texToExcel(<name>.tex, tmp/<name>.xlsx)`
2) 载入 `tests/fixtures/<name>.xlsx` 与生成的 `tmp/<name>.xlsx`
3) 断言 `rowCount/columnCount` 一致
4) 断言合并区域数量一致
5) 逐 cell 对比值一致（trim + 数值容差）

**步骤 2：运行测试验证正确失败**

运行：`npm test -- tests/fixtures.tex2xlsx.test.ts`
预期：FAIL（在实现/fixtures 未就位之前）

**步骤 3：写最小实现（若需要）**

如果失败原因是实现缺失，修复 `src/texReader.ts` / `src/excel.ts` 的对应行为，直到用例通过。

**步骤 4：运行测试验证通过**

运行：`npm test -- tests/fixtures.tex2xlsx.test.ts`
预期：PASS

---

### 任务 3：迁移 Python 的 xlsx→tex→(parse) 维度一致测试

**文件：**
- 创建：`tests/fixtures.xlsx2tex-roundtrip.test.ts`

**步骤 1：写失败的测试（先红）**

覆盖 Python：`test_xlsx_to_tex_roundtrip`

对每个 table fixture：
1) `xlsx2tex(<name>.xlsx, tmp/<name>.tex)`
2) `readTex` 解析生成的 tex
3) 载入原始 xlsx，读取 `rowCount/columnCount`
4) 断言 `table.numRows/numCols` 与原始一致

**步骤 2：运行测试验证正确失败**

运行：`npm test -- tests/fixtures.xlsx2tex-roundtrip.test.ts`
预期：FAIL（如果维度不对齐）

**步骤 3：写最小实现（若需要）**

如果失败，修复 `src/excel.ts` 的 `tableFromWorksheet` 或 `src/texReader.ts` 的解析维度推导。

**步骤 4：运行测试验证通过**

运行：`npm test -- tests/fixtures.xlsx2tex-roundtrip.test.ts`
预期：PASS

---

### 任务 4：全量验证

**步骤 1：运行全套测试**

运行：`npm test`
预期：PASS

