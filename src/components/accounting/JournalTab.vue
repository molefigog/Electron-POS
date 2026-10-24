<template>
  <div>
    <div class="row items-center q-col-gutter-sm q-mb-sm">
      <div class="col-auto"><q-input v-model="from" type="date" label="From" filled dense @update:model-value="load" /></div>
      <div class="col-auto"><q-input v-model="to" type="date" label="To" filled dense @update:model-value="load" /></div>
      <div class="col-auto" style="min-width: 170px">
        <q-select v-model="source" :options="sourceOptions" emit-value map-options dense filled label="Source" @update:model-value="load" />
      </div>
      <q-space />
      <div class="col-auto"><ExportMenu :table="exportTable" file-name="journal" :disable="!rows.length" /></div>
      <div class="col-auto"><q-btn outline no-caps icon="inventory_2" label="Post opening stock" @click="openingStock" /></div>
      <div class="col-auto"><q-btn outline no-caps icon="lock" :label="lockDate ? `Closed to ${lockDate}` : 'Close books'" @click="showLock = true" /></div>
      <div class="col-auto"><q-btn color="primary" no-caps icon="add" label="Manual entry" @click="openForm" /></div>
    </div>

    <q-table flat bordered dense :rows="rows" :columns="columns" row-key="id" :loading="loading"
      :pagination="{ rowsPerPage: 12 }" no-data-label="No journal entries in this period.">
      <template #body="props">
        <q-tr :props="props" class="cursor-pointer" @click="toggle(props.row.id)">
          <q-td v-for="col in props.cols" :key="col.name" :props="props">
            <template v-if="col.name === 'actions'">
              <q-btn v-if="isManual(props.row)" dense flat round icon="delete" color="negative" @click.stop="remove(props.row)" />
            </template>
            <template v-else>{{ col.value }}</template>
          </q-td>
        </q-tr>
        <q-tr v-if="open.has(props.row.id)" :props="props">
          <q-td colspan="100%" class="bg-transparent">
            <q-markup-table flat dense separator="none">
              <tbody>
                <tr v-for="l in props.row.lines" :key="l.id">
                  <td style="width: 90px">{{ l.account_code }}</td>
                  <td>{{ l.account_name }}</td>
                  <td class="text-right" style="width: 130px">{{ l.debit ? format(l.debit) : '' }}</td>
                  <td class="text-right" style="width: 130px">{{ l.credit ? format(l.credit) : '' }}</td>
                </tr>
              </tbody>
            </q-markup-table>
          </q-td>
        </q-tr>
      </template>
    </q-table>
    <div class="text-caption text-grey q-mt-xs">
      Click an entry to see its lines. Entries from sales, payments, expenses and bills are automatic - change the source and they follow.
    </div>

    <q-dialog v-model="showForm" persistent>
      <q-card style="min-width: 640px; max-width: 95vw">
        <q-card-section class="text-h6">Manual journal entry</q-card-section>
        <q-card-section class="q-gutter-sm">
          <div class="row q-col-gutter-sm">
            <div class="col-4"><q-input v-model="form.date" type="date" label="Date *" filled /></div>
            <div class="col-8"><q-input v-model="form.memo" label="Description" filled /></div>
          </div>
          <div v-for="(l, i) in form.lines" :key="i" class="row q-col-gutter-sm items-center">
            <div class="col-6"><q-select v-model="l.accountId" :options="accountOptions" emit-value map-options dense filled label="Account" /></div>
            <div class="col-2"><q-input v-model.number="l.debit" type="number" min="0" step="0.01" dense filled label="Debit" @update:model-value="l.credit = null" /></div>
            <div class="col-2"><q-input v-model.number="l.credit" type="number" min="0" step="0.01" dense filled label="Credit" @update:model-value="l.debit = null" /></div>
            <div class="col-2"><q-btn flat round dense icon="close" :disable="form.lines.length <= 2" @click="form.lines.splice(i, 1)" /></div>
          </div>
          <q-btn flat no-caps dense icon="add" label="Add line" @click="form.lines.push({ accountId: null, debit: null, credit: null })" />
          <div class="text-body2" :class="balanced ? 'text-positive' : 'text-negative'">
            Debits {{ format(debitTotal) }} &middot; Credits {{ format(creditTotal) }}
            <span v-if="!balanced"> &middot; out by {{ format(Math.abs(debitTotal - creditTotal)) }}</span>
          </div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn color="primary" label="Post entry" :disable="!balanced" :loading="saving" @click="save" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="showLock">
      <q-card style="min-width: 400px">
        <q-card-section class="text-h6">Close the books</q-card-section>
        <q-card-section class="q-gutter-sm">
          <div class="text-body2">Nothing dated on or before this day can be added, changed or deleted. Leave it empty to re-open everything.</div>
          <q-input v-model="lockInput" type="date" label="Closed up to (inclusive)" filled clearable />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn color="primary" label="Save" @click="saveLock" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import AccountingRepository from 'src/services/repositories/AccountingRepository';
