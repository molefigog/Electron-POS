<template>
  <q-page class="q-pa-md">
    <div class="row items-center q-mb-md">
      <div class="text-h5">Products</div>
      <q-space />
      <q-input v-model="search" dense filled clearable placeholder="Search products..." style="width: 260px"
        class="q-mr-sm" @update:model-value="load" />
      <q-btn flat color="primary" icon="select_all" label="Select All Filtered" class="q-mr-sm"
        @click="selectAllFiltered" />
      <q-btn v-if="hasSelectedRows" flat color="grey-8" icon="deselect" label="Clear Selection" class="q-mr-sm"
        @click="clearSelection" />
      <q-btn v-if="hasSelectedRows" flat color="negative" icon="delete_sweep"
        :label="`Delete Selected (${selectedRows.length})`" class="q-mr-sm" @click="deleteSelected" />
      <q-btn v-if="hasSelectedRows" flat color="primary" icon="download"
        :label="`Export Selected (${selectedRows.length})`" class="q-mr-sm" @click="exportSelectedCsv" />
      <q-btn flat color="primary" icon="upload_file" label="Import CSV" class="q-mr-sm" @click="showImport = true" />
      <q-btn color="primary" icon="add" label="New Product" @click="openForm(null)" />
    </div>

    <q-table flat bordered :rows="productsStore.items" :columns="columns" row-key="id" :loading="productsStore.loading"
      selection="multiple" v-model:selected="selectedRows" v-model:pagination="pagination"
      :rows-per-page-options="[20, 50, 100]">
      <template #body-cell-stock_qty="props">
        <q-td :props="props">
          <q-badge :color="props.row.stock_qty <= props.row.reorder_level ? 'negative' : 'positive'">{{ props.value
          }}</q-badge>
        </q-td>
      </template>
      <template #body-cell-actions="props">
        <q-td :props="props" class="q-gutter-x-xs">
          <q-btn dense flat round icon="edit" @click="openForm(props.row)" />
          <q-btn dense flat round icon="delete" color="negative" @click="remove(props.row)" />
        </q-td>
      </template>
    </q-table>

    <q-dialog v-model="showForm">
      <q-card style="min-width: 480px">
        <q-card-section class="text-h6">{{ form.id ? 'Edit' : 'New' }} Product</q-card-section>
        <q-card-section class="q-gutter-sm">
          <q-input v-model="form.name" label="Name *" filled />
          <div class="row q-col-gutter-sm">
            <div class="col-6"><q-input v-model="form.sku" label="SKU" filled /></div>
            <div class="col-6"><q-input v-model="form.barcode" label="Barcode" filled /></div>
          </div>
          <div class="row q-col-gutter-sm">
            <div class="col-6"><q-input v-model.number="form.cost_price" type="number" label="Cost Price" filled />
            </div>
            <div class="col-6"><q-input v-model.number="form.selling_price" type="number"
                label="Selling Price * (tax incl.)" filled
                hint="What the customer pays - tax is included, not added on top" /></div>
          </div>
          <div class="row q-col-gutter-sm">
            <div class="col-6"><q-input v-model.number="form.reorder_level" type="number" label="Reorder Level"
                filled />
            </div>
            <div class="col-6">
              <q-select v-model="form.category_id" :options="categoryOptions" emit-value map-options label="Category"
                filled clearable />
            </div>
          </div>
          <q-select v-model="form.tax_id" :options="taxOptions" emit-value map-options label="Tax" filled clearable />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn color="primary" label="Save" :loading="saving" @click="save" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="showImport">
      <q-card style="min-width: 620px; max-width: 92vw;">
        <q-card-section class="text-h6">Import Products from CSV</q-card-section>
        <q-card-section class="q-gutter-sm">
          <div class="text-caption text-grey">
            Required columns: <strong>name</strong>, <strong>selling_price</strong>.
            Optional: sku, barcode, cost_price, reorder_level, category_id/category, tax_id/tax.
          </div>
          <q-file v-model="csvFile" label="Choose CSV file" filled accept=".csv,text/csv" @rejected="onCsvRejected">
            <template #prepend><q-icon name="table_view" /></template>
          </q-file>
          <div class="text-caption text-grey">
            Header names are case-insensitive. Example:
            name,sku,barcode,cost_price,selling_price,reorder_level,category,tax
          </div>
          <div class="text-caption text-grey">
            Legacy export without headers is also supported using this order:
            name, sku, barcode, cost_price, selling_price, stock_qty, reorder_level, tax_id, ...
          </div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn color="primary" label="Import" :loading="importing" @click="importCsv" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { useQuasar } from 'quasar';
import { useProductsStore } from 'src/stores/products';
import { BaseRepository } from 'src/services/repositories/BaseRepository';

