/**
 * Accounting (double-entry) for the ERP - main-process side.
 *
 * How it fits the existing app
 * ----------------------------
 *  - Sales are NOT entered twice. Invoices (and POS sales) stay in `transactions`;
 *    postTransaction(id) turns the current state of one invoice into journal
 *    entries. It is idempotent: it deletes that invoice's old entries and writes
 *    fresh ones, so edits, voids and quote->invoice conversions all just work.
 *    TransactionRepository calls it after create / update / convert and
 *    unpostTransaction() before delete (see the hooks in repositories.js).
 *  - Money received against credit invoices (customer_payments), expenses,
 *    supplier bills and bill payments each post their own entries.
 *  - Reports read the journal. They return one normalised table shape
 *    ({ title, columns, rows, totals, meta }) so the renderer can show AND export
 *    (CSV / Excel / JSON) every report with the same code.
 *
 * Money rules
 *  - Selling prices in this app are TAX-INCLUSIVE, so an invoice posts
 *    Dr (cash|bank|mobile money|receivable) / Cr Sales (net) + Cr VAT Output.
 *  - A header-level discount is allocated proportionally across the VAT.
 *  - VAT on expenses/bills is only claimed when `company_vat` is set, and is
 *    extracted from the amount using `default_tax_rate`.
 *  - Period lock: nothing can be posted, changed or removed on or before
 *    `accounting_lock_date`.
 */

export const PAYMENT_METHODS = ['cash', 'speedpoint', 'eft', 'ecocash', 'mpesa', 'cheque']

// Which ledger account receives money paid by each method.
const METHOD_ACCOUNT = {
  cash: 'cash',
  speedpoint: 'bank',
  eft: 'bank',
  cheque: 'bank',
  ecocash: 'mobile_money',
  mpesa: 'mobile_money',
}

const MONEY_ACCOUNTS = ['cash', 'bank', 'mobile_money']
const POSTED_STATUSES = ['invoice', 'paid']
const TX_DATE = `COALESCE(NULLIF(substr(tx.issued_at, 1, 10), ''), date(tx.created_at, 'localtime'))`
const EPS = 0.005

const r2 = (n) => Math.round((Number(n) || 0) * 100 + (Number(n) >= 0 ? 1e-7 : -1e-7)) / 100
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))

function daysBetween(from, to) {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10))
  return Math.round((b - a) / 86400000)
}

const normalBalance = (type, debit, credit) =>
  type === 'asset' || type === 'expense' ? r2(debit - credit) : r2(credit - debit)

export class AccountingRepository {
  constructor(db) {
    this.db = db
  }

  // ---------------------------------------------------------------- helpers

