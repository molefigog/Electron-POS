import { useSettingsStore } from 'src/stores/settings'
import { renderThermalReceipt, THERMAL_TEMPLATES } from 'src/services/print-templates/thermal'

/**
 * Prints a saved transaction (as returned by transactionsStore.fetchOne) on the
 * 80 mm receipt printer chosen in Settings > Receipt (POS) printer. On a client
 * PC the job is forwarded to the main PC automatically by app:printReceipt.
 * Without an explicit template it uses the one chosen in Settings.
 */
export function useThermalReceipt() {
  const settingsStore = useSettingsStore()

  function defaultTemplate() {
    const key = settingsStore.values.thermal_template
    return THERMAL_TEMPLATES[key] ? key : 'compact'
  }

  function buildHtml(tx, templateKey) {
    return renderThermalReceipt(templateKey || defaultTemplate(), tx, settingsStore.values)
  }

  async function printReceipt(tx, templateKey) {
    if (!window.appBridge?.printReceipt) {
      throw new Error('Receipt printing is only available inside the desktop app.')
    }
    return window.appBridge.printReceipt({ html: buildHtml(tx, templateKey) })
  }

  return { buildHtml, printReceipt, defaultTemplate }
}
