<template>
  <q-card v-if="available" flat bordered class="q-mb-md">
    <q-card-section class="text-subtitle1">Network (several PCs, one database)</q-card-section>

    <q-card-section class="q-gutter-y-md">
      <q-option-group v-model="mode" :options="modeOptions" color="primary" :disable="busy" />

      <!-- MAIN PC -->
      <template v-if="mode === 'host'">
        <q-banner v-if="cfg.activeMode !== 'host'" dense rounded class="bg-blue-1 text-blue-10">
          Press Save, then restart the POS to turn this PC into the main PC.
        </q-banner>
        <q-banner v-else-if="cfg.serverRunning" dense rounded class="bg-green-1 text-green-10">
          Main PC is running. Other PCs can connect to it.
        </q-banner>
        <q-banner v-else dense rounded class="bg-red-1 text-red-10">
          The network server is not running. {{ cfg.serverError }}
        </q-banner>

        <q-select
          v-model="receiptPrinter" :options="printerOptions" emit-value map-options clearable dense outlined
          label="Receipt printer (80 mm thermal, connected to this PC)" :loading="loadingPrinters"
        />

        <div v-if="cfg.connectionCodes.length && cfg.activeMode === 'host'" class="q-gutter-y-sm">
          <div class="text-weight-medium">Connection code for the other PCs</div>
          <q-select
            v-if="cfg.connectionCodes.length > 1" v-model="selectedAddress"
            :options="cfg.connectionCodes.map((c) => c.address)" dense outlined label="This PC's network address"
          />
          <q-input :model-value="currentCode" type="textarea" readonly outlined autogrow dense input-class="text-caption" />
          <div class="row q-gutter-sm">
            <q-btn dense no-caps color="primary" icon="content_copy" label="Copy code" @click="copyCode" />
            <q-btn dense no-caps flat color="negative" icon="autorenew" label="Make a new code" @click="confirmRegenerate" />
          </div>
          <div class="text-caption text-grey-8">
            Treat this code like a password. Paste it on each other PC (Settings &rarr; Network &rarr; Connect to the main PC).
            Keep this PC switched on while the others work, and never forward this port on your router.
          </div>
        </div>
      </template>

      <!-- OTHER PC -->
      <template v-if="mode === 'client'">
        <q-banner v-if="cfg.mode === 'client'" dense rounded :class="cfg.clientConnected ? 'bg-green-1 text-green-10' : 'bg-orange-1 text-orange-10'">
          Paired with main PC <b>{{ cfg.hostName || cfg.hostAddress }}</b>
          <span v-if="cfg.activeMode === 'client'"> &middot; {{ cfg.clientConnected ? 'connected' : 'trying to reconnect...' }}</span>
          <span v-else> &middot; restart the POS to start using it</span>
        </q-banner>
        <q-input
          v-model="code" type="textarea" outlined autogrow dense label="Connection code from the main PC"
          placeholder="POS1...." :disable="busy"
        />
        <div class="row q-gutter-sm">
          <q-btn dense no-caps color="primary" icon="link" label="Connect" :loading="busy" :disable="!code.trim()" @click="connect" />
          <q-btn v-if="cfg.mode === 'client'" dense no-caps outline color="primary" icon="wifi_find" label="Test connection" :loading="testing" @click="testConnection" />
        </div>
        <div class="text-caption text-grey-8">
          This PC keeps no database of its own: products, customers and quotations live on the main PC, and receipts print on its printer.
        </div>
      </template>

      <div class="row q-gutter-sm">
        <q-btn
          v-if="mode !== 'client' || cfg.mode === 'client'" dense no-caps color="primary" icon="save" label="Save"
          :loading="busy" :disable="!dirty" @click="save"
        />
        <q-btn v-if="mode === 'host'" dense no-caps outline color="primary" icon="print" label="Print test receipt" :loading="printing" @click="printTest" />
        <q-btn v-if="mode === 'host'" dense no-caps outline color="primary" icon="wifi_tethering" label="Check server" :loading="testing" @click="testConnection" />
      </div>
    </q-card-section>
  </q-card>
</template>

<script setup>
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import { copyToClipboard, useQuasar } from 'quasar';

const $q = useQuasar();
const bridge = window.networkBridge;
const available = Boolean(bridge);

const cfg = ref({ mode: 'single', activeMode: 'single', connectionCodes: [], addresses: [] });
const mode = ref('single');
const receiptPrinter = ref('');
const code = ref('');
const selectedAddress = ref('');
const printers = ref([]);
const loadingPrinters = ref(false);
const busy = ref(false);
const testing = ref(false);
const printing = ref(false);
let offStatus = null;

