diff --git a/src/components/NetworkSettingsCard.vue b/src/components/NetworkSettingsCard.vue
index b355399..36ad91f 100644
--- a/src/components/NetworkSettingsCard.vue
+++ b/src/components/NetworkSettingsCard.vue
@@ -17,10 +17,9 @@
           The network server is not running. {{ cfg.serverError }}
         </q-banner>
 
-        <q-select
-          v-model="receiptPrinter" :options="printerOptions" emit-value map-options clearable dense outlined
-          label="Receipt printer (80 mm thermal, connected to this PC)" :loading="loadingPrinters"
-        />
+        <div class="text-caption text-grey-8">
+          The receipt printer for this PC is chosen in Settings &rarr; Receipt (POS) printer.
+        </div>
 
         <div v-if="cfg.connectionCodes.length && cfg.activeMode === 'host'" class="q-gutter-y-sm">
           <div class="text-weight-medium">Connection code for the other PCs</div>
@@ -82,11 +81,8 @@ const available = Boolean(bridge);
 
 const cfg = ref({ mode: 'single', activeMode: 'single', connectionCodes: [], addresses: [] });
 const mode = ref('single');
-const receiptPrinter = ref('');
 const code = ref('');
 const selectedAddress = ref('');
-const printers = ref([]);
-const loadingPrinters = ref(false);
 const busy = ref(false);
 const testing = ref(false);
 const printing = ref(false);
@@ -98,12 +94,11 @@ const modeOptions = [
   { label: 'Connect to the main PC', value: 'client' },
 ];
 
-const printerOptions = computed(() => printers.value.map((p) => ({ label: p.displayName || p.name, value: p.name })));
 const currentCode = computed(() => {
   const list = cfg.value.connectionCodes || [];
   return (list.find((c) => c.address === selectedAddress.value) || list[0])?.code || '';
 });