  _setting(key, fallback = '') {
    const row = this.db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key)
    return row?.value ?? fallback
  }

  _setSetting(key, value) {
    this.db
      .prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(key, String(value))
  }

  /** VAT facts taken from the existing settings: default_tax_rate and company_vat. */
  _vat() {
    const rate = Number(this._setting('default_tax_rate', '0')) || 0
    const vatNumber = String(this._setting('company_vat', '')).trim()
    return { rate, vatNumber, registered: vatNumber !== '' }
  }

  _today() {
    return this.db.prepare(`SELECT date('now','localtime') AS d`).get().d
  }

  _acct(systemKey) {
    const row = this.db.prepare(`SELECT id FROM accounts WHERE system_key = ?`).get(systemKey)
    if (!row) throw new Error(`System account "${systemKey}" is missing from the chart of accounts`)
    return row.id
  }

  _methodAcct(method) {
    if (!PAYMENT_METHODS.includes(method)) throw new Error(`Unknown payment method: ${method}`)
    return this._acct(METHOD_ACCOUNT[method])
  }

  _date(value, label = 'Date') {
    const d = value ? String(value).slice(0, 10) : this._today()
    if (!isDate(d)) throw new Error(`${label} must look like YYYY-MM-DD`)
    return d
  }

  _assertOpen(date) {
    const lock = this._setting('accounting_lock_date', '')
    if (lock && date <= lock) {
      throw new Error(`The books are closed up to ${lock}. Move the lock date back to change ${date}.`)
    }
  }

  _writeEntry({ date, memo, sourceType, sourceId = null, lines }) {
    const clean = lines
      .map((l) => ({ accountId: l.accountId, debit: r2(l.debit), credit: r2(l.credit), memo: l.memo || null }))
      .filter((l) => l.debit > 0 || l.credit > 0)
    if (!clean.length) return null
    const debit = clean.reduce((s, l) => s + l.debit, 0)
    const credit = clean.reduce((s, l) => s + l.credit, 0)
    if (Math.abs(debit - credit) > EPS) {
      throw new Error(`Journal entry is not balanced (debits ${debit.toFixed(2)}, credits ${credit.toFixed(2)})`)
    }
    this._assertOpen(date)
    const info = this.db
      .prepare(`INSERT INTO journal_entries (entry_date, memo, source_type, source_id) VALUES (?, ?, ?, ?)`)
      .run(date, memo || null, sourceType, sourceId)
    const stmt = this.db.prepare(
      `INSERT INTO journal_lines (entry_id, account_id, debit, credit, memo) VALUES (?, ?, ?, ?, ?)`,
    )
    for (const l of clean) stmt.run(info.lastInsertRowid, l.accountId, l.debit, l.credit, l.memo)
    return info.lastInsertRowid
  }

  _clearEntries(sourceType, sourceId) {
    const existing = this.db
      .prepare(`SELECT id, entry_date FROM journal_entries WHERE source_type = ? AND source_id = ?`)
      .all(sourceType, sourceId)
    for (const e of existing) this._assertOpen(e.entry_date)
    for (const e of existing) this.db.prepare(`DELETE FROM journal_entries WHERE id = ?`).run(e.id)
  }

  _vatFor(gross, { taxAmount, includesVat } = {}) {
    const vat = this._vat()
    if (!vat.registered) return 0 // not VAT registered: nothing to claim
    let tax = 0
    if (taxAmount !== undefined && taxAmount !== null && taxAmount !== '') tax = Number(taxAmount)
    else if (includesVat) tax = (gross * vat.rate) / (100 + vat.rate)
    tax = r2(tax)
    if (!(tax >= 0) || tax > gross + EPS) throw new Error('The VAT amount is not valid')
    return tax
  }

  _method(value) {
    const m = String(value || 'cash')
    if (!PAYMENT_METHODS.includes(m)) throw new Error(`Unknown payment method: ${m}`)
    return m
  }

  _positive(value, label = 'Amount') {
    const n = r2(value)
    if (!(n > 0)) throw new Error(`${label} must be greater than zero`)
    return n
  }

  // ----------------------------------------------- sales: invoice -> journal

  _isPos(txId) {
    return !!this.db.prepare(`SELECT 1 FROM transaction_payments WHERE transaction_id = ? LIMIT 1`).get(txId)
  }

  /** (Re)post one invoice from its current state. Safe to call any number of times. */
  postTransaction(id) {
    const tx = this.db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(id)
    const shouldPost = tx && tx.type === 'invoice' && POSTED_STATUSES.includes(tx.status)
    if (!shouldPost && this._paymentsFor(id).length) {
      throw new Error('Remove the payments recorded against this invoice before voiding it or changing its type.')
    }
    this._clearEntries('invoice', id)
    if (!shouldPost) return null

    const total = r2(tx.grand_total)
    const discount = Number(tx.discount_total) || 0
    const gross = total + discount
    let vat = Number(tx.tax_total) || 0
    if (discount > 0 && gross > 0) vat = vat * (total / gross) // discount shrinks the VAT proportionally
    vat = r2(Math.min(Math.max(vat, 0), total))
    const net = r2(total - vat)

    const items = this.db
      .prepare(`SELECT product_id, quantity, unit_cost FROM transaction_items WHERE transaction_id = ?`)
      .all(id)
    const cogs = r2(items.reduce((s, i) => s + (i.product_id ? (Number(i.quantity) || 0) * (Number(i.unit_cost) || 0) : 0), 0))

    const lines = []
    const paid = this.db
      .prepare(`SELECT method, amount FROM transaction_payments WHERE transaction_id = ? ORDER BY id`)
      .all(id)
    if (paid.length) {
      // POS sale: settled at the till. Cash is what is left after non-cash methods (i.e. net of change).
      const byAccount = new Map()
      let nonCash = 0
      for (const p of paid) {
        if (p.method === 'cash') continue
        const key = METHOD_ACCOUNT[p.method]
        byAccount.set(key, (byAccount.get(key) || 0) + Number(p.amount))
        nonCash += Number(p.amount)
      }
      const cash = r2(total - nonCash)
      if (cash > 0) byAccount.set('cash', (byAccount.get('cash') || 0) + cash)
      for (const [key, amount] of byAccount) lines.push({ accountId: this._acct(key), debit: amount })
    } else {
      lines.push({ accountId: this._acct('ar'), debit: total })
    }
    lines.push({ accountId: this._acct('sales'), credit: net })
    lines.push({ accountId: this._acct('vat_output'), credit: vat })
    if (cogs > 0) {
      lines.push({ accountId: this._acct('cogs'), debit: cogs })
      lines.push({ accountId: this._acct('inventory'), credit: cogs })
    }

    this._writeEntry({
      date: this._invoiceDate(tx),
      memo: `Sale ${tx.number}`,
      sourceType: 'invoice',
      sourceId: id,
      lines,
    })
    this._refreshInvoiceStatus(id)
    return id
  }

  /** Called BEFORE an invoice row is deleted (its payments cascade away with it). */
  unpostTransaction(id) {
    for (const p of this._paymentsFor(id)) this._clearEntries('customer_payment', p.id)
    this._clearEntries('invoice', id)
  }

  _invoiceDate(tx) {
    const d = String(tx.issued_at || '').slice(0, 10)
    if (isDate(d)) return d
    return this.db.prepare(`SELECT date(?, 'localtime') AS d`).get(tx.created_at).d
  }

  _paymentsFor(txId) {
    return this.db.prepare(`SELECT id FROM customer_payments WHERE transaction_id = ?`).all(txId)
  }

  _refreshInvoiceStatus(txId) {
    const tx = this.db.prepare(`SELECT id, type, status, grand_total FROM transactions WHERE id = ?`).get(txId)
    if (!tx || tx.type !== 'invoice' || !POSTED_STATUSES.includes(tx.status) || this._isPos(txId)) return
    const paid = this.db.prepare(`SELECT COALESCE(SUM(amount), 0) AS s FROM customer_payments WHERE transaction_id = ?`).get(txId).s
    const next = Number(tx.grand_total) > 0 && paid + EPS >= Number(tx.grand_total) ? 'paid' : 'invoice'
    if (next !== tx.status) {
      this.db.prepare(`UPDATE transactions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(next, txId)
    }
  }

  /**
   * First start after the accounting update: post every existing invoice. Credit
   * invoices already marked 'paid' get one opening payment so they do not show
   * up as receivables. Runs once (flag in settings); rebuild() can redo the postings.
   */
  ensureBackfilled() {
    if (this._setting('accounting_backfilled', '0') === '1') return { skipped: true }
    const run = this.db.transaction(() => {
      const invoices = this.db
        .prepare(`SELECT tx.*, ${TX_DATE} AS d FROM transactions tx WHERE tx.type = 'invoice' AND tx.status IN ('invoice','paid')`)
        .all()
      for (const tx of invoices) {
        if (tx.status === 'paid' && !this._isPos(tx.id) && !this._paymentsFor(tx.id).length && Number(tx.grand_total) > 0) {
          this.db
            .prepare(
              `INSERT INTO customer_payments (transaction_id, customer_id, method, amount, paid_at, notes) VALUES (?, ?, 'cash', ?, ?, ?)`,
            )
            .run(tx.id, tx.customer_id, r2(tx.grand_total), tx.d, 'Opening import (invoice was already marked paid)')
        }
      }
      for (const tx of invoices) this.postTransaction(tx.id)
      for (const p of this.db.prepare(`SELECT * FROM customer_payments`).all()) this._postCustomerPayment(p)
      this._setSetting('accounting_backfilled', '1')
      return { posted: invoices.length }
    })
    return run()
  }

  /** Re-post every invoice and customer payment from source data. Locked periods are refused. */
  rebuild() {
    const run = this.db.transaction(() => {
      const ids = this.db.prepare(`SELECT id FROM transactions WHERE type = 'invoice'`).all()
      for (const { id } of ids) this.postTransaction(id)
      for (const p of this.db.prepare(`SELECT * FROM customer_payments`).all()) this._postCustomerPayment(p)
      return { rebuilt: ids.length }
    })
    return run()
  }

  // --------------------------------------------------- customer payments

  /** Open (unpaid or part-paid) credit invoices as at a date. */
  openInvoices({ asOf = null } = {}) {
    const day = this._date(asOf, 'As-at date')
    const rows = this.db
      .prepare(
        `SELECT tx.id, tx.number, ${TX_DATE} AS date, tx.grand_total AS total, tx.customer_id, c.name AS customer_name,
           COALESCE((SELECT SUM(p.amount) FROM customer_payments p WHERE p.transaction_id = tx.id AND p.paid_at <= @day), 0) AS paid
         FROM transactions tx
         LEFT JOIN customers c ON c.id = tx.customer_id
         WHERE tx.type = 'invoice' AND tx.status IN ('invoice','paid')
           AND NOT EXISTS (SELECT 1 FROM transaction_payments tp WHERE tp.transaction_id = tx.id)
           AND ${TX_DATE} <= @day
         ORDER BY date ASC, tx.id ASC`,
      )
      .all({ day })
    return rows
      .map((r) => ({ ...r, paid: r2(r.paid), total: r2(r.total), balance: r2(r.total - r.paid), days: daysBetween(r.date, day) }))
      .filter((r) => r.balance > EPS)
  }

  customerPayments({ transactionId = null, from = null, to = null } = {}) {
    let sql = `SELECT p.*, tx.number AS invoice_number, c.name AS customer_name
      FROM customer_payments p
      JOIN transactions tx ON tx.id = p.transaction_id
      LEFT JOIN customers c ON c.id = p.customer_id WHERE 1=1`
    const params = []
    if (transactionId) { sql += ` AND p.transaction_id = ?`; params.push(transactionId) }
    if (from) { sql += ` AND p.paid_at >= ?`; params.push(from) }
    if (to) { sql += ` AND p.paid_at <= ?`; params.push(to) }
    return this.db.prepare(sql + ` ORDER BY p.paid_at DESC, p.id DESC`).all(...params)
  }

  _postCustomerPayment(p) {
    this._clearEntries('customer_payment', p.id)
    const inv = this.db.prepare(`SELECT number FROM transactions WHERE id = ?`).get(p.transaction_id)
    this._writeEntry({
      date: p.paid_at,
      memo: `Payment received for ${inv?.number || 'invoice'}${p.reference ? ` (${p.reference})` : ''}`,
      sourceType: 'customer_payment',
      sourceId: p.id,
      lines: [
        { accountId: this._methodAcct(p.method), debit: p.amount },
        { accountId: this._acct('ar'), credit: p.amount },
      ],
    })
  }

  recordCustomerPayment({ transactionId, method = 'cash', amount, paidAt = null, reference = '', notes = '' }) {
    const run = this.db.transaction(() => {
      const tx = this.db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(transactionId)
      if (!tx || tx.type !== 'invoice' || !POSTED_STATUSES.includes(tx.status)) throw new Error('Choose an invoice to pay')
      if (this._isPos(transactionId)) throw new Error('POS sales are already paid at the till')
      const value = this._positive(amount, 'Payment amount')
      const paid = this.db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM customer_payments WHERE transaction_id = ?`).get(transactionId).s
      const balance = r2(Number(tx.grand_total) - paid)
      if (value > balance + EPS) throw new Error(`The payment is more than the balance owing (${balance.toFixed(2)})`)
      const info = this.db
        .prepare(
          `INSERT INTO customer_payments (transaction_id, customer_id, method, amount, paid_at, reference, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(transactionId, tx.customer_id, this._method(method), value, this._date(paidAt, 'Payment date'), reference || null, notes || null)
      const row = this.db.prepare(`SELECT * FROM customer_payments WHERE id = ?`).get(info.lastInsertRowid)
      this._postCustomerPayment(row)
      this._refreshInvoiceStatus(transactionId)
      return row
    })
    return run()
  }

  deleteCustomerPayment(id) {
    const run = this.db.transaction(() => {
      const p = this.db.prepare(`SELECT * FROM customer_payments WHERE id = ?`).get(id)
      if (!p) throw new Error('Payment not found')
      this._clearEntries('customer_payment', id)
      this.db.prepare(`DELETE FROM customer_payments WHERE id = ?`).run(id)
      this._refreshInvoiceStatus(p.transaction_id)
      return { id }
    })
    return run()
  }

  // --------------------------------------------------------------- expenses

  expenses({ from = null, to = null, accountId = null, search = '' } = {}) {
    let sql = `SELECT e.*, a.code AS account_code, a.name AS account_name, s.name AS supplier_name
      FROM expenses e JOIN accounts a ON a.id = e.account_id LEFT JOIN suppliers s ON s.id = e.supplier_id WHERE 1=1`
    const params = []
    if (from) { sql += ` AND e.expense_date >= ?`; params.push(from) }
    if (to) { sql += ` AND e.expense_date <= ?`; params.push(to) }
    if (accountId) { sql += ` AND e.account_id = ?`; params.push(accountId) }
    if (search) {
      sql += ` AND (e.description LIKE ? OR e.payee LIKE ? OR e.reference LIKE ? OR s.name LIKE ?)`
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`)
    }
    return this.db.prepare(sql + ` ORDER BY e.expense_date DESC, e.id DESC`).all(...params)
  }

  _expenseAccount(accountId) {
    const a = this.db.prepare(`SELECT id, type FROM accounts WHERE id = ? AND is_active = 1`).get(accountId)
    if (!a || a.type !== 'expense') throw new Error('Choose an expense account')
    return a.id
  }

  _postExpense(e) {
    this._clearEntries('expense', e.id)
    const net = r2(e.amount - e.tax_amount)
    this._writeEntry({
      date: e.expense_date,
      memo: e.description || e.payee || 'Expense',
      sourceType: 'expense',
      sourceId: e.id,
      lines: [
        { accountId: e.account_id, debit: net },
        { accountId: this._acct('vat_input'), debit: e.tax_amount },
        { accountId: this._methodAcct(e.method), credit: e.amount },
      ],
    })
  }

  createExpense(data) {
    const run = this.db.transaction(() => {
      const amount = this._positive(data.amount)
      const info = this.db
        .prepare(
          `INSERT INTO expenses (expense_date, account_id, supplier_id, payee, description, amount, tax_amount, method, reference, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          this._date(data.expenseDate, 'Expense date'),
          this._expenseAccount(data.accountId),
          data.supplierId || null,
          data.payee || null,
          data.description || null,
          amount,
          this._vatFor(amount, data),
          this._method(data.method),
          data.reference || null,
          data.notes || null,
        )
      const row = this.db.prepare(`SELECT * FROM expenses WHERE id = ?`).get(info.lastInsertRowid)
      this._postExpense(row)
      return row
    })
    return run()
  }

  updateExpense(id, data) {
    const run = this.db.transaction(() => {
      const old = this.db.prepare(`SELECT * FROM expenses WHERE id = ?`).get(id)
      if (!old) throw new Error('Expense not found')
      this._assertOpen(old.expense_date)
      const amount = this._positive(data.amount)
      this.db
        .prepare(
          `UPDATE expenses SET expense_date=?, account_id=?, supplier_id=?, payee=?, description=?, amount=?, tax_amount=?, method=?, reference=?, notes=? WHERE id=?`,
        )
        .run(
          this._date(data.expenseDate, 'Expense date'),
          this._expenseAccount(data.accountId),
          data.supplierId || null,
          data.payee || null,
          data.description || null,
          amount,
          this._vatFor(amount, data),
          this._method(data.method),
          data.reference || null,
          data.notes || null,
          id,
        )
      const row = this.db.prepare(`SELECT * FROM expenses WHERE id = ?`).get(id)
      this._postExpense(row)
      return row
    })
    return run()
  }

  deleteExpense(id) {
    const run = this.db.transaction(() => {
      this._clearEntries('expense', id)
      this.db.prepare(`DELETE FROM expenses WHERE id = ?`).run(id)
      return { id }
    })
    return run()
  }

  // ------------------------------------------------------- supplier bills

  bills({ status = null, supplierId = null } = {}) {
    let sql = `SELECT b.*, s.name AS supplier_name, a.name AS account_name, po.number AS po_number,
        COALESCE((SELECT SUM(p.amount) FROM bill_payments p WHERE p.bill_id = b.id), 0) AS paid
      FROM supplier_bills b
      LEFT JOIN suppliers s ON s.id = b.supplier_id
      JOIN accounts a ON a.id = b.account_id
      LEFT JOIN transactions po ON po.id = b.purchase_order_id WHERE 1=1`
    const params = []
    if (status) { sql += ` AND b.status = ?`; params.push(status) }
    if (supplierId) { sql += ` AND b.supplier_id = ?`; params.push(supplierId) }
    return this.db
      .prepare(sql + ` ORDER BY b.bill_date DESC, b.id DESC`)
      .all(...params)
      .map((b) => ({ ...b, paid: r2(b.paid), balance: r2(b.total - b.paid) }))
  }

  billPayments(billId) {
    return this.db.prepare(`SELECT * FROM bill_payments WHERE bill_id = ? ORDER BY paid_at DESC, id DESC`).all(billId)
  }

  /** Finalised purchase orders that have no bill yet - pick one to pre-fill a bill. */
  purchaseOrdersToBill() {
    return this.db
      .prepare(
        `SELECT tx.id, tx.number, tx.supplier_id, s.name AS supplier_name, tx.grand_total, tx.tax_total, ${TX_DATE} AS date
         FROM transactions tx LEFT JOIN suppliers s ON s.id = tx.supplier_id
         WHERE tx.type = 'purchase_order' AND tx.status = 'purchase_order'
           AND tx.id NOT IN (SELECT purchase_order_id FROM supplier_bills WHERE purchase_order_id IS NOT NULL)
         ORDER BY date DESC, tx.id DESC`,
      )
      .all()
  }

  _billDebitAccount(accountId) {
    const a = this.db.prepare(`SELECT id, type FROM accounts WHERE id = ? AND is_active = 1`).get(accountId)
    if (!a || !['expense', 'asset'].includes(a.type)) throw new Error('Choose an expense or inventory account for the bill')
    return a.id
  }

  _postBill(b) {
    this._clearEntries('bill', b.id)
    this._writeEntry({
      date: b.bill_date,
      memo: `Bill ${b.bill_number || `#${b.id}`}`,
      sourceType: 'bill',
      sourceId: b.id,
      lines: [
        { accountId: b.account_id, debit: b.subtotal },
        { accountId: this._acct('vat_input'), debit: b.tax_amount },
        { accountId: this._acct('ap'), credit: b.total },
      ],
    })
  }

  _refreshBillStatus(billId) {
    const b = this.db.prepare(`SELECT id, total, status FROM supplier_bills WHERE id = ?`).get(billId)
    if (!b) return
    const paid = this.db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM bill_payments WHERE bill_id = ?`).get(billId).s
    const next = paid + EPS >= b.total ? 'paid' : 'open'
    if (next !== b.status) this.db.prepare(`UPDATE supplier_bills SET status = ? WHERE id = ?`).run(next, billId)
  }

  _billFields(data) {
    const total = this._positive(data.amount, 'Bill total')
    const tax = this._vatFor(total, data)
    return {
      total,
      tax,
      subtotal: r2(total - tax),
      billDate: this._date(data.billDate, 'Bill date'),
      dueDate: data.dueDate ? this._date(data.dueDate, 'Due date') : null,
      accountId: this._billDebitAccount(data.accountId || this._acct(data.purchaseOrderId ? 'inventory' : 'expenses_general')),
    }
  }

  createBill(data) {
    const run = this.db.transaction(() => {
      const f = this._billFields(data)
      const info = this.db
        .prepare(
          `INSERT INTO supplier_bills (bill_number, supplier_id, purchase_order_id, bill_date, due_date, account_id, subtotal, tax_amount, total, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(data.billNumber || null, data.supplierId || null, data.purchaseOrderId || null, f.billDate, f.dueDate, f.accountId, f.subtotal, f.tax, f.total, data.notes || null)
      const row = this.db.prepare(`SELECT * FROM supplier_bills WHERE id = ?`).get(info.lastInsertRowid)
      this._postBill(row)
      return row
    })
    return run()
  }

  updateBill(id, data) {
    const run = this.db.transaction(() => {
      const old = this.db.prepare(`SELECT * FROM supplier_bills WHERE id = ?`).get(id)
      if (!old) throw new Error('Bill not found')
      if (this.billPayments(id).length) throw new Error('Remove the payments on this bill before editing it')
      this._assertOpen(old.bill_date)
      const f = this._billFields(data)
      this.db
        .prepare(
          `UPDATE supplier_bills SET bill_number=?, supplier_id=?, purchase_order_id=?, bill_date=?, due_date=?, account_id=?, subtotal=?, tax_amount=?, total=?, notes=?, status='open' WHERE id=?`,
        )
        .run(data.billNumber || null, data.supplierId || null, data.purchaseOrderId || null, f.billDate, f.dueDate, f.accountId, f.subtotal, f.tax, f.total, data.notes || null, id)
      const row = this.db.prepare(`SELECT * FROM supplier_bills WHERE id = ?`).get(id)
      this._postBill(row)
      return row
    })
    return run()
  }

  deleteBill(id) {
    const run = this.db.transaction(() => {
      if (this.billPayments(id).length) throw new Error('Remove the payments on this bill before deleting it')
      this._clearEntries('bill', id)
      this.db.prepare(`DELETE FROM supplier_bills WHERE id = ?`).run(id)
      return { id }
    })
    return run()
  }

  recordBillPayment({ billId, method = 'cash', amount, paidAt = null, reference = '' }) {
    const run = this.db.transaction(() => {
      const bill = this.bills().find((b) => b.id === billId)
      if (!bill) throw new Error('Bill not found')
      const value = this._positive(amount, 'Payment amount')
      if (value > bill.balance + EPS) throw new Error(`The payment is more than the balance owing (${bill.balance.toFixed(2)})`)
      const info = this.db
        .prepare(`INSERT INTO bill_payments (bill_id, method, amount, paid_at, reference) VALUES (?, ?, ?, ?, ?)`)
        .run(billId, this._method(method), value, this._date(paidAt, 'Payment date'), reference || null)
      const p = this.db.prepare(`SELECT * FROM bill_payments WHERE id = ?`).get(info.lastInsertRowid)
      this._postBillPayment(p, bill)
      this._refreshBillStatus(billId)
      return p
    })
    return run()
  }

  _postBillPayment(p, bill) {
    this._clearEntries('bill_payment', p.id)
    this._writeEntry({
      date: p.paid_at,
      memo: `Paid bill ${bill.bill_number || `#${bill.id}`}${bill.supplier_name ? ` - ${bill.supplier_name}` : ''}`,
      sourceType: 'bill_payment',
      sourceId: p.id,
      lines: [
        { accountId: this._acct('ap'), debit: p.amount },
        { accountId: this._methodAcct(p.method), credit: p.amount },
      ],
    })
  }

  deleteBillPayment(id) {
    const run = this.db.transaction(() => {
      const p = this.db.prepare(`SELECT * FROM bill_payments WHERE id = ?`).get(id)
      if (!p) throw new Error('Payment not found')
      this._clearEntries('bill_payment', id)
      this.db.prepare(`DELETE FROM bill_payments WHERE id = ?`).run(id)
      this._refreshBillStatus(p.bill_id)
      return { id }
    })
    return run()
  }

  // ------------------------------------------------------------ chart of accounts

  accounts({ includeInactive = true } = {}) {
    return this.db
      .prepare(
        `SELECT a.*, COALESCE(SUM(l.debit),0) AS debit, COALESCE(SUM(l.credit),0) AS credit
         FROM accounts a LEFT JOIN journal_lines l ON l.account_id = a.id
         ${includeInactive ? '' : 'WHERE a.is_active = 1'}
         GROUP BY a.id ORDER BY a.code`,
      )
      .all()
      .map((a) => ({ ...a, balance: normalBalance(a.type, a.debit, a.credit) }))
  }

  createAccount({ code, name, type }) {
    code = String(code || '').trim()
    name = String(name || '').trim()
    if (!code || !name) throw new Error('Account code and name are required')
    if (!['asset', 'liability', 'equity', 'income', 'expense'].includes(type)) throw new Error('Choose an account type')
    if (this.db.prepare(`SELECT 1 FROM accounts WHERE code = ?`).get(code)) throw new Error(`Account code ${code} is already used`)
    const info = this.db.prepare(`INSERT INTO accounts (code, name, type) VALUES (?, ?, ?)`).run(code, name, type)
    return this.db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(info.lastInsertRowid)
  }

  updateAccount(id, { code, name, isActive }) {
    const a = this.db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(id)
    if (!a) throw new Error('Account not found')
    code = String(code ?? a.code).trim()
    name = String(name ?? a.name).trim()
    if (!code || !name) throw new Error('Account code and name are required')
    if (this.db.prepare(`SELECT 1 FROM accounts WHERE code = ? AND id != ?`).get(code, id)) throw new Error(`Account code ${code} is already used`)
    const active = isActive === undefined ? a.is_active : isActive ? 1 : 0
    if (a.is_system && !active) throw new Error('System accounts cannot be switched off')
    this.db.prepare(`UPDATE accounts SET code = ?, name = ?, is_active = ? WHERE id = ?`).run(code, name, active, id)
    return this.db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(id)
  }

  deleteAccount(id) {
    const a = this.db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(id)
    if (!a) throw new Error('Account not found')
    if (a.is_system) throw new Error('System accounts cannot be deleted')
    const used =
      this.db.prepare(`SELECT 1 FROM journal_lines WHERE account_id = ? LIMIT 1`).get(id) ||
      this.db.prepare(`SELECT 1 FROM expenses WHERE account_id = ? LIMIT 1`).get(id) ||
      this.db.prepare(`SELECT 1 FROM supplier_bills WHERE account_id = ? LIMIT 1`).get(id)
    if (used) throw new Error('This account has activity. Switch it off instead of deleting it.')
    this.db.prepare(`DELETE FROM accounts WHERE id = ?`).run(id)
    return { id }
  }

  // ------------------------------------------------------------------ journal

  journalEntries({ from = null, to = null, sourceType = null, search = '', limit = 500 } = {}) {
    let sql = `SELECT e.*, (SELECT COALESCE(SUM(debit),0) FROM journal_lines WHERE entry_id = e.id) AS total FROM journal_entries e WHERE 1=1`
    const params = []
    if (from) { sql += ` AND e.entry_date >= ?`; params.push(from) }
    if (to) { sql += ` AND e.entry_date <= ?`; params.push(to) }
    if (sourceType) { sql += ` AND e.source_type = ?`; params.push(sourceType) }
    if (search) { sql += ` AND e.memo LIKE ?`; params.push(`%${search}%`) }
    sql += ` ORDER BY e.entry_date DESC, e.id DESC LIMIT ?`
    params.push(Math.min(Number(limit) || 500, 2000))
    const entries = this.db.prepare(sql).all(...params)
    const lineStmt = this.db.prepare(
      `SELECT l.*, a.code AS account_code, a.name AS account_name FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = ? ORDER BY l.id`,
    )
    return entries.map((e) => ({ ...e, total: r2(e.total), lines: lineStmt.all(e.id) }))
  }

  createJournalEntry({ date, memo, lines }) {
    const run = this.db.transaction(() => {
      if (!Array.isArray(lines) || lines.length < 2) throw new Error('A journal entry needs at least two lines')
      const clean = lines.map((l) => {
        const debit = r2(l.debit)
        const credit = r2(l.credit)
        if (debit < 0 || credit < 0) throw new Error('Amounts cannot be negative')
        if (debit > 0 && credit > 0) throw new Error('A line is either a debit or a credit, not both')
        if (!this.db.prepare(`SELECT 1 FROM accounts WHERE id = ? AND is_active = 1`).get(l.accountId)) throw new Error('Choose an account on every line')
        return { accountId: l.accountId, debit, credit, memo: l.memo }
      })
      const id = this._writeEntry({ date: this._date(date, 'Entry date'), memo: memo || 'Manual journal', sourceType: 'manual', lines: clean })
      if (!id) throw new Error('Enter at least one amount')
      return this.journalEntries({ limit: 1 }).find((e) => e.id === id) || { id }
    })
    return run()
  }

  deleteJournalEntry(id) {
    const e = this.db.prepare(`SELECT * FROM journal_entries WHERE id = ?`).get(id)
    if (!e) throw new Error('Entry not found')
    if (!['manual', 'opening_stock'].includes(e.source_type)) {
      throw new Error('Automatic entries follow their source document. Change or delete the sale, payment, expense or bill instead.')
    }
    this._assertOpen(e.entry_date)
    this.db.prepare(`DELETE FROM journal_entries WHERE id = ?`).run(id)
    return { id }
  }

  /** Dr Inventory / Cr Opening Balance Equity for the stock on hand (qty x cost price). Once only. */
  postOpeningStock({ date = null } = {}) {
    const run = this.db.transaction(() => {
      if (this.db.prepare(`SELECT 1 FROM journal_entries WHERE source_type = 'opening_stock' LIMIT 1`).get()) {
        throw new Error('Opening stock has already been posted. Delete that journal entry first to post it again.')
      }
      const value = r2(this.db.prepare(`SELECT COALESCE(SUM(stock_qty * cost_price),0) AS v FROM products WHERE is_active = 1 AND stock_qty > 0`).get().v)
      if (!(value > 0)) throw new Error('There is no stock value to post (check cost prices and quantities)')
      this._writeEntry({
        date: this._date(date, 'Opening date'),
        memo: 'Opening stock on hand',
        sourceType: 'opening_stock',
        lines: [
          { accountId: this._acct('inventory'), debit: value },
          { accountId: this._acct('opening_equity'), credit: value },
        ],
      })
      return { value }
    })
    return run()
  }

  getLockDate() {
    return this._setting('accounting_lock_date', '')
  }

  /** date = 'YYYY-MM-DD' closes the books up to and including it; '' re-opens them. */
  setLockDate(date) {
    if (date && !isDate(date)) throw new Error('Lock date must look like YYYY-MM-DD')
    this._setSetting('accounting_lock_date', date || '')
    return { lockDate: date || '' }
  }

  // ----------------------------------------------------------------- overview

  overview() {
    const today = this._today()
    const monthStart = `${today.slice(0, 7)}-01`
    const bal = this._balances({})
    const byKey = (k) => bal.find((a) => a.system_key === k)?.balance || 0
    const period = (from) => {
      const b = this._balances({ from, to: today })
      const income = b.filter((a) => a.type === 'income').reduce((s, a) => s + a.balance, 0)
      const cogs = b.filter((a) => a.system_key === 'cogs').reduce((s, a) => s + a.balance, 0)
      const expenses = b.filter((a) => a.type === 'expense' && a.system_key !== 'cogs').reduce((s, a) => s + a.balance, 0)
      return { sales: r2(income), cogs: r2(cogs), expenses: r2(expenses), profit: r2(income - cogs - expenses) }
    }
    const receivables = this.openInvoices({ asOf: today }).reduce((s, r) => s + r.balance, 0)
    const payables = this.bills({ status: 'open' }).reduce((s, b) => s + b.balance, 0)
    return {
      today,
      vat: this._vat(),
      lockDate: this.getLockDate(),
      backfilled: this._setting('accounting_backfilled', '0') === '1',
      cash: { cash: byKey('cash'), bank: byKey('bank'), mobileMoney: byKey('mobile_money'), total: r2(byKey('cash') + byKey('bank') + byKey('mobile_money')) },
      receivables: r2(receivables),
      payables: r2(payables),
      inventory: byKey('inventory'),
      vatPayable: r2(byKey('vat_output') - byKey('vat_input')),
      month: period(monthStart),
      year: period(`${today.slice(0, 4)}-01-01`),
    }
  }

  // ------------------------------------------------------------------ reports

  _range(from, to) {
    const t = this._date(to, 'To date')
    const f = from ? this._date(from, 'From date') : `${t.slice(0, 7)}-01`
    if (f > t) throw new Error('The From date is after the To date')
    return { from: f, to: t }
  }

  /** Per-account debit/credit totals, optionally limited to a date range. */
  _balances({ from = '0000-01-01', to = '9999-12-31' } = {}) {
    return this.db
      .prepare(
        `SELECT a.id, a.code, a.name, a.type, a.system_key,
           COALESCE(SUM(x.debit),0) AS debit, COALESCE(SUM(x.credit),0) AS credit
         FROM accounts a
         LEFT JOIN (
           SELECT l.account_id, l.debit, l.credit FROM journal_lines l
           JOIN journal_entries e ON e.id = l.entry_id
           WHERE e.entry_date >= @from AND e.entry_date <= @to
         ) x ON x.account_id = a.id
         GROUP BY a.id ORDER BY a.code`,
      )
      .all({ from, to })
      .map((a) => ({ ...a, debit: r2(a.debit), credit: r2(a.credit), balance: normalBalance(a.type, a.debit, a.credit) }))
  }

  /** Entry point for every report. name: see REPORT_NAMES. */
  report(name, params = {}) {
    if (!REPORT_NAMES.includes(name)) throw new Error(`Unknown report: ${name}`)
    const table = this[`_report_${name}`](params || {})
    const company = this._setting('company_name', '')
    const vat = this._vat()
    return {
      name,
      generatedAt: new Date().toISOString(),
      ...table,
      meta: { company, vatNumber: vat.vatNumber, currency: this._setting('currency_symbol', 'M'), ...(table.meta || {}) },
    }
  }

  _report_trialBalance({ asOf }) {
    const to = this._date(asOf, 'As-at date')
    const rows = []
    let debit = 0
    let credit = 0
    for (const a of this._balances({ to })) {
      const net = r2(a.debit - a.credit)
      if (Math.abs(net) < EPS && !a.debit && !a.credit) continue
      const d = net > 0 ? net : 0
      const c = net < 0 ? -net : 0
      debit += d
      credit += c
      rows.push({ code: a.code, name: a.name, type: a.type, debit: d, credit: c })
    }
    return {
      title: 'Trial Balance',
      subtitle: `As at ${to}`,
      columns: [
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Account' },
        { key: 'type', label: 'Type' },
        { key: 'debit', label: 'Debit', type: 'money' },
        { key: 'credit', label: 'Credit', type: 'money' },
      ],
      rows,
      totals: { debit: r2(debit), credit: r2(credit) },
      meta: { balanced: Math.abs(debit - credit) < EPS },
    }
  }

  _report_profitAndLoss({ from, to }) {
    const range = this._range(from, to)
    const bal = this._balances(range)
    const active = (a) => a.debit || a.credit
    const income = bal.filter((a) => a.type === 'income' && active(a))
    const cogs = bal.filter((a) => a.system_key === 'cogs' && active(a))
    const expenses = bal.filter((a) => a.type === 'expense' && a.system_key !== 'cogs' && active(a))
    const sum = (list) => r2(list.reduce((s, a) => s + a.balance, 0))
    const rows = []
    const section = (label, list) => {
      rows.push({ code: '', line: label, amount: null, _kind: 'header' })
      for (const a of list) rows.push({ code: a.code, line: a.name, amount: a.balance, _kind: 'item' })
    }
    section('Income', income)
    rows.push({ code: '', line: 'Total income', amount: sum(income), _kind: 'subtotal' })
    section('Cost of sales', cogs)
    rows.push({ code: '', line: 'Total cost of sales', amount: sum(cogs), _kind: 'subtotal' })
    rows.push({ code: '', line: 'Gross profit', amount: r2(sum(income) - sum(cogs)), _kind: 'total' })
    section('Expenses', expenses)
    rows.push({ code: '', line: 'Total expenses', amount: sum(expenses), _kind: 'subtotal' })
    rows.push({ code: '', line: 'Net profit', amount: r2(sum(income) - sum(cogs) - sum(expenses)), _kind: 'total' })
    return {
      title: 'Profit & Loss',
      subtitle: `${range.from} to ${range.to}`,
      columns: [
        { key: 'code', label: 'Code' },
        { key: 'line', label: 'Account' },
        { key: 'amount', label: 'Amount', type: 'money' },
      ],
      rows,
      totals: null,
    }
  }

  _report_balanceSheet({ asOf }) {
    const to = this._date(asOf, 'As-at date')
    const bal = this._balances({ to })
    const live = (a) => a.debit || a.credit
    const sum = (list) => r2(list.reduce((s, a) => s + a.balance, 0))
    const assets = bal.filter((a) => a.type === 'asset' && live(a))
    const liabilities = bal.filter((a) => a.type === 'liability' && live(a))
    const equity = bal.filter((a) => a.type === 'equity' && live(a))
    const profit = r2(
      bal.filter((a) => a.type === 'income').reduce((s, a) => s + a.balance, 0) -
        bal.filter((a) => a.type === 'expense').reduce((s, a) => s + a.balance, 0),
    )
    const rows = []
    const section = (label, list) => {
      rows.push({ code: '', line: label, amount: null, _kind: 'header' })
      for (const a of list) rows.push({ code: a.code, line: a.name, amount: a.balance, _kind: 'item' })
    }
    section('Assets', assets)
    rows.push({ code: '', line: 'Total assets', amount: sum(assets), _kind: 'total' })
    section('Liabilities', liabilities)
    rows.push({ code: '', line: 'Total liabilities', amount: sum(liabilities), _kind: 'subtotal' })
    section('Equity', equity)
    rows.push({ code: '', line: 'Net profit to date', amount: profit, _kind: 'item' })
    const totalEquity = r2(sum(equity) + profit)
    rows.push({ code: '', line: 'Total equity', amount: totalEquity, _kind: 'subtotal' })
    rows.push({ code: '', line: 'Total liabilities + equity', amount: r2(sum(liabilities) + totalEquity), _kind: 'total' })
    return {
      title: 'Balance Sheet',
      subtitle: `As at ${to}`,
      columns: [
        { key: 'code', label: 'Code' },
        { key: 'line', label: 'Account' },
        { key: 'amount', label: 'Amount', type: 'money' },
      ],
      rows,
      totals: null,
      meta: { balanced: Math.abs(sum(assets) - (sum(liabilities) + totalEquity)) < EPS },
    }
  }

  _report_generalLedger({ accountId, from, to }) {
    const range = this._range(from, to)
    const acct = this.db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(accountId)
    if (!acct) throw new Error('Choose an account for the ledger')
    const sign = acct.type === 'asset' || acct.type === 'expense' ? 1 : -1
    const before = this.db
      .prepare(
        `SELECT COALESCE(SUM(l.debit),0) AS d, COALESCE(SUM(l.credit),0) AS c FROM journal_lines l
         JOIN journal_entries e ON e.id = l.entry_id WHERE l.account_id = ? AND e.entry_date < ?`,
      )
      .get(accountId, range.from)
    let running = r2(sign * (before.d - before.c))
    const rows = [{ date: range.from, ref: '', memo: 'Opening balance', debit: null, credit: null, balance: running, _kind: 'subtotal' }]
    const lines = this.db
      .prepare(
        `SELECT e.entry_date, e.source_type, e.id AS entry_id, COALESCE(l.memo, e.memo) AS memo, l.debit, l.credit
         FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
         WHERE l.account_id = ? AND e.entry_date >= ? AND e.entry_date <= ? ORDER BY e.entry_date, e.id, l.id`,
      )
      .all(accountId, range.from, range.to)
    let debit = 0
    let credit = 0
    for (const l of lines) {
      running = r2(running + sign * (l.debit - l.credit))
      debit += l.debit
      credit += l.credit
      rows.push({ date: l.entry_date, ref: `${l.source_type} #${l.entry_id}`, memo: l.memo, debit: l.debit || null, credit: l.credit || null, balance: running })
    }
    return {
      title: `General Ledger - ${acct.code} ${acct.name}`,
      subtitle: `${range.from} to ${range.to}`,
      columns: [
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'ref', label: 'Source' },
        { key: 'memo', label: 'Description' },
        { key: 'debit', label: 'Debit', type: 'money' },
        { key: 'credit', label: 'Credit', type: 'money' },
        { key: 'balance', label: 'Balance', type: 'money' },
      ],
      rows,
      totals: { debit: r2(debit), credit: r2(credit) },
    }
  }

  _report_journal({ from, to }) {
    const range = this._range(from, to)
    const rows = this.db
      .prepare(
        `SELECT e.entry_date AS date, e.id AS entry, e.source_type AS source, a.code AS code, a.name AS account,
           COALESCE(l.memo, e.memo) AS memo, l.debit, l.credit
         FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
         WHERE e.entry_date >= ? AND e.entry_date <= ? ORDER BY e.entry_date, e.id, l.id`,
      )
      .all(range.from, range.to)
      .map((r) => ({ ...r, debit: r.debit || null, credit: r.credit || null }))
    return {
      title: 'Journal',
      subtitle: `${range.from} to ${range.to}`,
      columns: [
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'entry', label: 'Entry #', type: 'number' },
        { key: 'source', label: 'Source' },
        { key: 'code', label: 'Code' },
        { key: 'account', label: 'Account' },
        { key: 'memo', label: 'Description' },
        { key: 'debit', label: 'Debit', type: 'money' },
        { key: 'credit', label: 'Credit', type: 'money' },
      ],
      rows,
      totals: { debit: r2(rows.reduce((s, r) => s + (r.debit || 0), 0)), credit: r2(rows.reduce((s, r) => s + (r.credit || 0), 0)) },
    }
  }

  _report_cashBook({ from, to }) {
    const range = this._range(from, to)
    const ids = MONEY_ACCOUNTS.map((k) => this._acct(k))
    const marks = ids.map(() => '?').join(',')
    const before = this.db
      .prepare(
        `SELECT COALESCE(SUM(l.debit - l.credit),0) AS b FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
         WHERE l.account_id IN (${marks}) AND e.entry_date < ?`,
      )
      .get(...ids, range.from).b
    let running = r2(before)
    const rows = [{ date: range.from, account: '', memo: 'Opening balance', receipts: null, payments: null, balance: running, _kind: 'subtotal' }]
    const lines = this.db
      .prepare(
        `SELECT e.entry_date AS date, a.name AS account, COALESCE(l.memo, e.memo) AS memo, l.debit, l.credit
         FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
         WHERE l.account_id IN (${marks}) AND e.entry_date >= ? AND e.entry_date <= ? ORDER BY e.entry_date, e.id, l.id`,
      )
      .all(...ids, range.from, range.to)
    let receipts = 0
    let payments = 0
    for (const l of lines) {
      running = r2(running + l.debit - l.credit)
      receipts += l.debit
      payments += l.credit
      rows.push({ date: l.date, account: l.account, memo: l.memo, receipts: l.debit || null, payments: l.credit || null, balance: running })
    }
    return {
      title: 'Cash Book',
      subtitle: `Cash, bank and mobile money - ${range.from} to ${range.to}`,
      columns: [
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'account', label: 'Account' },
        { key: 'memo', label: 'Description' },
        { key: 'receipts', label: 'Money in', type: 'money' },
        { key: 'payments', label: 'Money out', type: 'money' },
        { key: 'balance', label: 'Balance', type: 'money' },
      ],
      rows,
      totals: { receipts: r2(receipts), payments: r2(payments) },
    }
  }

  _report_arAging({ asOf }) {
    const day = this._date(asOf, 'As-at date')
    const rows = this.openInvoices({ asOf: day }).map((r) => ({
      customer: r.customer_name || 'Walk-in / no customer',
      number: r.number,
      date: r.date,
      days: r.days,
      total: r.total,
      paid: r.paid,
      balance: r.balance,
      b0: r.days <= 30 ? r.balance : null,
      b1: r.days > 30 && r.days <= 60 ? r.balance : null,
      b2: r.days > 60 && r.days <= 90 ? r.balance : null,
      b3: r.days > 90 ? r.balance : null,
    }))
    rows.sort((a, b) => a.customer.localeCompare(b.customer) || a.date.localeCompare(b.date))
    return this._agingTable('Customer Aging (Receivables)', day, 'customer', 'Customer', 'Invoice', rows)
  }

  _report_apAging({ asOf }) {
    const day = this._date(asOf, 'As-at date')
    const rows = this.db
      .prepare(
        `SELECT b.id, b.bill_number, b.bill_date, b.total, s.name AS supplier_name,
           COALESCE((SELECT SUM(p.amount) FROM bill_payments p WHERE p.bill_id = b.id AND p.paid_at <= @day), 0) AS paid
         FROM supplier_bills b LEFT JOIN suppliers s ON s.id = b.supplier_id WHERE b.bill_date <= @day ORDER BY b.bill_date, b.id`,
      )
      .all({ day })
      .map((b) => {
        const days = daysBetween(b.bill_date, day)
        const balance = r2(b.total - b.paid)
        return {
          supplier: b.supplier_name || 'No supplier',
          number: b.bill_number || `#${b.id}`,
          date: b.bill_date,
          days,
          total: r2(b.total),
          paid: r2(b.paid),
          balance,
          b0: days <= 30 ? balance : null,
          b1: days > 30 && days <= 60 ? balance : null,
          b2: days > 60 && days <= 90 ? balance : null,
          b3: days > 90 ? balance : null,
        }
      })
      .filter((r) => r.balance > EPS)
    return this._agingTable('Supplier Aging (Payables)', day, 'supplier', 'Supplier', 'Bill', rows)
  }

  _agingTable(title, day, partyKey, partyLabel, docLabel, rows) {
    const sum = (k) => r2(rows.reduce((s, r) => s + (r[k] || 0), 0))
    return {
      title,
      subtitle: `As at ${day}`,
      columns: [
        { key: partyKey, label: partyLabel },
        { key: 'number', label: docLabel },
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'days', label: 'Days', type: 'number' },
        { key: 'total', label: 'Total', type: 'money' },
        { key: 'paid', label: 'Paid', type: 'money' },
        { key: 'balance', label: 'Balance', type: 'money' },
        { key: 'b0', label: '0-30', type: 'money' },
        { key: 'b1', label: '31-60', type: 'money' },
        { key: 'b2', label: '61-90', type: 'money' },
        { key: 'b3', label: '90+', type: 'money' },
      ],
      rows,
      totals: { total: sum('total'), paid: sum('paid'), balance: sum('balance'), b0: sum('b0'), b1: sum('b1'), b2: sum('b2'), b3: sum('b3') },
    }
  }

  _report_vat({ from, to }) {
    const range = this._range(from, to)
    const vatOut = this._acct('vat_output')
    const vatIn = this._acct('vat_input')
    const entries = this.db
      .prepare(
        `SELECT DISTINCT e.id, e.entry_date, e.source_type, e.source_id, e.memo FROM journal_entries e
         JOIN journal_lines l ON l.entry_id = e.id
         WHERE l.account_id IN (?, ?) AND e.entry_date >= ? AND e.entry_date <= ? ORDER BY e.entry_date, e.id`,
      )
      .all(vatOut, vatIn, range.from, range.to)
    const lineStmt = this.db.prepare(`SELECT account_id, debit, credit FROM journal_lines WHERE entry_id = ?`)
    const rows = []
    let outputVat = 0
    let outputNet = 0
    let inputVat = 0
    let inputNet = 0
    for (const e of entries) {
      const lines = lineStmt.all(e.id)
      const out = lines.filter((l) => l.account_id === vatOut).reduce((s, l) => s + l.credit - l.debit, 0)
      const inn = lines.filter((l) => l.account_id === vatIn).reduce((s, l) => s + l.debit - l.credit, 0)
      if (out) {
        const net = lines.filter((l) => l.account_id !== vatOut && l.credit > 0 && l.account_id === this._acct('sales')).reduce((s, l) => s + l.credit, 0)
        outputVat += out
        outputNet += net
        rows.push({ date: e.entry_date, kind: 'Sales (output VAT)', memo: e.memo, net: r2(net), vat: r2(out) })
      }
      if (inn) {
        const net = lines.filter((l) => l.account_id !== vatIn && l.debit > 0).reduce((s, l) => s + l.debit, 0)
        inputNet += net
        inputVat += inn
        rows.push({ date: e.entry_date, kind: 'Purchases (input VAT)', memo: e.memo, net: r2(net), vat: r2(-inn) })
      }
    }
    const vat = this._vat()
    rows.push({ date: '', kind: 'Output VAT collected', memo: `Sales excl. VAT ${r2(outputNet).toFixed(2)}`, net: null, vat: r2(outputVat), _kind: 'subtotal' })
    rows.push({ date: '', kind: 'Input VAT claimable', memo: `Purchases excl. VAT ${r2(inputNet).toFixed(2)}`, net: null, vat: r2(-inputVat), _kind: 'subtotal' })
    rows.push({ date: '', kind: 'VAT payable / (refundable)', memo: vat.registered ? `VAT no. ${vat.vatNumber}` : 'No VAT number set in Settings', net: null, vat: r2(outputVat - inputVat), _kind: 'total' })
    return {
      title: 'VAT Summary',
      subtitle: `${range.from} to ${range.to}${vat.registered ? ` - VAT no. ${vat.vatNumber}` : ''} - default rate ${vat.rate}%`,
      columns: [
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'kind', label: 'Type' },
        { key: 'memo', label: 'Document' },
        { key: 'net', label: 'Amount excl. VAT', type: 'money' },
        { key: 'vat', label: 'VAT', type: 'money' },
      ],
      rows,
      totals: null,
      meta: { vatPayable: r2(outputVat - inputVat), registered: vat.registered },
    }
  }

  _report_salesByProduct({ from, to }) {
    const range = this._range(from, to)
    const rows = this.db
      .prepare(
        `SELECT MAX(ti.name) AS product, SUM(ti.quantity) AS qty,
           SUM(COALESCE(ti.line_total,0)) AS gross,
           SUM(CASE WHEN ti.tax_rate > 0 THEN COALESCE(ti.line_total,0) * ti.tax_rate / (100 + ti.tax_rate) ELSE 0 END) AS vat,
           SUM(CASE WHEN ti.product_id IS NOT NULL THEN ti.quantity * COALESCE(ti.unit_cost,0) ELSE 0 END) AS cost
         FROM transaction_items ti JOIN transactions tx ON tx.id = ti.transaction_id
         WHERE tx.type = 'invoice' AND tx.status IN ('invoice','paid') AND ${TX_DATE} >= ? AND ${TX_DATE} <= ?
         GROUP BY CASE WHEN ti.product_id IS NULL THEN 'n:' || ti.name ELSE 'p:' || ti.product_id END
         ORDER BY gross DESC`,
      )
      .all(range.from, range.to)
      .map((r) => {
        const sales = r2(r.gross - r.vat)
        return { product: r.product, qty: r.qty, sales, vat: r2(r.vat), cost: r2(r.cost), profit: r2(sales - r.cost) }
      })
    const sum = (k) => r2(rows.reduce((s, r) => s + r[k], 0))
    return {
      title: 'Sales by Product',
      subtitle: `${range.from} to ${range.to} (line discounts included; invoice-level discounts are not split by product)`,
      columns: [
        { key: 'product', label: 'Product' },
        { key: 'qty', label: 'Qty', type: 'number' },
        { key: 'sales', label: 'Sales excl. VAT', type: 'money' },
        { key: 'vat', label: 'VAT', type: 'money' },
        { key: 'cost', label: 'Cost of sales', type: 'money' },
        { key: 'profit', label: 'Gross profit', type: 'money' },
      ],
      rows,
      totals: { sales: sum('sales'), vat: sum('vat'), cost: sum('cost'), profit: sum('profit') },
    }
  }

  _report_stockValuation() {
    const rows = this.db
      .prepare(
        `SELECT sku, name, stock_qty AS qty, cost_price AS cost, selling_price AS price, stock_qty * cost_price AS value
         FROM products WHERE is_active = 1 ORDER BY name`,
      )
      .all()
      .map((r) => ({ ...r, sku: r.sku || '', value: r2(r.value) }))
    const ledger = this._balances({}).find((a) => a.system_key === 'inventory')?.balance || 0
    return {
      title: 'Stock Valuation',
      subtitle: `At cost price, as at ${this._today()}`,
      columns: [
        { key: 'sku', label: 'SKU' },
        { key: 'name', label: 'Product' },
        { key: 'qty', label: 'Qty', type: 'number' },
        { key: 'cost', label: 'Unit cost', type: 'money' },
        { key: 'price', label: 'Selling price', type: 'money' },
        { key: 'value', label: 'Value at cost', type: 'money' },
      ],
      rows,
      totals: { value: r2(rows.reduce((s, r) => s + r.value, 0)) },
      meta: { inventoryLedger: ledger },
    }
  }

  _report_chartOfAccounts() {
    const rows = this.accounts().map((a) => ({ code: a.code, name: a.name, type: a.type, active: a.is_active ? 'Yes' : 'No', balance: a.balance }))
    return {
      title: 'Chart of Accounts',
      subtitle: `As at ${this._today()}`,
      columns: [
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Account' },
        { key: 'type', label: 'Type' },
        { key: 'active', label: 'Active' },
        { key: 'balance', label: 'Balance', type: 'money' },
      ],
      rows,
      totals: null,
    }
  }
}

export const REPORT_NAMES = [
  'trialBalance',
  'profitAndLoss',
  'balanceSheet',
  'generalLedger',
  'journal',
  'cashBook',
  'arAging',
  'apAging',
  'vat',
  'salesByProduct',
  'stockValuation',
  'chartOfAccounts',
]
