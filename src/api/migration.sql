CREATE TABLE users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(191) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY users_email_unique (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE api_tokens (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    token_hash CHAR(64) NOT NULL,
    expires_at TIMESTAMP NULL DEFAULT NULL,
    revoked_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY api_tokens_hash_unique (token_hash),
    KEY api_tokens_user_index (user_id),
    CONSTRAINT api_tokens_user_foreign FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE categories (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(191) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY categories_name_unique (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE taxes (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(191) NOT NULL,
    rate DECIMAL(10,2) NOT NULL DEFAULT 0,
    is_default TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE products (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(191) NOT NULL,
    sku VARCHAR(191) NULL,
    barcode VARCHAR(191) NULL,
    cost_price DECIMAL(15,2) NOT NULL DEFAULT 0,
    selling_price DECIMAL(15,2) NOT NULL DEFAULT 0,
    stock_qty DECIMAL(15,3) NOT NULL DEFAULT 0,
    reorder_level DECIMAL(15,3) NOT NULL DEFAULT 0,
    category_id BIGINT UNSIGNED NULL,
    tax_id BIGINT UNSIGNED NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY products_sku_unique (sku),
    UNIQUE KEY products_barcode_unique (barcode),
    KEY products_name_index (name),
    KEY products_category_index (category_id),
    CONSTRAINT products_category_foreign FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE SET NULL,
    CONSTRAINT products_tax_foreign FOREIGN KEY (tax_id) REFERENCES taxes (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE customers (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(191) NOT NULL,
    email VARCHAR(191) NULL,
    phone VARCHAR(80) NULL,
    address TEXT NULL,
    tax_number VARCHAR(191) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY customers_name_index (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE transactions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    number VARCHAR(191) NOT NULL,
    type ENUM('quote','invoice','purchase_order') NOT NULL,
    status ENUM('draft','quote','converted','invoice','purchase_order','paid','void') NOT NULL DEFAULT 'draft',
    customer_id BIGINT UNSIGNED NULL,
    reference_quotation_id BIGINT UNSIGNED NULL,
    reference_quotation_number VARCHAR(191) NULL,
    manual_reference VARCHAR(191) NULL,
    subtotal DECIMAL(15,2) NULL,
    discount_total DECIMAL(15,2) NOT NULL DEFAULT 0,
    tax_total DECIMAL(15,2) NULL,
    grand_total DECIMAL(15,2) NULL,
    notes TEXT NULL,
    issued_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY transactions_number_unique (number),
    KEY transactions_type_status_index (type, status),
    KEY transactions_customer_index (customer_id),
    CONSTRAINT transactions_customer_foreign FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE SET NULL,
    CONSTRAINT transactions_quote_foreign FOREIGN KEY (reference_quotation_id) REFERENCES transactions (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE transaction_items (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    transaction_id BIGINT UNSIGNED NOT NULL,
    product_id BIGINT UNSIGNED NULL,
    name VARCHAR(191) NOT NULL,
    quantity DECIMAL(15,3) NOT NULL DEFAULT 1,
    unit_price DECIMAL(15,2) NULL,
    discount_pct DECIMAL(10,2) NULL,
    tax_rate DECIMAL(10,2) NULL,
    line_total DECIMAL(15,2) NULL,
    box_size DECIMAL(15,3) NULL,
    box_count DECIMAL(15,3) NULL,
    PRIMARY KEY (id),
    KEY transaction_items_transaction_index (transaction_id),
    CONSTRAINT transaction_items_transaction_foreign FOREIGN KEY (transaction_id) REFERENCES transactions (id) ON DELETE CASCADE,
    CONSTRAINT transaction_items_product_foreign FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE stock_movements (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    product_id BIGINT UNSIGNED NOT NULL,
    type ENUM('in','out','adjustment') NOT NULL,
    quantity DECIMAL(15,3) NOT NULL,
    reason VARCHAR(255) NULL,
    reference_type VARCHAR(80) NULL,
    reference_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY stock_movements_product_index (product_id),
    CONSTRAINT stock_movements_product_foreign FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE settings (
    `key` VARCHAR(191) NOT NULL,
    value TEXT NULL,
    PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sync_changes (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    sync_id CHAR(36) NOT NULL,
    repository VARCHAR(80) NOT NULL,
    method VARCHAR(80) NOT NULL,
    payload JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY sync_changes_sync_id_unique (sync_id),
    KEY sync_changes_user_index (user_id),
    CONSTRAINT sync_changes_user_foreign FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO settings (`key`, value) VALUES
    ('company_name', 'My Company'), ('company_address', ''), ('company_phone', ''),
    ('company_email', ''), ('company_website', ''), ('company_vat', ''),
    ('company_logo', ''), ('company_stamp', ''), ('currency_symbol', 'M'),
    ('print_template', 'classic'), ('quote_prefix', 'QUO-'), ('invoice_prefix', 'INV-'),
    ('purchase_order_prefix', 'PO-'), ('next_quote_seq', '1'), ('next_invoice_seq', '1'),
    ('next_purchase_order_seq', '1'), ('footer_note', 'Thank you for your business!'),
    ('payment_details', ''), ('mobile_money_details', ''), ('default_tax_rate', '0'),
    ('default_printer', ''), ('silent_printing', 'false'), ('theme_mode', 'system'),
    ('print_font_size', '12'), ('print_font_weight', '400'), ('keyboard_shortcuts', '{}')
ON DUPLICATE KEY UPDATE value = VALUES(value);
