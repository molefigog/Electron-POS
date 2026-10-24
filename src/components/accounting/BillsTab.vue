<template>
  <div>
    <div class="row items-center q-col-gutter-sm q-mb-sm">
      <div class="col-auto">
        <q-btn-toggle v-model="status" no-caps unelevated toggle-color="primary" dense
          :options="[{ label: 'Open', value: 'open' }, { label: 'Paid', value: 'paid' }, { label: 'All', value: null }]"
          @update:model-value="load" />
      </div>
      <q-space />
      <div class="col-auto"><ExportMenu :table="exportTable" file-name="supplier-bills" :disable="!rows.length" /></div>
      <div class="col-auto"><q-btn color="primary" icon="add" no-caps label="New bill" @click="openForm(null)" /></div>
    </div>

    <q-table flat bordered dense :rows="rows" :columns="columns" row-key="id" :loading="loading"
      :pagination="{ rowsPerPage: 15 }" no-data-label="No bills here.">
      <template #body-cell-status="props">
        <q-td :props="props"><q-badge :color="props.row.status === 'paid' ? 'positive' : 'orange'" :label="props.row.status" /></q-td>
      </template>
      <template #body-cell-actions="props">
        <q-td :props="props">
          <q-btn dense flat no-caps color="primary" icon="payments" label="Pay" @click="openPay(props.row)" />
          <q-btn dense flat round icon="edit" @click="openForm(props.row)" />
          <q-btn dense flat round icon="delete" color="negative" @click="remove(props.row)" />
        </q-td>
      </template>
    </q-table>
    <div class="text-caption text-grey q-mt-xs">Owing on this list: <strong>{{ format(owing) }}</strong></div>

    <q-dialog v-model="showForm">
      <q-card style="min-width: 480px">
        <q-card-section class="text-h6">{{ form.id ? 'Edit' : 'New' }} supplier bill</q-card-section>
        <q-card-section class="q-gutter-sm">
          <q-select v-if="!form.id" v-model="poId" :options="poOptions" emit-value map-options clearable
            label="Bill a purchase order (optional)" filled @update:model-value="pickPo" />
          <q-select v-model="form.supplierId" :options="supplierOptions" emit-value map-options clearable label="Supplier" filled />
          <q-input v-model="form.billNumber" label="Supplier's bill number" filled />
          <div class="row q-col-gutter-sm">
            <div class="col"><q-input v-model="form.billDate" type="date" label="Bill date *" filled /></div>
            <div class="col"><q-input v-model="form.dueDate" type="date" label="Due date" filled /></div>
          </div>
          <q-select v-model="form.accountId" :options="accountOptions" emit-value map-options label="What is it for? *" filled
            hint="Inventory for stock purchases, or an expense account" />
          <q-input v-model.number="form.amount" type="number" min="0" step="0.01" label="Bill total *" filled />
          <div v-if="vatInfo.registered && vatInfo.rate > 0">
            <q-checkbox v-model="form.includesVat" :label="`Total includes VAT (${vatInfo.rate}%)`" dense />
            <span v-if="form.includesVat && form.amount > 0" class="text-caption text-grey q-ml-sm">VAT {{ format(vatPreview) }}</span>
          </div>
          <q-input v-model="form.notes" label="Notes" filled type="textarea" autogrow />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn color="primary" label="Save bill" :loading="saving" @click="save" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="showPay">
      <q-card style="min-width: 480px">
        <q-card-section class="text-h6">Pay supplier</q-card-section>
        <q-card-section class="q-gutter-sm">
          <div class="text-body2">
            {{ target?.supplier_name || 'No supplier' }} &middot; bill {{ target?.bill_number || `#${target?.id}` }}<br />
            Balance owing: <strong>{{ format(target?.balance) }}</strong>
          </div>
          <q-input v-model.number="pay.amount" type="number" min="0" step="0.01" label="Amount *" filled />
          <q-select v-model="pay.method" :options="PAYMENT_METHODS" option-value="value" option-label="label" emit-value map-options label="Paid from" filled />
          <q-input v-model="pay.paidAt" type="date" label="Date" filled />
          <q-input v-model="pay.reference" label="Reference" filled />
          <div v-if="payments.length" class="q-mt-md">
            <div class="text-caption text-grey">Payments made</div>
            <q-list dense separator>
              <q-item v-for="p in payments" :key="p.id">
                <q-item-section>{{ p.paid_at }} &middot; {{ paymentLabel(p.method) }} &middot; {{ format(p.amount) }}</q-item-section>
                <q-item-section side><q-btn dense flat round icon="delete" color="negative" @click="removePayment(p)" /></q-item-section>
              </q-item>
            </q-list>
          </div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Close" v-close-popup />
          <q-btn color="primary" label="Record payment" :loading="saving" :disable="!(target?.balance > 0)" @click="savePayment" />
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
import { useAccountingUi, localISO } from 'src/composables/useAccountingUi';
import ExportMenu from './ExportMenu.vue';

