<template>
  <q-page class="q-pa-md">
    <div class="text-h5 q-mb-md">Settings</div>

    <q-card flat bordered class="q-mb-md">
      <q-card-section class="text-subtitle1">Company Logo</q-card-section>
      <q-card-section class="row items-center q-col-gutter-md">
        <div class="col-auto">
          <div class="logo-preview" v-if="form.company_logo">
            <img :src="form.company_logo" alt="Logo preview" />
          </div>
          <div class="logo-preview logo-preview-empty" v-else>No logo</div>
        </div>
        <div class="col">
          <q-file v-model="logoFile" label="Upload logo" filled accept=".jpg,.jpeg,.png,.svg,.webp"
            max-file-size="1048576" @update:model-value="onLogoSelected" @rejected="onLogoRejected">
            <template #prepend><q-icon name="image" /></template>
          </q-file>
          <div class="text-caption text-grey q-mt-xs">PNG, JPG, SVG, or WebP — max 1MB. Shown on every printed quotation
            and
            invoice.</div>
          <q-btn v-if="form.company_logo" flat dense color="negative" label="Remove logo" class="q-mt-xs"
            @click="removeLogo" />
        </div>
      </q-card-section>
    </q-card>

    <q-card flat bordered class="q-mb-md">
      <q-card-section class="text-subtitle1">Company Stamp</q-card-section>
      <q-card-section class="row items-center q-col-gutter-md">
        <div class="col-auto">
          <div class="logo-preview" v-if="form.company_stamp">
            <img :src="form.company_stamp" alt="Stamp preview" />
          </div>
          <div class="logo-preview logo-preview-empty" v-else>No stamp</div>
        </div>
        <div class="col">
          <q-file v-model="stampFile" label="Upload stamp" filled accept=".jpg,.jpeg,.png,.webp" max-file-size="2097152"
            @update:model-value="onStampSelected" @rejected="onStampRejected">
            <template #prepend><q-icon name="approval" /></template>
          </q-file>
          <div class="text-caption text-grey q-mt-xs">PNG, JPG, or WebP - max 2MB. Used on printed business letters.
          </div>
          <q-btn v-if="form.company_stamp" flat dense color="negative" label="Remove stamp" class="q-mt-xs"
            @click="removeStamp" />
        </div>
      </q-card-section>
    </q-card>

    <q-card flat bordered class="q-mb-md">
      <q-card-section class="text-subtitle1">Company Information</q-card-section>
      <q-card-section class="q-gutter-sm">
        <q-input v-model="form.company_name" label="Company Name" filled />
        <q-input v-model="form.company_address" label="Address" filled type="textarea" autogrow />
        <div class="row q-col-gutter-sm">
          <div class="col-6"><q-input v-model="form.company_phone" label="Phone" filled /></div>
          <div class="col-6"><q-input v-model="form.company_email" label="Email" filled /></div>
        </div>
        <q-input v-model="form.company_website" label="Website" filled />
        <q-input v-model="form.company_vat" label="VAT / Tax Number" filled />
        <q-input v-model="form.currency_symbol" label="Currency Symbol" filled style="max-width: 160px" />
      </q-card-section>
    </q-card>

    <q-card flat bordered class="q-mb-md">
      <q-card-section class="text-subtitle1">Tax</q-card-section>
      <q-card-section class="q-gutter-sm">
        <div class="text-caption text-grey">
          Product prices are treated as <strong>tax-inclusive</strong> everywhere in the app — what you enter as a
          product's selling price is exactly what the customer pays; tax is calculated out of that price, never added
          on top. This default rate applies to any product that doesn't have its own tax assigned under Products.
        </div>
        <q-input v-model.number="form.default_tax_rate" type="number" label="Default Tax Rate (%)" filled min="0"
          max="100" step="0.5" style="max-width: 220px" />
      </q-card-section>
    </q-card>

    <q-card flat bordered class="q-mb-md">
      <q-card-section class="text-subtitle1">Document Letterhead &amp; Footer</q-card-section>
      <q-card-section class="q-gutter-sm">
        <div class="text-caption text-grey">
          The company info above is shown as a letterhead at the top of every printed quotation and invoice.
          Add payment details (bank account), mobile money details, and a closing note to appear at the bottom, next to
          the
          totals.
        </div>
        <q-input v-model="form.payment_details" label="Bank / Payment Details" filled type="textarea" autogrow
          hint="e.g. Bank: ABC Bank, Acct: 1234567890" />
        <q-input v-model="form.mobile_money_details" label="Mobile Money Details" filled type="textarea" autogrow
          hint="e.g. M-Pesa: 12345, Ecocash: 67890" />
        <q-input v-model="form.footer_note" label="Footer Note" filled hint="e.g. Thank you for your business!" />
      </q-card-section>
    </q-card>

    <q-card flat bordered class="q-mb-md">
      <q-card-section class="text-subtitle1">Default Print Template</q-card-section>
      <q-card-section>
        <TemplateSwitcher v-model="form.print_template" />
        <div class="text-caption text-grey q-mt-sm">
          Applies to new prints and PDF exports. You can still switch templates per-document from the Transactions
          screen.
        </div>
      </q-card-section>
    </q-card>

    <q-card flat bordered class="q-mb-md">
      <q-card-section class="text-subtitle1">Printing</q-card-section>
      <q-card-section class="q-gutter-md">
        <div class="row q-col-gutter-md items-end settings-grid-row">
          <div class="col-12 col-sm-6 col-md-4">
            <q-input v-model.number="form.print_font_size" type="number" filled min="8" max="24" step="0.5"
              label="Print Font Size (px)" hint="Base size used across all print templates" />
          </div>
          <div class="col-12 col-sm-6 col-md-4">
            <q-select v-model="form.print_font_weight" :options="fontWeightOptions" emit-value map-options filled
              label="Print Font Weight" hint="Default body text weight for all templates" />
          </div>
          <div class="col-12 col-md-4">
            <q-btn flat no-caps icon="refresh" label="Refresh Printers" :loading="loadingPrinters"
              class="settings-grid-row__btn" @click="loadPrinters" />
          </div>
        </div>

        <div class="row q-col-gutter-md items-end settings-grid-row">
          <div class="col-12">
            <q-select v-model="form.default_printer" :options="printerOptions" emit-value map-options filled clearable
              label="Default Printer" :loading="loadingPrinters" hint="Used when silent printing is enabled" />
          </div>
        </div>

        <q-toggle v-model="form.silent_printing" label="Enable Silent Printing"
          hint="When enabled with a default printer, print jobs go directly to that printer without showing the print dialog." />
      </q-card-section>
    </q-card>

    <q-card flat bordered class="q-mb-md">
      <q-card-section class="text-subtitle1">Appearance</q-card-section>
      <q-card-section>
        <q-option-group v-model="form.theme_mode" type="radio" color="primary" :options="[
          { label: 'System (match Windows theme)', value: 'system' },
          { label: 'Light', value: 'light' },
          { label: 'Dark', value: 'dark' }
        ]" />
      </q-card-section>
    </q-card>

    <q-card flat bordered class="q-mb-md">
      <q-card-section class="text-subtitle1">Data Connection</q-card-section>
      <q-card-section class="q-gutter-md">
        <q-option-group v-model="form.data_mode" type="radio" color="primary" :options="[
          { label: 'Local SQLite (works offline)', value: 'local' },
          { label: 'Hosted API (requires sign-in)', value: 'api' }
        ]" />
        <q-input v-model="form.api_url" label="API URL" filled placeholder="https://example.com" />
        <div v-if="form.data_mode === 'api'" class="row q-col-gutter-sm items-end">
          <div class="col-12 col-sm-5"><q-input v-model="apiEmail" label="Email" filled type="email" /></div>
          <div class="col-12 col-sm-5"><q-input v-model="apiPassword" label="Password" filled type="password" /></div>
          <div class="col-12 col-sm-2"><q-btn color="primary" icon="login" label="Sign in" :loading="authenticating"
              class="full-width" @click="signIn" /></div>
        </div>
        <div class="row items-center q-gutter-sm">
          <q-chip :color="connectionState.authenticated ? 'positive' : 'grey-6'" text-color="white" dense>
            {{ connectionState.authenticated ? 'Signed in' : 'Not signed in' }}
          </q-chip>
          <q-btn v-if="connectionState.authenticated" flat no-caps label="Sign out" icon="logout" @click="signOut" />
        </div>
        <div class="text-caption text-grey">Changing this setting affects this device only. Use Sync in the toolbar to
          upload offline changes.</div>
      </q-card-section>
    </q-card>

    <q-card flat bordered class="q-mb-md">
      <q-card-section class="row items-center">
        <div class="text-subtitle1">Keyboard Shortcuts</div>
        <q-space />
        <q-btn flat dense no-caps icon="restart_alt" label="Reset to Defaults" @click="resetShortcuts" />
      </q-card-section>
      <q-card-section>
        <div class="text-caption text-grey q-mb-sm">
          Fast, mouse-free cart entry. Combos are Ctrl or Shift plus a number key, and work anywhere in the app -
          even while a text field is focused. Assign the same combo to two actions and the newest one wins, so keep
          each combo unique.
        </div>
        <div v-for="group in shortcutGroups" :key="group.name" class="shortcut-group">
          <div class="shortcut-group__title">{{ group.name }}</div>
          <div class="row q-col-gutter-sm">
            <div class="col-12 col-sm-6" v-for="action in group.actions" :key="action.id">
              <q-select v-model="form.shortcutsByAction[action.id]" :options="comboOptions" emit-value map-options
                filled dense :label="action.label" clearable />
            </div>
          </div>
        </div>
      </q-card-section>
    </q-card>

    <q-card flat bordered class="q-mb-md">
      <q-card-section class="text-subtitle1">Document Numbering</q-card-section>
      <q-card-section class="row q-col-gutter-sm">
        <div class="col-4"><q-input v-model="form.quote_prefix" label="Quotation Prefix" filled /></div>
        <div class="col-4"><q-input v-model="form.invoice_prefix" label="Invoice Prefix" filled /></div>
        <div class="col-4"><q-input v-model="form.purchase_order_prefix" label="Purchase Order Prefix" filled /></div>
      </q-card-section>
    </q-card>

    <q-btn color="primary" label="Save Settings" :loading="saving" @click="save" />
  </q-page>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { useQuasar } from 'quasar';
