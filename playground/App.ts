import { defineComponent, h, onBeforeUnmount, ref } from 'vue';

import { texToXlsx, xlsxToTex } from '../src/browser.js';
import type { TableCellView, TableResult, Xlsx2TexOptions } from '../src/models.js';

export default defineComponent({
  name: 'PlaygroundApp',
  setup() {
    const mode = ref<'xlsx-to-tex' | 'tex-to-xlsx'>('xlsx-to-tex');
    const sheet = ref('');
    const headerRows = ref('auto');
    const caption = ref('');
    const label = ref('');
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

    function renderPreviewCell(tag: 'th' | 'td', cell: TableCellView) {
      if (cell.isPlaceholder) return null;
      return h(tag, {
        key: cell.id,
        rowspan: cell.rowspan > 1 ? cell.rowspan : undefined,
        colspan: cell.colspan > 1 ? cell.colspan : undefined,
        'data-origin': `${cell.originRowIndex},${cell.originColIndex}`,
      }, cell.text);
    }

    async function handleFile(file: File): Promise<void> {
      error.value = '';
      texOutput.value = '';
      result.value = null;
      cleanupDownloadUrl();
      downloadName.value = '';
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

    return () => h('main', { class: 'shell' }, [
      h('section', { class: 'hero' }, [
        h('p', { class: 'eyebrow' }, 'pubtab-js playground'),
        h('h1', null, 'Browser-side table conversion with a frontend-shaped result.'),
        h('p', { class: 'lead' }, 'Upload a single workbook or TeX table, inspect the structured result, and verify the conversion path in Chromium.'),
      ]),
      h('section', { class: 'panel controls' }, [
        h('div', { class: 'field-row' }, [
          h('label', { class: 'field' }, [
            h('span', null, 'Mode'),
            h('select', {
              value: mode.value,
              'data-testid': 'mode-select',
              onChange: (event: Event) => {
                mode.value = (event.target as HTMLSelectElement).value as typeof mode.value;
              },
            }, [
              h('option', { value: 'xlsx-to-tex' }, 'xlsx -> tex'),
              h('option', { value: 'tex-to-xlsx' }, 'tex -> xlsx'),
            ]),
          ]),
          h('label', { class: 'field' }, [
            h('span', null, 'Sheet'),
            h('input', {
              value: sheet.value,
              placeholder: '0 / Sheet1',
              'data-testid': 'sheet-input',
              onInput: (event: Event) => { sheet.value = (event.target as HTMLInputElement).value; },
            }),
          ]),
        ]),
        h('div', { class: 'field-row' }, [
          h('label', { class: 'field' }, [
            h('span', null, 'Header Rows'),
            h('input', {
              value: headerRows.value,
              placeholder: 'auto / 1 / 2',
              'data-testid': 'header-rows-input',
              onInput: (event: Event) => { headerRows.value = (event.target as HTMLInputElement).value; },
            }),
          ]),
          h('label', { class: 'field' }, [
            h('span', null, 'Caption'),
            h('input', {
              value: caption.value,
              placeholder: 'Optional caption',
              'data-testid': 'caption-input',
              onInput: (event: Event) => { caption.value = (event.target as HTMLInputElement).value; },
            }),
          ]),
        ]),
        h('label', { class: 'field' }, [
          h('span', null, 'Label'),
          h('input', {
            value: label.value,
            placeholder: 'tab:example',
            'data-testid': 'label-input',
            onInput: (event: Event) => { label.value = (event.target as HTMLInputElement).value; },
          }),
        ]),
        h('label', { class: 'field' }, [
          h('span', null, mode.value === 'xlsx-to-tex' ? 'Upload .xlsx' : 'Upload .tex'),
          h('input', {
            type: 'file',
            accept: mode.value === 'xlsx-to-tex' ? '.xlsx' : '.tex,.txt',
            'data-testid': 'file-input',
            onChange: onFileChange,
          }),
        ]),
        error.value ? h('p', { class: 'error', 'data-testid': 'error' }, error.value) : null,
      ]),
      busy.value ? h('p', { class: 'placeholder', 'data-testid': 'busy' }, 'Converting...') : null,
      result.value ? h('section', { class: 'panel meta', 'data-testid': 'summary' }, [
        h('span', null, `Rows ${result.value.table.numRows}`),
        h('span', null, `Cols ${result.value.table.numCols}`),
        h('span', null, `Header Rows ${result.value.table.headerRows}`),
        h('span', null, `Spans ${result.value.spans.length}`),
      ]) : null,
      downloadUrl.value ? h('section', { class: 'panel' }, [
        h('a', {
          href: downloadUrl.value,
          download: downloadName.value,
          'data-testid': 'download-link',
        }, `Download ${downloadName.value}`),
      ]) : null,
      h('section', { class: 'grid' }, [
        h('article', { class: 'panel' }, [
          h('div', { class: 'section-head' }, [h('h2', null, 'Structured Result')]),
          result.value ? h('div', { class: 'preview-wrap' }, [
            h('table', { class: 'preview-table', 'data-testid': 'result-table' }, [
              h('thead', null, result.value.headerRows.map((row) => h('tr', { key: row.id }, row.cells.map((cell) => renderPreviewCell('th', cell))))),
              h('tbody', null, result.value.bodyRows.map((row) => h('tr', { key: row.id }, row.cells.map((cell) => renderPreviewCell('td', cell))))),
            ]),
          ]) : h('p', { class: 'placeholder' }, '转换后会在这里显示结构结果和表格预览。'),
        ]),
        h('article', { class: 'panel' }, [
          h('div', { class: 'section-head' }, [h('h2', null, 'Raw Output')]),
          texOutput.value
            ? h('pre', { class: 'code-output', 'data-testid': 'tex-output' }, texOutput.value)
            : h('pre', { class: 'code-output', 'data-testid': 'result-json' }, JSON.stringify(result.value ? {
              columns: result.value.columns,
              headerRows: result.value.headerRows.map((row) => row.cells.map((cell) => cell.text)),
              firstBodyRow: result.value.bodyRows[0]?.cells.map((cell) => cell.text) ?? [],
              spans: result.value.spans,
            } : {}, null, 2)),
        ]),
      ]),
    ]);
  },
});
