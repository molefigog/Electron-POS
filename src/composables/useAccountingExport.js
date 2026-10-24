import * as XLSX from 'xlsx';
import { useAccountingUi, localISO } from './useAccountingUi';

/**
 * Exports any "report table" - { title, subtitle?, columns:[{key,label,type?}],
 * rows:[{...}], totals?:{key:number}, meta? } - to CSV, Excel (.xlsx) or JSON.
 * The same shape comes back from AccountingRepository.report(), so every report
 * and every list in the accounting screens exports through this one function.
 * Files are saved through the Electron "Save as" dialog (appBridge.saveFile);
 * outside Electron it falls back to a normal browser download.
 */

const FORMATS = {
  csv: { ext: 'csv', label: 'CSV', filters: [{ name: 'CSV file', extensions: ['csv'] }] },
  xlsx: { ext: 'xlsx', label: 'Excel', filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }] },
  json: { ext: 'json', label: 'JSON', filters: [{ name: 'JSON file', extensions: ['json'] }] },
};

const slug = (text) =>
  String(text || 'export').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'export';

const isNum = (col) => col.type === 'money' || col.type === 'number';

function cell(value, col) {
  if (value === null || value === undefined) return '';
  if (isNum(col)) {
    const n = Number(value);
    return Number.isFinite(n) ? n : '';
  }
  return value;
}

/** Header row + data rows (+ a Total row when the table has totals) as an array of arrays. */
export function tableToAoa(table) {
  const cols = table.columns;
  const aoa = [cols.map((c) => c.label)];
  for (const row of table.rows) aoa.push(cols.map((c) => cell(row[c.key], c)));
  if (table.totals) {
    aoa.push(cols.map((c, i) => (i === 0 ? 'Total' : c.key in table.totals ? cell(table.totals[c.key], c) : '')));
  }
  return aoa;
}

function csvField(value, col) {
  if (value === '' || value === null || value === undefined) return '';
  if (col?.type === 'money' && typeof value === 'number') return value.toFixed(2);
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(table) {
  const aoa = tableToAoa(table);
  const lines = aoa.map((row, r) =>
    row.map((v, i) => (r === 0 ? csvField(v) : csvField(v, table.columns[i]))).join(','),
  );
  return `\uFEFF${lines.join('\r\n')}\r\n`; // BOM so Excel opens UTF-8 correctly
}

export function toJson(table) {
  return JSON.stringify(
    {
      report: table.title,
      subtitle: table.subtitle || null,
      generatedAt: table.generatedAt || new Date().toISOString(),
      meta: table.meta || {},
      columns: table.columns.map(({ key, label, type }) => ({ key, label, type: type || 'text' })),
      rows: table.rows.map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith('_')))),
      totals: table.totals || null,
    },
    null,
    2,
  );
}

function sheetFor(table) {
  const head = [];
  if (table.meta?.company) head.push([table.meta.company]);
  head.push([table.title]);
  if (table.subtitle) head.push([table.subtitle]);
  head.push([]);
  const headerRowIndex = head.length;
  const aoa = head.concat(tableToAoa(table));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const dataRows = aoa.length - headerRowIndex;
  table.columns.forEach((col, c) => {
    if (col.type !== 'money') return;
    for (let r = headerRowIndex + 1; r < headerRowIndex + dataRows; r += 1) {
      const ref = ws[XLSX.utils.encode_cell({ r, c })];
      if (ref && typeof ref.v === 'number') ref.z = '#,##0.00';
    }
  });
  ws['!cols'] = table.columns.map((col, c) => {
    const longest = aoa.slice(headerRowIndex).reduce((m, row) => Math.max(m, String(row[c] ?? '').length), String(col.label).length);
    return { wch: Math.min(Math.max(longest + 2, 10), 48) };
  });
  return ws;
}

function sheetName(title, used) {
  let base = String(title).replace(/[\\/?*[\]:]+/g, '-').slice(0, 28).trim() || 'Sheet';
  let name = base;
  let n = 2;
  while (used.has(name.toLowerCase())) name = `${base.slice(0, 26)} ${n++}`;
  used.add(name.toLowerCase());
  return name;
}

export function toXlsxBase64(tables) {
  const list = Array.isArray(tables) ? tables : [tables];
  const wb = XLSX.utils.book_new();
  const used = new Set();
  for (const t of list) XLSX.utils.book_append_sheet(wb, sheetFor(t), sheetName(t.title, used));
  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
}

async function saveFile({ name, format, content, encoding }) {
  const fmt = FORMATS[format];
  if (window.appBridge?.saveFile) {
    return window.appBridge.saveFile({ defaultName: name, filters: fmt.filters, content, encoding });
  }
  // browser fallback (dev server outside Electron)
  const blob =
    encoding === 'base64'
      ? new Blob([Uint8Array.from(atob(content), (c) => c.charCodeAt(0))])
      : new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
  return { saved: true, path: name };
}

export function useAccountingExport() {
  const { ok, fail } = useAccountingUi();

  async function finish(result, label) {
    if (result?.saved) ok(`${label} saved${result.path ? `: ${result.path}` : ''}`);
  }

  /** format: 'csv' | 'xlsx' | 'json'. `table` may be an object or a function returning one (sync or async). */
  async function exportTable(format, table, baseName = null) {
    try {
      const t = typeof table === 'function' ? await table() : table;
      if (!t?.columns || !t.rows) throw new Error('Nothing to export');
      const name = `${baseName || slug(t.title)}-${localISO().replace(/-/g, '')}.${FORMATS[format].ext}`;
      const content = format === 'csv' ? toCsv(t) : format === 'json' ? toJson(t) : toXlsxBase64(t);
      const result = await saveFile({ name, format, content, encoding: format === 'xlsx' ? 'base64' : 'utf8' });
      await finish(result, FORMATS[format].label);
    } catch (err) {
      fail(err);
    }
  }

  /** One workbook with a sheet per table (xlsx), or one JSON file holding all of them. */
  async function exportPack(format, tables, baseName = 'accounting-pack') {
    try {
      const list = typeof tables === 'function' ? await tables() : tables;
      if (!list?.length) throw new Error('Nothing to export');
      const name = `${baseName}-${localISO().replace(/-/g, '')}.${FORMATS[format].ext}`;
      const content =
        format === 'json'
          ? JSON.stringify({ generatedAt: new Date().toISOString(), reports: list.map((t) => JSON.parse(toJson(t))) }, null, 2)
          : toXlsxBase64(list);
      const result = await saveFile({ name, format, content, encoding: format === 'xlsx' ? 'base64' : 'utf8' });
      await finish(result, FORMATS[format].label);
    } catch (err) {
      fail(err);
    }
  }

  return { exportTable, exportPack };
}
