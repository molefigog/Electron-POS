import { baseShellCss, renderLetterhead, LETTERHEAD_FOOTER_CSS } from './shared';

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toMultilineHtml(text) {
  return escapeHtml(String(text || '')).replace(/\r\n|\r|\n/g, '<br/>');
}

function sanitizeHtml(html) {
  const raw = String(html || '');
  if (!raw.trim()) return '';

  // Remove obvious script/style payloads and inline event handlers.
  return raw
    .replace(/<\s*script[\s\S]*?>[\s\S]*?<\s*\/\s*script\s*>/gi, '')
    .replace(/<\s*style[\s\S]*?>[\s\S]*?<\s*\/\s*style\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/\s(href|src)\s*=\s*"\s*javascript:[^"]*"/gi, ' $1="#"')
    .replace(/\s(href|src)\s*=\s*'\s*javascript:[^']*'/gi, " $1='#'")
    .replace(/\s(href|src)\s*=\s*javascript:[^\s>]+/gi, ' $1="#"');
}

function renderRichOrMultiline(value) {
  const raw = String(value || '');
  if (!raw.trim()) return '';
  if (/<\/?[a-z][\s\S]*>/i.test(raw)) {
    return sanitizeHtml(raw);
  }
  return toMultilineHtml(raw);
}

// Formats a date as "02 July 2026" regardless of locale settings.
function formatLetterDate(dateInput) {
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

export function renderBusinessLetter(letter, company) {
  const contentStyles = `
    .letterhead-break {
      border-bottom: 1px solid var(--line);
      margin: 12px 0 16px;
    }
    .meta-stack {
      margin: 0 0 18px;
    }
    .letter-date {
      font-size: calc(13px * var(--print-font-scale));
      color: var(--ink-soft);
    }
    .meta-line-break {
      height: 12px;
    }
    .recipient {
      font-size: calc(12.5px * var(--print-font-scale));
      line-height: 1.6;
      color: var(--ink);
    }
    .subject {
      margin: 10px 0 14px;
      padding: 8px 10px;
      border-left: 3px solid var(--accent);
      background: var(--wash);
      font-size: calc(13px * var(--print-font-scale));
    }
    .subject strong {
      display: inline-block;
      min-width: 58px;
      font-family: "Courier New", monospace;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--accent);
      font-size: calc(11px * var(--print-font-scale));
    }
    .body,
    .closing,
    .signature {
      line-height: 1.75;
    }
    .letterhead-info .company-name {
      font-size: calc(24px * var(--print-font-scale));
    }
    .body p,
    .closing p,
    .signature p { margin: 0 0 0.8em; }
    .body h1, .body h2, .body h3, .body h4, .body h5, .body h6,
    .closing h1, .closing h2, .closing h3, .closing h4, .closing h5, .closing h6,
    .signature h1, .signature h2, .signature h3, .signature h4, .signature h5, .signature h6 {
      margin: 0.4em 0 0.5em;
      line-height: 1.35;
    }
    .body ul, .body ol,
    .closing ul, .closing ol,
    .signature ul, .signature ol {
      margin: 0.4em 0 0.8em 1.25em;
      padding-left: 1.1em;
    }
    .body table,
    .closing table,
    .signature table {
      width: 100%;
      border-collapse: collapse;
      margin: 0.6em 0 0.9em;
    }
    .body th, .body td,
    .closing th, .closing td,
    .signature th, .signature td {
      border: 1px solid var(--line);
      padding: 6px 7px;
      vertical-align: top;
    }
    .closing {
      margin-top: 18px;
    }
    .signature {
      margin-top: 28px;
    }
    .signature-name {
      margin-top: 32px;
      border-top: 1px solid var(--line);
      width: 260px;
      padding-top: 6px;
      font-weight: var(--print-font-weight-semibold);
    }
  `;

  return `
  <html><head><meta charset="utf-8"><style>
    ${baseShellCss('classic', company)}
    ${LETTERHEAD_FOOTER_CSS}
    ${contentStyles}
  </style></head><body>
    <div class="sheet">
      <div class="content">
        ${renderLetterhead(company)}
        <div class="letterhead-break"></div>

        <div class="meta-stack">
          <div class="letter-date">${formatLetterDate(letter.date)}</div>
          <div class="meta-line-break"></div>
          <div class="recipient">
            <strong>${escapeHtml(letter.recipientName || '')}</strong>
            ${letter.recipientCompany ? `<div>${escapeHtml(letter.recipientCompany)}</div>` : ''}
            ${letter.recipientAddress ? `<div>${toMultilineHtml(letter.recipientAddress)}</div>` : ''}
          </div>
        </div>

        <div class="subject"><strong></strong> ${escapeHtml(letter.subject || '')}</div>

        <div class="body">${renderRichOrMultiline(letter.body)}</div>

        ${letter.closing ? `<div class="closing">${renderRichOrMultiline(letter.closing)}</div>` : ''}

        <div class="signature">
          ${letter.signature ? `<div class="signature-name">${renderRichOrMultiline(letter.signature)}</div>` : '<div class="signature-name"></div>'}
        </div>
      </div>
    </div>
  </body></html>`;
}
