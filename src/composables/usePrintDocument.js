import { useSettingsStore } from 'src/stores/settings';
import { renderTemplate } from 'src/services/print-templates/registry';

/**
 * One composable, used identically for quotes and invoices - the template
 * switcher lives entirely in settings.print_template, so callers never
 * branch on document type or layout.
 */
export function usePrintDocument() {
  const settingsStore = useSettingsStore();

  function buildHtml(tx, templateKey) {
    const key = templateKey || settingsStore.values.print_template || 'classic';
    return renderTemplate(key, tx, settingsStore.values);
  }

  function shouldUseSilentPrinting() {
    const enabled = String(settingsStore.values.silent_printing || 'false') === 'true';
    const printer = settingsStore.values.default_printer;
    return enabled && !!printer;
  }

  async function printHtml(html) {
    if (!window.appBridge?.printHtml) {
      const win = window.open('', '_blank', 'width=900,height=1000');
      win.document.write(html);
      win.document.close();
      win.focus();
      setTimeout(() => win.print(), 250);
      return;
    }

    const silent = shouldUseSilentPrinting();
    await window.appBridge.printHtml({
      html,
      silent,
      deviceName: silent ? settingsStore.values.default_printer : null,
    });
  }

  async function print(tx, templateKey) {
    const html = buildHtml(tx, templateKey);
    await printHtml(html);
  }

  /**
   * Renders the document, saves it silently to ~/Documents/receipts (no save
   * dialog), and opens it with the OS default PDF viewer. Returns { filePath }.
   */
  async function exportPdf(tx, templateKey) {
    const html = buildHtml(tx, templateKey);
    if (!window.appBridge) {
      throw new Error('PDF export is only available inside the desktop app.');
    }
    return window.appBridge.printPdf({
      html,
      defaultFileName: `${tx.number}.pdf`,
    });
  }

  return { buildHtml, print, printHtml, exportPdf };
}
