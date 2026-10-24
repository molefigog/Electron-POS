/**
 * Repository pattern, main-process side. Each repository owns its table(s)
 * and exposes plain methods (no raw SQL leaks to the renderer/IPC layer).
 * Renderer calls these via ipc-handlers.js's whitelist -> dbBridge.call(...)
 */

export class ProductRepository {
  constructor(db) {
    this.db = db
  }

  all({ search = '', categoryId = null } = {}) {
    let sql = `SELECT p.*, c.name as category_name, t.rate as tax_rate
               FROM products p
               LEFT JOIN categories c ON c.id = p.category_id
               LEFT JOIN taxes t ON t.id = p.tax_id
               WHERE p.is_active = 1`
    const params = []
    if (search) {
      sql += ` AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)`
      params.push(`%${search}%`, `%${search}%`, `%${search}%`)
    }
    if (categoryId) {
      sql += ` AND p.category_id = ?`
      params.push(categoryId)
    }
    sql += ` ORDER BY p.name ASC`
    return this.db.prepare(sql).all(...params)
  }

  find(id) {
    return this.db.prepare(`SELECT * FROM products WHERE id = ?`).get(id)
  }

  findByBarcode(barcode) {
    return this.db
      .prepare(`SELECT * FROM products WHERE barcode = ? AND is_active = 1`)
      .get(barcode)
  }
  findBySku(sku) {
    return this.db.prepare(`SELECT * FROM products WHERE sku = ? AND is_active = 1`).get(sku)
  }

  /**
   * Like findByBarcode/findBySku but ALSO returns soft-deleted rows. Deleting a
   * product only sets is_active = 0, so its barcode/sku stay reserved by the
   * UNIQUE indexes. CSV import uses this to find (and revive) those rows
   * instead of blindly inserting and hitting "UNIQUE constraint failed".
   */
  findAnyByBarcode(barcode) {
    return this.db.prepare(`SELECT * FROM products WHERE barcode = ? LIMIT 1`).get(barcode)
  }
  findAnyBySku(sku) {
    return this.db.prepare(`SELECT * FROM products WHERE sku = ? LIMIT 1`).get(sku)
  }

  /** '' / whitespace -> null. Two products with barcode '' would collide on the UNIQUE index. */
  _clean(data) {
    const blankToNull = (v) => {
      if (v === undefined || v === null) return null
      const s = String(v).trim()
      return s === '' ? null : s
    }
    return { ...data, sku: blankToNull(data.sku), barcode: blankToNull(data.barcode) }
  }

  /** Friendly duplicate check for ACTIVE products (excludes `exceptId`). */
  _assertUnique(data, exceptId = null) {
    for (const [column, label] of [['barcode', 'Barcode'], ['sku', 'SKU']]) {
      if (!data[column]) continue
      const clash = this.db
        .prepare(`SELECT id, name FROM products WHERE ${column} = ? AND is_active = 1 AND id IS NOT ?`)
        .get(data[column], exceptId)
      if (clash) throw new Error(`${label} "${data[column]}" is already used by "${clash.name}"`)
    }
  }

  create(input) {
    const data = this._clean(input)
    this._assertUnique(data)

    // A soft-deleted product may still own this barcode/sku - revive it
    // (with the new data) rather than violating the UNIQUE index.
    const revivable =
      (data.barcode && this.findAnyByBarcode(data.barcode)) ||
      (data.sku && this.findAnyBySku(data.sku)) ||
      null
    if (revivable && !revivable.is_active) {
      this.db
        .prepare(
          `UPDATE products SET
             name=@name, sku=@sku, barcode=@barcode, cost_price=@cost_price, selling_price=@selling_price,
             reorder_level=@reorder_level, category_id=@category_id, tax_id=@tax_id,
             is_active = 1, updated_at = CURRENT_TIMESTAMP
           WHERE id=@id`,
        )
        .run({
          category_id: null,
          tax_id: null,
          cost_price: 0,
          reorder_level: 0,
          ...data,
          id: revivable.id,
        })
      return this.find(revivable.id)
    }

    const stmt = this.db.prepare(`
      INSERT INTO products (name, sku, barcode, cost_price, selling_price, stock_qty, reorder_level, category_id, tax_id)
      VALUES (@name, @sku, @barcode, @cost_price, @selling_price, @stock_qty, @reorder_level, @category_id, @tax_id)
    `)
    const info = stmt.run({
      reorder_level: 0,
      stock_qty: 0,
      cost_price: 0,
      category_id: null,
      tax_id: null,
      ...data,
    })
    return this.find(info.lastInsertRowid)
  }

