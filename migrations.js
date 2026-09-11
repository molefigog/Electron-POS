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
      `);
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
      `);
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
      `);
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
      `);
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
      `);
    },
  },
  {
    version: 6,
    name: 'purchase_orders_and_nullable_item_amounts',
    up: (db) => {
      const txColumns = new Set(db.prepare(`PRAGMA table_info(transactions)`).all().map((c) => c.name));
      const manualReferenceSelect = txColumns.has('manual_reference') ? 'manual_reference' : 'NULL AS manual_reference';

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
      `);
    },
  },
  {
    version: 7,
    name: 'add_theme_mode_setting',
    up: (db) => {
      db.exec(`
        INSERT OR IGNORE INTO settings (key, value) VALUES ('theme_mode', 'system');
      `);
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
      `);
    },
  },
  {
    version: 9,
    name: 'add_batch_box_fields_to_transaction_items',
    up: (db) => {
      const itemColumns = new Set(db.prepare(`PRAGMA table_info(transaction_items)`).all().map((c) => c.name));

      if (!itemColumns.has('box_size')) {
        db.exec(`ALTER TABLE transaction_items ADD COLUMN box_size REAL`);
      }

      if (!itemColumns.has('box_count')) {
        db.exec(`ALTER TABLE transaction_items ADD COLUMN box_count REAL`);
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
      `);
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
      `);
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
      `);
    },
  },
  {
    version: 13,
    name: 'add_suppliers_and_purchase_order_supplier',
    up: (db) => {
      const transactionColumns = new Set(db.prepare(`PRAGMA table_info(transactions)`).all().map((c) => c.name));
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
      `);
      if (!transactionColumns.has('supplier_id')) {
        db.exec(`ALTER TABLE transactions ADD COLUMN supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL`);
      }
      db.exec(`CREATE INDEX IF NOT EXISTS idx_transactions_supplier ON transactions(supplier_id)`);
    },
  },
];

export function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const applied = new Set(db.prepare('SELECT version FROM migrations').all().map((r) => r.version));

  const run = db.transaction(() => {
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      migration.up(db);
      db.prepare('INSERT INTO migrations (version, name) VALUES (?, ?)').run(migration.version, migration.name);
    }
  });

  run();
}
