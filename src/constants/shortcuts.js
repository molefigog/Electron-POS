/**
 * The full catalog of remappable keyboard shortcuts. Each action has a
 * stable `id` (never rename these - they're what's stored in the DB and
 * matched in MainLayout.vue's dispatcher), a human label for the Settings
 * UI, and a `default` combo.
 *
 * Combo format: "<modifier>+<digit>", modifier is exactly one of
 * ctrl/shift, digit is 0-9. Kept intentionally narrow (see
 * src-electron/shortcuts.js's comboFromInput) so this never collides with
 * normal typing, text editing shortcuts, or Quasar's own component
 * keybindings.
 */
export const SHORTCUT_ACTIONS = [
  { id: 'save_quote', label: 'Save as Quotation', group: 'Save', default: 'shift+1' },
  { id: 'save_invoice', label: 'Save as Invoice', group: 'Save', default: 'shift+2' },
  { id: 'save_purchase_order', label: 'Save as Purchase Order', group: 'Save', default: 'shift+3' },
  { id: 'save_draft', label: 'Save as Draft', group: 'Save', default: 'shift+4' },

  { id: 'new_transaction', label: 'New Transaction', group: 'Cart', default: 'ctrl+1' },
  { id: 'open_recent', label: 'Open Recent Transactions', group: 'Cart', default: 'ctrl+2' },
  { id: 'focus_product_search', label: 'Focus Product Search', group: 'Cart', default: 'ctrl+3' },
  { id: 'focus_sku', label: 'Focus SKU / Barcode Field', group: 'Cart', default: 'ctrl+4' },
  { id: 'add_customer', label: 'Add New Customer', group: 'Cart', default: 'ctrl+5' },
  { id: 'remove_active_row', label: 'Remove Selected Cart Row', group: 'Cart', default: 'ctrl+6' },
];

/** All valid combos: ctrl/shift + 0-9, e.g. "ctrl+1", "shift+7". Used to populate the picker in Settings. */
export const AVAILABLE_COMBOS = (() => {
  const combos = [];
  for (const mod of ['ctrl', 'shift']) {
    for (let d = 0; d <= 9; d += 1) combos.push(`${mod}+${d}`);
  }
  return combos;
})();

export function formatCombo(combo) {
  if (!combo) return '';
  const [mod, digit] = combo.split('+');
  return `${mod === 'ctrl' ? 'Ctrl' : 'Shift'} + ${digit}`;
}

/** { "shift+1": "save_quote", ... } - the shape stored in settings.keyboard_shortcuts and read by the Electron main process. */
export function defaultShortcutMap() {
  const map = {};
  for (const action of SHORTCUT_ACTIONS) map[action.default] = action.id;
  return map;
}

/** Merge a possibly-partial saved map with defaults for any action that isn't explicitly mapped (or was mapped to ""). */
export function withDefaults(savedMap) {
  const merged = { ...defaultShortcutMap() };
  if (savedMap && typeof savedMap === 'object') {
    // Saved map wins for any combo explicitly set - but first strip out any
    // combo the saved map re-points to a *different* action than default,
    // so re-assigning a combo in Settings correctly "steals" it.
    for (const [combo, actionId] of Object.entries(savedMap)) {
      if (SHORTCUT_ACTIONS.some((a) => a.id === actionId)) merged[combo] = actionId;
    }
  }
  return merged;
}

/** Converts a combo->action map into action->combo, for populating the Settings form. */
export function toActionComboMap(comboActionMap) {
  const out = {};
  for (const [combo, actionId] of Object.entries(comboActionMap || {})) out[actionId] = combo;
  return out;
}
