<template>
  <section class="transaction-form">
    <q-banner v-if="draft.id" dense inline-actions class="transaction-form__edit-banner">
      Editing existing {{ docTypeLabel(draft.type) }}
      <template #action>
        <q-btn flat dense no-caps label="Done editing" @click="startFresh" />
      </template>
    </q-banner>

    <div class="transaction-form__meta row q-col-gutter-md items-start">
      <div class="col-4">
        <div class="row q-col-gutter-xs items-start no-wrap">
          <q-select v-model="draft.customerId" :options="customerOptions" emit-value map-options use-input
            label="Customer" clearable class="col" @filter="filterCustomers"
            hint="Leave blank for a walk-in customer" />
          <q-btn round dense color="primary" icon="add" class="q-mt-sm" @click="showNewCustomer = true">
            <q-tooltip>Add new customer</q-tooltip>
          </q-btn>
        </div>
      </div>
      <div class="col-4" v-if="isPurchaseOrder">
        <div class="row q-col-gutter-xs items-start no-wrap">
          <q-select v-model="draft.supplierId" :options="supplierOptions" emit-value map-options use-input
            label="Supplier" clearable class="col" @filter="filterSuppliers" />
          <q-btn round dense color="primary" icon="add" class="q-mt-sm" @click="showNewSupplier = true">
            <q-tooltip>Add new supplier</q-tooltip>
          </q-btn>
        </div>
      </div>
      <div class="col-4">
        <q-input v-model="draft.issuedAt" type="date" label="Date" filled hint="Defaults to today if left unchanged" />
      </div>
      <div class="col-4">
        <q-input v-model="draft.manualReference" label="Reference (optional)" filled
          hint="e.g. PO number, customer reference" />
      </div>
      <div class="col-12" v-if="draft.referenceQuotationNumber">
        <q-input :model-value="draft.referenceQuotationNumber" label="Converted from Quotation" readonly filled />
      </div>
    </div>

    <div class="transaction-form__products">
      <div class="row q-col-gutter-sm items-center">
        <div class="col-6">
          <q-select ref="productSelectRef" v-model="productPick" :options="productOptions"
            label="Add product (search by name)" use-input emit-value map-options @filter="filterProducts"
            @update:model-value="onPickProduct" />
        </div>
        <div class="col-6">
          <q-input ref="skuInputRef" v-model="skuInput" label="SKU / Barcode (auto-adds on match)" dense filled>
            <template #prepend><q-icon name="qr_code_scanner" /></template>
          </q-input>
        </div>
      </div>
    </div>

    <div class="transaction-form__cart">
      <q-markup-table flat bordered class="transaction-form__table">
        <thead>
          <tr>
            <th style="width: 32px"></th>
            <th style="width: 28px"></th>
            <th class="text-left">Item</th>
            <th class="text-left">Qty</th>
            <th class="text-left">Batch/Box</th>
            <th class="text-left">Price</th>
            <th class="text-left">Disc %</th>
            <th class="text-left">Tax %</th>
            <th class="text-left">Line Total</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(item, idx) in draft.lineItems" :key="idx"
            :class="{ 'row-active': idx === activeRowIndex, 'row-drag-over': idx === dragOverIndex }"
            @dragover.prevent="dragOverIndex = idx" @dragleave="dragOverIndex = null" @drop="onDrop(idx)">
            <td class="text-center">
              <q-checkbox :model-value="idx === activeRowIndex" dense @update:model-value="focusRow(idx)">
                <q-tooltip>Select row (for keyboard shortcuts and Up/Down navigation)</q-tooltip>
              </q-checkbox>
            </td>
            <td>
              <q-icon name="drag_indicator" class="drag-handle" draggable="true" @dragstart="onDragStart(idx)"
                @dragend="onDragEnd">
                <q-tooltip>Drag to reorder</q-tooltip>
              </q-icon>
            </td>
            <td>{{ item.name }}</td>
            <td class="text-left" style="width: 90px">
              <q-input :ref="(el) => setQtyRef(el, idx)" v-model.number="item.quantity" type="number" dense borderless
                class="text-left" min="0" step="1" @focus="activeRowIndex = idx" @keydown="onRowKeydown($event, idx)" />
            </td>
            <td class="text-left" style="width: 210px">
              <div v-if="isPurchaseOrder" class="batch-box-editor">
                <q-input v-model.number="item.box_size" type="number" dense borderless class="text-left" min="0"
                  step="1" placeholder="Units/box" @update:model-value="recalculateQuantityFromBatch(item)" />
                <q-input v-model.number="item.box_count" type="number" dense borderless class="text-left" min="0"
                  step="1" placeholder="Boxes" @update:model-value="recalculateQuantityFromBatch(item)" />
                <div v-if="hasBatchValues(item)" class="text-caption text-grey">
                  {{ batchSummary(item) }}
                </div>
              </div>
              <span v-else class="text-grey">-</span>
            </td>
            <td class="text-left" style="width: 110px">
              <q-input v-model.number="item.unit_price" type="number" dense borderless class="text-left" min="0"
                step="1" @focus="activeRowIndex = idx" @keydown="onRowKeydown($event, idx)" />
            </td>
            <td class="text-left" style="width: 90px">
              <q-input v-model.number="item.discount_pct" type="number" dense borderless class="text-left" min="0"
                max="100" :disable="!itemHasPrice(item)" @focus="activeRowIndex = idx"
                @keydown="onRowKeydown($event, idx)" />
            </td>
            <td class="text-left" style="width: 90px">
              <q-input v-model.number="item.tax_rate" type="number" dense borderless class="text-left" min="0" max="100"
                :disable="!itemHasPrice(item)" @focus="activeRowIndex = idx" @keydown="onRowKeydown($event, idx)" />
            </td>
            <td class="text-left">{{ formatLineTotal(item) }}</td>
            <td><q-btn flat dense round icon="close" size="sm" @click="transactionsStore.removeLineItem(idx)" /></td>
          </tr>
          <tr v-if="!draft.lineItems.length">
            <td colspan="10" class="text-center text-grey q-py-md">No items yet - search, scan, or type a SKU above</td>
          </tr>
        </tbody>
      </q-markup-table>
    </div>

    <div class="transaction-form__notes">
      <q-input v-model="draft.notes" label="Notes" type="textarea" autogrow filled />
    </div>

    <!-- Inline customer creation - no navigating away from the invoice/quote being built -->
    <q-dialog v-model="showNewCustomer">
      <q-card style="min-width: 400px">
        <q-card-section class="text-h6">New Customer</q-card-section>
        <q-card-section class="q-gutter-sm">
          <q-input v-model="newCustomer.name" label="Name *" filled autofocus />
          <q-input v-model="newCustomer.phone" label="Phone" filled />
          <q-input v-model="newCustomer.email" label="Email" filled />
          <q-input v-model="newCustomer.address" label="Address" filled type="textarea" autogrow />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn color="primary" label="Save & Select" :loading="savingCustomer" @click="saveNewCustomer" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="showNewSupplier">
      <q-card style="min-width: 400px">
        <q-card-section class="text-h6">New Supplier</q-card-section>
        <q-card-section class="q-gutter-sm">
          <q-input v-model="newSupplier.name" label="Name *" filled autofocus />
          <q-input v-model="newSupplier.phone" label="Phone" filled />
          <q-input v-model="newSupplier.email" label="Email" filled />
          <q-input v-model="newSupplier.address" label="Address" filled type="textarea" autogrow />
          <q-input v-model="newSupplier.tax_number" label="Tax Number" filled />
          <q-input v-model="newSupplier.payment_terms" label="Payment Terms" filled hint="e.g. Cash, 30 days" />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn color="primary" label="Save & Select" :loading="savingSupplier" @click="saveNewSupplier" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </section>
