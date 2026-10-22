import { docDate, money } from './shared'
import { paymentLabel } from 'src/constants/payments'

/**
 * 80 mm thermal receipt layouts. They produce plain HTML that is sent through
 * window.appBridge.printReceipt({ html }) - the same path as the test receipt
 * in Settings > Network - so they print on the receipt printer of the main PC,
 * from any PC on the network. No extra npm package is needed.
 *
 * Prices are tax-inclusive (see TransactionRepository._computeTotals):
 * line_total is what the customer pays, VAT is shown as "included".
 */
export const THERMAL_TEMPLATES = {
  compact: { label: 'Compact', hint: 'Company, items and total. Saves paper.' },
  detailed: { label: 'Detailed', hint: 'Logo, company details, customer, item columns, discount and VAT.' },
}

const DOC_LABELS = { quote: 'QUOTATION', invoice: 'INVOICE', purchase_order: 'PURCHASE ORDER' }

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function qty(value) {
  const n = Number(value)
  return Number.isFinite(n) ? String(Number(n.toFixed(4))) : esc(value)
}

/**
 * Cheap thermal printers (80 mm paper) usually print only ~72 mm and some start at the left
 * edge, so a full-width receipt loses its right-hand side (the Total column). The text is
 * therefore kept in a centred column - 62 mm by default, adjustable in
 * Settings > Receipt (POS) printer ("Receipt text width").
 */
export const RECEIPT_WIDTH_DEFAULT_MM = 62
export const RECEIPT_WIDTH_MIN_MM = 40
export const RECEIPT_WIDTH_MAX_MM = 76

export function receiptContentWidth(company = {}) {
  const n = Number(company.receipt_content_width)
  if (!Number.isFinite(n) || n <= 0) return RECEIPT_WIDTH_DEFAULT_MM
  return Math.min(RECEIPT_WIDTH_MAX_MM, Math.max(RECEIPT_WIDTH_MIN_MM, Math.round(n)))
}

function baseCss(company) {
  const side = (80 - receiptContentWidth(company)) / 2
  return `
  @page { margin: 0 }
  * { box-sizing: border-box }
  html, body { margin: 0; background: #fff }
  body { width: 80mm; padding: 3mm ${side}mm 6mm; font: 12px/1.35 "Segoe UI", Arial, sans-serif; color: #000 }
  .c { text-align: center }
  .r { text-align: right }
  .b { font-weight: 700 }
  .small { font-size: 10.5px }
  .name { font-size: 16px; font-weight: 700; text-align: center; margin-bottom: 2px }
  hr { border: 0; border-top: 1px dashed #000; margin: 5px 0 }
  hr.solid { border-top-style: solid }
  .row { display: flex; justify-content: space-between; gap: 6px }
  .row .grow { flex: 1; min-width: 0; word-break: break-word }
  .row .amt { white-space: nowrap }
  .total { font-size: 15px; font-weight: 700 }
  table { width: 100%; border-collapse: collapse; table-layout: fixed }
  th { text-align: left; font-size: 10px; border-bottom: 1px solid #000; padding: 2px 0 }
  td { padding: 2px 4px 2px 0; vertical-align: top; word-break: break-word; font-size: 11px }
  td.r { white-space: nowrap; padding-right: 0 }
  tr { break-inside: avoid }
  .logo { display: block; margin: 0 auto 3px; max-width: 40mm; max-height: 16mm; filter: grayscale(1) contrast(1.4) }
`
}

