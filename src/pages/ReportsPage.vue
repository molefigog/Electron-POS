<template>
  <q-page class="q-pa-md">
    <div class="row items-center justify-between q-mb-md">
      <div class="text-h5">Reports</div>
      <div class="row q-gutter-sm">
        <q-btn outline icon="print" label="Print" @click="printReport" />
        <q-btn color="primary" icon="picture_as_pdf" label="Save PDF" :loading="savingPdf" @click="savePdf" />
      </div>
    </div>

    <div class="row q-col-gutter-md q-mb-md">
      <div class="col-3">
        <q-input v-model="from" type="date" label="From" filled dense @update:model-value="load" />
      </div>
      <div class="col-3">
        <q-input v-model="to" type="date" label="To" filled dense @update:model-value="load" />
      </div>
    </div>

    <div class="row q-col-gutter-md q-mb-md">
      <div class="col-12 col-md-3">
        <q-card flat bordered><q-card-section>
            <div class="text-caption text-grey">Total Invoiced</div>
            <div class="text-h5">{{ format(totals.invoiced) }}</div>
          </q-card-section></q-card>
      </div>
      <div class="col-12 col-md-3">
        <q-card flat bordered><q-card-section>
            <div class="text-caption text-grey">Total Quoted</div>
            <div class="text-h5">{{ format(totals.quoted) }}</div>
          </q-card-section></q-card>
      </div>
      <div class="col-12 col-md-3">
        <q-card flat bordered><q-card-section>
            <div class="text-caption text-grey">Quote → Invoice Conversion</div>
            <div class="text-h5">{{ conversionRate }}%</div>
          </q-card-section></q-card>
      </div>
      <div class="col-12 col-md-3">
        <q-card flat bordered><q-card-section>
            <div class="text-caption text-grey">Total Amount</div>
            <div class="text-h5">{{ format(grandTotal) }}</div>
          </q-card-section></q-card>
      </div>
    </div>

    <q-table flat bordered :rows="filteredRows" :columns="columns" row-key="id" />
  </q-page>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useQuasar } from 'quasar';
import { useTransactionsStore } from 'src/stores/transactions';
import { useSettingsStore } from 'src/stores/settings';
import { useCurrency } from 'src/composables/useCurrency';
import { usePrintDocument } from 'src/composables/usePrintDocument';
import { renderReportDocument } from 'src/services/print-templates/report';

const $q = useQuasar();
const transactionsStore = useTransactionsStore();
const settingsStore = useSettingsStore();
const { format } = useCurrency();
const { printHtml } = usePrintDocument();

const from = ref('');
const to = ref('');
const savingPdf = ref(false);

const columns = [
  { name: 'number', label: 'Number', field: 'number', align: 'left' },
  { name: 'type', label: 'Type', field: 'type', align: 'left' },
  { name: 'customer_name', label: 'Customer', field: (r) => r.customer_name || 'Walk-in', align: 'left' },
  { name: 'grand_total', label: 'Total', field: (r) => format(r.grand_total), align: 'right' },
  { name: 'status', label: 'Status', field: 'status', align: 'left' },
  { name: 'created_at', label: 'Date', field: (r) => new Date(r.created_at).toLocaleDateString(), align: 'left' },
];

const filteredRows = computed(() => {
  return transactionsStore.items.filter((t) => {
    const date = new Date(t.created_at);
    if (from.value && date < new Date(from.value)) return false;
    if (to.value && date > new Date(to.value + 'T23:59:59')) return false;
    return true;
  });
});

const totals = computed(() => ({
  invoiced: filteredRows.value.filter((t) => t.type === 'invoice').reduce((s, t) => s + t.grand_total, 0),
  quoted: filteredRows.value.filter((t) => t.type === 'quote').reduce((s, t) => s + t.grand_total, 0),
}));

const grandTotal = computed(() => totals.value.invoiced + totals.value.quoted);

const conversionRate = computed(() => {
  const quotes = filteredRows.value.filter((t) => t.type === 'quote');
  if (!quotes.length) return 0;
  const converted = quotes.filter((q) => q.status === 'converted').length;
  return Math.round((converted / quotes.length) * 100);
});

function load() {
  // filtering happens client-side above; fetchAll ensures fresh data
  transactionsStore.fetchAll();
}

function buildReportHtml() {
  return renderReportDocument(
    {
      from: from.value,
      to: to.value,
      rows: filteredRows.value,
      totals: totals.value,
      conversionRate: conversionRate.value,
      generatedAt: new Date().toISOString(),
    },
    settingsStore.values,
    settingsStore.values.print_template || 'classic'
  );
}

function datePart(value) {
  return value ? value.replace(/-/g, '') : 'all';
}

async function printReport() {
  try {
    await printHtml(buildReportHtml());
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message || 'Could not print report' });
  }
}

async function savePdf() {
  if (!window.appBridge) {
    $q.notify({ type: 'negative', message: 'PDF export is only available in the desktop app.' });
    return;
  }

  savingPdf.value = true;
  try {
    const result = await window.appBridge.printPdf({
      html: buildReportHtml(),
      defaultFileName: `REPORT-${datePart(from.value)}-${datePart(to.value)}.pdf`,
    });
    if (result.opened === false) {
      $q.notify({ type: 'warning', message: `Saved: ${result.filePath}. Could not open automatically.` });
    } else {
      $q.notify({ type: 'positive', message: `Saved and opened: ${result.filePath}` });
    }
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message || 'Could not save PDF' });
  } finally {
    savingPdf.value = false;
  }
}

onMounted(async () => {
  if (!settingsStore.loaded) {
    await settingsStore.fetchAll();
  }
  await load();
});
</script>