const settingsStore = useSettingsStore();
const { format } = useCurrency();
const { ok, fail, confirm } = useAccountingUi();

const status = ref('open');
const rows = ref([]);
const accounts = ref([]);
const suppliers = ref([]);
const pos = ref([]);
const poId = ref(null);
const loading = ref(false);
const saving = ref(false);
const showForm = ref(false);
const showPay = ref(false);
const form = ref({});
const target = ref(null);
const pay = ref({});
const payments = ref([]);

const vatInfo = computed(() => ({
  rate: Number(settingsStore.values.default_tax_rate) || 0,
  registered: String(settingsStore.values.company_vat || '').trim() !== '',
}));
const vatPreview = computed(() => (Number(form.value.amount) * vatInfo.value.rate) / (100 + vatInfo.value.rate) || 0);
const owing = computed(() => rows.value.reduce((s, r) => s + r.balance, 0));
const accountOptions = computed(() =>
  accounts.value.filter((a) => a.is_active && (a.type === 'expense' || a.system_key === 'inventory') && a.system_key !== 'cogs')
    .map((a) => ({ label: `${a.code} ${a.name}`, value: a.id })),
);
const supplierOptions = computed(() => suppliers.value.map((s) => ({ label: s.name, value: s.id })));
const poOptions = computed(() =>
  pos.value.map((p) => ({ label: `${p.number} - ${p.supplier_name || 'no supplier'}${p.grand_total ? ` - ${format(p.grand_total)}` : ''}`, value: p.id })),
);

const columns = [
  { name: 'date', label: 'Bill date', field: 'bill_date', align: 'left', sortable: true },
  { name: 'number', label: 'Bill no.', field: (r) => r.bill_number || `#${r.id}`, align: 'left' },
  { name: 'supplier', label: 'Supplier', field: (r) => r.supplier_name || '-', align: 'left', sortable: true },
  { name: 'po', label: 'PO', field: (r) => r.po_number || '', align: 'left' },
  { name: 'due', label: 'Due', field: (r) => r.due_date || '', align: 'left' },
  { name: 'total', label: 'Total', field: (r) => format(r.total), align: 'right' },
  { name: 'balance', label: 'Balance', field: (r) => format(r.balance), align: 'right' },
  { name: 'status', label: 'Status', field: 'status', align: 'left' },
  { name: 'actions', label: '', field: 'id', align: 'right' },
];

const exportTable = () => ({
  title: 'Supplier Bills',
  subtitle: status.value ? `Status: ${status.value}` : 'All bills',
  columns: [
    { key: 'date', label: 'Bill date', type: 'date' },
    { key: 'number', label: 'Bill no.' },
    { key: 'supplier', label: 'Supplier' },
    { key: 'po', label: 'PO' },
    { key: 'due', label: 'Due date' },
    { key: 'vat', label: 'VAT', type: 'money' },
    { key: 'total', label: 'Total', type: 'money' },
    { key: 'paid', label: 'Paid', type: 'money' },
    { key: 'balance', label: 'Balance', type: 'money' },
    { key: 'status', label: 'Status' },
  ],
  rows: rows.value.map((r) => ({
    date: r.bill_date, number: r.bill_number || `#${r.id}`, supplier: r.supplier_name || '', po: r.po_number || '',
    due: r.due_date || '', vat: r.tax_amount, total: r.total, paid: r.paid, balance: r.balance, status: r.status,
  })),
  totals: { vat: sum('tax_amount'), total: sum('total'), paid: sum('paid'), balance: sum('balance') },
  meta: { company: settingsStore.values.company_name || '' },
});
const sum = (k) => rows.value.reduce((s, r) => s + (Number(r[k]) || 0), 0);

