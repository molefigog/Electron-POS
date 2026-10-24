<template>
  <div>
    <div class="row items-center q-col-gutter-sm q-mb-sm">
      <div class="col-auto"><q-input v-model="from" type="date" label="From" filled dense @update:model-value="load" /></div>
      <div class="col-auto"><q-input v-model="to" type="date" label="To" filled dense @update:model-value="load" /></div>
      <div class="col-auto"><q-input v-model="search" label="Search" filled dense clearable debounce="250" @update:model-value="load" /></div>
      <q-space />
      <div class="col-auto"><ExportMenu :table="exportTable" file-name="expenses" :disable="!rows.length" /></div>
      <div class="col-auto"><q-btn color="primary" icon="add" no-caps label="New expense" @click="openForm(null)" /></div>
    </div>

    <q-table flat bordered dense :rows="rows" :columns="columns" row-key="id" :loading="loading"
      :pagination="{ rowsPerPage: 15 }" no-data-label="No expenses in this period.">
      <template #body-cell-actions="props">
        <q-td :props="props">
          <q-btn dense flat round icon="edit" @click="openForm(props.row)" />
          <q-btn dense flat round icon="delete" color="negative" @click="remove(props.row)" />
        </q-td>
      </template>
    </q-table>
    <div class="text-caption text-grey q-mt-xs">
      Total: <strong>{{ format(total) }}</strong> &middot; input VAT: <strong>{{ format(vatTotal) }}</strong>
    </div>

    <q-dialog v-model="showForm">
      <q-card style="min-width: 460px">
        <q-card-section class="text-h6">{{ form.id ? 'Edit' : 'New' }} expense</q-card-section>
        <q-card-section class="q-gutter-sm">
          <q-input v-model="form.expenseDate" type="date" label="Date *" filled />
          <q-select v-model="form.accountId" :options="accountOptions" emit-value map-options label="Category *" filled />
          <q-input v-model.number="form.amount" type="number" min="0" step="0.01" label="Amount paid *" filled />
          <div v-if="vatInfo.registered && vatInfo.rate > 0">
            <q-checkbox v-model="form.includesVat" :label="`Amount includes VAT (${vatInfo.rate}%)`" dense />
            <span v-if="form.includesVat && form.amount > 0" class="text-caption text-grey q-ml-sm">
              VAT {{ format(vatPreview) }}
            </span>
          </div>
          <div v-else class="text-caption text-grey">
            {{ vatInfo.registered ? 'Default VAT rate is 0%, so no VAT is claimed.' : 'Add your VAT number in Settings to claim VAT on expenses.' }}
          </div>
          <q-select v-model="form.method" :options="PAYMENT_METHODS" option-value="value" option-label="label" emit-value
            map-options label="Paid from" filled />
          <q-select v-model="form.supplierId" :options="supplierOptions" emit-value map-options clearable label="Supplier (optional)" filled />
          <q-input v-model="form.payee" label="Paid to (optional)" filled />
          <q-input v-model="form.description" label="Description" filled />
          <q-input v-model="form.reference" label="Receipt / reference" filled />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn color="primary" label="Save" :loading="saving" @click="save" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import AccountingRepository from 'src/services/repositories/AccountingRepository';
import SupplierRepository from 'src/services/repositories/SupplierRepository';
import { PAYMENT_METHODS, paymentLabel } from 'src/constants/payments';
import { useSettingsStore } from 'src/stores/settings';
import { useCurrency } from 'src/composables/useCurrency';
import { useAccountingUi, localISO, monthStartISO } from 'src/composables/useAccountingUi';
import ExportMenu from './ExportMenu.vue';

const settingsStore = useSettingsStore();
const { format } = useCurrency();
const { ok, fail, confirm } = useAccountingUi();

const from = ref(monthStartISO());
const to = ref(localISO());
const search = ref('');
const rows = ref([]);
const accounts = ref([]);
const suppliers = ref([]);
const loading = ref(false);
const saving = ref(false);
const showForm = ref(false);
const form = ref({});

