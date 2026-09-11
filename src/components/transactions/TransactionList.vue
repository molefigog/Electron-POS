<template>
  <div>
    <div class="row items-center q-col-gutter-sm q-mb-md">
      <div class="col-4">
        <q-input v-model="search" dense filled clearable placeholder="Search number, customer, ref..."
          @update:model-value="onSearch">
          <template #prepend><q-icon name="search" /></template>
        </q-input>
      </div>
      <div class="col-3">
        <q-select v-model="typeFilter" dense filled clearable :options="['quote', 'invoice', 'purchase_order']"
          label="Type" @update:model-value="onSearch" />
      </div>
      <div class="col-5" />
    </div>

    <q-table flat bordered :rows="transactionsStore.items" :columns="columns" row-key="id"
      :loading="transactionsStore.loading" :pagination="{ rowsPerPage: 14 }" :rows-per-page-options="[14]">
      <template #body-cell-type="props">
        <q-td :props="props">
          <q-badge :color="typeColor(props.value)">{{ typeLabel(props.value) }}</q-badge>
        </q-td>
      </template>
      <template #body-cell-status="props">
        <q-td :props="props">
          <q-badge :color="statusColor(props.value)">{{ props.value }}</q-badge>
        </q-td>
      </template>
      <template #body-cell-actions="props">
        <q-td :props="props" class="q-gutter-x-xs">
          <q-btn dense flat round icon="edit" @click="edit(props.row)" />
          <q-btn dense flat round icon="print" @click="printRow(props.row)" />
          <q-btn dense flat round icon="picture_as_pdf" @click="exportRow(props.row)" />
          <q-btn dense flat round icon="email" @click="emailRow(props.row)">
            <q-tooltip>Email document</q-tooltip>
          </q-btn>
          <q-btn v-if="props.row.type === 'quote' && props.row.status !== 'converted'" dense flat round icon="sync_alt"
            color="primary" @click="convert(props.row)">
            <q-tooltip>Convert to Invoice</q-tooltip>
          </q-btn>
          <q-btn dense flat round icon="delete" color="negative" @click="remove(props.row)" />
        </q-td>
      </template>
    </q-table>

    <!-- Convert-to-invoice: date defaults to the quote's own date (preserved unless changed here) -->
    <q-dialog v-model="showConvertDialog">
      <q-card style="min-width: 380px">
        <q-card-section class="text-h6">Convert to Invoice</q-card-section>
        <q-card-section class="q-gutter-sm">
          <div class="text-body2">
            Convert <strong>{{ convertTarget?.number }}</strong> into an invoice? Stock will be deducted and a new
            invoice
            number issued.
          </div>
          <q-input v-model="convertDate" type="date" label="Invoice Date" filled
            hint="Defaults to the quotation's date - change if needed" />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn color="primary" label="Convert" :loading="converting" @click="confirmConvert" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useQuasar } from 'quasar';
import { useTransactionsStore } from 'src/stores/transactions';
import { usePrintDocument } from 'src/composables/usePrintDocument';
import { useCurrency } from 'src/composables/useCurrency';

const emit = defineEmits(['edit']);
const $q = useQuasar();
const transactionsStore = useTransactionsStore();
const { print, exportPdf, emailPdf } = usePrintDocument();
const { format } = useCurrency();

const search = ref('');
const typeFilter = ref(null);

const columns = [
  { name: 'number', label: 'Number', field: 'number', align: 'left', sortable: true },
  { name: 'type', label: 'Type', field: 'type', align: 'left' },
  { name: 'customer_name', label: 'Customer', field: (r) => r.customer_name || 'Walk-in', align: 'left' },
  { name: 'reference_quotation_number', label: 'Ref. Quote', field: 'reference_quotation_number', align: 'left' },
  { name: 'manual_reference', label: 'Reference', field: 'manual_reference', align: 'left' },
  { name: 'grand_total', label: 'Total', field: (r) => (r.grand_total === null || r.grand_total === undefined ? '-' : format(r.grand_total)), align: 'right' },
  { name: 'status', label: 'Status', field: 'status', align: 'left' },
  { name: 'issued_at', label: 'Date', field: (r) => new Date(r.issued_at || r.created_at).toLocaleDateString(), align: 'left' },
  { name: 'actions', label: '', field: 'actions', align: 'right' },
];

function statusColor(status) {
  return {
    draft: 'grey',
    quote: 'indigo',
    converted: 'orange',
    invoice: 'teal',
    purchase_order: 'cyan-8',
    paid: 'positive',
    void: 'negative',
  }[status] || 'grey';
}

function typeLabel(type) {
  return {
    quote: 'Quotation',
    invoice: 'Invoice',
    purchase_order: 'Purchase Order',
  }[type] || type;
}

function typeColor(type) {
  return {
    quote: 'indigo',
    invoice: 'teal',
    purchase_order: 'cyan-8',
  }[type] || 'grey';
}

function onSearch() {
  transactionsStore.fetchAll({ search: search.value, type: typeFilter.value });
}

async function edit(row) {
  try {
    const full = await transactionsStore.fetchOne(row.id);
    if (!full) {
      $q.notify({ type: 'warning', message: 'Could not load that transaction for editing' });
      return;
    }
    transactionsStore.loadIntoDraft(full);
    emit('edit', full);
    $q.notify({ type: 'info', message: `Editing ${full.number}` });
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message || 'Failed to open transaction for editing' });
  }
}

async function printRow(row) {
  try {
    const full = await transactionsStore.fetchOne(row.id);
    await print(full);
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message || 'Could not print document' });
  }
}

async function exportRow(row) {
  const full = await transactionsStore.fetchOne(row.id);
  try {
    const result = await exportPdf(full);
    if (result.opened === false) {
      $q.notify({ type: 'warning', message: `Saved: ${result.filePath}. Could not open automatically.` });
    } else {
      $q.notify({ type: 'positive', message: `Saved and opened: ${result.filePath}` });
    }
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message });
  }
}

async function emailRow(row) {
  try {
    const full = await transactionsStore.fetchOne(row.id);
    if (!full.customer_email) {
      $q.notify({ type: 'warning', message: 'This customer has no email address' });
      return;
    }
    const result = await emailPdf(full);
    if (result.html) {
      $q.notify({ type: 'positive', message: 'HTML email draft opened' });
    } else {
      $q.notify({ type: 'warning', message: 'Email draft opened in plain-text mode' });
    }
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message || 'Could not prepare email' });
  }
}

const showConvertDialog = ref(false);
const convertTarget = ref(null);
const convertDate = ref('');
const converting = ref(false);

function convert(row) {
  convertTarget.value = row;
  convertDate.value = String(row.issued_at || row.created_at).slice(0, 10);
  showConvertDialog.value = true;
}

async function confirmConvert() {
  converting.value = true;
  try {
    const invoice = await transactionsStore.convertToInvoice(convertTarget.value.id, convertDate.value);
    $q.notify({ type: 'positive', message: `Created invoice ${invoice.number}` });
    showConvertDialog.value = false;
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message });
  } finally {
    converting.value = false;
  }
}

function remove(row) {
  $q.dialog({ title: 'Delete', message: `Delete ${row.number}? This cannot be undone.`, cancel: true }).onOk(async () => {
    await transactionsStore.remove(row.id);
  });
}

onMounted(() => transactionsStore.fetchAll());
</script>