</template>

<script setup>
import { ref, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { useQuasar } from 'quasar';
import { useTransactionsStore } from 'src/stores/transactions';
import { useCustomersStore } from 'src/stores/customers';
import { useSuppliersStore } from 'src/stores/suppliers';
import { useProductsStore } from 'src/stores/products';
import { useCurrency } from 'src/composables/useCurrency';
import { useBarcodeScanner } from 'src/composables/useBarcodeScanner';
import { onUiEvent } from 'src/composables/useUiEvents';

const $q = useQuasar();
const transactionsStore = useTransactionsStore();
const customersStore = useCustomersStore();
const suppliersStore = useSuppliersStore();
const productsStore = useProductsStore();
const { format } = useCurrency();

const draft = computed(() => transactionsStore.draft);
const isPurchaseOrder = computed(() => draft.value.type === 'purchase_order');
const productPick = ref(null);
const productSelectRef = ref(null);
const skuInput = ref('');
const skuInputRef = ref(null);

const customerOptions = ref([]);
const supplierOptions = ref([]);
const productOptions = ref([]);

function docTypeLabel(type) {
  return {
    quote: 'quotation',
    invoice: 'invoice',
    purchase_order: 'purchase order',
  }[type] || 'transaction';
}

function startFresh() {
  transactionsStore.startNewDraft(draft.value.type || 'quote');
}

function filterSuppliers(value, update) {
  update(() => {
    const needle = String(value || '').toLowerCase();
    supplierOptions.value = suppliersStore.items
      .filter((supplier) => supplier.name.toLowerCase().includes(needle))
      .map((supplier) => ({ label: supplier.name, value: supplier.id }));
  });
}

// --- Keyboard row navigation -------------------------------------------------
// qtyRefs holds a live reference to each row's Quantity QInput, keyed by row
// index, so Up/Down arrows and "just added a product" can both jump focus
// straight to the right row without the mouse.
const qtyRefs = ref([]);
const activeRowIndex = ref(-1);

function setQtyRef(el, idx) {
  qtyRefs.value[idx] = el;
}

function focusRow(idx) {
  if (idx == null || idx < 0) return;
  activeRowIndex.value = idx;
  nextTick(() => {
    qtyRefs.value[idx]?.focus?.();
    qtyRefs.value[idx]?.select?.();
  });
}

function onRowKeydown(e, idx) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    focusRow(Math.min(idx + 1, draft.value.lineItems.length - 1));
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    focusRow(Math.max(idx - 1, 0));
  }
}

