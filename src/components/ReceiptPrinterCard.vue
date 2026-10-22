<template>
  <q-card flat bordered class="q-mb-md">
    <q-card-section class="text-subtitle1">Receipt (POS) printer</q-card-section>

    <q-card-section class="q-gutter-y-md">
      <q-banner v-if="isClient" dense rounded class="bg-blue-1 text-blue-10">
        This PC is connected to the main PC, so receipts print on the printer chosen on the main PC.
      </q-banner>

      <div class="row items-start q-col-gutter-sm no-wrap">
        <q-select
          v-model="printer" :options="printerOptions" emit-value map-options clearable filled dense class="col"
          label="POS receipt printer (80 mm thermal)" :loading="loadingPrinters" :disable="isClient || !bridge"
          hint="The Windows printer name of your thermal printer. Saved as soon as you pick it."
          @update:model-value="savePrinter"
        />
        <q-btn flat dense round icon="refresh" class="q-mt-xs" :disable="isClient" @click="loadPrinters">
          <q-tooltip>Refresh printer list</q-tooltip>
        </q-btn>
      </div>

      <div>
        <div class="text-caption text-grey q-mb-xs">Receipt template</div>
        <q-btn-toggle
          :model-value="currentTemplate" no-caps unelevated toggle-color="primary" :options="templateOptions"
          @update:model-value="(v) => emit('update:template', v)"
        />
        <div class="text-caption text-grey q-mt-xs">{{ templateHint }}</div>
      </div>

      <div class="row q-col-gutter-md items-start">
        <div class="col-12 col-sm-6">
          <q-select
            :model-value="shortcut" :options="comboOptions" emit-value map-options clearable filled dense
            label="Print receipt shortcut" hint="Works on the Transactions screen. Press Save Settings to apply."
            @update:model-value="(v) => emit('update:shortcut', v)"
          />
          <div class="text-caption text-grey q-mt-sm">
            Prints the document you are editing, or the last one you saved, with the template above.
            Template and shortcut are saved with Save Settings.
          </div>
        </div>
        <div class="col-12 col-sm-6">
          <div class="text-caption text-grey q-mb-xs">Preview (sample data)</div>
          <iframe class="receipt-preview" sandbox="" :srcdoc="previewHtml" title="Receipt preview" />
        </div>
      </div>

      <div class="row items-start q-col-gutter-sm no-wrap">
        <q-input
          v-model.number="contentWidth" type="number" :min="RECEIPT_WIDTH_MIN_MM" :max="RECEIPT_WIDTH_MAX_MM" step="2"
          filled dense suffix="mm" label="Receipt text width" style="width: 190px"
          hint="Cut off on the right? Make it smaller (try 60). Wasted space at the sides? Make it larger (68 or 72)."
          @change="saveContentWidth"
        />
      </div>

      <div class="row q-gutter-sm">
        <q-btn
          dense no-caps outline color="primary" icon="print" label="Print test receipt" :loading="printing"
          :disable="!printer && !isClient" @click="printTest"
        />
      </div>
    </q-card-section>
  </q-card>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useQuasar } from 'quasar';
import { useSettingsStore } from 'src/stores/settings';
import { AVAILABLE_COMBOS, formatCombo } from 'src/constants/shortcuts';
import {
  THERMAL_TEMPLATES,
  RECEIPT_WIDTH_MIN_MM,
  RECEIPT_WIDTH_MAX_MM,
  receiptContentWidth,
  renderThermalReceipt,
} from 'src/services/print-templates/thermal';

const props = defineProps({
  template: { type: String, default: 'compact' },
  shortcut: { type: String, default: '' },
});
const emit = defineEmits(['update:template', 'update:shortcut']);

const $q = useQuasar();
const settingsStore = useSettingsStore();
const bridge = window.networkBridge;