import { useSettingsStore } from 'src/stores/settings';
import { apiClient } from 'src/services/api-client';
import { clearSession, connectionState, setConnectionSettings } from 'src/services/connection';
import TemplateSwitcher from 'src/components/print-templates/TemplateSwitcher.vue';
import {
  SHORTCUT_ACTIONS, AVAILABLE_COMBOS, formatCombo, defaultShortcutMap, withDefaults, toActionComboMap,
} from 'src/constants/shortcuts';

const $q = useQuasar();
const settingsStore = useSettingsStore();
const saving = ref(false);
const logoFile = ref(null);
const stampFile = ref(null);
const loadingPrinters = ref(false);
const authenticating = ref(false);
const apiEmail = ref('');
const apiPassword = ref('');
const printerOptions = ref([]);
const fontWeightOptions = [
  { label: 'Light (300)', value: 300 },
  { label: 'Normal (400)', value: 400 },
  { label: 'Medium (500)', value: 500 },
  { label: 'Semi-bold (600)', value: 600 },
  { label: 'Bold (700)', value: 700 },
  { label: 'Extra-bold (800)', value: 800 },
];

const form = reactive({
  company_name: '',
  company_address: '',
  company_phone: '',
  company_email: '',
  company_website: '',
  company_vat: '',
  company_logo: '',
  company_stamp: '',
  currency_symbol: 'M',
  print_template: 'classic',
  quote_prefix: 'QUO-',
  invoice_prefix: 'INV-',
  purchase_order_prefix: 'PO-',
  footer_note: '',
  payment_details: '',
  mobile_money_details: '',
  default_tax_rate: 0,
  print_font_size: 12,
  print_font_weight: 400,
  default_printer: '',
  silent_printing: false,
  theme_mode: 'system',
  data_mode: 'local',
  api_url: '',
  shortcutsByAction: {}, // { [actionId]: combo } - UI-friendly shape; converted to combo->action JSON on save
});