// --- Drag-to-reorder line items ------------------------------------------------
// Order is just array position - saved as-is via saveDraft, which sends
// lineItems straight through to TransactionRepository.create/update, where
// each item's array index becomes its sort_order column. Printed documents
// and PDFs read items back in that same order (find() sorts by sort_order).
const dragIndex = ref(null);
const dragOverIndex = ref(null);

function onDragStart(idx) {
  dragIndex.value = idx;
}

function onDragEnd() {
  dragIndex.value = null;
  dragOverIndex.value = null;
}

function onDrop(idx) {
  if (dragIndex.value === null || dragIndex.value === idx) {
    dragOverIndex.value = null;
    return;
  }
  const items = draft.value.lineItems;
  const [moved] = items.splice(dragIndex.value, 1);
  items.splice(idx, 0, moved);
  dragIndex.value = null;
  dragOverIndex.value = null;
}

// TAX-INCLUSIVE: unit_price already has tax baked in, so the line total is
// just quantity * price, minus the line discount - never plus tax on top.
// This mirrors the exact formula used server-side in repositories.js.
function lineTotal(item) {
  if (!itemHasPrice(item)) return null;
  const base = item.quantity * Number(item.unit_price);
  return base - base * ((item.discount_pct || 0) / 100);
}

function itemHasPrice(item) {
  return item.unit_price !== null && item.unit_price !== '' && !Number.isNaN(Number(item.unit_price));
}

function formatLineTotal(item) {
  const total = lineTotal(item);
  return total === null ? '-' : format(total);
}

function normalizePositiveNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function hasBatchValues(item) {
  return normalizePositiveNumber(item.box_size) !== null && normalizePositiveNumber(item.box_count) !== null;
}

function recalculateQuantityFromBatch(item) {
  const boxSize = normalizePositiveNumber(item.box_size);
  const boxCount = normalizePositiveNumber(item.box_count);
  if (boxSize === null || boxCount === null) return;
  item.quantity = Number((boxSize * boxCount).toFixed(4));
}

function batchSummary(item) {
  const boxSize = normalizePositiveNumber(item.box_size);
  const boxCount = normalizePositiveNumber(item.box_count);
  if (boxSize === null || boxCount === null) return '';
  const total = boxSize * boxCount;
  return `${boxSize} units x ${boxCount} boxes = ${total} units`;
}

function filterCustomers(val, update) {
  update(() => {
    customerOptions.value = customersStore.items
      .filter((c) => c.name.toLowerCase().includes((val || '').toLowerCase()))
      .map((c) => ({ label: c.name, value: c.id }));
  });
}

function filterProducts(val, update) {
  update(() => {
    productOptions.value = productsStore.items
      .filter((p) => p.name.toLowerCase().includes((val || '').toLowerCase()) || p.sku?.includes(val || ''))
      .map((p, i) => ({ label: `${i + 1}. ${p.name}  (${format(p.selling_price)})`, value: p.id, product: p }));
  });
}

function onPickProduct(id) {
  const product = productsStore.byId(id);
  if (product) {
    const idx = transactionsStore.addLineItem(product);
    focusRow(idx);
  }
  productPick.value = null;
}

// --- SKU / barcode auto-add ---------------------------------------------------
// Fires the instant the typed/scanned text exactly matches a product's SKU
// or barcode - no Enter, no button click. Handles physical scanners that type
// into whichever field is focused (as opposed to useBarcodeScanner below,
// which catches scans anywhere on the page even if this field isn't focused).
watch(skuInput, (val) => {
  if (!val) return;
  const match = productsStore.items.find((p) => p.sku === val || p.barcode === val);
  if (match) {
    const idx = transactionsStore.addLineItem(match);
    $q.notify({ type: 'positive', message: `Added ${match.name}`, timeout: 800 });
    skuInput.value = '';
    focusRow(idx);
  }
});

