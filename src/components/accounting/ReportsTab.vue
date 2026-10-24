<template>
  <div>
    <div class="row items-center q-col-gutter-sm q-mb-md">
      <div class="col-12 col-md-4">
        <q-select v-model="name" :options="REPORTS" emit-value map-options dense filled label="Report"
          @update:model-value="onPick" />
      </div>
      <div v-if="needs('asOf')" class="col-auto"><q-input v-model="asOf" type="date" label="As at" filled dense /></div>
      <template v-if="needs('range')">
        <div class="col-auto"><q-input v-model="from" type="date" label="From" filled dense /></div>
        <div class="col-auto"><q-input v-model="to" type="date" label="To" filled dense /></div>
      </template>
      <div v-if="needs('account')" class="col-12 col-md-3">
        <q-select v-model="accountId" :options="accountOptions" emit-value map-options dense filled label="Account" />
      </div>
      <div class="col-auto"><q-btn color="primary" no-caps icon="play_arrow" label="Run" :loading="loading"
          @click="run" />
      </div>
      <q-space />
      <div class="col-auto">
        <ExportMenu :table="exportable" :disable="!exportable" />
      </div>
      <div class="col-auto">
        <q-btn-dropdown outline no-caps icon="folder_zip" label="Full accounting pack" :loading="packing">
          <q-list dense>
            <q-item clickable v-close-popup @click="pack('xlsx')">
              <q-item-section avatar><q-icon name="table_view" /></q-item-section>
              <q-item-section>Excel workbook (one sheet per report)</q-item-section>
            </q-item>
            <q-item clickable v-close-popup @click="pack('json')">
              <q-item-section avatar><q-icon name="data_object" /></q-item-section>
              <q-item-section>JSON (all reports)</q-item-section>
            </q-item>
          </q-list>
        </q-btn-dropdown>
      </div>
    </div>

    <div v-if="current">
      <div class="text-h6">{{ current.title }}</div>
      <div class="text-caption text-grey q-mb-sm">{{ current.subtitle }}</div>
      <q-banner v-if="current.meta?.balanced === false" dense rounded class="bg-red-1 text-negative q-mb-sm">
        This report does not balance. Use "Rebuild from sales" in Accounts, then run it again.
      </q-banner>
      <q-table flat bordered dense :rows="current.rows" :columns="tableColumns" row-key="__i"
        :pagination="{ rowsPerPage: 0 }" hide-pagination no-data-label="No data for this period.">
        <template #body="props">
          <q-tr :props="props" :class="`kind-${props.row._kind || 'row'}`">
            <q-td v-for="col in props.cols" :key="col.name" :props="props">{{ col.value }}</q-td>
          </q-tr>
        </template>
        <template v-if="current.totals" #bottom-row>
          <q-tr class="kind-total">
            <q-td v-for="(c, i) in tableColumns" :key="c.name"
              :class="c.align === 'right' ? 'text-right' : 'text-left'">
              {{ i === 0 ? 'Total' : c.name in current.totals ? cellText(current.totals[c.name], c.type) : '' }}
            </q-td>
          </q-tr>
        </template>
      </q-table>
    </div>
    <div v-else class="text-grey">Choose a report and press Run.</div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import AccountingRepository from 'src/services/repositories/AccountingRepository';
import { useCurrency } from 'src/composables/useCurrency';
import { useSettingsStore } from 'src/stores/settings';
import { useAccountingExport } from 'src/composables/useAccountingExport';
import { useAccountingUi, localISO, monthStartISO } from 'src/composables/useAccountingUi';
import ExportMenu from './ExportMenu.vue';

