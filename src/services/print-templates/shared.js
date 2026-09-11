export function money(amount, symbol = 'M') {
  if (amount === null || amount === undefined || amount === '') return '-'
  const n = Number(amount || 0)
  return `${symbol}${n.toFixed(2)}`
}

export function itemsRows(tx, symbol) {
  return tx.items
    .map(
      (item) => `
      <tr>
        <td>${item.name}</td>
        <td class="num">${item.quantity}</td>
        <td class="num">${money(item.unit_price, symbol)}</td>
        <td class="num">${item.unit_price === null || item.unit_price === undefined || item.unit_price === '' ? '-' : item.discount_pct ? item.discount_pct + '%' : '-'}</td>
        <td class="num">${item.unit_price === null || item.unit_price === undefined || item.unit_price === '' ? '-' : item.tax_rate ? item.tax_rate + '%' : '-'}</td>
        <td class="num">${money(item.line_total, symbol)}</td>
      </tr>`,
    )
    .join('')
}

/**
 * Palette per template - one accent color and a couple of neutrals drive
 * the whole visual identity via CSS custom properties. Change the accent
 * here and every element that reads var(--accent) shifts together.
 */
const PALETTES = {
  classic: {
    accent: '#22ac87',
    ink: '#1c2230',
    inkSoft: '#5a6272',
    line: '#dde1e8',
    wash: '#f6f7fa',
  },
  modern: {
    accent: '#4338ca',
    ink: '#1c2230',
    inkSoft: '#5a6272',
    line: '#e4e4f5',
    wash: '#f5f5fc',
  },
  minimal: {
    accent: '#0090b4',
    ink: '#111111',
    inkSoft: '#444444',
    line: '#000000',
    wash: '#f2f2f2',
  },
}