useBarcodeScanner(async (code) => {
  const product = await productsStore.findByBarcode(code);
  if (product) {
    const idx = transactionsStore.addLineItem(product);
    focusRow(idx);
    $q.notify({ type: 'positive', message: `Added ${product.name}`, timeout: 1200 });
  } else {
    $q.notify({ type: 'warning', message: `No product found for barcode ${code}` });
  }
});

// --- Inline customer creation --------------------------------------------------
const showNewCustomer = ref(false);
const savingCustomer = ref(false);
function emptyNewCustomer() {
  return { name: '', phone: '', email: '', address: '' };
}
const newCustomer = reactive(emptyNewCustomer());

const showNewSupplier = ref(false);
const savingSupplier = ref(false);
function emptyNewSupplier() {
  return { name: '', phone: '', email: '', address: '', tax_number: '', payment_terms: '' };
}
const newSupplier = reactive(emptyNewSupplier());

async function saveNewCustomer() {
  if (!newCustomer.name) {
    $q.notify({ type: 'warning', message: 'Name is required' });
    return;
  }
  savingCustomer.value = true;
  try {
    const created = await customersStore.create({ ...newCustomer });
    // add it to the options list immediately and select it - no refetch, no leaving the form
    customerOptions.value = [{ label: created.name, value: created.id }, ...customerOptions.value];
    draft.value.customerId = created.id;
    Object.assign(newCustomer, emptyNewCustomer());
    showNewCustomer.value = false;
    $q.notify({ type: 'positive', message: `${created.name} added and selected` });
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message });
  } finally {
    savingCustomer.value = false;
  }
}

async function saveNewSupplier() {
  if (!newSupplier.name.trim()) {
    $q.notify({ type: 'warning', message: 'Name is required' });
    return;
  }
  savingSupplier.value = true;
  try {
    const created = await suppliersStore.create({ ...newSupplier });
    supplierOptions.value = [{ label: created.name, value: created.id }, ...supplierOptions.value];
    draft.value.supplierId = created.id;
    Object.assign(newSupplier, emptyNewSupplier());
    showNewSupplier.value = false;
    $q.notify({ type: 'positive', message: `${created.name} added and selected` });
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message });
  } finally {
    savingSupplier.value = false;
  }
}

onMounted(async () => {
  if (!customersStore.items.length) await customersStore.fetchAll();
  if (!suppliersStore.items.length) await suppliersStore.fetchAll();
  if (!productsStore.items.length) await productsStore.fetchAll();
  filterCustomers('', (fn) => fn());
  filterSuppliers('', (fn) => fn());
  filterProducts('', (fn) => fn());
});

// --- Cart shortcut relays -------------------------------------------------
// MainLayout.vue owns the global Ctrl/Shift+digit dispatch (it's the only
// place with access to appBridge.onShortcut across route changes) and
// relays cart-specific actions here via a small window CustomEvent bus,
// since this component owns the state those actions actually act on.
const unsubscribers = [
  onUiEvent('focus-product-search', () => {
    nextTick(() => productSelectRef.value?.focus?.());
  }),
  onUiEvent('focus-sku', () => {
    nextTick(() => skuInputRef.value?.focus?.());
  }),
  onUiEvent('add-customer', () => {
    showNewCustomer.value = true;
  }),
  onUiEvent('remove-active-row', () => {
    if (activeRowIndex.value >= 0 && activeRowIndex.value < draft.value.lineItems.length) {
      transactionsStore.removeLineItem(activeRowIndex.value);
      activeRowIndex.value = -1;
    }
  }),
];

onBeforeUnmount(() => {
  unsubscribers.forEach((unsub) => unsub());
});
</script>

<style scoped>
.transaction-form {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
}

.transaction-form__edit-banner {
  border: 1px solid var(--accent-border);
  background: color-mix(in srgb, var(--accent-bg) 60%, var(--surface-1));
}

.transaction-form__meta,
.transaction-form__products,
.transaction-form__notes {
  flex: 0 0 auto;
}

.transaction-form__cart {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--border-color);
  border-radius: 8px;
}

.transaction-form__table {
  width: 100%;
  border-collapse: collapse;
}

.transaction-form__table th,
.transaction-form__table td {
  text-align: left;
  border: 1px solid var(--border-color);
}

.transaction-form__table thead th,
.transaction-form__table tbody td {
  text-align: left !important;
}

.batch-box-editor {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 8px;
  row-gap: 2px;
}

.batch-box-editor .text-caption {
  grid-column: 1 / -1;
}

.row-active {
  background: var(--accent-bg);
}

.row-drag-over {
  border-top: 2px solid var(--accent-soft);
}

.drag-handle {
  cursor: grab;
  color: var(--text-muted);
}

.drag-handle:active {
  cursor: grabbing;
}
</style>
