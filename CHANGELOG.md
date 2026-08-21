# Changelog

All notable changes to Nid-POS, in the order they were built. Entries are
grouped by milestone rather than calendar date. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/).

## Milestone 1 — Initial Application Scaffold

**Added**

- Quasar (Vue 3 + Composition API) + Pinia + Electron + SQLite (`better-sqlite3`) project scaffold.
- SQLite schema and versioned migration runner (`src-electron/db/migrations.js`).
- Repository pattern on both sides: main-process repositories (`src-electron/db/repositories.js`) doing all SQL, thin renderer-side wrappers (`src/services/repositories/*`) calling them over a whitelisted IPC bridge (`db:call`) — the renderer never runs raw SQL.
- Pinia stores: `products`, `customers`, `transactions`, `stock`, `settings`.
- Modules: Dashboard, Products (CRUD), Customers (CRUD), Stock Management (movements + adjustments with history), Transactions (quotations & invoices), Reports, Settings.
- Single Transactions screen handling both quotations and invoices.
- **Quote → Invoice conversion** without re-entering data — copies customer, items, and totals into a new invoice row, stamping the source quote's number as `reference_quotation_number`.
- PDF/print template switcher (Classic, Modern, Minimal), A4-only, template files are pure `(transaction, company) => htmlString` functions so switching layouts never touches business logic.
- `useBarcodeScanner` composable (detects fast-typed input + Enter, typical of USB/Bluetooth scanners).
- `useCurrency` composable for consistent money formatting.

## Milestone 2 — Stability & Environment Fixes

**Fixed**

- `better-sqlite3` failing to bundle under esbuild — marked external in `quasar.config.js`'s `extendElectronMainConf`/`extendElectronPreloadConf` (native modules can't be bundled as JS).
- Broken SQL migration — a backtick inside a SQL _comment_ was terminating the enclosing JS template literal early.
- ESLint `no-unused-vars` errors from leftover dead code.
- Missing Pinia registration — added `src/boot/pinia.js` and registered it in `quasar.config.js`'s `boot` array (`app.use(pinia)` was never being called).
- Electron IPC "An object could not be cloned" errors — Vue/Pinia reactive Proxies can't cross the `contextBridge`. Fixed by JSON round-tripping data at the actual boundary (`electron-preload.js`), not just in renderer code.
- "Dynamic require of 'electron' is not supported" — `require('electron')` doesn't work inside ES module main-process code under esbuild; switched to top-level `import`.

## Milestone 3 — PDF Workflow & Document Branding

**Changed**

- PDF export no longer shows a save dialog — saves silently to `~/Documents/receipts/` (auto-created), avoids overwriting via `(1)`, `(2)`… suffixing, then opens with the OS default PDF viewer (`shell.openPath`).

**Added**

- Letterhead and footer sections added to all three print templates, pulling from Settings (company name/address/phone/email/website, payment details, footer note).
- Shared CSS custom-property system (`--ink`, `--ink-soft`, `--line`, `--wash`, `--accent`) so all templates share one palette mechanism; each template only overrides its accent and middle-section layout.
- Print-safe pagination (repeating table headers, `page-break-inside: avoid` on rows/footer).
- Totals moved into the footer, next to payment/mobile money details, rather than sitting separately in the document body.

## Milestone 4 — Settings, Tax, Navigation & Fast Cart Entry

**Added**

- Company logo upload in Settings (stored as base64, shown in the letterhead; falls back to text initials if unset).
- Global default tax rate setting, used as a fallback when a product has no tax of its own.
- **Tax-inclusive pricing model** applied strictly across the app — `unit_price` is always what the customer pays; tax is extracted from the price, never added on top. Existing transactions keep their original stored totals (no retroactive rewrite); only new transactions use the new formula.
- Windows-style fixed top toolbar navigation, replacing the side drawer.
- Keyboard-driven line-item table: Up/Down arrow keys move between rows' Quantity fields; adding a product (search, SKU field, or barcode scan) auto-focuses the new row's Quantity input.
- SKU/barcode field that auto-adds the matching product to the cart the instant it's typed or scanned — no Enter or click needed.
- Inline "add customer" dialog from the transaction form — create and select a customer without leaving the document being built.

## Milestone 5 — Transaction Fidelity Improvements

**Changed**

- Confirmed and extended quote → invoice conversion to be an exact replica: all line items (in saved order), quantities, prices, discounts, taxes, subtotal, grand total, and notes are copied — not just the customer.

**Added**

- Transaction **Date** field, defaulting to today; preserved from the quotation when converting to an invoice unless explicitly changed at conversion time.
- **Drag-to-reorder** cart line items (native HTML5 drag events), persisted via a `sort_order` column so print/PDF output always reflects the arranged order.
- Optional **manual Reference** field (PO number, customer reference, etc.), fully independent of the system-generated `reference_quotation_number`; copied over on conversion but stays freely editable afterward.

## Milestone 6 — Global Shortcuts, Faster Cart Entry & Excel Export

**Added**

- Electron-aware global keyboard shortcuts (Ctrl/Shift + digit), intercepted in the main process via `before-input-event` so they fire regardless of which field has focus and can't be swallowed by a component.
- Configurable shortcut mapping UI in Settings — each action's combo can be reassigned, with duplicate-combo validation, a Reset to Defaults option, and instant apply (pushed live to the main process, no restart needed).
- Visual row-selection checkbox in the cart table (in addition to the existing highlight), doubling as the target for "remove active row" and other row-scoped shortcuts.
- Row index numbers in the product search dropdown (`1. Widget A (M45.00)`) for faster keyboard-driven picking.
- **Enter key saves the current transaction** — context-aware: backs off inside a textarea (Notes) or while any dialog/dropdown is open, so it never fights with their own Enter behavior.
- Products page: **Export to Excel** — exports all currently-loaded products by default, or just the checked rows if any are selected (via SheetJS `xlsx`).

## Also present in the current codebase (evolved independently between sessions)

These exist in the repo as of the last clone but weren't built in the sessions covered above — noting them here for a complete picture rather than describing internals I haven't verified line-by-line:

- Purchase Orders as a third transaction type alongside quotations/invoices (`purchase_order_prefix`, `next_purchase_order_seq` settings, `purchase_order` type/status).
- A Business Letters module (`LetterPage.vue`, `services/letter-templates.js`, `services/print-templates/letter.js`).
- A Help page.
- Company stamp upload (`services/print-templates/stamp.js`, separate from the logo).
- Printer selection and silent printing (`default_printer`, `silent_printing` settings, `appBridge.getPrinters`).
- Print font size/weight controls (`print_font_size`, `print_font_weight`).
- Theme mode setting (`theme_mode`).
- A floating/draggable, resizable window chrome in `MainLayout.vue` beyond the toolbar itself.