const $q = useQuasar();
const productsStore = useProductsStore();
const search = ref('');
const showForm = ref(false);
const saving = ref(false);
const selectedRows = ref([]);
const pagination = ref({
  page: 1,
  rowsPerPage: 20,
  sortBy: 'name',
  descending: false,
});
const showImport = ref(false);
const csvFile = ref(null);
const importing = ref(false);
const categoryOptions = ref([]);
const taxOptions = ref([]);
const categoryByName = ref({});
const taxByName = ref({});
const hasSelectedRows = computed(() => selectedRows.value.length > 0);

const categoriesRepo = new BaseRepository('categories');
const taxesRepo = new BaseRepository('taxes');

const columns = [
  { name: 'name', label: 'Name', field: 'name', align: 'left', sortable: true },
  { name: 'sku', label: 'SKU', field: 'sku', align: 'left' },
  { name: 'barcode', label: 'Barcode', field: 'barcode', align: 'left' },
  { name: 'selling_price', label: 'Price', field: 'selling_price', align: 'right' },
  { name: 'stock_qty', label: 'Stock', field: 'stock_qty', align: 'right' },
  { name: 'category_name', label: 'Category', field: 'category_name', align: 'left' },
  { name: 'actions', label: '', field: 'actions', align: 'right' },
];

function emptyForm() {
  return { id: null, name: '', sku: '', barcode: '', cost_price: 0, selling_price: 0, reorder_level: 0, category_id: null, tax_id: null };
}
const form = reactive(emptyForm());

function openForm(product) {
  Object.assign(form, product ? { ...product } : emptyForm());
  showForm.value = true;
}

async function save() {
  if (!form.name || !form.selling_price) {
    $q.notify({ type: 'warning', message: 'Name and selling price are required' });
    return;
  }
  saving.value = true;
  try {
    if (form.id) await productsStore.update(form.id, form);
    else await productsStore.create(form);
    showForm.value = false;
    $q.notify({ type: 'positive', message: 'Product saved' });
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message });
  } finally {
    saving.value = false;
  }
}

function remove(row) {
  $q.dialog({ title: 'Delete', message: `Delete ${row.name}?`, cancel: true }).onOk(async () => {
    await productsStore.remove(row.id);
  });
}

function clearSelection() {
  selectedRows.value = [];
}

function selectAllFiltered() {
  if (!productsStore.items.length) {
    $q.notify({ type: 'warning', message: 'No products found for current filter' });
    return;
  }

  selectedRows.value = [...productsStore.items];
  $q.notify({ type: 'positive', message: `Selected ${selectedRows.value.length} product(s)` });
}

async function deleteSelected() {
  if (!selectedRows.value.length) {
    $q.notify({ type: 'warning', message: 'Select one or more products first' });
    return;
  }

  $q.dialog({
    title: 'Delete Selected Products',
    message: `Delete ${selectedRows.value.length} selected product(s)?`,
    cancel: true,
    persistent: true,
  }).onOk(async () => {
    const rows = [...selectedRows.value];
    const failures = [];

    for (const row of rows) {
      try {
        await productsStore.remove(row.id);
      } catch (err) {
        failures.push(`${row.name}: ${err.message}`);
      }
    }

    clearSelection();
    await load();

    if (!failures.length) {
      $q.notify({ type: 'positive', message: `Deleted ${rows.length} product(s)` });
      return;
    }

    $q.notify({
      type: 'warning',
      message: `Deleted ${rows.length - failures.length}/${rows.length}. ${failures[0]}`,
      timeout: 9000,
    });
  });
}