const REPORTS = [
  { label: 'Profit & Loss', value: 'profitAndLoss', params: ['range'] },
  { label: 'Balance Sheet', value: 'balanceSheet', params: ['asOf'] },
  { label: 'Trial Balance', value: 'trialBalance', params: ['asOf'] },
  { label: 'General Ledger (one account)', value: 'generalLedger', params: ['range', 'account'] },
  { label: 'Journal', value: 'journal', params: ['range'] },
  { label: 'Cash Book (cash, bank, mobile money)', value: 'cashBook', params: ['range'] },
  { label: 'Customer Aging (Receivables)', value: 'arAging', params: ['asOf'] },
  { label: 'Supplier Aging (Payables)', value: 'apAging', params: ['asOf'] },
  { label: 'VAT Summary', value: 'vat', params: ['range'] },
  { label: 'Sales by Product', value: 'salesByProduct', params: ['range'] },
  { label: 'Stock Valuation', value: 'stockValuation', params: [] },
  { label: 'Chart of Accounts', value: 'chartOfAccounts', params: [] },
];

const settingsStore = useSettingsStore();
const { format } = useCurrency();
const { fail } = useAccountingUi();
const { exportPack } = useAccountingExport();

const name = ref('profitAndLoss');
const from = ref(monthStartISO());
const to = ref(localISO());
const asOf = ref(localISO());
const accountId = ref(null);
const accounts = ref([]);
const current = ref(null);
const loading = ref(false);
const packing = ref(false);

const needs = (p) => REPORTS.find((r) => r.value === name.value)?.params.includes(p);
const accountOptions = computed(() => accounts.value.map((a) => ({ label: `${a.code} ${a.name}`, value: a.id })));

function cellText(value, type) {
  if (value === null || value === undefined || value === '') return '';
  if (type === 'money') return format(value);
  return value;
}

const tableColumns = computed(() =>
  (current.value?.columns || []).map((c) => ({
    name: c.key,
    label: c.label,
    type: c.type,
    field: c.key,
    align: c.type === 'money' || c.type === 'number' ? 'right' : 'left',
    format: (v) => cellText(v, c.type),
  })),
);

function paramsFor() {
  return { from: from.value, to: to.value, asOf: asOf.value, accountId: accountId.value };
}

async function fetchReport(reportName) {
  const table = await AccountingRepository.report(reportName, paramsFor());
  table.meta = { ...table.meta, company: table.meta?.company || settingsStore.values.company_name || '' };
  table.rows = table.rows.map((r, i) => ({ ...r, __i: i }));
  return table;
}

// Rows get a UI-only __i key; strip it again for exports.
const stripped = (table) => ({
  ...table,
  rows: table.rows.map((row) => {
    const copy = { ...row };
    delete copy.__i;
    return copy;
  }),
});
const exportable = computed(() => (current.value ? stripped(current.value) : null));

async function run() {
  if (name.value === 'generalLedger' && !accountId.value) {
    fail(new Error('Choose an account for the ledger'));
    return;
  }
  loading.value = true;
  try {
    current.value = await fetchReport(name.value);
  } catch (err) {
    current.value = null;
    fail(err);
  } finally {
    loading.value = false;
  }
}

function onPick() {
  current.value = null;
}

async function pack(fmt) {
  packing.value = true;
  try {
    await exportPack(fmt, async () => {
      const list = [
        ['profitAndLoss'], ['balanceSheet'], ['trialBalance'], ['journal'], ['cashBook'],
        ['arAging'], ['apAging'], ['vat'], ['salesByProduct'], ['stockValuation'], ['chartOfAccounts'],
      ];
      const tables = [];
      for (const [r] of list) tables.push(stripped(await fetchReport(r)));
      return tables;
    });
  } catch (err) {
    fail(err);
  } finally {
    packing.value = false;
  }
}

onMounted(async () => {
  if (!settingsStore.loaded) await settingsStore.fetchAll();
  try {
    accounts.value = await AccountingRepository.accounts();
    accountId.value = accounts.value.find((a) => a.system_key === 'cash')?.id || null;
  } catch (err) {
    fail(err);
  }
  await run();
});
</script>

<style scoped>
.kind-header td {
  font-weight: 700;
  background: rgba(128, 128, 128, 0.12);
}

.kind-subtotal td {
  font-weight: 600;
}

.kind-total td {
  font-weight: 700;
  background: rgba(25, 118, 210, 0.12);
}
</style>
