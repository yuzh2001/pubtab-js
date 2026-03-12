<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { getCoreRowModel, useVueTable, type ColumnDef } from '@tanstack/vue-table';

import { texToXlsx, xlsxToTex } from '../../src/browser.js';
import type { TableDataRow, TableRenderCell, TableResult, Xlsx2TexOptions } from '../../src/models.js';

const mode = ref<'xlsx-to-tex' | 'tex-to-xlsx'>('xlsx-to-tex');
const sheet = ref('');
const headerRows = ref('auto');
const caption = ref('');
const label = ref('');
const texInput = ref('');
const error = ref('');
const texOutput = ref('');
const result = ref<TableResult | null>(null);
const downloadUrl = ref('');
const downloadName = ref('');
const busy = ref(false);

function cleanupDownloadUrl(): void {
  if (downloadUrl.value) {
    URL.revokeObjectURL(downloadUrl.value);
    downloadUrl.value = '';
  }
}

onBeforeUnmount(() => {
  cleanupDownloadUrl();
});

const isTexToXlsxMode = computed(() => mode.value === 'tex-to-xlsx');
const canConvertTexInput = computed(() => texInput.value.trim().length > 0 && !busy.value);

function parseOptions(): Xlsx2TexOptions {
  const opts: Xlsx2TexOptions = {};
  const header = headerRows.value.trim();
  const sheetValue = sheet.value.trim();
  if (header === 'auto') {
    opts.headerRows = 'auto';
  } else if (header) {
    const parsed = Number(header);
    if (Number.isFinite(parsed)) opts.headerRows = parsed;
  }
  if (sheetValue) {
    opts.sheet = /^\d+$/u.test(sheetValue) ? Number(sheetValue) : sheetValue;
  }
  if (caption.value.trim()) opts.caption = caption.value.trim();
  if (label.value.trim()) opts.label = label.value.trim();
  return opts;
}

const tanstackColumns = computed<ColumnDef<TableDataRow>[]>(() => {
  return (result.value?.columns ?? []).map((column) => ({
    id: column.id,
    accessorFn: (row) => row.values[column.accessorKey],
    header: column.header,
  }));
});

const table = useVueTable<TableDataRow>({
  get data() {
    return result.value?.data ?? [];
  },
  get columns() {
    return tanstackColumns.value;
  },
  getCoreRowModel: getCoreRowModel(),
});

const summary = computed(() => {
  if (!result.value) return null;
  return {
    totalRows: result.value.table.numRows,
    leafColumns: table.getAllLeafColumns().length,
    headerDepth: result.value.headerDepth,
    bodyRows: table.getRowModel().rows.length,
  };
});

const previewRows = computed(() => {
  if (!result.value) return [];
  return [...result.value.headerRows, ...result.value.bodyRows];
});

const jsonOutput = computed(() => {
  if (!result.value) return '{}';
  return JSON.stringify({
    columns: result.value.columns,
    leafColumnIds: result.value.leafColumnIds,
    headerRows: result.value.headerRows.map((row) => row.cells.map((cell) => ({
      text: cell.text,
      rowSpan: cell.rowSpan,
      colSpan: cell.colSpan,
    }))),
    data: result.value.data.map((row) => ({
      id: row.id,
      values: row.values,
      cells: row.cells.map((cell) => ({
        text: cell.text,
        rowSpan: cell.rowSpan,
        colSpan: cell.colSpan,
      })),
    })),
  }, null, 2);
});

function cellAttrs(cell: TableRenderCell) {
  return {
    rowspan: cell.rowSpan > 1 ? cell.rowSpan : undefined,
    colspan: cell.colSpan > 1 ? cell.colSpan : undefined,
    'data-origin': `${cell.originRowIndex},${cell.originColIndex}`,
  };
}

function resetOutputs(): void {
  error.value = '';
  texOutput.value = '';
  result.value = null;
  cleanupDownloadUrl();
  downloadName.value = '';
}

