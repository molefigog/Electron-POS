# Accounting module

Double-entry accounting on top of the existing POS/ERP data. Nothing is entered twice: sales, POS payments and
purchase orders stay where they are; accounting reads them.

## Where things live
| Piece | File |
|---|---|
| Tables, default chart of accounts, cost snapshot | `migrations.js` (v17) |
| Posting engine, payments, expenses, bills, journal, reports | `src-electron/db/accounting-repository.js` |
| Hooks that post invoices automatically | `TransactionRepository` in `src-electron/db/repositories.js` (create / update / delete / convert) |
| IPC allow-list + "Save as" dialog | `src-electron/db/ipc-handlers.js`, `src-electron/electron-preload.js` |
| Screens | `src/pages/AccountingPage.vue`, `src/components/accounting/*` |
| Export (CSV / Excel / JSON) | `src/composables/useAccountingExport.js` |
| Self-test | `node src-electron/db/accounting-selftest.mjs` |

## Rules worth knowing
- Prices are tax-inclusive, so a sale posts Dr cash/bank/mobile money/receivable, Cr Sales (excl. VAT) + Cr VAT Output.
- VAT uses the existing settings: `default_tax_rate` (to extract VAT from expenses/bills) and `company_vat`
  (input VAT is only claimed when a VAT number is set).
- Profit uses `transaction_items.unit_cost`, a cost snapshot taken when the line is saved. Editing an invoice re-snapshots
  its lines at the product's current cost.
- POS sales are settled at the till. Credit invoices are settled with *Receivables -> Receive payment*; the invoice becomes `paid` automatically.
- Voiding or deleting an invoice that has payments is refused until the payments are removed.
- *Journal -> Close books* locks everything on or before a date.
- First start after the update posts all existing invoices once (invoices already marked `paid` get an opening payment).
- Accounting is desktop/LAN only: it is not synced through the internet API and is hidden in API mode.
