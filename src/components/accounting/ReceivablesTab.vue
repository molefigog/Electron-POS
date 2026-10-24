<template>
  <div>
    <div class="row items-center q-mb-sm">
      <div class="text-subtitle1">Unpaid customer invoices</div>
      <q-space />
      <ExportMenu :table="agingTable" label="Export aging" file-name="customer-aging" />
    </div>
    <q-table flat bordered dense :rows="rows" :columns="columns" row-key="id" :loading="loading"
      :pagination="{ rowsPerPage: 15 }" no-data-label="Nothing owed - every invoice is paid.">
      <template #body-cell-actions="props">
        <q-td :props="props">
          <q-btn dense unelevated color="primary" no-caps icon="payments" label="Receive payment" @click="openPay(props.row)" />
        </q-td>
      </template>
    </q-table>
    <div class="text-caption text-grey q-mt-xs">
      POS sales are paid at the till and never appear here. Total owed: <strong>{{ format(owed) }}</strong>
    </div>

    <div class="text-subtitle1 q-mt-lg q-mb-sm">Payments received</div>
    <q-table flat bordered dense :rows="payments" :columns="payColumns" row-key="id" :pagination="{ rowsPerPage: 10 }"
      no-data-label="No payments recorded yet.">
      <template #body-cell-actions="props">
        <q-td :props="props"><q-btn dense flat round icon="delete" color="negative" @click="removePayment(props.row)" /></q-td>
      </template>
    </q-table>

    <q-dialog v-model="showPay">
      <q-card style="min-width: 420px">
        <q-card-section class="text-h6">Receive payment</q-card-section>
        <q-card-section class="q-gutter-sm">
          <div class="text-body2">
            {{ target?.number }} &middot; {{ target?.customer_name || 'No customer' }}<br />
            Balance owing: <strong>{{ format(target?.balance) }}</strong>
          </div>
          <q-input v-model.number="form.amount" type="number" min="0" step="0.01" label="Amount *" filled autofocus />
          <q-select v-model="form.method" :options="PAYMENT_METHODS" option-value="value" option-label="label" emit-value
            map-options label="Method" filled />
          <q-input v-model="form.paidAt" type="date" label="Date" filled />
          <q-input v-model="form.reference" label="Reference (optional)" filled />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn color="primary" label="Save payment" :loading="saving" @click="savePayment" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import AccountingRepository from 'src/services/repositories/AccountingRepository';
import { PAYMENT_METHODS, paymentLabel } from 'src/constants/payments';
import { useCurrency } from 'src/composables/useCurrency';
import { useAccountingUi, localISO } from 'src/composables/useAccountingUi';
import ExportMenu from './ExportMenu.vue';

const { format } = useCurrency();
const { ok, fail, confirm } = useAccountingUi();

const rows = ref([]);
const payments = ref([]);
const loading = ref(false);
const saving = ref(false);
const showPay = ref(false);
const target = ref(null);
const form = ref({ amount: 0, method: 'cash', paidAt: localISO(), reference: '' });

const owed = computed(() => rows.value.reduce((s, r) => s + r.balance, 0));
const money = (key) => (r) => format(r[key]);
const columns = [
  { name: 'customer', label: 'Customer', field: (r) => r.customer_name || '-', align: 'left', sortable: true },
  { name: 'number', label: 'Invoice', field: 'number', align: 'left', sortable: true },
  { name: 'date', label: 'Date', field: 'date', align: 'left', sortable: true },
  { name: 'days', label: 'Days', field: 'days', align: 'right', sortable: true },
  { name: 'total', label: 'Total', field: money('total'), align: 'right' },
  { name: 'paid', label: 'Paid', field: money('paid'), align: 'right' },
  { name: 'balance', label: 'Balance', field: money('balance'), align: 'right' },
  { name: 'actions', label: '', field: 'id', align: 'right' },
];
const payColumns = [
  { name: 'paid_at', label: 'Date', field: 'paid_at', align: 'left', sortable: true },
  { name: 'invoice', label: 'Invoice', field: 'invoice_number', align: 'left' },
  { name: 'customer', label: 'Customer', field: (r) => r.customer_name || '-', align: 'left' },
  { name: 'method', label: 'Method', field: (r) => paymentLabel(r.method), align: 'left' },
  { name: 'reference', label: 'Reference', field: (r) => r.reference || '', align: 'left' },
  { name: 'amount', label: 'Amount', field: money('amount'), align: 'right' },
  { name: 'actions', label: '', field: 'id', align: 'right' },
];

const agingTable = () => AccountingRepository.report('arAging', { asOf: localISO() });

async function load() {
  loading.value = true;
  try {
    [rows.value, payments.value] = await Promise.all([
      AccountingRepository.openInvoices({ asOf: localISO() }),
      AccountingRepository.customerPayments({}),
    ]);
  } catch (err) {
    fail(err);
  } finally {
    loading.value = false;
  }
}

function openPay(row) {
  target.value = row;
  form.value = { amount: row.balance, method: 'cash', paidAt: localISO(), reference: '' };
  showPay.value = true;
}

async function savePayment() {
  saving.value = true;
  try {
    await AccountingRepository.recordCustomerPayment({ transactionId: target.value.id, ...form.value });
    showPay.value = false;
    ok('Payment recorded');
    await load();
  } catch (err) {
    fail(err);
  } finally {
    saving.value = false;
  }
}

async function removePayment(row) {
  if (!(await confirm(`Delete the ${format(row.amount)} payment on ${row.invoice_number}?`))) return;
  try {
    await AccountingRepository.deleteCustomerPayment(row.id);
    ok('Payment deleted');
    await load();
  } catch (err) {
    fail(err);
  }
}

onMounted(load);
</script>