const vatInfo = computed(() => ({
  rate: Number(settingsStore.values.default_tax_rate) || 0,
  registered: String(settingsStore.values.company_vat || '').trim() !== '',
}));
const vatPreview = computed(() => (Number(form.value.amount) * vatInfo.value.rate) / (100 + vatInfo.value.rate) || 0);
const accountOptions = computed(() =>
  accounts.value.filter((a) => a.type === 'expense' && a.is_active && a.system_key !== 'cogs').map((a) => ({ label: `${a.code} ${a.name}`, value: a.id })),
);
const supplierOptions = computed(() => suppliers.value.map((s) => ({ label: s.name, value: s.id })));
const total = computed(() => rows.value.reduce((s, r) => s + r.amount, 0));
const vatTotal = computed(() => rows.value.reduce((s, r) => s + r.tax_amount, 0));

const columns = [
  { name: 'date', label: 'Date', field: 'expense_date', align: 'left', sortable: true },
  { name: 'account', label: 'Category', field: 'account_name', align: 'left', sortable: true },
  { name: 'payee', label: 'Paid to', field: (r) => r.supplier_name || r.payee || '', align: 'left' },
  { name: 'description', label: 'Description', field: (r) => r.description || '', align: 'left' },
  { name: 'method', label: 'Paid from', field: (r) => paymentLabel(r.method), align: 'left' },
  { name: 'vat', label: 'VAT', field: (r) => format(r.tax_amount), align: 'right' },
  { name: 'amount', label: 'Amount', field: (r) => format(r.amount), align: 'right', sortable: true },
  { name: 'actions', label: '', field: 'id', align: 'right' },
];

const exportTable = () => ({
  title: 'Expenses',
  subtitle: `${from.value} to ${to.value}`,
  columns: [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'category', label: 'Category' },
    { key: 'payee', label: 'Paid to' },
    { key: 'description', label: 'Description' },
    { key: 'method', label: 'Paid from' },
    { key: 'reference', label: 'Reference' },
    { key: 'vat', label: 'VAT', type: 'money' },
    { key: 'amount', label: 'Amount', type: 'money' },
  ],
  rows: rows.value.map((r) => ({
    date: r.expense_date, category: r.account_name, payee: r.supplier_name || r.payee || '', description: r.description || '',
    method: paymentLabel(r.method), reference: r.reference || '', vat: r.tax_amount, amount: r.amount,
  })),
  totals: { vat: vatTotal.value, amount: total.value },
  meta: { company: settingsStore.values.company_name || '' },
});

async function load() {
  loading.value = true;
  try {
    rows.value = await AccountingRepository.expenses({ from: from.value || null, to: to.value || null, search: search.value || '' });
  } catch (err) {
    fail(err);
  } finally {
    loading.value = false;
  }
}

function openForm(row) {
  form.value = row
    ? {
        id: row.id, expenseDate: row.expense_date, accountId: row.account_id, amount: row.amount,
        includesVat: row.tax_amount > 0, method: row.method, supplierId: row.supplier_id, payee: row.payee || '',
        description: row.description || '', reference: row.reference || '', notes: row.notes || '',
      }
    : {
        id: null, expenseDate: localISO(), accountId: null, amount: null, includesVat: vatInfo.value.registered && vatInfo.value.rate > 0,
        method: 'cash', supplierId: null, payee: '', description: '', reference: '', notes: '',
      };
  showForm.value = true;
}

async function save() {
  saving.value = true;
  try {
    const { id, ...data } = form.value;
    if (id) await AccountingRepository.updateExpense(id, data);
    else await AccountingRepository.createExpense(data);
    showForm.value = false;
    ok('Expense saved');
    await load();
  } catch (err) {
    fail(err);
  } finally {
    saving.value = false;
  }
}

async function remove(row) {
  if (!(await confirm(`Delete this ${format(row.amount)} expense?`))) return;
  try {
    await AccountingRepository.deleteExpense(row.id);
    ok('Expense deleted');
    await load();
  } catch (err) {
    fail(err);
  }
}

onMounted(async () => {
  if (!settingsStore.loaded) await settingsStore.fetchAll();
  try {
    [accounts.value, suppliers.value] = await Promise.all([AccountingRepository.accounts(), SupplierRepository.all()]);
  } catch (err) {
    fail(err);
  }
  await load();
});
</script>