  update(id, input) {
    const data = this._clean(input)
    this._assertUnique(data, id)
    const stmt = this.db.prepare(`
      UPDATE products SET
        name = @name, sku = @sku, barcode = @barcode,
        cost_price = @cost_price, selling_price = @selling_price,
        reorder_level = @reorder_level, category_id = @category_id, tax_id = @tax_id,
        is_active = 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `)
    stmt.run({ category_id: null, tax_id: null, ...data, id })
    return this.find(id)
  }

  delete(id) {
    // soft delete keeps historical transaction_items snapshots intact
    this.db.prepare(`UPDATE products SET is_active = 0 WHERE id = ?`).run(id)
    return { id }
  }

  /** Called only from StockRepository within a transaction - keeps stock_qty in sync */
  _adjustStock(id, delta) {
    this.db
      .prepare(
        `UPDATE products SET stock_qty = stock_qty + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      )
      .run(delta, id)
  }
}

export class CategoryRepository {
  constructor(db) {
    this.db = db
  }
  all() {
    return this.db.prepare(`SELECT * FROM categories ORDER BY name`).all()
  }
  create(name) {
    const info = this.db.prepare(`INSERT INTO categories (name) VALUES (?)`).run(name)
    return { id: info.lastInsertRowid, name }
  }
  delete(id) {
    this.db.prepare(`DELETE FROM categories WHERE id = ?`).run(id)
    return { id }
  }
}

export class TaxRepository {
  constructor(db) {
    this.db = db
  }
  all() {
    return this.db.prepare(`SELECT * FROM taxes ORDER BY name`).all()
  }
  create(data) {
    const info = this.db
      .prepare(`INSERT INTO taxes (name, rate, is_default) VALUES (@name, @rate, @is_default)`)
      .run({ is_default: 0, ...data })
    return { id: info.lastInsertRowid, ...data }
  }
  delete(id) {
    this.db.prepare(`DELETE FROM taxes WHERE id = ?`).run(id)
    return { id }
  }
}

export class CustomerRepository {
  constructor(db) {
    this.db = db
  }

  all({ search = '' } = {}) {
    let sql = `SELECT * FROM customers`
    const params = []
    if (search) {
      sql += ` WHERE name LIKE ? OR phone LIKE ? OR email LIKE ?`
      params.push(`%${search}%`, `%${search}%`, `%${search}%`)
    }
    sql += ` ORDER BY name ASC`
    return this.db.prepare(sql).all(...params)
  }

  find(id) {
    return this.db.prepare(`SELECT * FROM customers WHERE id = ?`).get(id)
  }

  create(data) {
    const stmt = this.db.prepare(`
      INSERT INTO customers (name, email, phone, address, tax_number)
      VALUES (@name, @email, @phone, @address, @tax_number)
    `)
    const info = stmt.run({ email: null, phone: null, address: null, tax_number: null, ...data })
    return this.find(info.lastInsertRowid)
  }

  update(id, data) {
    this.db
      .prepare(
        `
      UPDATE customers SET name=@name, email=@email, phone=@phone, address=@address, tax_number=@tax_number,
      updated_at = CURRENT_TIMESTAMP WHERE id=@id
    `,
      )
      .run({ id, ...data })
    return this.find(id)
  }

  delete(id) {
    this.db.prepare(`DELETE FROM customers WHERE id = ?`).run(id)
    return { id }
  }
}

export class SupplierRepository {
  constructor(db) {
    this.db = db
  }

  all({ search = '' } = {}) {
    let sql = `SELECT * FROM suppliers`
    const params = []
    if (search) {
      sql += ` WHERE name LIKE ? OR phone LIKE ? OR email LIKE ?`
      params.push(`%${search}%`, `%${search}%`, `%${search}%`)
    }
    sql += ` ORDER BY name ASC`
    return this.db.prepare(sql).all(...params)
  }

  find(id) {
    return this.db.prepare(`SELECT * FROM suppliers WHERE id = ?`).get(id)
  }

  create(data) {
    const info = this.db
      .prepare(
        `
      INSERT INTO suppliers (name, phone, email, address, tax_number, payment_terms)
      VALUES (@name, @phone, @email, @address, @tax_number, @payment_terms)
    `,
      )
      .run({
        phone: null,
        email: null,
        address: null,
        tax_number: null,
        payment_terms: null,
        ...data,
      })
    return this.find(info.lastInsertRowid)
  }

  update(id, data) {
    this.db
      .prepare(
        `
      UPDATE suppliers SET name=@name, phone=@phone, email=@email, address=@address,
      tax_number=@tax_number, payment_terms=@payment_terms, updated_at=CURRENT_TIMESTAMP WHERE id=@id
    `,
      )
      .run({ id, ...data })
    return this.find(id)
  }

  delete(id) {
    this.db.prepare(`DELETE FROM suppliers WHERE id = ?`).run(id)
    return { id }
  }
}

export class StockRepository {
  constructor(db) {
    this.db = db
  }

  history(productId) {
    return this.db
      .prepare(`SELECT * FROM stock_movements WHERE product_id = ? ORDER BY created_at DESC`)
      .all(productId)
  }

  summary({ from, to } = {}) {
    const products = this.db
      .prepare(
        `
      SELECT id, stock_qty, cost_price, selling_price
      FROM products
      WHERE is_active = 1
    `,
      )
      .all()
    const movements = this.db
      .prepare(
        `
      SELECT product_id, type, quantity
      FROM stock_movements
      WHERE created_at >= ? AND created_at <= ?
    `,
      )
      .all(from, to || new Date().toISOString())
    const byProduct = new Map()
    for (const movement of movements) {
      const quantity = Number(movement.quantity) || 0
      const delta = movement.type === 'out' ? -quantity : quantity
      const current = byProduct.get(movement.product_id) || { delta: 0, in: 0, out: 0 }
      current.delta += delta
      if (movement.type === 'in') current.in += quantity
      if (movement.type === 'out') current.out += quantity
      byProduct.set(movement.product_id, current)
    }

    return products.reduce(
      (summary, product) => {
        const movement = byProduct.get(product.id) || { delta: 0, in: 0, out: 0 }
        const closingQty = Number(product.stock_qty) || 0
        const openingQty = closingQty - movement.delta
        const cost = Number(product.cost_price) || 0
        const retail = Number(product.selling_price) || 0
        summary.openingQty += openingQty
        summary.closingQty += closingQty
        summary.stockInQty += movement.in
        summary.stockOutQty += movement.out
        summary.openingCostValue += openingQty * cost
        summary.closingCostValue += closingQty * cost
        summary.closingRetailValue += closingQty * retail
        return summary
      },
      {
        openingQty: 0,
        closingQty: 0,
        stockInQty: 0,
        stockOutQty: 0,
        openingCostValue: 0,
        closingCostValue: 0,
        closingRetailValue: 0,
      },
    )
  }

  /**
   * Records a movement AND keeps products.stock_qty in sync, atomically.
   * type: 'in' | 'out' | 'adjustment'. For 'adjustment', `quantity` is the
   * signed delta (can be negative); for 'in'/'out' it's always positive.
   */
  record({
    productId,
    type,
    quantity,
    reason = null,
    referenceType = 'manual',
    referenceId = null,
  }) {
    const productRepo = new ProductRepository(this.db)
    const run = this.db.transaction(() => {
      const delta =
        type === 'out' ? -Math.abs(quantity) : type === 'in' ? Math.abs(quantity) : quantity
      this.db
        .prepare(
          `
        INSERT INTO stock_movements (product_id, type, quantity, reason, reference_type, reference_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
        )
        .run(productId, type, Math.abs(quantity), reason, referenceType, referenceId)
      productRepo._adjustStock(productId, delta)
      return productRepo.find(productId)
    })
    return run()
  }
}