const comboOptions = computed(() => AVAILABLE_COMBOS.map((combo) => ({ label: formatCombo(combo), value: combo })));
const shortcutGroups = computed(() => {
  const groups = [];
  for (const action of SHORTCUT_ACTIONS) {
    let group = groups.find((g) => g.name === action.group);
    if (!group) {
      group = { name: action.group, actions: [] };
      groups.push(group);
    }
    group.actions.push(action);
  }
  return groups;
});

function resetShortcuts() {
  form.shortcutsByAction = { ...toActionComboMap(defaultShortcutMap()) };
  $q.notify({ type: 'info', message: 'Shortcuts reset - click Save Settings to apply', timeout: 2500 });
}

async function loadPrinters() {
  if (!window.appBridge?.getPrinters) {
    printerOptions.value = [];
    return;
  }

  loadingPrinters.value = true;
  try {
    const printers = await window.appBridge.getPrinters();
    printerOptions.value = printers.map((p) => ({
      label: p.isDefault ? `${p.displayName} (System default)` : p.displayName,
      value: p.name,
    }));
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message || 'Could not load printers' });
  } finally {
    loadingPrinters.value = false;
  }
}

/** Reads the chosen file as a base64 data URL - stored directly in SQLite (settings.company_logo). */
function onLogoSelected(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    form.company_logo = reader.result;
  };
  reader.onerror = () => {
    $q.notify({ type: 'negative', message: 'Could not read that image file' });
  };
  reader.readAsDataURL(file);
}