import { useCurrency } from 'src/composables/useCurrency';
import { useSettingsStore } from 'src/stores/settings';
import { useAccountingUi, localISO, monthStartISO } from 'src/composables/useAccountingUi';
import ExportMenu from './ExportMenu.vue';

const settingsStore = useSettingsStore();
const { format } = useCurrency();
const { ok, fail, confirm } = useAccountingUi();

const SOURCE_LABELS = {
  invoice: 'Sale', customer_payment: 'Payment received', expense: 'Expense', bill: 'Supplier bill',
  bill_payment: 'Bill payment', manual: 'Manual', opening_stock: 'Opening stock',
};
const sourceOptions = [{ label: 'All sources', value: null }, ...Object.entries(SOURCE_LABELS).map(([value, label]) => ({ label, value }))];

const from = ref(monthStartISO());
const to = ref(localISO());
const source = ref(null);
const rows = ref([]);
const accounts = ref([]);
const open = ref(new Set());
const loading = ref(false);
const saving = ref(false);
const showForm = ref(false);
const showLock = ref(false);
const lockDate = ref('');
const lockInput = ref('');
const form = ref({ date: localISO(), memo: '', lines: [] });

const columns = [
  { name: 'date', label: 'Date', field: 'entry_date', align: 'left', sortable: true },
  { name: 'id', label: '#', field: 'id', align: 'left' },
  { name: 'source', label: 'Source', field: (r) => SOURCE_LABELS[r.source_type] || r.source_type, align: 'left' },
  { name: 'memo', label: 'Description', field: (r) => r.memo || '', align: 'left' },
  { name: 'total', label: 'Amount', field: (r) => format(r.total), align: 'right' },
  { name: 'actions', label: '', field: 'id', align: 'right' },
];
const accountOptions = computed(() => accounts.value.filter((a) => a.is_active).map((a) => ({ label: `${a.code} ${a.name}`, value: a.id })));
const debitTotal = computed(() => form.value.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0));
const creditTotal = computed(() => form.value.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0));
const balanced = computed(() => debitTotal.value > 0 && Math.abs(debitTotal.value - creditTotal.value) < 0.005);
const isManual = (r) => r.source_type === 'manual' || r.source_type === 'opening_stock';

const exportTable = () => ({
  title: 'Journal',
  subtitle: `${from.value} to ${to.value}`,
  columns: [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'entry', label: 'Entry #', type: 'number' },
    { key: 'source', label: 'Source' },
    { key: 'account', label: 'Account' },
    { key: 'memo', label: 'Description' },
    { key: 'debit', label: 'Debit', type: 'money' },
    { key: 'credit', label: 'Credit', type: 'money' },
  ],
  rows: rows.value.flatMap((e) =>
    e.lines.map((l) => ({
      date: e.entry_date, entry: e.id, source: SOURCE_LABELS[e.source_type] || e.source_type,
      account: `${l.account_code} ${l.account_name}`, memo: e.memo || '', debit: l.debit || null, credit: l.credit || null,
    })),
  ),
  meta: { company: settingsStore.values.company_name || '' },
});

function toggle(id) {
  const next = new Set(open.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  open.value = next;
}

async function load() {
  loading.value = true;
  try {
    rows.value = await AccountingRepository.journalEntries({ from: from.value || null, to: to.value || null, sourceType: source.value, limit: 1000 });
    lockDate.value = await AccountingRepository.getLockDate();
  } catch (err) {
    fail(err);
  } finally {
    loading.value = false;
  }
}

function openForm() {
  form.value = { date: localISO(), memo: '', lines: [{ accountId: null, debit: null, credit: null }, { accountId: null, debit: null, credit: null }] };
  showForm.value = true;
}

async function save() {
  saving.value = true;
  try {
    await AccountingRepository.createJournalEntry(form.value);
    showForm.value = false;
    ok('Entry posted');
    await load();
  } catch (err) {
    fail(err);
  } finally {
    saving.value = false;
  }
}

async function remove(row) {
  if (!(await confirm(`Delete journal entry #${row.id}?`))) return;
  try {
    await AccountingRepository.deleteJournalEntry(row.id);
    ok('Entry deleted');
    await load();
  } catch (err) {
    fail(err);
  }
}

async function openingStock() {
  if (!(await confirm('Post the current stock on hand (quantity x cost price) as your opening inventory, dated today? Do this once, when you start using accounting.'))) return;
  try {
    const res = await AccountingRepository.postOpeningStock({ date: localISO() });
    ok(`Opening stock posted: ${format(res.value)}`);
    await load();
  } catch (err) {
    fail(err);
  }
}

async function saveLock() {
  try {
    await AccountingRepository.setLockDate(lockInput.value || '');
    showLock.value = false;
    ok(lockInput.value ? `Books closed up to ${lockInput.value}` : 'Books re-opened');
    await load();
  } catch (err) {
    fail(err);
  }
}

onMounted(async () => {
  if (!settingsStore.loaded) await settingsStore.fetchAll();
  try {
    accounts.value = await AccountingRepository.accounts();
  } catch (err) {
    fail(err);
  }
  await load();
  lockInput.value = lockDate.value;
});
</script>