function shell(body, company = {}) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${baseCss(company)}</style></head><body>${body}</body></html>`
}

/** A POS sale is an invoice that carries the cash handed over. */
function isPosSale(tx) {
  return tx.type === 'invoice' && tx.amount_tendered !== null && tx.amount_tendered !== undefined && tx.amount_tendered !== ''
}

/** South African till-slip wording: a VAT-registered business issues a TAX INVOICE. */
function docLabel(tx, company) {
  if (isPosSale(tx) && String(company.company_vat || '').trim()) return 'TAX INVOICE'
  return DOC_LABELS[tx.type] || 'RECEIPT'
}

/** created_at is SQLite UTC ('YYYY-MM-DD HH:MM:SS'); show the till time in local time. */
function saleTime(tx) {
  const raw = String(tx.created_at || '')
  const d = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? new Date(`${raw.replace(' ', 'T')}Z`) : new Date(raw)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function itemCount(tx) {
  return Math.round((tx.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0) * 1000) / 1000
}

/**
 * Payment lines, printed right under TOTAL on POS sales only: one line per method
 * used, then the change (only when cash was part of the payment).
 */
function tenderBlock(tx, symbol) {
  if (!isPosSale(tx)) return ''
  const tendered = Number(tx.amount_tendered)
  const change = Math.max(0, Math.round((tendered - (Number(tx.grand_total) || 0)) * 100) / 100)
  const payments = Array.isArray(tx.payments) && tx.payments.length ? tx.payments : [{ method: 'cash', amount: tendered }]
  const hasCash = payments.some((p) => p.method === 'cash')

  const lines = payments
    .map((p) => {
      const label = p.method === 'cash' && payments.length === 1 ? 'Cash tendered' : paymentLabel(p.method)
      return `<div class="row"><div>${esc(label)}</div><div class="amt">${money(p.amount, symbol)}</div></div>`
    })
    .join('')
  const changeLine = hasCash
    ? `<div class="row b" style="font-size:14px"><div>CHANGE</div><div class="amt">${money(change, symbol)}</div></div>`
    : ''
  return `${lines}${changeLine}<div class="small">Items: ${itemCount(tx)}</div>`
}

function party(tx) {
  if (tx.type === 'purchase_order') return tx.supplier_name || 'Supplier not selected'
  return tx.customer_name || 'Walk-in Customer'
}

function companyHeader(company, { full }) {
  const lines = []
  if (full && company.company_logo && String(company.company_logo).startsWith('data:image')) {
    lines.push(`<img class="logo" src="${esc(company.company_logo)}" alt="">`)
  }
  lines.push(`<div class="name">${esc(company.company_name || 'My Company')}</div>`)
  if (company.company_address) lines.push(`<div class="c small">${esc(company.company_address)}</div>`)
  if (company.company_phone) lines.push(`<div class="c small">Tel: ${esc(company.company_phone)}</div>`)
  if (full && company.company_email) lines.push(`<div class="c small">${esc(company.company_email)}</div>`)
  if (full && company.company_vat) lines.push(`<div class="c small">VAT No: ${esc(company.company_vat)}</div>`)
  return lines.join('')
}

function renderCompact(tx, company) {
  const symbol = company.currency_symbol || 'M'
  const rows = (tx.items || [])
    .map(
      (item) => `<div class="row"><div class="grow">${qty(item.quantity)} x ${esc(item.name)}${
        item.discount_pct ? ` (-${esc(item.discount_pct)}%)` : ''
      }</div><div class="amt">${money(item.line_total, symbol)}</div></div>`,
    )
    .join('')

  return shell(`
    ${companyHeader(company, { full: false })}
    <hr>
    <div class="c b">${docLabel(tx, company)} ${esc(tx.number)}</div>
    <div class="c small">${esc(docDate(tx, company))}${isPosSale(tx) ? ` ${esc(saleTime(tx))}` : ''}</div>
    ${isPosSale(tx) && company.company_vat ? `<div class="c small">VAT No: ${esc(company.company_vat)}</div>` : ''}
    <hr>
    ${rows || '<div class="c">No items</div>'}
    <hr>
    <div class="row total"><div>TOTAL</div><div class="amt">${money(tx.grand_total, symbol)}</div></div>
    ${isPosSale(tx) && Number(tx.tax_total) > 0 ? `<div class="row small"><div>VAT included</div><div class="amt">${money(tx.tax_total, symbol)}</div></div>` : ''}
    ${tenderBlock(tx, symbol)}
    <hr>
    <div class="c small">${esc(company.footer_note || 'Thank you for your business!')}</div>
  `, company)
}

function renderDetailed(tx, company) {
  const symbol = company.currency_symbol || 'M'
  const items = tx.items || []
  const itemsTotal = items.reduce((sum, item) => sum + (Number(item.line_total) || 0), 0)
  const discount = Number(tx.discount_total) || 0
  const vat = Number(tx.tax_total) || 0

  const rows = items
    .map(
      (item) => `<tr>
        <td>${esc(item.name)}${item.discount_pct ? `<div class="small">discount ${esc(item.discount_pct)}%</div>` : ''}</td>
        <td>${qty(item.quantity)}</td>
        <td class="r">${money(item.unit_price, symbol)}</td>
        <td class="r b">${money(item.line_total, symbol)}</td>
      </tr>`,
    )
    .join('')

  const totals = []
  if (discount > 0) {
    totals.push(`<div class="row"><div>Subtotal</div><div class="amt">${money(itemsTotal, symbol)}</div></div>`)
    totals.push(`<div class="row"><div>Discount</div><div class="amt">-${money(discount, symbol)}</div></div>`)
  }
  totals.push(`<div class="row total"><div>TOTAL</div><div class="amt">${money(tx.grand_total, symbol)}</div></div>`)
  if (vat > 0) {
    totals.push(`<div class="row small"><div>VAT included</div><div class="amt">${money(vat, symbol)}</div></div>`)
  }
  totals.push(tenderBlock(tx, symbol))

  return shell(`
    ${companyHeader(company, { full: true })}
    <hr class="solid">
    <div class="c b" style="font-size:14px">${docLabel(tx, company)}</div>
    <div class="row small"><div>No:</div><div class="b">${esc(tx.number)}</div></div>
    <div class="row small"><div>Date:</div><div>${esc(docDate(tx, company))}${isPosSale(tx) ? ` ${esc(saleTime(tx))}` : ''}</div></div>
    <div class="row small"><div>${tx.type === 'purchase_order' ? 'Supplier' : 'Customer'}:</div><div class="r">${esc(party(tx))}</div></div>
    ${tx.manual_reference ? `<div class="row small"><div>Ref:</div><div class="r">${esc(tx.manual_reference)}</div></div>` : ''}
    <hr>
    <table>
      <colgroup><col style="width:36%"><col style="width:10%"><col style="width:26%"><col style="width:28%"></colgroup>
      <thead><tr><th>Item</th><th>Qty</th><th class="r">Price</th><th class="r">Total</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" class="c">No items</td></tr>'}</tbody>
    </table>
    <hr>
    ${totals.join('')}
    ${tx.notes ? `<hr><div class="small">${esc(tx.notes)}</div>` : ''}
    <hr class="solid">
    <div class="c small"><i>${esc(company.footer_note || 'Thank you for your business!')}</i></div>
  `, company)
}

/** @param {string} key 'compact' | 'detailed' */
export function renderThermalReceipt(key, tx, company = {}) {
  return key === 'detailed' ? renderDetailed(tx, company) : renderCompact(tx, company)
}