function onLogoRejected() {
  $q.notify({ type: 'warning', message: 'Logo must be an image under 1MB' });
}

function removeLogo() {
  form.company_logo = '';
  logoFile.value = null;
}

function onStampSelected(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    form.company_stamp = reader.result;
  };
  reader.onerror = () => {
    $q.notify({ type: 'negative', message: 'Could not read that stamp file' });
  };
  reader.readAsDataURL(file);
}

function onStampRejected() {
  $q.notify({ type: 'warning', message: 'Stamp must be an image under 2MB' });
}

function removeStamp() {
  form.company_stamp = '';
  stampFile.value = null;
}

async function save() {
  if (form.data_mode === 'api' && !connectionState.authenticated) {
    $q.notify({ type: 'warning', message: 'Sign in before selecting API mode' });
    return;
  }

  const comboToAction = {};
  const seenCombos = new Map();
  for (const action of SHORTCUT_ACTIONS) {
    const combo = form.shortcutsByAction[action.id];
    if (!combo) continue;
    if (seenCombos.has(combo)) {
      $q.notify({
        type: 'negative',
        message: `"${formatCombo(combo)}" is assigned to both "${seenCombos.get(combo)}" and "${action.label}" - each combo must be unique.`,
        timeout: 6000,
      });
      return;
    }
    seenCombos.set(combo, action.label);
    comboToAction[combo] = action.id;
  }

  saving.value = true;
  try {
    const settingsValues = { ...form };
    delete settingsValues.data_mode;
    delete settingsValues.api_url;
    delete settingsValues.shortcutsByAction;
    await settingsStore.update({
      ...settingsValues,
      default_tax_rate: String(form.default_tax_rate),
      print_font_size: String(form.print_font_size),
      print_font_weight: String(form.print_font_weight),
      default_printer: form.default_printer || '',
      silent_printing: String(!!form.silent_printing),
      keyboard_shortcuts: JSON.stringify(comboToAction),
    });
    setConnectionSettings({ mode: form.data_mode, apiUrl: form.api_url });
    $q.notify({ type: 'positive', message: 'Settings saved' });
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message });
  } finally {
    saving.value = false;
  }
}

async function signIn() {
  authenticating.value = true;
  try {
    setConnectionSettings({ mode: 'api', apiUrl: form.api_url });
    await apiClient.login(apiEmail.value, apiPassword.value);
    form.data_mode = 'api';
    setConnectionSettings({ mode: 'api', apiUrl: form.api_url });
    $q.notify({ type: 'positive', message: 'Signed in to the hosted API' });
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message || 'Sign-in failed' });
  } finally {
    authenticating.value = false;
    apiPassword.value = '';
  }
}

function signOut() {
  clearSession();
  form.data_mode = 'local';
  setConnectionSettings({ mode: 'local', apiUrl: form.api_url });
  $q.notify({ type: 'info', message: 'Signed out of the hosted API' });
}

onMounted(async () => {
  await settingsStore.fetchAll();
  Object.assign(form, settingsStore.values);
  form.default_tax_rate = Number(settingsStore.values.default_tax_rate || 0);
  form.print_font_size = Number(settingsStore.values.print_font_size || 12);
  form.print_font_weight = Number(settingsStore.values.print_font_weight || 400);
  form.silent_printing = String(settingsStore.values.silent_printing || 'false') === 'true';
  form.data_mode = connectionState.mode;
  form.api_url = connectionState.apiUrl;

  let savedMap = {};
  try {
    savedMap = JSON.parse(settingsStore.values.keyboard_shortcuts || '{}');
  } catch {
    savedMap = {};
  }
  form.shortcutsByAction = toActionComboMap(withDefaults(savedMap));

  await loadPrinters();
});
</script>

<style scoped>
.logo-preview {
  width: 96px;
  height: 96px;
  border-radius: 8px;
  border: 1px dashed var(--border-color);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: var(--surface-2);
}

.logo-preview img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.logo-preview-empty {
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
}

.shortcut-group {
  margin-bottom: 14px;
}

.shortcut-group:last-child {
  margin-bottom: 0;
}

.shortcut-group__title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  margin-bottom: 6px;
  font-weight: 600;
}

.settings-grid-row {
  margin-bottom: 2px;
}

.settings-grid-row__btn {
  width: 100%;
  min-height: 56px;
}

@media (max-width: 599px) {
  .settings-grid-row__btn {
    min-height: 44px;
  }
}
</style>