export function paletteFor(style) {
  return PALETTES[style] || PALETTES.classic
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function resolvePrintTypography(company = {}) {
  const baseFontSize = clampNumber(Number(company.print_font_size), 8, 24, 12)
  const baseWeight = clampNumber(Number(company.print_font_weight), 300, 900, 400)
  const weight = Math.round(baseWeight / 100) * 100
  const mediumWeight = Math.min(900, weight + 100)
  const semiboldWeight = Math.min(900, weight + 200)
  const boldWeight = Math.min(900, weight + 300)
  return {
    baseFontSize,
    fontScale: Number((baseFontSize / 12).toFixed(4)),
    weight,
    mediumWeight,
    semiboldWeight,
    boldWeight,
  }
}

/**
 * Base page shell shared by every template: A4 sizing, colour variables,
 * the coloured top bar, and print-safe pagination rules (don't split a
 * table row or the footer across pages, repeat the table header). This is
 * everything that must stay identical regardless of which layout is picked.
 */
export function baseShellCss(style, company = {}) {
  const p = paletteFor(style)
  const t = resolvePrintTypography(company)
  return `
    :root {
      --ink: ${p.ink};
      --ink-soft: ${p.inkSoft};
      --line: ${p.line};
      --wash: ${p.wash};
      --accent: ${p.accent};
      --print-font-size: ${t.baseFontSize}px;
      --print-font-scale: ${t.fontScale};
      --print-font-weight: ${t.weight};
      --print-font-weight-medium: ${t.mediumWeight};
      --print-font-weight-semibold: ${t.semiboldWeight};
      --print-font-weight-bold: ${t.boldWeight};
    }
    * { box-sizing: border-box; }
    @page { size: A4; margin: 0; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      font-size: var(--print-font-size);
      font-weight: var(--print-font-weight);
      color: var(--ink);
      background: #fff;
    }
    .sheet { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 14mm 15mm 12mm; position: relative; display: flex; flex-direction: column; }
    .sheet::before { content: ""; position: absolute; top: 0; left: 0; right: 0; height: 5mm; background: var(--accent); }
    .content { position: relative; z-index: 1; }
    .page-header,
    .page-footer { display: block; }
    .page-content { position: relative; z-index: 1; flex: 1 0 auto; }
    .num { text-align: left; }
    table.main-table thead th { text-align: left !important; }

    table.main-table thead { display: table-header-group; }
    table.main-table tr { page-break-inside: avoid; break-inside: avoid; }
    .footer { page-break-inside: avoid; break-inside: avoid; }

    @media print {
      .sheet {
        width: auto;
        min-height: 297mm;
        margin: 0;
        padding: 14mm 15mm 12mm;
        break-after: page;
        page-break-after: always;
      }
      .sheet:last-child { break-after: auto; page-break-after: auto; }
    }
  `
}

export const ITEMS_PER_PAGE = 18

export function paginateTransactionItems(tx, itemsPerPage = ITEMS_PER_PAGE) {
  const allItems = Array.isArray(tx?.items) ? tx.items : []
  if (!allItems.length) {
    return [{ ...tx, items: [] }]
  }

  const pages = []
  for (let index = 0; index < allItems.length; index += itemsPerPage) {
    pages.push({
      ...tx,
      items: allItems.slice(index, index + itemsPerPage),
    })
  }

  return pages
}

/** Uploaded logo image if Settings has one, otherwise initials fallback */
function logoBlock(company) {
  if (company.company_logo) {
    return `<img class="brand-logo-img" src="${company.company_logo}" alt="${company.company_name || 'Logo'}" />`
  }
  const initials = String(company.company_name || 'LG')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
  return `<div class="brand-logo-fallback">${initials}</div>`
}

const ICONS = {
  address:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18"/><line x1="9" y1="7" x2="9" y2="7.01"/><line x1="15" y1="7" x2="15" y2="7.01"/><line x1="9" y1="11" x2="9" y2="11.01"/><line x1="15" y1="11" x2="15" y2="11.01"/></svg>',
  phone:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 8a3 3 0 0 1 3 3M15 4a7 7 0 0 1 7 7"/><path d="M4.5 3h3l1.5 5-2 1.5a11 11 0 0 0 6 6L14.5 14l5 1.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 2.5 5.2 2 2 0 0 1 4.5 3z"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 6 10 7 10-7"/></svg>',
  vat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h9l3 3v17H6z"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="12" x2="15" y2="12"/></svg>',
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function toMultilineHtml(text) {
  return escapeHtml(text).replace(/\r\n|\r|\n/g, '<br/>')
}

/** Optional signature block: two signature lines + a note, all editable from Settings */
function renderSignatureBlock(company) {
  if (String(company.show_signature_block) !== 'true') return ''

  const leftLabel = company.signature_label_manager || 'Manager / Authorized Person'
  const rightLabel = company.signature_label_customer || 'Customer / Client'
  const note = company.signature_note || ''

  return `
    <div class="signature-block">
      <div class="signature-line">
        <div class="signature-box"></div>
        <div class="signature-label">${escapeHtml(leftLabel)}</div>
      </div>
      <div class="signature-line">
        <div class="signature-box"></div>
        <div class="signature-label">${escapeHtml(rightLabel)}</div>
      </div>
    </div>
    ${note ? `<div class="signature-note">${escapeHtml(note)}</div>` : ''}`
}
/**
 * Letterhead: logo/initials + centered company identity + a row of
 * detail chips (address / phone / email / VAT). Identical markup across
 * every template - only the CSS variables (set by baseShellCss) change
 * how it looks.
 */
export function renderLetterhead(company) {
  const details = [
    company.company_address &&
      `<span class="detail detail-address">${ICONS.address}<span>${toMultilineHtml(company.company_address)}</span></span>`,
    company.company_phone && `<span class="detail">${ICONS.phone}${company.company_phone}</span>`,
    company.company_email && `<span class="detail">${ICONS.mail}${company.company_email}</span>`,
    company.company_vat && `<span class="detail">${ICONS.vat}VAT: ${company.company_vat}</span>`,
  ]
    .filter(Boolean)
    .join('')

  return `
    <div class="letterhead">
      <div class="letterhead-logo">${logoBlock(company)}</div>
      <div class="letterhead-info">
        <div class="company-name">${company.company_name || ''}</div>
        ${details ? `<div class="company-details">${details}</div>` : ''}
      </div>
    </div>`
}

/**
 * Footer: payment details on the left, mobile money in the middle, and the
 * running totals (subtotal/discount/tax/grand total) on the right - this
 * is the one place both "how to pay" and "how much" live together, so
 * nothing about payment is scattered elsewhere in the document.
 */
export function renderFooter(company, tx, symbol) {
  const hasTotals = tx.grand_total !== null && tx.grand_total !== undefined && tx.grand_total !== ''
  const grand = money(tx.grand_total, symbol)
  const isPurchaseOrder = tx.type === 'purchase_order'
  const showPaymentDetails = !isPurchaseOrder
  const totalUnits = Array.isArray(tx.items)
    ? tx.items.reduce((sum, item) => sum + (Number(item?.quantity) || 0), 0)
    : 0
  const hasQuantitySummary = tx.type === 'purchase_order'
  const hasRightSummary = hasTotals || hasQuantitySummary

  return `
    <div class="footer">
      <hr />
      <div class="footer-content${showPaymentDetails ? '' : ' footer-content--compact'}">
        ${showPaymentDetails && company.payment_details ? `<div class="payment-block">${company.payment_details.replace(/\n/g, '<br/>')}</div>` : '<div></div>'}
        ${showPaymentDetails && company.mobile_money_details ? `<div class="merchants-block">${company.mobile_money_details.replace(/\n/g, '<br/>')}</div>` : '<div></div>'}
        ${
          hasRightSummary
            ? `<div class="totals-block">
          ${hasQuantitySummary ? `<div class="totals-row"><span class="label">Total Units</span><span class="value">${totalUnits}</span></div>` : ''}
          ${hasTotals ? `<div class="totals-row"><span class="label">Subtotal </span> &nbsp;<span class="value">${money(tx.subtotal, symbol)}</span></div>` : ''}
          ${hasTotals && tx.discount_total ? `<div class="totals-row"><span class="label">Discount</span><span class="value">-${money(tx.discount_total, symbol)}</span></div>` : ''}
          ${hasTotals ? `<div class="totals-row"><span class="label">Tax </span> &nbsp;<span class="value">${money(tx.tax_total, symbol)}</span></div>` : ''}
          ${hasTotals ? `<div class="totals-row grand"><span class="label">Total </span><span class="value">${grand}</span></div>` : ''}
        </div>`
            : '<div></div>'
        }
      </div>
     ${renderSignatureBlock(company)}
      ${company.footer_note ? `<div class="footer-note">${company.footer_note}</div>` : ''}
    </div>`
}

/**
 * Page indicator rendered near document references. The current layout uses
 * one long A4 sheet, so this shows "1/N" where N is computed from content
 * height before print/export.
 */
export function renderPageIndicator(page = 1, total = 1) {
  return `<span class="page-indicator">Page ${page}/${total}</span>`
}

/** Shared CSS for letterhead + footer blocks (reads the --accent/--ink/etc vars set by baseShellCss) */
export const LETTERHEAD_FOOTER_CSS = `
  .letterhead { display: flex; align-items: stretch; gap: 16px; padding-bottom: 12px; border-bottom: 2px solid var(--accent); margin-bottom: 16px; }
  .letterhead-logo { width: 102px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; border-right: 1px solid var(--line); padding-right: 12px; }
  .letterhead-logo .brand-logo-img { max-width: 100%; max-height: 82px; object-fit: contain; }
  .letterhead-logo .brand-logo-fallback { width: 68px; height: 68px; border-radius: 8px; background: var(--accent); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: var(--print-font-weight-bold); font-size: calc(20px * var(--print-font-scale)); }
  .letterhead-info { flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; }
  .letterhead-info .company-name { font-family: "Palatino Linotype", "Book Antiqua", Palatino, serif; font-size: calc(22px * var(--print-font-scale)); font-weight: var(--print-font-weight-bold); letter-spacing: .04em; text-transform: uppercase; color: var(--ink); margin-bottom: 6px; }
  .letterhead-info .company-details { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 18px; font-size: calc(10.5px * var(--print-font-scale)); color: var(--ink-soft); }
  .letterhead-info .detail { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
  .letterhead-info .detail-address { align-items: flex-start; white-space: normal; max-width: 360px; text-align: left; }
  .letterhead-info .detail-address span { display: inline-block; }
  .letterhead-info .detail svg { width: 11px; height: 11px; vertical-align: -1px; margin-right: 2px; }

  .footer { margin-top: auto; padding-top: 10mm; font-size: calc(11px * var(--print-font-scale)); }
  .footer hr { margin: 0 0 10px; border: none; border-top: 1px solid var(--line); }
  .footer-content { display: flex; justify-content: space-between; gap: 24px; }
  .footer-content--compact { justify-content: flex-end; }
  .footer-content > div { flex: 1; }
  .footer-content--compact > div { flex: 0 0 auto; }
  .footer-content--compact .totals-block { min-width: 280px; }
  .payment-block, .merchants-block { font-size: calc(10.5px * var(--print-font-scale)); line-height: 1.7; color: var(--ink-soft); }
  .payment-block { background: var(--wash); border-left: 3px solid var(--accent); padding: 8px 10px; }
  .payment-block strong, .merchants-block strong { color: var(--ink); }
  .totals-block { text-align: right; }
  .totals-row { display: flex; justify-content: space-between; font-size: calc(11px * var(--print-font-scale)); padding: 3px 0; color: var(--ink-soft); }
  .totals-row .value { font-family: "Courier New", monospace; font-weight: var(--print-font-weight-semibold); color: var(--ink); }
  .totals-row.grand { margin-top: 5px; background: var(--accent); color: #fff; border-radius: 5px; padding: 8px 10px; font-size: calc(13px * var(--print-font-scale)); font-weight: var(--print-font-weight-bold); }
  .totals-row.grand .label, .totals-row.grand .value { color: #fff; font-weight: var(--print-font-weight-bold); }
  .footer-note { margin-top: 12px; font-size: calc(10.5px * var(--print-font-scale)); color: var(--ink-soft); font-style: italic; text-align: center; }

  .label { font-family: "Courier New", monospace; font-size: calc(9px * var(--print-font-scale)); letter-spacing: .1em; text-transform: uppercase; color: var(--accent); font-weight: var(--print-font-weight-bold); }
  .page-indicator { display: inline-block; margin-top: 3px; font-family: "Courier New", monospace; font-size: calc(10px * var(--print-font-scale)); letter-spacing: .04em; color: var(--ink-soft); }
  .signature-block { display: flex; justify-content: space-between; gap: 40px; margin-top: 24px; }
  .signature-line { flex: 1; text-align: center; }
  .signature-box { border-top: 1px solid var(--ink); margin: 28px 12px 6px; }
  .signature-label { font-size: calc(10px * var(--print-font-scale)); color: var(--ink-soft); }
  .signature-note { margin-top: 10px; font-size: calc(9.5px * var(--print-font-scale)); color: var(--ink-soft); text-align: center; font-style: italic; }
`

/** Kept for backwards compatibility with anything importing the old constant name */
export const A4_PAGE_CSS = ''
