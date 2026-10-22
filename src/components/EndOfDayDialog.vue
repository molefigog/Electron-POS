<template>
  <q-dialog :model-value="modelValue" @update:model-value="(v) => emit('update:modelValue', v)" @show="load">
    <q-card style="width: 760px; max-width: 95vw">
      <q-card-section class="row items-center q-pb-none">
        <div class="text-h6">End of Day</div>
        <q-space />
        <q-btn flat round dense icon="close" v-close-popup />
      </q-card-section>

      <q-card-section class="q-gutter-y-md">
        <div class="row items-center q-col-gutter-md">
          <div class="col-6 col-sm-4">
            <q-input v-model="date" type="date" label="Day" filled dense @update:model-value="load" />
          </div>
          <div class="col text-caption text-grey">
            POS sales only - quotations, purchase orders and account invoices are not included.
          </div>
        </div>

        <q-markup-table flat bordered dense separator="horizontal">
          <thead>
            <tr>
              <th class="text-left">Number</th>
              <th class="text-left">Customer</th>
              <th class="text-right">Total</th>
              <th class="text-left">Paid by</th>
              <th class="text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!report.sales.length">
              <td colspan="5" class="text-center text-grey">{{ loading ? 'Loading...' : 'No POS sales on this day.' }}</td>
            </tr>
            <tr v-for="s in report.sales" :key="s.id" :class="{ 'text-grey': s.status === 'void' }">
              <td>{{ s.number }}</td>
              <td>{{ s.customer_name || 'Walk-in' }}</td>
              <td class="text-right">{{ format(s.grand_total) }}</td>
              <td>{{ s.payments.map((p) => paymentLabel(p.method)).join(' + ') }}</td>
              <td>{{ s.status === 'void' ? 'Void' : 'Paid' }}</td>
            </tr>
          </tbody>
        </q-markup-table>

        <div class="row q-col-gutter-sm">
          <div class="col-12">
            <q-card flat bordered><q-card-section class="row items-center q-py-sm">
              <div class="text-subtitle2">Grand sales total ({{ report.totals.count }})</div>
              <q-space />
              <div class="text-h6">{{ format(report.totals.grandTotal) }}</div>
            </q-card-section></q-card>
          </div>
          <div v-for="m in usedMethods" :key="m.value" class="col-6 col-sm-4">
            <q-card flat bordered><q-card-section class="q-py-sm">
              <div class="text-caption text-grey">{{ m.label }}</div>
              <div class="text-subtitle1">{{ format(report.totals.byMethod[m.value]) }}</div>
            </q-card-section></q-card>
          </div>
        </div>
      </q-card-section>

      <q-card-actions align="right" class="q-pa-md">
        <q-btn flat no-caps label="Close" v-close-popup />
        <q-btn outline no-caps icon="print" label="Print" :disable="!report.sales.length" :loading="printing" @click="printSheet" />
        <q-btn color="primary" no-caps icon="picture_as_pdf" label="Save PDF" :disable="!report.sales.length" :loading="savingPdf" @click="savePdf" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useQuasar } from 'quasar';
import TransactionRepository from 'src/services/repositories/TransactionRepository';
import { useSettingsStore } from 'src/stores/settings';
import { useCurrency } from 'src/composables/useCurrency';
import { usePrintDocument } from 'src/composables/usePrintDocument';
import { renderEndOfDay } from 'src/services/print-templates/end-of-day';
import { PAYMENT_METHODS, paymentLabel } from 'src/constants/payments';

defineProps({ modelValue: { type: Boolean, default: false } });
const emit = defineEmits(['update:modelValue']);

const $q = useQuasar();
const settingsStore = useSettingsStore();
const { format } = useCurrency();
const { printHtml } = usePrintDocument();

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const emptyReport = () => ({ date: '', sales: [], totals: { count: 0, grandTotal: 0, byMethod: {} } });
const date = ref(todayLocal());
const report = ref(emptyReport());
const loading = ref(false);
const printing = ref(false);
const savingPdf = ref(false);

const usedMethods = computed(() => PAYMENT_METHODS.filter((m) => Number(report.value.totals.byMethod?.[m.value] || 0) > 0));

async function load() {
  if (!date.value) date.value = todayLocal();
  loading.value = true;
  try {
    report.value = await TransactionRepository.endOfDay({ date: date.value });
  } catch (err) {
    report.value = emptyReport();
    $q.notify({ type: 'negative', message: err.message || 'Could not load the end-of-day sales' });
  } finally {
    loading.value = false;
  }
}

function buildHtml() {
  return renderEndOfDay(report.value, settingsStore.values, settingsStore.values.print_template || 'classic');
}

async function printSheet() {
  printing.value = true;
  try {
    await printHtml(buildHtml());
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message || 'Could not print the end-of-day sheet' });
  } finally {
    printing.value = false;
  }
}

async function savePdf() {
  if (!window.appBridge?.printPdf) {
    $q.notify({ type: 'negative', message: 'PDF export is only available in the desktop app.' });
    return;
  }
  savingPdf.value = true;
  try {
    const result = await window.appBridge.printPdf({
      html: buildHtml(),
      defaultFileName: `END-OF-DAY-${date.value.replace(/-/g, '')}.pdf`,
    });
    $q.notify({
      type: result.opened === false ? 'warning' : 'positive',
      message: result.opened === false ? `Saved: ${result.filePath}. Could not open automatically.` : `Saved and opened: ${result.filePath}`,
    });
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message || 'Could not save PDF' });
  } finally {
    savingPdf.value = false;
  }
}
</script>
