import {
  money,
  paginateTransactionItems,
  baseShellCss,
  renderLetterhead,
  renderFooter,
  renderPageIndicator,
  LETTERHEAD_FOOTER_CSS,
} from './shared';

/**
 * Minimal layout: monospace, black-and-white ledger feel. Same shared
 * letterhead + footer as every other template - only the middle (billing
 * line + item table) is styled differently.
 */
export function renderMinimal(tx, company) {
  const symbol = company.currency_symbol || 'M';
  const docLabel = tx.type === 'quote' ? 'QUOTATION' : tx.type === 'purchase_order' ? 'PURCHASE ORDER' : 'INVOICE';
  const partyLabel = tx.type === 'purchase_order' ? 'Supplier' : 'To';
  const pages = paginateTransactionItems(tx);
  const totalPages = pages.length;

  const contentStyles = `
    body { font-family: "Courier New", monospace; }
    .doc-line { display: flex; justify-content: space-between; margin-bottom: 14px; font-size: calc(11px * var(--print-font-scale)); }
    .doc-line .title { font-size: calc(14px * var(--print-font-scale)); letter-spacing: .15em; }
    .divider { border-top: 1px dashed var(--ink); margin: 10px 0; }
    .bill-to { font-size: calc(11px * var(--print-font-scale)); margin-bottom: 6px; }
    .meta-extra { font-size: calc(10.5px * var(--print-font-scale)); color: var(--ink-soft); margin-bottom: 6px; }

    table.main-table { width: 100%; border-collapse: collapse; font-size: calc(11px * var(--print-font-scale)); }
    .main-table th { text-align: left; padding: 5px 4px; font-weight: var(--print-font-weight); border-bottom: 1px solid var(--ink); text-transform: uppercase; font-size: calc(9.5px * var(--print-font-scale)); }
    .main-table td { padding: 5px 4px; }
  `;

  const sheets = pages
    .map((pageTx, pageIndex) => `
    <div class="sheet">
      <div class="page-header">
        ${renderLetterhead(company)}

        <div class="doc-line">
          <span class="title">${docLabel} #${tx.number}</span>
          <span>${new Date(tx.issued_at || tx.created_at).toLocaleDateString()}</span>
        </div>
        <div class="bill-to">
          ${partyLabel}: ${tx.customer_name || 'Walk-in Customer'}${tx.manual_reference ? `  |  Ref: ${tx.manual_reference}` : ''}${tx.reference_quotation_number ? `  |  Quote: ${tx.reference_quotation_number}` : ''}
        </div>
        <div class="meta-extra">${renderPageIndicator(pageIndex + 1, totalPages)}</div>
        <div class="divider"></div>
      </div>

      <div class="content page-content">

        <table class="main-table">
          <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Total</th></tr></thead>
          <tbody>
            ${pageTx.items.map((i) => `<tr><td>${i.name}</td><td class="num">${i.quantity}</td><td class="num">${money(i.unit_price, symbol)}</td><td class="num">${money(i.line_total, symbol)}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div class="page-footer">
        ${renderFooter(company, tx, symbol)}
      </div>
    </div>
  `)
    .join('');

  return `
  <html><head><meta charset="utf-8"><style>
    ${baseShellCss('minimal', company)}
    ${LETTERHEAD_FOOTER_CSS}
    ${contentStyles}
  </style></head><body>
    ${sheets}
  </body></html>`;
}