export class SettingsRepository {
  constructor(db) {
    this.db = db
  }

  all() {
    const rows = this.db.prepare(`SELECT key, value FROM settings`).all()
    return Object.fromEntries(rows.map((r) => [r.key, r.value]))
  }

  update(values) {
    const stmt = this.db.prepare(`INSERT INTO settings (key, value) VALUES (@key, @value)
      ON CONFLICT(key) DO UPDATE SET value = @value`)
    const run = this.db.transaction((vals) => {
      for (const [key, value] of Object.entries(vals)) stmt.run({ key, value: String(value) })
    })
    run(values)
    return this.all()
  }

  get(key, fallback = null) {
    const row = this.db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key)
    return row ? row.value : fallback
  }

  set(key, value) {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = ?`,
      )
      .run(key, String(value), String(value))
  }
}

/** Payment methods a POS sale can be paid with, in the order they print on reports. */
import { AccountingRepository } from './accounting-repository.js'

const PAYMENT_METHODS = ['cash', 'speedpoint', 'eft', 'ecocash', 'mpesa', 'cheque']

export class TransactionRepository {
  constructor(db) {
    this.db = db
  }

  _nextNumber(type) {
    const settingsRepo = new SettingsRepository(this.db)
    const prefixKey =
      type === 'quote'
        ? 'quote_prefix'
        : type === 'purchase_order'
          ? 'purchase_order_prefix'
          : 'invoice_prefix'
    const seqKey =
      type === 'quote'
        ? 'next_quote_seq'
        : type === 'purchase_order'
          ? 'next_purchase_order_seq'
          : 'next_invoice_seq'
    const prefix = settingsRepo.get(
      prefixKey,
      type === 'quote' ? 'QUO-' : type === 'purchase_order' ? 'PO-' : 'INV-',
    )
    const seq = parseInt(settingsRepo.get(seqKey, '1'), 10)
    settingsRepo.set(seqKey, seq + 1)
    return `${prefix}${String(seq).padStart(5, '0')}`
  }

  all({ search = '', type = null, status = null } = {}) {
    let sql = `
      SELECT tx.*, c.name as customer_name, s.name as supplier_name
      FROM transactions tx
      LEFT JOIN customers c ON c.id = tx.customer_id
      LEFT JOIN suppliers s ON s.id = tx.supplier_id
      WHERE 1=1`
    const params = []
    if (search) {
      sql += ` AND (tx.number LIKE ? OR c.name LIKE ? OR tx.reference_quotation_number LIKE ? OR tx.manual_reference LIKE ?)`
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`)
    }
    if (type) {
      sql += ` AND tx.type = ?`
      params.push(type)
    }
    if (status) {
      sql += ` AND tx.status = ?`
      params.push(status)
    }
    sql += ` ORDER BY tx.created_at DESC`
    return this.db.prepare(sql).all(...params)
  }

  find(id) {
    const tx = this.db
      .prepare(
        `
      SELECT tx.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone, c.address as customer_address,
        s.name as supplier_name, s.email as supplier_email, s.phone as supplier_phone, s.address as supplier_address
      FROM transactions tx
      LEFT JOIN customers c ON c.id = tx.customer_id
      LEFT JOIN suppliers s ON s.id = tx.supplier_id
      WHERE tx.id = ?
    `,
      )
      .get(id)
    if (!tx) return null
    tx.items = this.db.prepare(`SELECT * FROM transaction_items WHERE transaction_id = ?`).all(id)
    tx.payments = this.db
      .prepare(`SELECT method, amount FROM transaction_payments WHERE transaction_id = ? ORDER BY id`)
      .all(id)
    return tx
  }

  /**
   * End-of-day sheet: POS sales only (invoices that carry a payment), for one
   * LOCAL calendar day. created_at is stored in UTC, so the day is cut with
   * 'localtime' - a sale at 00:30 belongs to the day on the till's clock.
   * Cash is reported net of change so the method totals add up to the sales
   * total. Voided sales are listed but left out of every total.
   * @param {{ date?: string|null }} opts date = 'YYYY-MM-DD'; defaults to today.
   */
  endOfDay({ date = null } = {}) {
    const day = date && /^\d{4}-\d{2}-\d{2}$/.test(String(date))
      ? String(date)
      : this.db.prepare(`SELECT date('now','localtime') AS d`).get().d

    const rows = this.db
      .prepare(
        `
      SELECT tx.id, tx.number, tx.status, tx.grand_total, tx.amount_tendered, tx.created_at, c.name AS customer_name
      FROM transactions tx
      LEFT JOIN customers c ON c.id = tx.customer_id
      WHERE tx.type = 'invoice' AND tx.amount_tendered IS NOT NULL
        AND date(tx.created_at, 'localtime') = ?
      ORDER BY tx.created_at ASC, tx.id ASC
    `,
      )
      .all(day)

    const paymentsByTx = new Map()
    if (rows.length) {
      const marks = rows.map(() => '?').join(',')
      const payRows = this.db
        .prepare(`SELECT transaction_id, method, amount FROM transaction_payments WHERE transaction_id IN (${marks}) ORDER BY id`)
        .all(...rows.map((r) => r.id))
      for (const p of payRows) {
        if (!paymentsByTx.has(p.transaction_id)) paymentsByTx.set(p.transaction_id, [])
        paymentsByTx.get(p.transaction_id).push({ method: p.method, amount: p.amount })
      }
    }

    const byMethod = Object.fromEntries(PAYMENT_METHODS.map((m) => [m, 0]))
    let grandTotal = 0
    let count = 0
    const sales = rows.map((row) => {
      const total = Number(row.grand_total || 0)
      const change = Math.max(0, Number((Number(row.amount_tendered) - total).toFixed(2)))
      // a sale with no payment rows (should not happen after migration 16) counts as cash
      const raw = paymentsByTx.get(row.id) || [{ method: 'cash', amount: Number(row.amount_tendered) }]
      const payments = raw.map((p) => ({
        method: p.method,
        amount: Number((p.method === 'cash' ? p.amount - change : p.amount).toFixed(2)),
      }))
      const isVoid = row.status === 'void'
      if (!isVoid) {
        grandTotal += total
        count += 1
        for (const p of payments) byMethod[p.method] += p.amount
      }
      return {
        id: row.id,
        number: row.number,
        customer_name: row.customer_name || null,
        grand_total: total,
        status: isVoid ? 'void' : 'paid',
        created_at: row.created_at,
        payments,
      }
    })

    return {
      date: day,
      sales,
      totals: {
        count,
        grandTotal: Number(grandTotal.toFixed(2)),
        byMethod: Object.fromEntries(Object.entries(byMethod).map(([m, v]) => [m, Number(v.toFixed(2))])),
      },
    }
  }

  /**
   * POS sales only. An invoice may carry how it was paid: `payments` is
   * [{ method, amount }] (amount = what the customer handed over by that method).
   * With only `amountTendered` (or nothing ticked) the sale is cash.
   * Rules: no part payments (the sum can never be below the total) and non-cash
   * methods can never exceed the total, because only cash can give change.
   * Returns { tendered, payments } - both empty for every other document.
   */
  _resolvePayments(type, payments, amountTendered, grandTotal) {
    const none = { tendered: null, payments: [] }
    if (type !== 'invoice') return none

    let list = Array.isArray(payments) ? payments : []
    if (!list.length) {
      if (amountTendered === null || amountTendered === undefined || amountTendered === '') return none
      list = [{ method: 'cash', amount: amountTendered }]
    }

    const byMethod = new Map()
    for (const p of list) {
      const method = String(p?.method || 'cash')
      if (!PAYMENT_METHODS.includes(method)) throw new Error(`Unknown payment method: ${method}`)
      const amount = Number(p?.amount)
      if (!Number.isFinite(amount) || amount < 0) throw new Error('A payment amount is not valid')
      if (amount > 0) byMethod.set(method, (byMethod.get(method) || 0) + amount)
    }
    const resolved = PAYMENT_METHODS.filter((m) => byMethod.has(m)).map((m) => ({
      method: m,
      amount: Number(byMethod.get(m).toFixed(2)),
    }))
    if (!resolved.length) return none

    const total = Number(grandTotal || 0)
    const tendered = Number(resolved.reduce((sum, p) => sum + p.amount, 0).toFixed(2))
    if (tendered + 0.005 < total) throw new Error('The amount paid is less than the total')
    const nonCash = tendered - (resolved.find((p) => p.method === 'cash')?.amount || 0)
    if (nonCash > total + 0.005) throw new Error('Card, EFT, mobile money and cheque payments cannot be more than the total')
    return { tendered, payments: resolved }
  }

  _savePayments(txId, payments) {
    this.db.prepare(`DELETE FROM transaction_payments WHERE transaction_id = ?`).run(txId)
    const stmt = this.db.prepare(`INSERT INTO transaction_payments (transaction_id, method, amount) VALUES (?, ?, ?)`)
    for (const p of payments) stmt.run(txId, p.method, p.amount)
  }

  /**
   * TAX-INCLUSIVE pricing: item.unit_price is the price the customer actually
   * pays per unit, tax already baked in - never add tax on top of it. Tax is
   * extracted FROM the price (grossAmount * rate/(100+rate)) rather than
   * calculated on top of it. `subtotal` in the return value is therefore the
   * tax-EXCLUSIVE base (informational, for the receipt breakdown) - the
   * customer-facing total is always grossSubtotal - discountTotal, which
   * equals the sum of the tax-inclusive prices they saw, minus any discount.
   */
  _computeTotals(items, discountTotal = 0, { nullableTotals = false } = {}) {
    let grossSubtotal = 0 // sum of tax-inclusive line totals (after per-line discount)
    let taxTotal = 0
    let hasPricedItems = false
    for (const item of items) {
      const hasPrice =
        item.unit_price !== null && item.unit_price !== '' && !Number.isNaN(Number(item.unit_price))
      if (!hasPrice) {
        item.line_total = null
        continue
      }

      hasPricedItems = true
      const unitPrice = Number(item.unit_price)
      const lineBase = item.quantity * unitPrice // already tax-inclusive
      const lineDiscount = lineBase * ((item.discount_pct || 0) / 100)
      const lineGross = lineBase - lineDiscount // still tax-inclusive
      const rate = item.tax_rate || 0
      const lineTax = rate > 0 ? lineGross - lineGross / (1 + rate / 100) : 0

      item.line_total = Number(lineGross.toFixed(2)) // what the customer pays for this line
      grossSubtotal += lineGross
      taxTotal += lineTax
    }
    if (!hasPricedItems && nullableTotals) {
      return { subtotal: null, taxTotal: null, grandTotal: null }
    }

    const safeDiscount = discountTotal || 0
    const grandTotal = grossSubtotal - safeDiscount // header-level discount comes off the tax-inclusive total
    const netSubtotal = grossSubtotal - taxTotal // tax-exclusive base, shown for the receipt breakdown only

    return {
      subtotal: Number(netSubtotal.toFixed(2)),
      taxTotal: Number(taxTotal.toFixed(2)),
      grandTotal: Number(grandTotal.toFixed(2)),
    }
  }

  /**
   * Creates a quote, invoice, or draft. `type` decides numbering series.
   * `status` defaults to match type ('draft' stays a draft regardless of type
   * until explicitly finalized).
   */
  create({
    type,
    status,
    customerId,
    supplierId = null,
    items,
    discountTotal = 0,
    notes = '',
    issuedAt = null,
    manualReference = null,
    amountTendered = null,
    payments = [],
  }) {
    const run = this.db.transaction(() => {
      const number = this._nextNumber(type)
      const resolvedStatus = status || type
      const { subtotal, taxTotal, grandTotal } = this._computeTotals(items, discountTotal, {
        nullableTotals: type === 'purchase_order',
      })
      const paid = this._resolvePayments(type, payments, amountTendered, grandTotal)

      const info = this.db
        .prepare(
          `
        INSERT INTO transactions (
          number, type, status, customer_id, supplier_id, subtotal, discount_total, tax_total, grand_total, notes, issued_at, manual_reference, amount_tendered
        )
        VALUES (
          @number, @type, @status, @customerId, @supplierId, @subtotal, @discountTotal, @taxTotal, @grandTotal, @notes, @issuedAt, @manualReference, @amountTendered
        )
      `,
        )
        .run({
          number,
          type,
          status: resolvedStatus,
          customerId,
          supplierId: type === 'purchase_order' ? supplierId : null,
          subtotal,
          discountTotal,
          taxTotal,
          grandTotal,
          notes,
          issuedAt: issuedAt || null,
          manualReference: manualReference || null,
          amountTendered: paid.tendered,
        })

      const txId = info.lastInsertRowid
      this._savePayments(txId, paid.payments)
      const itemStmt = this.db.prepare(`
        INSERT INTO transaction_items (transaction_id, product_id, name, quantity, box_size, box_count, unit_price, discount_pct, tax_rate, line_total)
        VALUES (@transaction_id, @product_id, @name, @quantity, @box_size, @box_count, @unit_price, @discount_pct, @tax_rate, @line_total)
      `)
      for (const item of items) {
        itemStmt.run({ transaction_id: txId, ...item })
      }

      // Invoices decrement stock immediately; quotes/drafts do not reserve stock.
      if (type === 'invoice') {
        const stockRepo = new StockRepository(this.db)
        for (const item of items) {
          if (item.product_id) {
            stockRepo.record({
              productId: item.product_id,
              type: 'out',
              quantity: item.quantity,
              reason: `Sold via ${number}`,
              referenceType: 'invoice',
              referenceId: txId,
            })
          }
        }
      }

      // Finalized purchase orders add stock using the already-calculated
      // item.quantity (including any box/batch expansion from UI).
      if (type === 'purchase_order' && resolvedStatus === 'purchase_order') {
        const stockRepo = new StockRepository(this.db)
        for (const item of items) {
          if (item.product_id) {
            stockRepo.record({
              productId: item.product_id,
              type: 'in',
              quantity: item.quantity,
              reason: `Received via ${number}`,
              referenceType: 'purchase_order',
              referenceId: txId,
            })
          }
        }
      }

      // Accounting: turn this invoice into journal entries (no-op for quotes/POs).
      new AccountingRepository(this.db).postTransaction(txId)

      return this.find(txId)
    })
    return run()
  }

  update(
    id,
    {
      type,
      customerId,
      supplierId = null,
      items,
      discountTotal = 0,
      notes = '',
      status,
      issuedAt = null,
      manualReference = null,
      amountTendered = null,
      payments = [],
    },
  ) {
    const run = this.db.transaction(() => {
      const current = this.find(id)
      if (!current) throw new Error('Transaction not found')
      const resolvedType = type || current.type
      const resolvedStatus = status || current.status
      const { subtotal, taxTotal, grandTotal } = this._computeTotals(items, discountTotal, {
        nullableTotals: resolvedType === 'purchase_order',
      })
      const paid = this._resolvePayments(resolvedType, payments, amountTendered, grandTotal)

      this.db
        .prepare(
          `
        UPDATE transactions SET
        type=@type, customer_id=@customerId, supplier_id=@supplierId, subtotal=@subtotal, discount_total=@discountTotal,
        tax_total=@taxTotal, grand_total=@grandTotal, notes=@notes, status=COALESCE(@status, status),
        issued_at=COALESCE(@issuedAt, issued_at), manual_reference=@manualReference,
        amount_tendered=@amountTendered,
        updated_at = CURRENT_TIMESTAMP WHERE id=@id
      `,
        )
        .run({
          id,
          type: resolvedType,
          customerId,
          supplierId: resolvedType === 'purchase_order' ? supplierId : null,
          subtotal,
          discountTotal,
          taxTotal,
          grandTotal,
          notes,
          status: status || null,
          issuedAt: issuedAt || null,
          manualReference: manualReference || null,
          amountTendered: paid.tendered,
        })
      this._savePayments(id, paid.payments)

      this.db.prepare(`DELETE FROM transaction_items WHERE transaction_id = ?`).run(id)
      const itemStmt = this.db.prepare(`
        INSERT INTO transaction_items (transaction_id, product_id, name, quantity, box_size, box_count, unit_price, discount_pct, tax_rate, line_total)
        VALUES (@transaction_id, @product_id, @name, @quantity, @box_size, @box_count, @unit_price, @discount_pct, @tax_rate, @line_total)
      `)
      for (const item of items) itemStmt.run({ transaction_id: id, ...item })

      // Apply stock-in once when a purchase order moves from non-final to final.
      if (
        resolvedType === 'purchase_order' &&
        current.status !== 'purchase_order' &&
        resolvedStatus === 'purchase_order'
      ) {
        const stockRepo = new StockRepository(this.db)
        for (const item of items) {
          if (item.product_id) {
            stockRepo.record({
              productId: item.product_id,
              type: 'in',
              quantity: item.quantity,
              reason: `Received via ${current.number}`,
              referenceType: 'purchase_order',
              referenceId: id,
            })
          }
        }
      }

      // Accounting: re-post from the edited invoice (also clears entries when voided).
      new AccountingRepository(this.db).postTransaction(id)

      return this.find(id)
    })
    return run()
  }

  delete(id) {
    // Accounting: remove this invoice's journal entries (and its payments') first.
    this.db.transaction(() => {
      new AccountingRepository(this.db).unpostTransaction(id)
      this.db.prepare(`DELETE FROM transactions WHERE id = ?`).run(id) // cascades items via FK
    })()
    return { id }
  }

  /**
   * Core requirement: convert a quotation into an invoice WITHOUT re-entering
   * data. Copies customer + line items into a NEW invoice row, stamps the
   * origin quote's number as reference_quotation_number, decrements stock,
   * and marks the source quote as 'converted' so it's no longer editable
   * as a live quote but stays visible for audit/history.
   */
  convertQuoteToInvoice(quoteId, overrides = {}) {
    const run = this.db.transaction(() => {
      const quote = this.find(quoteId)
      if (!quote) throw new Error('Quotation not found')
      if (quote.type !== 'quote') throw new Error('Only quotations can be converted to invoices')
      if (quote.status === 'converted') throw new Error('This quotation was already converted')

      const number = this._nextNumber('invoice')
      const info = this.db
        .prepare(
          `
        INSERT INTO transactions (
          number, type, status, customer_id, reference_quotation_id, reference_quotation_number,
          subtotal, discount_total, tax_total, grand_total, notes, issued_at, manual_reference
        ) VALUES (
          @number, 'invoice', 'invoice', @customerId, @refId, @refNumber,
          @subtotal, @discountTotal, @taxTotal, @grandTotal, @notes, @issuedAt, @manualReference
        )
      `,
        )
        .run({
          number,
          customerId: quote.customer_id,
          refId: quote.id,
          refNumber: quote.number,
          subtotal: quote.subtotal,
          discountTotal: quote.discount_total,
          taxTotal: quote.tax_total,
          grandTotal: quote.grand_total,
          notes: quote.notes,
          issuedAt: overrides.issuedAt || quote.issued_at || quote.created_at,
          manualReference: quote.manual_reference || null,
        })

      const invoiceId = info.lastInsertRowid
      const itemStmt = this.db.prepare(`
        INSERT INTO transaction_items (transaction_id, product_id, name, quantity, box_size, box_count, unit_price, discount_pct, tax_rate, line_total)
        VALUES (@transaction_id, @product_id, @name, @quantity, @box_size, @box_count, @unit_price, @discount_pct, @tax_rate, @line_total)
      `)
      const stockRepo = new StockRepository(this.db)
      for (const item of quote.items) {
        itemStmt.run({ ...item, transaction_id: invoiceId })
        if (item.product_id) {
          stockRepo.record({
            productId: item.product_id,
            type: 'out',
            quantity: item.quantity,
            reason: `Sold via ${number} (converted from ${quote.number})`,
            referenceType: 'invoice',
            referenceId: invoiceId,
          })
        }
      }

      this.db
        .prepare(
          `UPDATE transactions SET status = 'converted', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        )
        .run(quoteId)

      new AccountingRepository(this.db).postTransaction(invoiceId)

      return this.find(invoiceId)
    })
    return run()
  }
}
