import { defineStore } from 'pinia';
import { Dark } from 'quasar';
import SettingsRepository from 'src/services/repositories/SettingsRepository';

const DEFAULT_SETTINGS = {
  company_name: 'My Company',
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
  footer_note: 'Thank you for your business!',
  payment_details: '',
  mobile_money_details: '',
  default_tax_rate: '0',
  print_font_size: '12',
  print_font_weight: '400',
  default_printer: '',
  silent_printing: 'false',
  theme_mode: 'system',
  keyboard_shortcuts: '{}',
};

function resolveThemeMode(mode) {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function syncBranding(values) {
  const companyName = String(values?.company_name || DEFAULT_SETTINGS.company_name).trim() || DEFAULT_SETTINGS.company_name;

  if (typeof document !== 'undefined') {
    document.title = companyName;
  }

  if (typeof window !== 'undefined' && window.appBridge?.updateBranding) {
    window.appBridge.updateBranding({ companyName }).catch(() => {
      // Best effort only: renderer branding still updates even if IPC fails.
    });
  }
}

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    values: { ...DEFAULT_SETTINGS },
    loaded: false,
  }),

  actions: {
    applyTheme(mode = this.values.theme_mode) {
      Dark.set(resolveThemeMode(mode));
    },

    async fetchAll() {
      const saved = await SettingsRepository.all();
      this.values = { ...DEFAULT_SETTINGS, ...saved };
      this.applyTheme();
      syncBranding(this.values);
      this.loaded = true;
    },

    async update(values) {
      this.values = await SettingsRepository.update(values);
      this.values = { ...DEFAULT_SETTINGS, ...this.values };
      this.applyTheme();
      syncBranding(this.values);

      if (values.keyboard_shortcuts !== undefined && window.appBridge?.updateShortcuts) {
        try {
          const map = JSON.parse(this.values.keyboard_shortcuts || '{}');
          await window.appBridge.updateShortcuts(map);
        } catch {
          // Malformed JSON shouldn't block the rest of settings from saving.
        }
      }

      return this.values;
    },
  },
});