-const dirty = computed(() => mode.value !== cfg.value.mode || (receiptPrinter.value || '') !== (cfg.value.receiptPrinter || ''));
+const dirty = computed(() => mode.value !== cfg.value.mode);
 
 function cleanError(err) {
   return String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
@@ -119,26 +114,13 @@ function askRestart(message) {
 async function load() {
   cfg.value = await bridge.getConfig();
   mode.value = cfg.value.mode;
-  receiptPrinter.value = cfg.value.receiptPrinter || '';
   selectedAddress.value = cfg.value.connectionCodes?.[0]?.address || '';
 }
 
-async function loadPrinters() {
-  if (!window.appBridge?.getPrinters) return;
-  loadingPrinters.value = true;
-  try {
-    printers.value = await window.appBridge.getPrinters();
-  } catch {
-    printers.value = [];
-  } finally {
-    loadingPrinters.value = false;
-  }
-}
-
 async function save() {
   busy.value = true;
   try {
-    const res = await bridge.save({ mode: mode.value, receiptPrinter: receiptPrinter.value || '' });
+    const res = await bridge.save({ mode: mode.value });
     cfg.value = res.config;
     $q.notify({ type: 'positive', message: 'Network settings saved' });
     if (res.restartRequired) askRestart('The POS must restart to apply the new network role.');
@@ -215,7 +197,6 @@ function receiptTestHtml() {
 async function printTest() {
   printing.value = true;
   try {
-    if (dirty.value) await bridge.save({ receiptPrinter: receiptPrinter.value || '' });
     await window.appBridge.printReceipt({ html: receiptTestHtml() });
     $q.notify({ type: 'positive', message: 'Test receipt sent to the printer' });
   } catch (err) {
@@ -227,7 +208,7 @@ async function printTest() {
 
 onMounted(async () => {
   if (!available) return;
-  await Promise.all([load(), loadPrinters()]);
+  await load();
   offStatus = bridge.onStatus?.((connected) => { cfg.value = { ...cfg.value, clientConnected: connected }; });
 });
 onBeforeUnmount(() => offStatus?.());
diff --git a/src/components/ReceiptPrinterCard.vue b/src/components/ReceiptPrinterCard.vue
new file mode 100644
index 0000000..dcc8ac2
--- /dev/null
+++ b/src/components/ReceiptPrinterCard.vue
@@ -0,0 +1,173 @@
+<template>
+  <q-card flat bordered class="q-mb-md">
+    <q-card-section class="text-subtitle1">Receipt (POS) printer</q-card-section>
+
+    <q-card-section class="q-gutter-y-md">
+      <q-banner v-if="isClient" dense rounded class="bg-blue-1 text-blue-10">
+        This PC is connected to the main PC, so receipts print on the printer chosen on the main PC.
+      </q-banner>
+
+      <div class="row items-start q-col-gutter-sm no-wrap">
+        <q-select
+          v-model="printer" :options="printerOptions" emit-value map-options clearable filled dense class="col"
+          label="POS receipt printer (80 mm thermal)" :loading="loadingPrinters" :disable="isClient || !bridge"
+          hint="The Windows printer name of your thermal printer. Saved as soon as you pick it."
+          @update:model-value="savePrinter"
+        />
+        <q-btn flat dense round icon="refresh" class="q-mt-xs" :disable="isClient" @click="loadPrinters">
+          <q-tooltip>Refresh printer list</q-tooltip>
+        </q-btn>
+      </div>
+
+      <div>
+        <div class="text-caption text-grey q-mb-xs">Receipt template</div>
+        <q-btn-toggle
+          :model-value="currentTemplate" no-caps unelevated toggle-color="primary" :options="templateOptions"
+          @update:model-value="(v) => emit('update:template', v)"
+        />
+        <div class="text-caption text-grey q-mt-xs">{{ templateHint }}</div>
+      </div>
+
+      <div class="row q-col-gutter-md items-start">
+        <div class="col-12 col-sm-6">
+          <q-select
+            :model-value="shortcut" :options="comboOptions" emit-value map-options clearable filled dense
+            label="Print receipt shortcut" hint="Works on the Transactions screen. Press Save Settings to apply."
+            @update:model-value="(v) => emit('update:shortcut', v)"
+          />
+          <div class="text-caption text-grey q-mt-sm">
+            Prints the document you are editing, or the last one you saved, with the template above.
+            Template and shortcut are saved with Save Settings.
+          </div>
+        </div>
+        <div class="col-12 col-sm-6">
+          <div class="text-caption text-grey q-mb-xs">Preview (sample data)</div>
+          <iframe class="receipt-preview" sandbox="" :srcdoc="previewHtml" title="Receipt preview" />
+        </div>
+      </div>
+
+      <div class="row q-gutter-sm">
+        <q-btn
+          dense no-caps outline color="primary" icon="print" label="Print test receipt" :loading="printing"
+          :disable="!printer && !isClient" @click="printTest"
+        />
+      </div>
+    </q-card-section>
+  </q-card>
+</template>
+
+<script setup>
+import { computed, onMounted, ref } from 'vue';
+import { useQuasar } from 'quasar';
+import { useSettingsStore } from 'src/stores/settings';
+import { AVAILABLE_COMBOS, formatCombo } from 'src/constants/shortcuts';
+import { THERMAL_TEMPLATES, renderThermalReceipt } from 'src/services/print-templates/thermal';
+
+const props = defineProps({
+  template: { type: String, default: 'compact' },
+  shortcut: { type: String, default: '' },
+});
+const emit = defineEmits(['update:template', 'update:shortcut']);
+
+const $q = useQuasar();
+const settingsStore = useSettingsStore();
+const bridge = window.networkBridge;
+
+const printer = ref('');
+const printers = ref([]);
+const isClient = ref(false);
+const loadingPrinters = ref(false);
+const printing = ref(false);
+
+const templateOptions = Object.entries(THERMAL_TEMPLATES).map(([value, t]) => ({ label: t.label, value }));
+const comboOptions = AVAILABLE_COMBOS.map((combo) => ({ label: formatCombo(combo), value: combo }));
+const printerOptions = computed(() => {
+  const list = printers.value.map((p) => ({ label: p.displayName || p.name, value: p.name }));
+  // keep a saved printer visible even if Windows no longer lists it (switched off / unplugged)
+  if (printer.value && !list.some((o) => o.value === printer.value)) list.unshift({ label: `${printer.value} (not found)`, value: printer.value });
+  return list;
+});
+
+// The preview follows the (not yet saved) choice made in this card
+const currentTemplate = computed(() => (THERMAL_TEMPLATES[props.template] ? props.template : 'compact'));
+const templateHint = computed(() => THERMAL_TEMPLATES[currentTemplate.value]?.hint || '');
+
+function sampleTransaction() {
+  return {
+    type: 'invoice',
+    number: 'INV-0001',
+    issued_at: new Date().toISOString().slice(0, 10),
+    created_at: new Date().toISOString(),
+    customer_name: 'Walk-in Customer',
+    discount_total: 0,
+    tax_total: 16.7,
+    grand_total: 127.5,
+    items: [
+      { name: 'Claw hammer 16oz', quantity: 1, unit_price: 85, discount_pct: 0, line_total: 85 },
+      { name: 'Wood screws (box)', quantity: 3, unit_price: 14.17, discount_pct: 0, line_total: 42.5 },
+    ],
+  };
+}
+
+const previewHtml = computed(() => renderThermalReceipt(currentTemplate.value, sampleTransaction(), settingsStore.values));
+
+function cleanError(err) {
+  return String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
+}
+
+async function loadPrinters() {
+  if (!window.appBridge?.getPrinters) return;
+  loadingPrinters.value = true;
+  try {
+    printers.value = await window.appBridge.getPrinters();
+  } catch {
+    printers.value = [];
+  } finally {
+    loadingPrinters.value = false;
+  }
+}
+
+async function savePrinter(value) {
+  try {
+    await bridge.save({ receiptPrinter: value || '' });
+    $q.notify({ type: 'positive', message: value ? `POS printer set to ${value}` : 'POS printer cleared', timeout: 1500 });
+  } catch (err) {
+    $q.notify({ type: 'negative', message: cleanError(err), timeout: 6000 });
+  }
+}
+
+async function printTest() {
+  printing.value = true;
+  try {
+    await window.appBridge.printReceipt({ html: previewHtml.value });
+    $q.notify({ type: 'positive', message: 'Test receipt sent to the printer' });
+  } catch (err) {
+    $q.notify({ type: 'negative', message: cleanError(err), timeout: 6000 });
+  } finally {
+    printing.value = false;
+  }
+}
+
+onMounted(async () => {
+  if (!bridge) return;
+  try {
+    const cfg = await bridge.getConfig();
+    printer.value = cfg.receiptPrinter || '';
+    isClient.value = cfg.mode === 'client';
+  } catch {
+    // keep defaults
+  }
+  await loadPrinters();
+});
+</script>
+
+<style scoped>
+.receipt-preview {
+  width: 302px; /* 80 mm */
+  max-width: 100%;
+  height: 360px;
+  border: 1px solid var(--border-color, #ccc);
+  border-radius: 6px;
+  background: #fff;
+}
+</style>
diff --git a/src/composables/useThermalReceipt.js b/src/composables/useThermalReceipt.js
index fa0fbcb..bbd6012 100644
--- a/src/composables/useThermalReceipt.js
+++ b/src/composables/useThermalReceipt.js
@@ -1,24 +1,30 @@
 import { useSettingsStore } from 'src/stores/settings'
-import { renderThermalReceipt } from 'src/services/print-templates/thermal'
+import { renderThermalReceipt, THERMAL_TEMPLATES } from 'src/services/print-templates/thermal'
 
 /**
  * Prints a saved transaction (as returned by transactionsStore.fetchOne) on the
- * 80 mm receipt printer chosen in Settings > Network. On a client PC the job is
- * forwarded to the main PC automatically by app:printReceipt.
+ * 80 mm receipt printer chosen in Settings > Receipt (POS) printer. On a client
+ * PC the job is forwarded to the main PC automatically by app:printReceipt.
+ * Without an explicit template it uses the one chosen in Settings.
  */
 export function useThermalReceipt() {
   const settingsStore = useSettingsStore()
 
+  function defaultTemplate() {
+    const key = settingsStore.values.thermal_template
+    return THERMAL_TEMPLATES[key] ? key : 'compact'
+  }
+
   function buildHtml(tx, templateKey) {
-    return renderThermalReceipt(templateKey, tx, settingsStore.values)
+    return renderThermalReceipt(templateKey || defaultTemplate(), tx, settingsStore.values)
   }
 
-  async function printReceipt(tx, templateKey = 'compact') {
+  async function printReceipt(tx, templateKey) {
     if (!window.appBridge?.printReceipt) {
       throw new Error('Receipt printing is only available inside the desktop app.')
     }
     return window.appBridge.printReceipt({ html: buildHtml(tx, templateKey) })
   }
 
-  return { buildHtml, printReceipt }
+  return { buildHtml, printReceipt, defaultTemplate }
 }
diff --git a/src/constants/shortcuts.js b/src/constants/shortcuts.js
index de81ce1..d47719e 100644
--- a/src/constants/shortcuts.js
+++ b/src/constants/shortcuts.js
@@ -22,6 +22,8 @@ export const SHORTCUT_ACTIONS = [
   { id: 'focus_sku', label: 'Focus SKU / Barcode Field', group: 'Cart', default: 'ctrl+4' },
   { id: 'add_customer', label: 'Add New Customer', group: 'Cart', default: 'ctrl+5' },
   { id: 'remove_active_row', label: 'Remove Selected Cart Row', group: 'Cart', default: 'ctrl+6' },
+
+  { id: 'print_receipt', label: 'Print Receipt (POS printer)', group: 'Print', default: 'ctrl+7' },
 ];
 
 /** All valid combos: ctrl/shift + 0-9, e.g. "ctrl+1", "shift+7". Used to populate the picker in Settings. */
diff --git a/src/layouts/MainLayout.vue b/src/layouts/MainLayout.vue
index d6d4291..1de3c4d 100644
--- a/src/layouts/MainLayout.vue
+++ b/src/layouts/MainLayout.vue
@@ -141,6 +141,7 @@
         </q-card-section>
         <q-card-actions align="right">
           <q-btn flat no-caps label="Print Document" :disable="!lastSavedTransaction" @click="printLastSaved" />
+          <q-btn flat no-caps icon="receipt_long" label="Print Receipt" :disable="!lastSavedTransaction" @click="printReceiptShortcut" />
           <q-btn flat no-caps label="Save as PDF" :disable="!lastSavedTransaction" @click="exportLastSavedPdf" />
           <q-btn color="primary" no-caps label="Close" @click="showPostSaveDialog = false" />
         </q-card-actions>
@@ -186,6 +187,7 @@ import { useSettingsStore } from 'src/stores/settings';
 import { useDesktopStore } from 'src/stores/desktop';
 import { useCurrency } from 'src/composables/useCurrency';
 import { usePrintDocument } from 'src/composables/usePrintDocument';
+import { useThermalReceipt } from 'src/composables/useThermalReceipt';
 import { emitUiEvent } from 'src/composables/useUiEvents';
 import TemplateSwitcher from 'src/components/print-templates/TemplateSwitcher.vue';
 import TransactionList from 'src/components/transactions/TransactionList.vue';
@@ -198,6 +200,7 @@ const settingsStore = useSettingsStore();
 const desktopStore = useDesktopStore();
 const { format } = useCurrency();
 const { print, exportPdf } = usePrintDocument();
+const { printReceipt } = useThermalReceipt();
 const syncing = ref(false);
 
 const workspaceRef = ref(null);
@@ -378,6 +381,23 @@ async function printLastSaved() {
   }
 }
 
+// Prints the POS receipt (template chosen in Settings) for the document being
+// edited, or else for the last document saved in this session.
+async function printReceiptShortcut() {
+  try {
+    const draftId = transactionsStore.draft.id;
+    const tx = draftId ? await transactionsStore.fetchOne(draftId) : lastSavedTransaction.value;
+    if (!tx) {
+      $q.notify({ type: 'warning', message: 'Save the document first (for example as an invoice), then print the receipt.' });
+      return;
+    }
+    await printReceipt(tx);
+    $q.notify({ type: 'positive', message: `Receipt for ${tx.number} sent to the POS printer`, timeout: 1500 });
+  } catch (err) {
+    $q.notify({ type: 'negative', message: err.message || 'Could not print receipt' });
+  }
+}
+
 async function exportLastSavedPdf() {
   if (!lastSavedTransaction.value) return;
   try {
@@ -449,6 +469,9 @@ function handleShortcut(actionId) {
     case 'remove_active_row':
       emitUiEvent('remove-active-row');
       break;
+    case 'print_receipt':
+      printReceiptShortcut();
+      break;
     default:
       break;
   }
diff --git a/src/pages/SettingsPage.vue b/src/pages/SettingsPage.vue
index d50bee3..63aee1f 100644
--- a/src/pages/SettingsPage.vue
+++ b/src/pages/SettingsPage.vue
@@ -274,6 +274,11 @@
       </q-card-section>
     </q-card>
 
+    <ReceiptPrinterCard
+      v-model:template="form.thermal_template"
+      v-model:shortcut="form.shortcutsByAction.print_receipt"
+    />
+
     <q-btn color="primary" label="Save Settings" :loading="saving" @click="save" />
 
     <NetworkSettingsCard />
@@ -289,6 +294,7 @@ import { apiClient } from 'src/services/api-client';
 import { clearSession, connectionState, setConnectionSettings } from 'src/services/connection';
 import TemplateSwitcher from 'src/components/print-templates/TemplateSwitcher.vue';
 import NetworkSettingsCard from 'src/components/NetworkSettingsCard.vue';
+import ReceiptPrinterCard from 'src/components/ReceiptPrinterCard.vue';
 import {
   SHORTCUT_ACTIONS, AVAILABLE_COMBOS, formatCombo, defaultShortcutMap, withDefaults, toActionComboMap,
 } from 'src/constants/shortcuts';
@@ -406,6 +412,7 @@ const form = reactive({
   print_color_intensity: 100,
   default_printer: '',
   silent_printing: false,
+  thermal_template: 'compact',
   theme_mode: 'system',
   data_mode: 'local',
   api_url: '',
@@ -532,6 +539,7 @@ async function save() {
       print_color_intensity: String(form.print_color_intensity),
       items_per_page: String(form.items_per_page),
       default_printer: form.default_printer || '',
+      thermal_template: form.thermal_template === 'detailed' ? 'detailed' : 'compact',
       silent_printing: String(!!form.silent_printing),
       show_signature_block: String(!!form.show_signature_block),
       keyboard_shortcuts: JSON.stringify(comboToAction),
@@ -579,6 +587,7 @@ onMounted(async () => {
   form.print_color_intensity = Number(settingsStore.values.print_color_intensity || 100);
   form.items_per_page = Number(settingsStore.values.items_per_page || 18);
   form.silent_printing = String(settingsStore.values.silent_printing || 'false') === 'true';
+  form.thermal_template = settingsStore.values.thermal_template === 'detailed' ? 'detailed' : 'compact';
   form.show_signature_block = String(settingsStore.values.show_signature_block || 'false') === 'true';
   form.data_mode = connectionState.mode;
   form.api_url = connectionState.apiUrl;
diff --git a/src/stores/settings.js b/src/stores/settings.js
index 40c4969..c29a9bd 100644
--- a/src/stores/settings.js
+++ b/src/stores/settings.js
@@ -14,6 +14,7 @@ const DEFAULT_SETTINGS = {
   company_stamp: '',
   currency_symbol: 'M',
   print_template: 'classic',
+  thermal_template: 'compact',
   quote_prefix: 'QUO-',
   invoice_prefix: 'INV-',
   purchase_order_prefix: 'PO-',