function escapeCsvValue(value) {
  const raw = value === null || value === undefined ? '' : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

function exportSelectedCsv() {
  if (!selectedRows.value.length) {
    $q.notify({ type: 'warning', message: 'Select one or more products first' });
    return;
  }

  const headers = [
    'name',
    'sku',
    'barcode',
    'cost_price',
    'selling_price',
    'stock_qty',
    'reorder_level',
    'category_id',
    'tax_id',
  ];

  const lines = [
    headers.join(','),
    ...selectedRows.value.map((row) => headers.map((key) => escapeCsvValue(row[key])).join(',')),
  ];

  const csvContent = lines.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = `products-selected-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  $q.notify({ type: 'positive', message: `Exported ${selectedRows.value.length} product(s)` });
}

function load() {
  productsStore.fetchAll({ search: search.value });
}

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function parseCsvLine(line) {
  const out = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      out.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  out.push(current.trim());
  return out;
}

function parseCsv(text) {
  const lines = String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (!lines.length) return [];

  const firstCols = parseCsvLine(lines[0]);
  const firstHeaders = firstCols.map(normalizeKey);

  const knownHeaderSet = new Set([
    'name', 'product_name', 'sku', 'barcode', 'cost_price', 'selling_price', 'price',
    'stock_qty', 'reorder_level', 'category', 'category_name', 'category_id', 'tax', 'tax_name', 'tax_id',
  ]);

  const headerLikeCount = firstHeaders.filter((key) => knownHeaderSet.has(key)).length;
  const isHeaderRow = headerLikeCount >= 2;

  if (isHeaderRow) {
    return lines.slice(1).map((line) => {
      const cols = parseCsvLine(line);
      const row = {};
      firstHeaders.forEach((key, idx) => {
        row[key] = cols[idx] ?? '';
      });
      row.__sourceType = 'header';
      return row;
    });
  }

  // Legacy DB export (no header):
  // 0 name, 1 sku, 2 barcode, 3 cost_price, 4 selling_price,
  // 5 stock_qty, 6 reorder_level, 7 tax_id, 8 category_id, ...
  return lines.map((line) => {
    const cols = parseCsvLine(line);
    return {
      name: cols[0] ?? '',
      sku: cols[1] ?? '',
      barcode: cols[2] ?? '',
      cost_price: cols[3] ?? '',
      selling_price: cols[4] ?? '',
      stock_qty: cols[5] ?? '',
      reorder_level: cols[6] ?? '',
      tax_id: cols[7] ?? '',
      category_id: cols[8] ?? '',
      __sourceType: 'legacy',
    };
  });
}

function readNumeric(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function resolveCategoryId(row) {
  if (row.category_id) return Number(row.category_id) || null;
  const categoryName = row.category || row.category_name;
  if (!categoryName) return null;
  return categoryByName.value[normalizeKey(categoryName)] || null;
}

function resolveTaxId(row) {
  if (row.tax_id) return Number(row.tax_id) || null;
  const taxName = row.tax || row.tax_name;
  if (!taxName) return null;
  return taxByName.value[normalizeKey(taxName)] || null;
}

async function applyStockQtyFromImport(productId, stockQty) {
  const qty = readNumeric(stockQty, 0);
  if (!qty || qty <= 0) return;

  await window.dbBridge.call('stock', 'record', [{
    productId,
    type: 'in',
    quantity: qty,
    reason: 'Imported opening stock from CSV',
  }]);
}

function onCsvRejected() {
  $q.notify({ type: 'warning', message: 'Please select a valid CSV file' });
}

async function importCsv() {
  if (!csvFile.value) {
    $q.notify({ type: 'warning', message: 'Choose a CSV file first' });
    return;
  }

  importing.value = true;
  try {
    const text = await csvFile.value.text();
    const rows = parseCsv(text);

    if (!rows.length) {
      $q.notify({ type: 'warning', message: 'CSV file is empty' });
      return;
    }

    let successCount = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const name = (row.name || row.product_name || '').trim();
      const sellingPriceRaw = row.selling_price || row.price;

      if (!name || sellingPriceRaw === null || sellingPriceRaw === undefined || String(sellingPriceRaw).trim() === '') {
        errors.push(`Row ${i + 2}: name and selling_price are required`);
        continue;
      }

      try {
        const created = await productsStore.create({
          name,
          sku: (row.sku || '').trim() || null,
          barcode: (row.barcode || '').trim() || null,
          cost_price: readNumeric(row.cost_price, 0),
          selling_price: readNumeric(sellingPriceRaw, 0),
          reorder_level: readNumeric(row.reorder_level, 0),
          category_id: resolveCategoryId(row),
          tax_id: resolveTaxId(row),
        });

        // Legacy exports include opening stock as stock_qty.
        await applyStockQtyFromImport(created.id, row.stock_qty);
        successCount += 1;
      } catch (err) {
        errors.push(`Row ${i + 2}: ${err.message}`);
      }
    }

    await load();

    if (successCount > 0) {
      $q.notify({ type: 'positive', message: `Imported ${successCount} product(s)` });
      showImport.value = false;
      csvFile.value = null;
    }

    if (errors.length) {
      $q.notify({
        type: 'warning',
        message: `Skipped ${errors.length} row(s). ${errors.slice(0, 2).join(' | ')}`,
        timeout: 9000,
      });
    }
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message || 'Could not import CSV' });
  } finally {
    importing.value = false;
  }
}

onMounted(async () => {
  await load();
  const categories = await categoriesRepo.call('all');
  const taxes = await taxesRepo.call('all');

  categoryOptions.value = categories.map((c) => ({ label: c.name, value: c.id }));
  taxOptions.value = taxes.map((t) => ({ label: `${t.name} (${t.rate}%)`, value: t.id }));

  categoryByName.value = Object.fromEntries(categories.map((c) => [normalizeKey(c.name), c.id]));
  taxByName.value = Object.fromEntries(taxes.map((t) => [normalizeKey(t.name), t.id]));
});
</script>
