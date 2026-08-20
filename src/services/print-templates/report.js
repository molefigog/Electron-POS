import {
  baseShellCss,
  LETTERHEAD_FOOTER_CSS,
  renderLetterhead,
  money,
} from './shared';

function formatDate(value) {
  if (!value) return 'All dates';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString();
}

function formatDateTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function valueOrDash(value) {
  return value === null || value === undefined || value === '' ? '-' : String(value);
}

export function renderReportDocument(report, company, style = 'classic') {
  const rows = Array.isArray(report?.rows) ? report.rows : [];
  const symbol = company?.currency_symbol || 'M';
  const totals = report?.totals || {};
  const invoiced = Number(totals.invoiced || 0);
  const quoted = Number(totals.quoted || 0);
  const grand = invoiced + quoted;
  const conversionRate = Number(report?.conversionRate || 0);

  const tableRows = rows
    .map((row) => {
      const issued = new Date(row.created_at);
      const dateLabel = Number.isNaN(issued.getTime()) ? '-' : issued.toLocaleDateString();
      return `
        <tr>
          <td>${valueOrDash(row.number)}</td>
          <td>${valueOrDash(row.type)}</td>
          <td>${valueOrDash(row.customer_name || 'Walk-in')}</td>
          <td class="num">${money(row.grand_total, symbol)}</td>
          <td>${valueOrDash(row.status)}</td>
          <td>${dateLabel}</td>
        </tr>`;
    })
    .join('');

  const contentStyles = `
    .report-meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 14px; }
    .meta-card { border: 1px solid var(--line); border-radius: 6px; padding: 9px 10px; background: #fff; }
    .meta-label { font-family: "Courier New", monospace; font-size: calc(9px * var(--print-font-scale)); letter-spacing: .08em; text-transform: uppercase; color: var(--accent); font-weight: var(--print-font-weight-bold); }
    .meta-value { margin-top: 5px; font-size: calc(12px * var(--print-font-scale)); color: var(--ink); font-weight: var(--print-font-weight-semibold); }

    table.main-table { width: 100%; border-collapse: collapse; font-size: calc(11px * var(--print-font-scale)); margin-top: 6px; }
    .main-table th { background: var(--accent); color: #fff; font-family: "Courier New", monospace; font-size: calc(9px * var(--print-font-scale)); letter-spacing: .06em; text-transform: uppercase; text-align: left; padding: 7px 8px; font-weight: var(--print-font-weight-semibold); border: none; }
    .main-table td { padding: 6px 8px; border-bottom: 1px solid var(--line); }
    .main-table tbody tr:nth-child(even) { background: var(--wash); }

    .summary-grid { margin-top: 14px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
    .summary-card { border: 1px solid var(--line); border-radius: 6px; background: #fff; padding: 9px 10px; }
    .summary-label { color: var(--ink-soft); font-size: calc(10.5px * var(--print-font-scale)); }
    .summary-value { margin-top: 5px; font-size: calc(14px * var(--print-font-scale)); font-weight: var(--print-font-weight-bold); color: var(--ink); }
    .summary-card.total { border: 1px solid var(--accent); background: var(--wash); }
  `;

  return `
  <html><head><meta charset="utf-8"><style>
    ${baseShellCss(style, company)}
    ${LETTERHEAD_FOOTER_CSS}
    ${contentStyles}
  </style></head><body>
    <div class="sheet">
      <div class="page-header">
        ${renderLetterhead(company || {})}
      </div>

      <div class="content page-content">
        <div class="report-meta">
          <div class="meta-card">
            <div class="meta-label">Date From</div>
            <div class="meta-value">${formatDate(report?.from)}</div>
          </div>
          <div class="meta-card">
            <div class="meta-label">Date To</div>
            <div class="meta-value">${formatDate(report?.to)}</div>
          </div>
          <div class="meta-card">
            <div class="meta-label">Generated</div>
            <div class="meta-value">${formatDateTime(report?.generatedAt)}</div>
          </div>
        </div>

        <table class="main-table">
          <thead>
            <tr>
              <th>Number</th>
              <th>Type</th>
              <th>Customer</th>
              <th class="num">Total</th>
              <th>Status</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>${tableRows || '<tr><td colspan="6">No transactions in this date range.</td></tr>'}</tbody>
        </table>

        <div class="summary-grid">
          <div class="summary-card">
            <div class="summary-label">Total Invoiced</div>
            <div class="summary-value">${money(invoiced, symbol)}</div>
          </div>
          <div class="summary-card">
            <div class="summary-label">Total Quoted</div>
            <div class="summary-value">${money(quoted, symbol)}</div>
          </div>
          <div class="summary-card">
            <div class="summary-label">Quote to Invoice Conversion</div>
            <div class="summary-value">${conversionRate}%</div>
          </div>
          <div class="summary-card total">
            <div class="summary-label">Total Amount</div>
            <div class="summary-value">${money(grand, symbol)}</div>
          </div>
        </div>
      </div>
    </div>
  </body></html>`;
}
