import {
  formatPrintDate,
  baseShellCss,
  LETTERHEAD_FOOTER_CSS,
  renderLetterhead,
  money,
} from './shared'
import { PAYMENT_METHODS, paymentLabel } from 'src/constants/payments'

/** Short column headers so six payment columns fit on A4 portrait. */
const SHORT_HEAD = { cash: 'Cash', speedpoint: 'Speed', eft: 'EFT', ecocash: 'Eco', mpesa: 'MPesa', cheque: 'Chq' }

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** created_at is SQLite UTC ('YYYY-MM-DD HH:MM:SS'); convert to a local Date. */
function localDate(value) {
  const raw = String(value || '')
  const d = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? new Date(`${raw.replace(' ', 'T')}Z`) : new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

function dateTimeLabel(value, dateFormat) {
  const d = localDate(value)
  if (!d) return '-'
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return `${formatPrintDate(d, dateFormat)} ${time}`
}

/**
 * End-of-day sheet (A4): the day's POS sales with a tick under every payment method
 * used, then the grand sales total and the total per payment method.
 * `report` is the result of TransactionRepository.endOfDay().
 */
export function renderEndOfDay(report, company, style = 'classic') {
  const sales = Array.isArray(report?.sales) ? report.sales : []
  const symbol = company?.currency_symbol || 'M'
  const totals = report?.totals || { count: 0, grandTotal: 0, byMethod: {} }
  const dateFormat = company?.print_date_format
  const dayLabel = formatPrintDate(report?.date, dateFormat) || esc(report?.date)
  const generated = dateTimeLabel(new Date().toISOString().replace('T', ' ').slice(0, 19), dateFormat)
  const voided = sales.filter((s) => s.status === 'void').length

  const rows = sales
    .map((sale) => {
      const used = new Set((sale.payments || []).map((p) => p.method))
      const isVoid = sale.status === 'void'
      const ticks = PAYMENT_METHODS.map((m) => `<td class="tick">${used.has(m.value) ? '&#10003;' : ''}</td>`).join('')
      return `
        <tr class="${isVoid ? 'void' : ''}">
          <td>${esc(sale.number)}</td>
          <td>${esc(sale.customer_name || 'Walk-in')}</td>
          <td class="num">${money(sale.grand_total, symbol)}</td>
          <td>${isVoid ? 'Void' : 'Paid'}</td>
          <td>${esc(dateTimeLabel(sale.created_at, dateFormat))}</td>
          ${ticks}
        </tr>`
    })
    .join('')

  const methodCards = PAYMENT_METHODS.filter((m) => Number(totals.byMethod?.[m.value] || 0) > 0)
    .map(
      (m) => `
        <div class="summary-card">
          <div class="summary-label">${esc(paymentLabel(m.value))}</div>
          <div class="summary-value">${money(totals.byMethod[m.value], symbol)}</div>
        </div>`,
    )
    .join('')

  const css = `
    .report-meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 14px; }
    .meta-card { border: 1px solid var(--line); border-radius: 6px; padding: 9px 10px; background: #fff; }
    .meta-label { font-family: "Courier New", monospace; font-size: calc(9px * var(--print-font-scale)); letter-spacing: .08em; text-transform: uppercase; color: var(--accent); font-weight: var(--print-font-weight-bold); }
    .meta-value { margin-top: 5px; font-size: calc(12px * var(--print-font-scale)); color: var(--ink); font-weight: var(--print-font-weight-semibold); }

    table.main-table { width: 100%; border-collapse: collapse; font-size: calc(10.5px * var(--print-font-scale)); margin-top: 6px; }
    .main-table th { background: var(--accent); color: #fff; font-family: "Courier New", monospace; font-size: calc(8.5px * var(--print-font-scale)); letter-spacing: .04em; text-transform: uppercase; text-align: left; padding: 7px 5px; font-weight: var(--print-font-weight-semibold); border: none; }
    .main-table td { padding: 5px; border-bottom: 1px solid var(--line); }
    .main-table th.num, .main-table td.num { text-align: right; white-space: nowrap; }
    .main-table th.tick, .main-table td.tick { width: 6.5%; text-align: center; padding-left: 2px; padding-right: 2px; font-weight: 700; }
    .main-table tbody tr:nth-child(even) { background: var(--wash); }
    .main-table tr.void td { text-decoration: line-through; color: #888; }

    .summary-title { margin: 16px 0 6px; font-family: "Courier New", monospace; font-size: calc(9px * var(--print-font-scale)); letter-spacing: .08em; text-transform: uppercase; color: var(--accent); font-weight: var(--print-font-weight-bold); }
    .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .summary-card { border: 1px solid var(--line); border-radius: 6px; background: #fff; padding: 9px 10px; }
    .summary-label { color: var(--ink-soft); font-size: calc(10.5px * var(--print-font-scale)); }
    .summary-value { margin-top: 5px; font-size: calc(14px * var(--print-font-scale)); font-weight: var(--print-font-weight-bold); color: var(--ink); }
    .summary-card.total { border: 1px solid var(--accent); background: var(--wash); grid-column: 1 / -1; }
    .summary-card.total .summary-value { font-size: calc(18px * var(--print-font-scale)); }
    .note { margin-top: 10px; font-size: calc(9.5px * var(--print-font-scale)); color: var(--ink-soft); }
  `

  return `
  <html><head><meta charset="utf-8"><style>
    ${baseShellCss(style, company)}
    ${LETTERHEAD_FOOTER_CSS}
    ${css}
  </style></head><body>
    <div class="sheet">
      <div class="page-header">
        ${renderLetterhead(company || {})}
      </div>

      <div class="content page-content">
        <div class="report-meta">
          <div class="meta-card"><div class="meta-label">End of day</div><div class="meta-value">${esc(dayLabel)}</div></div>
          <div class="meta-card"><div class="meta-label">Sales</div><div class="meta-value">${Number(totals.count || 0)}</div></div>
          <div class="meta-card"><div class="meta-label">Generated</div><div class="meta-value">${esc(generated)}</div></div>
        </div>

        <table class="main-table">
          <thead>
            <tr>
              <th>Number</th>
              <th>Customer</th>
              <th class="num">Total</th>
              <th>Status</th>
              <th>Date</th>
              ${PAYMENT_METHODS.map((m) => `<th class="tick">${SHORT_HEAD[m.value]}</th>`).join('')}
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="11">No POS sales on this day.</td></tr>'}</tbody>
        </table>

        <div class="summary-title">Totals</div>
        <div class="summary-grid">
          <div class="summary-card total">
            <div class="summary-label">Grand sales total (${Number(totals.count || 0)} sale${Number(totals.count) === 1 ? '' : 's'})</div>
            <div class="summary-value">${money(totals.grandTotal, symbol)}</div>
          </div>
          ${methodCards}
        </div>
        <div class="note">Cash is shown after change given. ${voided ? `${voided} voided sale${voided === 1 ? '' : 's'} listed but not counted.` : ''}</div>
      </div>
    </div>
  </body></html>`
}
