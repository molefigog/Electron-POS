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

  async function emailPdf(tx) {
    if (!window.appBridge?.emailPdf) {
      throw new Error('Email PDF is only available inside the desktop app.');
    }
    const customerName = tx.customer_name || 'Customer';
    const total = tx.grand_total === null || tx.grand_total === undefined
      ? '-'
      : `${settingsStore.values.currency_symbol || 'M'}${Number(tx.grand_total).toFixed(2)}`;
    const escape = (value) => String(value ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const rows = (tx.items || []).map((item) => `
      <tr>
        <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;">${escape(item.name)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">${escape(item.quantity)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">${escape(item.unit_price == null ? '-' : `${settingsStore.values.currency_symbol || 'M'}${Number(item.unit_price).toFixed(2)}`)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">${escape(item.line_total == null ? '-' : `${settingsStore.values.currency_symbol || 'M'}${Number(item.line_total).toFixed(2)}`)}</td>
      </tr>`).join('');
    const htmlBody = `
      <div style="font-family:Segoe UI,Arial,sans-serif;color:#1f2937;max-width:720px;line-height:1.5;">
        <p>Greeting ${escape(customerName)},</p>
        <p>Please find the document details below for your review.</p>
        <table style="border-collapse:collapse;width:100%;margin:20px 0;font-size:14px;">
          <tr><td style="padding:6px 0;font-weight:600;">Customer name</td><td style="padding:6px 0;">${escape(customerName)}</td></tr>
          <tr><td style="padding:6px 0;font-weight:600;">Quotation number</td><td style="padding:6px 0;">${escape(tx.number)}</td></tr>
          <tr><td style="padding:6px 0;font-weight:600;">Grand Total</td><td style="padding:6px 0;">${escape(total)}</td></tr>
        </table>
        <table style="border-collapse:collapse;width:100%;border:1px solid #d1d5db;font-size:14px;">
          <thead><tr style="background:#0f766e;color:#ffffff;">
            <th style="padding:10px 8px;text-align:left;">Item</th>
            <th style="padding:10px 8px;text-align:right;">Qty</th>
            <th style="padding:10px 8px;text-align:right;">Price</th>
            <th style="padding:10px 8px;text-align:right;">Total</th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="4" style="padding:12px;text-align:center;">No items</td></tr>'}</tbody>
        </table>
        <p style="margin-top:24px;">Kind Regards<br>${escape(settingsStore.values.company_name || 'Your Company')}</p>
      </div>`;
    const plainBody = `Greeting ${customerName},\n\nPlease find the document details below for your review.\n\nCustomer name: ${customerName}\nQuotation number: ${tx.number}\nGrand Total: ${total}\n\nItems:\n${(tx.items || []).map((item) => `- ${item.name}: ${item.quantity} x ${item.unit_price == null ? '-' : item.unit_price} = ${item.line_total == null ? '-' : item.line_total}`).join('\n')}\n\nKind Regards\n${settingsStore.values.company_name || 'Your Company'}`;
    return window.appBridge.emailPdf({
      to: tx.customer_email || '',
      subject: tx.number,
      body: plainBody,
      htmlBody,
    });
  }

  return { buildHtml, print, printHtml, exportPdf, emailPdf };
}