const printer = ref('');
const contentWidth = ref(receiptContentWidth(settingsStore.values));
const printers = ref([]);
const isClient = ref(false);
const loadingPrinters = ref(false);
const printing = ref(false);

const templateOptions = Object.entries(THERMAL_TEMPLATES).map(([value, t]) => ({ label: t.label, value }));
const comboOptions = AVAILABLE_COMBOS.map((combo) => ({ label: formatCombo(combo), value: combo }));
const printerOptions = computed(() => {
  const list = printers.value.map((p) => ({ label: p.displayName || p.name, value: p.name }));
  // keep a saved printer visible even if Windows no longer lists it (switched off / unplugged)
  if (printer.value && !list.some((o) => o.value === printer.value)) list.unshift({ label: `${printer.value} (not found)`, value: printer.value });
  return list;
});

// The preview follows the (not yet saved) choice made in this card
const currentTemplate = computed(() => (THERMAL_TEMPLATES[props.template] ? props.template : 'compact'));
const templateHint = computed(() => THERMAL_TEMPLATES[currentTemplate.value]?.hint || '');

function sampleTransaction() {
  return {
    type: 'invoice',
    number: 'INV-0001',
    issued_at: new Date().toISOString().slice(0, 10),
    created_at: new Date().toISOString(),
    customer_name: 'Walk-in Customer',
    discount_total: 0,
    tax_total: 16.7,
    grand_total: 127.5,
    amount_tendered: 150,
    payments: [
      { method: 'speedpoint', amount: 100 },
      { method: 'cash', amount: 50 },
    ],
    items: [
      { name: 'Claw hammer 16oz', quantity: 1, unit_price: 85, discount_pct: 0, line_total: 85 },
      { name: 'Wood screws (box)', quantity: 3, unit_price: 14.17, discount_pct: 0, line_total: 42.5 },
    ],
  };
}

const previewHtml = computed(() => renderThermalReceipt(currentTemplate.value, sampleTransaction(), settingsStore.values));

function cleanError(err) {
  return String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

async function loadPrinters() {
  if (!window.appBridge?.getPrinters) return;
  loadingPrinters.value = true;
  try {
    printers.value = await window.appBridge.getPrinters();
  } catch {
    printers.value = [];
  } finally {
    loadingPrinters.value = false;
  }
}

async function savePrinter(value) {
  try {
    await bridge.save({ receiptPrinter: value || '' });
    $q.notify({ type: 'positive', message: value ? `POS printer set to ${value}` : 'POS printer cleared', timeout: 1500 });
  } catch (err) {
    $q.notify({ type: 'negative', message: cleanError(err), timeout: 6000 });
  }
}

async function saveContentWidth() {
  const width = receiptContentWidth({ receipt_content_width: contentWidth.value });
  contentWidth.value = width;
  try {
    await settingsStore.update({ receipt_content_width: String(width) });
    $q.notify({ type: 'positive', message: `Receipt text width set to ${width} mm`, timeout: 1500 });
  } catch (err) {
    $q.notify({ type: 'negative', message: cleanError(err), timeout: 6000 });
  }
}

async function printTest() {
  printing.value = true;
  try {
    await window.appBridge.printReceipt({ html: previewHtml.value });
    $q.notify({ type: 'positive', message: 'Test receipt sent to the printer' });
  } catch (err) {
    $q.notify({ type: 'negative', message: cleanError(err), timeout: 6000 });
  } finally {
    printing.value = false;
  }
}

onMounted(async () => {
  if (!bridge) return;
  try {
    const cfg = await bridge.getConfig();
    printer.value = cfg.receiptPrinter || '';
    isClient.value = cfg.mode === 'client';
  } catch {
    // keep defaults
  }
  await loadPrinters();
});
</script>

<style scoped>
.receipt-preview {
  width: 302px; /* 80 mm */
  max-width: 100%;
  height: 360px;
  border: 1px solid var(--border-color, #ccc);
  border-radius: 6px;
  background: #fff;
}
</style>