async function load() {
  loading.value = true;
  try {
    rows.value = await AccountingRepository.bills({ status: status.value });
  } catch (err) {
    fail(err);
  } finally {
    loading.value = false;
  }
}

async function loadLookups() {
  [accounts.value, suppliers.value, pos.value] = await Promise.all([
    AccountingRepository.accounts(),
    SupplierRepository.all(),
    AccountingRepository.purchaseOrdersToBill(),
  ]);
}

function inventoryAccountId() {
  return accounts.value.find((a) => a.system_key === 'inventory')?.id || null;
}

function openForm(row) {
  poId.value = null;
  form.value = row
    ? {
        id: row.id, billNumber: row.bill_number || '', supplierId: row.supplier_id, purchaseOrderId: row.purchase_order_id,
        billDate: row.bill_date, dueDate: row.due_date || '', accountId: row.account_id, amount: row.total,
        includesVat: row.tax_amount > 0, notes: row.notes || '',
      }
    : {
        id: null, billNumber: '', supplierId: null, purchaseOrderId: null, billDate: localISO(), dueDate: '',
        accountId: accounts.value.find((a) => a.system_key === 'expenses_general')?.id || null, amount: null,
        includesVat: vatInfo.value.registered && vatInfo.value.rate > 0, notes: '',
      };
  showForm.value = true;
}

function pickPo(id) {
  const po = pos.value.find((p) => p.id === id);
  form.value.purchaseOrderId = po?.id || null;
  if (!po) return;
  form.value.supplierId = po.supplier_id;
  form.value.accountId = inventoryAccountId();
  if (po.grand_total) form.value.amount = po.grand_total;
}

async function save() {
  saving.value = true;
  try {
    const { id, ...data } = form.value;
    if (id) await AccountingRepository.updateBill(id, data);
    else await AccountingRepository.createBill(data);
    showForm.value = false;
    ok('Bill saved');
    await Promise.all([load(), loadLookups()]);
  } catch (err) {
    fail(err);
  } finally {
    saving.value = false;
  }
}

async function remove(row) {
  if (!(await confirm(`Delete bill ${row.bill_number || `#${row.id}`}?`))) return;
  try {
    await AccountingRepository.deleteBill(row.id);
    ok('Bill deleted');
    await Promise.all([load(), loadLookups()]);
  } catch (err) {
    fail(err);
  }
}

async function openPay(row) {
  target.value = row;
  pay.value = { amount: row.balance, method: 'cash', paidAt: localISO(), reference: '' };
  try {
    payments.value = await AccountingRepository.billPayments(row.id);
  } catch (err) {
    fail(err);
  }
  showPay.value = true;
}

async function refreshTarget() {
  await load();
  target.value = rows.value.find((r) => r.id === target.value.id) || { ...target.value, balance: 0 };
  payments.value = await AccountingRepository.billPayments(target.value.id);
}

async function savePayment() {
  saving.value = true;
  try {
    await AccountingRepository.recordBillPayment({ billId: target.value.id, ...pay.value });
    ok('Payment recorded');
    await refreshTarget();
    pay.value.amount = target.value.balance;
  } catch (err) {
    fail(err);
  } finally {
    saving.value = false;
  }
}

async function removePayment(p) {
  if (!(await confirm(`Delete the ${format(p.amount)} payment?`))) return;
  try {
    await AccountingRepository.deleteBillPayment(p.id);
    await refreshTarget();
    pay.value.amount = target.value.balance;
  } catch (err) {
    fail(err);
  }
}

onMounted(async () => {
  if (!settingsStore.loaded) await settingsStore.fetchAll();
  try {
    await loadLookups();
  } catch (err) {
    fail(err);
  }
  await load();
});
</script>