const modeOptions = [
  { label: 'This PC works on its own', value: 'single' },
  { label: 'Main PC: other PCs connect to this PC (keeps the database, prints receipts)', value: 'host' },
  { label: 'Connect to the main PC', value: 'client' },
];

const printerOptions = computed(() => printers.value.map((p) => ({ label: p.displayName || p.name, value: p.name })));
const currentCode = computed(() => {
  const list = cfg.value.connectionCodes || [];
  return (list.find((c) => c.address === selectedAddress.value) || list[0])?.code || '';
});
const dirty = computed(() => mode.value !== cfg.value.mode || (receiptPrinter.value || '') !== (cfg.value.receiptPrinter || ''));

function cleanError(err) {
  return String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
function fail(err) {
  $q.notify({ type: 'negative', message: cleanError(err), timeout: 6000 });
}
function askRestart(message) {
  $q.dialog({ title: 'Restart required', message, ok: { label: 'Restart now', color: 'primary' }, cancel: { label: 'Later', flat: true } })
    .onOk(() => bridge.restart());
}

async function load() {
  cfg.value = await bridge.getConfig();
  mode.value = cfg.value.mode;
  receiptPrinter.value = cfg.value.receiptPrinter || '';
  selectedAddress.value = cfg.value.connectionCodes?.[0]?.address || '';
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

async function save() {
  busy.value = true;
  try {
    const res = await bridge.save({ mode: mode.value, receiptPrinter: receiptPrinter.value || '' });
    cfg.value = res.config;
    $q.notify({ type: 'positive', message: 'Network settings saved' });
    if (res.restartRequired) askRestart('The POS must restart to apply the new network role.');
  } catch (err) {
    fail(err);
  } finally {
    busy.value = false;
  }
}

async function connect() {
  busy.value = true;
  try {
    const res = await bridge.applyCode(code.value);
    code.value = '';
    await load();
    $q.notify({ type: 'positive', message: `Paired with ${res.hostName || 'the main PC'}` });
    askRestart('This PC is paired. Restart the POS to start using the main PC\'s database.');
  } catch (err) {
    fail(err);
  } finally {
    busy.value = false;
  }
}

async function testConnection() {
  testing.value = true;
  try {
    const res = await bridge.test();
    $q.notify({ type: res.ok ? 'positive' : 'negative', message: res.message, timeout: 5000 });
  } catch (err) {
    fail(err);
  } finally {
    testing.value = false;
  }
}

async function copyCode() {
  try {
    await copyToClipboard(currentCode.value);
    $q.notify({ type: 'positive', message: 'Connection code copied' });
  } catch {
    $q.notify({ type: 'warning', message: 'Could not copy. Select the code and press Ctrl+C.' });
  }
}

function confirmRegenerate() {
  $q.dialog({
    title: 'Make a new connection code?',
    message: 'PCs that are already paired will stop working until you paste the new code on them.',
    ok: { label: 'Make new code', color: 'negative' },
    cancel: { label: 'Cancel', flat: true },
  }).onOk(async () => {
    try {
      cfg.value = await bridge.regenerateKey();
      selectedAddress.value = cfg.value.connectionCodes?.[0]?.address || '';
    } catch (err) {
      fail(err);
    }
  });
}

function receiptTestHtml() {
  const when = new Date().toLocaleString();
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box} body{margin:0;width:80mm;padding:4mm;font:12px/1.4 monospace;color:#000}
    h1{font-size:15px;text-align:center;margin:0 0 6px} hr{border:0;border-top:1px dashed #000;margin:6px 0}
    .c{text-align:center}</style></head><body>
    <h1>TEST RECEIPT</h1><hr>
    <div>Receipt printer is working.</div><div>${when}</div><hr>
    <div class="c">0123456789 ABCDEFGHIJ</div><div class="c">Thank you</div></body></html>`;
}

async function printTest() {
  printing.value = true;
  try {
    if (dirty.value) await bridge.save({ receiptPrinter: receiptPrinter.value || '' });
    await window.appBridge.printReceipt({ html: receiptTestHtml() });
    $q.notify({ type: 'positive', message: 'Test receipt sent to the printer' });
  } catch (err) {
    fail(err);
  } finally {
    printing.value = false;
  }
}

onMounted(async () => {
  if (!available) return;
  await Promise.all([load(), loadPrinters()]);
  offStatus = bridge.onStatus?.((connected) => { cfg.value = { ...cfg.value, clientConnected: connected }; });
});
onBeforeUnmount(() => offStatus?.());
</script>