async function handleFile(file: File): Promise<void> {
  resetOutputs();
  busy.value = true;
  try {
    if (mode.value === 'xlsx-to-tex') {
      const converted = await xlsxToTex(file, parseOptions());
      texOutput.value = converted.tex;
      result.value = converted.table;
      return;
    }

    const text = await file.text();
    const filename = `${file.name.replace(/\.[^.]+$/u, '') || 'table'}.xlsx`;
    const converted = await texToXlsx(text, { filename });
    result.value = converted.table;
    downloadName.value = converted.filename;
    downloadUrl.value = URL.createObjectURL(converted.blob);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  await handleFile(file);
}

async function convertTexInput(): Promise<void> {
  const text = texInput.value.trim();
  if (!text) return;

  resetOutputs();
  busy.value = true;
  try {
    const converted = await texToXlsx(text, { filename: 'pasted-table.xlsx' });
    result.value = converted.table;
    downloadName.value = converted.filename;
    downloadUrl.value = URL.createObjectURL(converted.blob);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <UApp>
    <main class="shell">
      <section class="hero">
        <p class="eyebrow">pubtab-js playground</p>
        <h1>TanStack-backed table preview with real rowSpan and colSpan.</h1>
        <p class="lede">上传单个 workbook 或 TeX 表格，直接检查真实合并单元格，而不是占位网格。</p>
      </section>

      <section class="controls">
        <label class="control">
          <span>Mode</span>
          <select v-model="mode" data-testid="mode-select">
            <option value="xlsx-to-tex">xlsx -&gt; tex</option>
            <option value="tex-to-xlsx">tex -&gt; xlsx</option>
          </select>
        </label>

        <label class="control">
          <span>Sheet</span>
          <input v-model="sheet" data-testid="sheet-input" placeholder="0 / Sheet1" />
        </label>

        <label class="control">
          <span>Header Rows</span>
          <input v-model="headerRows" data-testid="header-rows-input" placeholder="auto / 1 / 2" />
        </label>

        <label class="control">
          <span>Caption</span>
          <input v-model="caption" data-testid="caption-input" placeholder="Optional caption" />
        </label>

        <label class="control control-wide">
          <span>Label</span>
          <input v-model="label" data-testid="label-input" placeholder="tab:example" />
        </label>

        <label class="control control-wide">
          <span>{{ mode === 'xlsx-to-tex' ? 'Upload .xlsx' : 'Upload .tex (optional)' }}</span>
          <input
            type="file"
            :accept="mode === 'xlsx-to-tex' ? '.xlsx' : '.tex,.txt'"
            data-testid="file-input"
            @change="onFileChange"
          />
        </label>

        <div v-if="isTexToXlsxMode" class="control control-wide control-stack">
          <span>Paste TeX</span>
          <UTextarea
            v-model="texInput"
            :rows="10"
            autoresize
            data-testid="tex-input"
            placeholder="\\begin{tabular}{cc}&#10;A &amp; B \\\\&#10;1 &amp; 2 \\\\&#10;\\end{tabular}"
          />
          <div class="action-row">
            <UButton data-testid="tex-submit" :disabled="!canConvertTexInput" @click="convertTexInput">
              Convert TeX Text
            </UButton>
          </div>
        </div>
      </section>

      <p v-if="busy" class="status" data-testid="busy">Converting...</p>
      <p v-if="error" class="error" data-testid="error">{{ error }}</p>

      <section v-if="summary" class="summary" data-testid="summary">
        <div>
          <span class="meta-label">Rows</span>
          <strong>{{ summary.totalRows }}</strong>
        </div>
        <div>
          <span class="meta-label">Leaf Columns</span>
          <strong>{{ summary.leafColumns }}</strong>
        </div>
        <div>
          <span class="meta-label">Header Depth</span>
          <strong>{{ summary.headerDepth }}</strong>
        </div>
        <div>
          <span class="meta-label">Body Rows</span>
          <strong>{{ summary.bodyRows }}</strong>
        </div>
      </section>

      <section v-if="downloadUrl" class="download">
        <a :href="downloadUrl" :download="downloadName" data-testid="download-link">Download {{ downloadName }}</a>
      </section>

      <section class="panel">
        <div class="section-head">
          <h2>Structured Preview</h2>
        </div>

        <div v-if="result" class="table-wrap">
          <table class="result-table" data-testid="result-table">
            <tbody>
              <tr v-for="row in previewRows" :key="row.id">
                <td v-for="cell in row.cells" :key="cell.id" v-bind="cellAttrs(cell)">
                  {{ cell.text }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="placeholder">转换后会在这里显示真实合并单元格预览。</p>
      </section>

      <section class="panel">
        <div class="section-head">
          <h2>Raw Output</h2>
        </div>
        <pre v-if="texOutput" class="code-output" data-testid="tex-output">{{ texOutput }}</pre>
        <pre v-else class="code-output" data-testid="result-json">{{ jsonOutput }}</pre>
      </section>
    </main>
  </UApp>
</template>
