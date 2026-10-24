/**
 * Simple version-based migration runner.
 * Each migration is applied once and recorded in the `migrations` table.
 */
const migrations = [
  {
    version: 1,
    name: 'init_schema',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS taxes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          rate REAL NOT NULL DEFAULT 0, -- percentage e.g. 15 = 15%
          is_default INTEGER NOT NULL DEFAULT 0,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS products (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          sku TEXT UNIQUE,
          barcode TEXT UNIQUE,
          cost_price REAL NOT NULL DEFAULT 0,
          selling_price REAL NOT NULL DEFAULT 0,
          stock_qty REAL NOT NULL DEFAULT 0,
          reorder_level REAL NOT NULL DEFAULT 0,
          category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
          tax_id INTEGER REFERENCES taxes(id) ON DELETE SET NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
        CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);

        CREATE TABLE IF NOT EXISTS customers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT,
          phone TEXT,
          address TEXT,
          tax_number TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);

        -- Stock movements: the audit trail. stock_qty on products is derived/cached
        -- but movements are the source of truth for history.
        CREATE TABLE IF NOT EXISTS stock_movements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          type TEXT NOT NULL CHECK (type IN ('in','out','adjustment')),
          quantity REAL NOT NULL, -- always positive; sign implied by type
          reason TEXT,
          reference_type TEXT, -- e.g. 'invoice', 'manual'
          reference_id INTEGER,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id);

        -- Transactions cover both quotations and invoices via the "type" column.
        -- Converting a quote to an invoice creates a NEW row (audit-friendly)
        -- linked back via reference_quotation_id / reference_quotation_number,
        -- and marks the source quote status = 'converted'.
        CREATE TABLE IF NOT EXISTS transactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          number TEXT NOT NULL UNIQUE,
          type TEXT NOT NULL CHECK (type IN ('quote','invoice')),
          status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','quote','converted','invoice','paid','void')),
          customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
          reference_quotation_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
          reference_quotation_number TEXT,
          subtotal REAL NOT NULL DEFAULT 0,
          discount_total REAL NOT NULL DEFAULT 0,
          tax_total REAL NOT NULL DEFAULT 0,
          grand_total REAL NOT NULL DEFAULT 0,
          notes TEXT,
          issued_at TEXT DEFAULT CURRENT_TIMESTAMP,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_transactions_number ON transactions(number);
        CREATE INDEX IF NOT EXISTS idx_transactions_type_status ON transactions(type, status);
        CREATE INDEX IF NOT EXISTS idx_transactions_customer ON transactions(customer_id);

        CREATE TABLE IF NOT EXISTS transaction_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
          product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
          name TEXT NOT NULL, -- snapshot of product name at time of sale
          quantity REAL NOT NULL DEFAULT 1,
          unit_price REAL NOT NULL DEFAULT 0,
          discount_pct REAL NOT NULL DEFAULT 0,
          tax_rate REAL NOT NULL DEFAULT 0,
          line_total REAL NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_transaction_items_txn ON transaction_items(transaction_id);

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT
        );

        INSERT OR IGNORE INTO settings (key, value) VALUES
          ('company_name', 'My Company'),
          ('company_address', ''),
          ('company_phone', ''),
          ('company_email', ''),
          ('company_website', ''),
          ('currency_symbol', 'M'),
          ('print_template', 'classic'),
          ('quote_prefix', 'QUO-'),
          ('invoice_prefix', 'INV-'),
          ('next_quote_seq', '1'),
          ('next_invoice_seq', '1'),
          ('footer_note', 'Thank you for your business!'),
          ('payment_details', '');
      `)
    },
  },
  {
    version: 2,
    name: 'add_letterhead_footer_settings',
    up: (db) => {
      db.exec(`
        INSERT OR IGNORE INTO settings (key, value) VALUES
          ('company_website', ''),
          ('footer_note', 'Thank you for your business!'),
          ('payment_details', '');
      `)
    },
  },
  {
    version: 3,
    name: 'add_vat_and_mobile_money_settings',
    up: (db) => {
      db.exec(`
        INSERT OR IGNORE INTO settings (key, value) VALUES
          ('company_vat', ''),
          ('mobile_money_details', '');
      `)
    },
  },
  {
    version: 4,
    name: 'add_global_tax_rate',
    up: (db) => {
      // Safe default: 0%. Existing products/transactions are untouched -
      // their stored tax_id / historical totals stay exactly as they were
      // (financial records shouldn't be silently rewritten). This setting
      // only affects the fallback tax rate applied to NEW line items for
      // products that don't have their own tax assigned. See
      // TransactionForm.vue's addLineItem fallback and repositories.js's
      // tax-inclusive _computeTotals for where it's actually used.
      db.exec(`
        INSERT OR IGNORE INTO settings (key, value) VALUES ('default_tax_rate', '0');
      `)
    },
  },
  {
    version: 5,
    name: 'add_company_logo',
    up: (db) => {
      // Stored as a base64 data URL. SQLite has no practical row-size limit
      // for TEXT, so this is fine for a single small logo image; if you
      // later want multiple images or larger assets, move to files on disk
      // and store just the path instead.
      db.exec(`
        INSERT OR IGNORE INTO settings (key, value) VALUES ('company_logo', '');
      `)
    },
  },
  {
    version: 6,
    name: 'purchase_orders_and_nullable_item_amounts',
    up: (db) => {
      const txColumns = new Set(
        db
          .prepare(`PRAGMA table_info(transactions)`)
          .all()
          .map((c) => c.name),
      )
      const manualReferenceSelect = txColumns.has('manual_reference')
        ? 'manual_reference'
        : 'NULL AS manual_reference'

      db.exec(`
        INSERT OR IGNORE INTO settings (key, value) VALUES
          ('purchase_order_prefix', 'PO-'),
          ('next_purchase_order_seq', '1');

        PRAGMA foreign_keys = OFF;

        CREATE TABLE IF NOT EXISTS transactions_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          number TEXT NOT NULL UNIQUE,
          type TEXT NOT NULL CHECK (type IN ('quote','invoice','purchase_order')),
          status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','quote','converted','invoice','purchase_order','paid','void')),
          customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
          reference_quotation_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
          reference_quotation_number TEXT,
          manual_reference TEXT,
          subtotal REAL DEFAULT NULL,
          discount_total REAL NOT NULL DEFAULT 0,
          tax_total REAL DEFAULT NULL,
          grand_total REAL DEFAULT NULL,
          notes TEXT,
          issued_at TEXT DEFAULT CURRENT_TIMESTAMP,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        INSERT INTO transactions_new (
          id, number, type, status, customer_id, reference_quotation_id, reference_quotation_number,
          manual_reference, subtotal, discount_total, tax_total, grand_total, notes, issued_at, created_at, updated_at
        )
        SELECT
          id, number, type, status, customer_id, reference_quotation_id, reference_quotation_number,
          ${manualReferenceSelect}, subtotal, discount_total, tax_total, grand_total, notes, issued_at, created_at, updated_at
        FROM transactions;

        DROP TABLE transactions;
        ALTER TABLE transactions_new RENAME TO transactions;

        CREATE INDEX IF NOT EXISTS idx_transactions_number ON transactions(number);
        CREATE INDEX IF NOT EXISTS idx_transactions_type_status ON transactions(type, status);
        CREATE INDEX IF NOT EXISTS idx_transactions_customer ON transactions(customer_id);

        CREATE TABLE IF NOT EXISTS transaction_items_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
          product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
          name TEXT NOT NULL,
          quantity REAL NOT NULL DEFAULT 1,
          unit_price REAL,
          discount_pct REAL,
          tax_rate REAL,
          line_total REAL
        );

        INSERT INTO transaction_items_new (
          id, transaction_id, product_id, name, quantity, unit_price, discount_pct, tax_rate, line_total
        )
        SELECT
          id, transaction_id, product_id, name, quantity, unit_price, discount_pct, tax_rate, line_total
        FROM transaction_items;

        DROP TABLE transaction_items;
        ALTER TABLE transaction_items_new RENAME TO transaction_items;

        CREATE INDEX IF NOT EXISTS idx_transaction_items_txn ON transaction_items(transaction_id);

        PRAGMA foreign_keys = ON;
      `)
    },
  },
  {
    version: 7,
    name: 'add_theme_mode_setting',
    up: (db) => {
      db.exec(`
        INSERT OR IGNORE INTO settings (key, value) VALUES ('theme_mode', 'system');
      `)
    },
  },
  {
    version: 8,
    name: 'add_printing_settings',
    up: (db) => {
      db.exec(`
        INSERT OR IGNORE INTO settings (key, value) VALUES
          ('default_printer', ''),
          ('silent_printing', 'false');
      `)
    },
  },
  {
    version: 9,
    name: 'add_batch_box_fields_to_transaction_items',
    up: (db) => {
      const itemColumns = new Set(
        db
          .prepare(`PRAGMA table_info(transaction_items)`)
          .all()
          .map((c) => c.name),
      )

      if (!itemColumns.has('box_size')) {
        db.exec(`ALTER TABLE transaction_items ADD COLUMN box_size REAL`)
      }

      if (!itemColumns.has('box_count')) {
        db.exec(`ALTER TABLE transaction_items ADD COLUMN box_count REAL`)
      }
    },
  },
  {
    version: 10,
    name: 'add_print_typography_settings',
    up: (db) => {
      db.exec(`
        INSERT OR IGNORE INTO settings (key, value) VALUES
          ('print_font_size', '12'),
          ('print_font_weight', '400');
      `)
    },
  },
  {
    version: 11,
    name: 'add_keyboard_shortcuts_setting',
    up: (db) => {
      // Stored as a JSON string: { "<combo>": "<actionId>", ... }, e.g.
      // { "shift+1": "save_quote", "ctrl+1": "new_transaction" }. Combo keys
      // are what the main process's before-input-event handler looks up on
      // every keystroke, so this needs to already be in "combo -> action"
      // shape, not "action -> combo" (see src/constants/shortcuts.js for the
      // default set and the UI-friendly action list).
      db.exec(`
        INSERT OR IGNORE INTO settings (key, value) VALUES ('keyboard_shortcuts', '{}');
      `)
    },
  },
  {
    version: 12,
    name: 'add_local_sync_metadata',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sync_queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sync_id TEXT NOT NULL UNIQUE,
          repository TEXT NOT NULL,
          method TEXT NOT NULL,
          args TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','synced','conflict')),
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          synced_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status, id);
        CREATE TABLE IF NOT EXISTS sync_state (
          key TEXT PRIMARY KEY,
          value TEXT
        );
        INSERT OR IGNORE INTO sync_state (key, value) VALUES ('cursor', '');
      `)
    },
  },
  {
    version: 13,
    name: 'add_suppliers_and_purchase_order_supplier',
    up: (db) => {
      const transactionColumns = new Set(
        db
          .prepare(`PRAGMA table_info(transactions)`)
          .all()
          .map((c) => c.name),
      )
      db.exec(`
        CREATE TABLE IF NOT EXISTS suppliers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          phone TEXT,
          email TEXT,
          address TEXT,
          tax_number TEXT,
          payment_terms TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(name);
      `)
      if (!transactionColumns.has('supplier_id')) {
        db.exec(
          `ALTER TABLE transactions ADD COLUMN supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL`,
        )
      }
      db.exec(`CREATE INDEX IF NOT EXISTS idx_transactions_supplier ON transactions(supplier_id)`)
    },
  },
  {
    version: 14,
    name: 'add_company_ibr_setting',
    up: (db) => {
      db.exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('company_ibr', '')`)
    },
  },
  {
    version: 15,
    name: 'add_amount_tendered_to_transactions',
    up: (db) => {
      // POS cash sales: the cash handed over by the customer. NULL for every
      // other document. Change is never stored - it is amount_tendered - grand_total.
      const columns = new Set(
        db
          .prepare(`PRAGMA table_info(transactions)`)
          .all()
          .map((c) => c.name),
      )
      if (!columns.has('amount_tendered')) {
        db.exec(`ALTER TABLE transactions ADD COLUMN amount_tendered REAL`)
      }
    },
  },
  {
    version: 16,
    name: 'add_transaction_payments',
    up: (db) => {
      // How a POS sale was paid. One row per payment method used, so a sale can
      // be split (e.g. SpeedPoint + cash). `amount` is what the customer handed
      // over by that method; the change is taken out of the cash part.
      db.exec(`
        CREATE TABLE IF NOT EXISTS transaction_payments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
          method TEXT NOT NULL CHECK (method IN ('cash','speedpoint','eft','ecocash','mpesa','cheque')),
          amount REAL NOT NULL CHECK (amount >= 0)
        );
        CREATE INDEX IF NOT EXISTS idx_transaction_payments_tx ON transaction_payments(transaction_id);
      `)
      // POS sales made before this migration were all cash.
      db.exec(`
        INSERT INTO transaction_payments (transaction_id, method, amount)
        SELECT id, 'cash', amount_tendered FROM transactions
        WHERE type = 'invoice' AND amount_tendered IS NOT NULL
          AND id NOT IN (SELECT transaction_id FROM transaction_payments)
      `)
    },
  },
  {
    version: 17,
    name: 'add_accounting',
    up: (db) => {
      // Double-entry books. Everything here is ADDITIVE: no existing sales,
      // payment or stock row is rewritten. Journal entries for sales are
      // derived from `transactions` by AccountingRepository.postTransaction().
      db.exec(`
        CREATE TABLE IF NOT EXISTS accounts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          code TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          type TEXT NOT NULL CHECK (type IN ('asset','liability','equity','income','expense')),
          system_key TEXT UNIQUE, -- lets the posting engine find 'cash', 'ar', 'sales', ... by role, not by code
          is_system INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS journal_entries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          entry_date TEXT NOT NULL, -- YYYY-MM-DD
          memo TEXT,
          source_type TEXT NOT NULL CHECK (source_type IN ('invoice','customer_payment','expense','bill','bill_payment','manual','opening_stock')),
          source_id INTEGER,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(entry_date);
        CREATE INDEX IF NOT EXISTS idx_journal_entries_source ON journal_entries(source_type, source_id);

        CREATE TABLE IF NOT EXISTS journal_lines (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
          account_id INTEGER NOT NULL REFERENCES accounts(id),
          debit REAL NOT NULL DEFAULT 0,
          credit REAL NOT NULL DEFAULT 0,
          memo TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON journal_lines(entry_id);
        CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(account_id);

        -- Money received against a (non-POS) invoice. POS sales are paid in full
        -- at the till and keep using transaction_payments.
        CREATE TABLE IF NOT EXISTS customer_payments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
          customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
          method TEXT NOT NULL CHECK (method IN ('cash','speedpoint','eft','ecocash','mpesa','cheque')),
          amount REAL NOT NULL CHECK (amount > 0),
          paid_at TEXT NOT NULL, -- YYYY-MM-DD
          reference TEXT,
          notes TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_customer_payments_tx ON customer_payments(transaction_id);

        CREATE TABLE IF NOT EXISTS expenses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          expense_date TEXT NOT NULL,
          account_id INTEGER NOT NULL REFERENCES accounts(id),
          supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
          payee TEXT,
          description TEXT,
          amount REAL NOT NULL CHECK (amount > 0), -- what was paid, VAT included
          tax_amount REAL NOT NULL DEFAULT 0,      -- recoverable input VAT inside amount
          method TEXT NOT NULL CHECK (method IN ('cash','speedpoint','eft','ecocash','mpesa','cheque')),
          reference TEXT,
          notes TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);

        CREATE TABLE IF NOT EXISTS supplier_bills (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          bill_number TEXT,
          supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
          purchase_order_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
          bill_date TEXT NOT NULL,
          due_date TEXT,
          account_id INTEGER NOT NULL REFERENCES accounts(id), -- what the bill is for (Inventory, an expense, ...)
          subtotal REAL NOT NULL DEFAULT 0,   -- excluding VAT
          tax_amount REAL NOT NULL DEFAULT 0,
          total REAL NOT NULL CHECK (total > 0),
          status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid')),
          notes TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_supplier_bills_supplier ON supplier_bills(supplier_id);

        CREATE TABLE IF NOT EXISTS bill_payments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          bill_id INTEGER NOT NULL REFERENCES supplier_bills(id) ON DELETE CASCADE,
          method TEXT NOT NULL CHECK (method IN ('cash','speedpoint','eft','ecocash','mpesa','cheque')),
          amount REAL NOT NULL CHECK (amount > 0),
          paid_at TEXT NOT NULL,
          reference TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_bill_payments_bill ON bill_payments(bill_id);
      `)

      // Cost snapshot: what the product cost when it was sold, so profit does
      // not change when cost_price is edited later.
      const itemColumns = new Set(
        db.prepare(`PRAGMA table_info(transaction_items)`).all().map((c) => c.name),
      )
      if (!itemColumns.has('unit_cost')) {
        db.exec(`ALTER TABLE transaction_items ADD COLUMN unit_cost REAL`)
      }
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_transaction_items_unit_cost
        AFTER INSERT ON transaction_items
        WHEN NEW.unit_cost IS NULL AND NEW.product_id IS NOT NULL
        BEGIN
          UPDATE transaction_items
          SET unit_cost = (SELECT cost_price FROM products WHERE id = NEW.product_id)
          WHERE id = NEW.id;
        END;
      `)
      // History: the best available figure is the product's current cost.
      db.exec(`
        UPDATE transaction_items
        SET unit_cost = (SELECT cost_price FROM products p WHERE p.id = transaction_items.product_id)
        WHERE unit_cost IS NULL AND product_id IS NOT NULL
      `)

      const seed = db.prepare(
        `INSERT OR IGNORE INTO accounts (code, name, type, system_key, is_system) VALUES (?, ?, ?, ?, ?)`,
      )
      const chart = [
        ['1000', 'Cash on Hand', 'asset', 'cash'],
        ['1010', 'Bank Account', 'asset', 'bank'],
        ['1020', 'Mobile Money', 'asset', 'mobile_money'],
        ['1100', 'Accounts Receivable', 'asset', 'ar'],
        ['1200', 'Inventory', 'asset', 'inventory'],
        ['1300', 'VAT Input (Recoverable)', 'asset', 'vat_input'],
        ['2000', 'Accounts Payable', 'liability', 'ap'],
        ['2100', 'VAT Output (Payable)', 'liability', 'vat_output'],
        ['3000', "Owner's Equity", 'equity', 'equity'],
        ['3100', 'Opening Balance Equity', 'equity', 'opening_equity'],
        ['4000', 'Sales Revenue', 'income', 'sales'],
        ['4100', 'Other Income', 'income', 'other_income'],
        ['5000', 'Cost of Goods Sold', 'expense', 'cogs'],
        ['6000', 'Rent', 'expense', null],
        ['6010', 'Salaries & Wages', 'expense', null],
        ['6020', 'Utilities (Electricity, Water, Phone)', 'expense', null],
        ['6030', 'Transport & Fuel', 'expense', null],
        ['6040', 'Marketing & Advertising', 'expense', null],
        ['6050', 'Repairs & Maintenance', 'expense', null],
        ['6060', 'Bank & Card Charges', 'expense', null],
        ['6070', 'Office & Stationery', 'expense', null],
        ['6900', 'General Expenses', 'expense', 'expenses_general'],
      ]
      for (const [code, name, type, key] of chart) seed.run(code, name, type, key, key ? 1 : 0)

      db.exec(`
        INSERT OR IGNORE INTO settings (key, value) VALUES
          ('accounting_lock_date', ''),
          ('accounting_backfilled', '0');
      `)
    },
  },
]

export function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `)

  const applied = new Set(
    db
      .prepare('SELECT version FROM migrations')
      .all()
      .map((r) => r.version),
  )

  const run = db.transaction(() => {
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue
      migration.up(db)
      db.prepare('INSERT INTO migrations (version, name) VALUES (?, ?)').run(
        migration.version,
        migration.name,
      )
    }
  })

  run()
}
