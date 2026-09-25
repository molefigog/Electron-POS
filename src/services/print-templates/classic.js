import {
  itemsRows,
  paginateTransactionItems,
  ITEMS_PER_PAGE,
  baseShellCss,
  renderLetterhead,
  renderFooter,
  renderPageIndicator,
  LETTERHEAD_FOOTER_CSS,
} from './shared'

/**
 * Every template exports the same signature: (tx, company) => htmlString.
 * This is what makes the switcher "reusable across quotations and invoices
 * without changing business logic" - the caller never knows or cares which
 * template rendered the document.
 */
export function renderClassic(tx, company) {
  const symbol = company.currency_symbol || 'M'
  const docLabel =
    tx.type === 'quote' ? 'QUOTATION' : tx.type === 'purchase_order' ? 'PURCHASE ORDER' : 'INVOICE'
  const partyLabel = tx.type === 'purchase_order' ? 'Supplier' : 'Bill To'
  const partyName = tx.type === 'purchase_order' ? tx.supplier_name : tx.customer_name
  const partyAddress = tx.type === 'purchase_order' ? tx.supplier_address : tx.customer_address
  const partyPhone = tx.type === 'purchase_order' ? tx.supplier_phone : tx.customer_phone
  // const pages = paginateTransactionItems(tx);
  const pages = paginateTransactionItems(tx, Number(company.items_per_page) || ITEMS_PER_PAGE)
  const totalPages = pages.length

  const contentStyles = `
    .meta-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; }
    .meta-left { font-size: calc(12px * var(--print-font-scale)); line-height: 1.8; }
    .meta-right { text-align: right; }
    .doc-title { font-family: "Courier New", monospace; font-size: calc(20px * var(--print-font-scale)); font-weight: var(--print-font-weight-bold); letter-spacing: .06em; color: var(--accent); display: block; }
    .doc-number { font-family: "Courier New", monospace; font-size: calc(12px * var(--print-font-scale)); color: var(--ink-soft); margin-top: 4px; }
    .doc-date { font-size: calc(11px * var(--print-font-scale)); color: var(--ink-soft); margin-top: 4px; }
    .ref { display: block; font-size: calc(10.5px * var(--print-font-scale)); color: var(--ink-soft); margin-top: 4px; }

    table.main-table { width: 100%; border-collapse: collapse; font-size: calc(11px * var(--print-font-scale)); margin-top: 8px; }
    .main-table th { background: var(--accent); color: #fff; font-family: "Courier New", monospace; font-size: calc(9px * var(--print-font-scale)); letter-spacing: .06em; text-transform: uppercase; text-align: left; padding: 7px 8px; font-weight: var(--print-font-weight-semibold); border: none; }
    .main-table td { padding: 6px 8px; border-bottom: 1px solid var(--line); }
    .main-table tbody tr:nth-child(even) { background: var(--wash); }
    .notes { margin-top: 16px; font-size: calc(11px * var(--print-font-scale)); color: var(--ink-soft); }
  `

  const sheets = pages
    .map(
      (pageTx, pageIndex) => `
    <div class="sheet">
      <div class="page-header">
        ${renderLetterhead(company)}

        <div class="meta-row">
          <div class="meta-left">
            <strong>${partyLabel}:</strong><br>
            ${partyName || (tx.type === 'purchase_order' ? 'Supplier not selected' : 'Walk-in Customer')}
            ${partyAddress ? `<br>${partyAddress}` : ''}
            ${partyPhone ? `<br>${partyPhone}` : ''}
          </div>
          <div class="meta-right">
            <span class="doc-title">${docLabel}</span>
            <div class="doc-number">No. <strong>${tx.number}</strong></div>
            <div class="doc-date">Date: <strong>${new Date(tx.issued_at || tx.created_at).toLocaleDateString()}</strong></div>
            ${tx.manual_reference ? `<span class="ref">Reference: ${tx.manual_reference}</span>` : ''}
            ${tx.reference_quotation_number ? `<span class="ref">Ref. Quotation: ${tx.reference_quotation_number}</span>` : ''}
            <span class="ref">${renderPageIndicator(pageIndex + 1, totalPages)}</span>
          </div>
        </div>
      </div>

      <div class="content page-content">

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
  `,
    )
    .join('')

  return `
  <html><head><meta charset="utf-8"><style>
    ${baseShellCss('classic', company)}
    ${LETTERHEAD_FOOTER_CSS}
    ${contentStyles}
  </style></head><body>
    ${sheets}
  </body></html>`
}
