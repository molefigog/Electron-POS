import {
  itemsRows,
  paginateTransactionItems,
  baseShellCss,
  renderLetterhead,
  renderFooter,
  renderPageIndicator,
  LETTERHEAD_FOOTER_CSS,
} from './shared';

/**
 * Modern layout: same shared letterhead + footer as every other template,
 * distinguished by a rounded accent "doc banner" and a cleaner borderless
 * table. Totals live only in the shared footer (renderFooter) - never
 * duplicated in the body.
 */
export function renderModern(tx, company) {
  const symbol = company.currency_symbol || 'M';
  const docLabel = tx.type === 'quote' ? 'Quotation' : tx.type === 'purchase_order' ? 'Purchase Order' : 'Invoice';
  const partyLabel = tx.type === 'purchase_order' ? 'Supplier' : 'Bill To';
  const partyName = tx.type === 'purchase_order' ? tx.supplier_name : tx.customer_name;
  const partyPhone = tx.type === 'purchase_order' ? tx.supplier_phone : tx.customer_phone;
  const pages = paginateTransactionItems(tx);
  const totalPages = pages.length;

  const contentStyles = `
    .doc-banner { display: flex; justify-content: space-between; align-items: center; background: var(--wash); border-radius: 10px; padding: 14px 18px; margin-bottom: 18px; }
    .doc-banner .doc-title { font-family: "Courier New", monospace; font-size: calc(15px * var(--print-font-scale)); font-weight: var(--print-font-weight-bold); letter-spacing: .08em; text-transform: uppercase; color: var(--accent); }
    .doc-banner .doc-meta { text-align: right; font-size: calc(10.5px * var(--print-font-scale)); color: var(--ink-soft); line-height: 1.6; }
    .doc-banner .doc-meta strong { color: var(--ink); }
    .doc-banner .ref { display: block; margin-top: 2px; }

    .bill-to { margin-bottom: 16px; font-size: calc(11.5px * var(--print-font-scale)); color: var(--ink-soft); }
    .bill-to strong { color: var(--ink); }

    table.main-table { width: 100%; border-collapse: collapse; font-size: calc(11px * var(--print-font-scale)); }
    .main-table th { text-align: left; padding: 8px; font-size: calc(9px * var(--print-font-scale)); text-transform: uppercase; letter-spacing: .05em; color: var(--ink-soft); border-bottom: 2px solid var(--accent); }
    .main-table td { padding: 8px; border-bottom: 1px solid var(--line); }
    .main-table tbody tr:nth-child(even) { background: var(--wash); }
    .notes { margin-top: 16px; font-size: calc(11px * var(--print-font-scale)); color: var(--ink-soft); }
  `;

  const sheets = pages
    .map((pageTx, pageIndex) => `
    <div class="sheet">
      <div class="page-header">
        ${renderLetterhead(company)}

        <div class="doc-banner">
          <span class="doc-title">${docLabel}</span>
          <div class="doc-meta">
            No. <strong>${tx.number}</strong><br>
            ${new Date(tx.issued_at || tx.created_at).toLocaleDateString()}
            ${tx.manual_reference ? `<span class="ref">Ref: ${tx.manual_reference}</span>` : ''}
            ${tx.reference_quotation_number ? `<span class="ref">from ${tx.reference_quotation_number}</span>` : ''}
            <span class="ref">${renderPageIndicator(pageIndex + 1, totalPages)}</span>
          </div>
        </div>
      </div>

      <div class="content page-content">

        <div class="bill-to">
          <strong>${partyLabel}:</strong> ${partyName || (tx.type === 'purchase_order' ? 'Supplier not selected' : 'Walk-in Customer')}
          ${partyPhone ? `<br>${partyPhone}` : ''}
        </div>

        <table class="main-table">
          <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Disc.</th><th class="num">Tax</th><th class="num">Total</th></tr></thead>
          <tbody>${itemsRows(pageTx, symbol)}</tbody>
        </table>

        ${pageIndex === totalPages - 1 && tx.notes ? `<div class="notes"><strong>Notes:</strong> ${tx.notes}</div>` : ''}
      </div>

      <div class="page-footer">
        ${renderFooter(company, tx, symbol)}
      </div>
    </div>
  `)
    .join('');

  return `
  <html><head><meta charset="utf-8"><style>
    ${baseShellCss('modern', company)}
    ${LETTERHEAD_FOOTER_CSS}
    ${contentStyles}
  </style></head><body>
    ${sheets}
  </body></html>`;
}
