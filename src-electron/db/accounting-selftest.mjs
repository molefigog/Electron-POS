// Accounting self-test: node src-electron/db/accounting-selftest.mjs
// (needs better-sqlite3 built for plain Node - run `npm rebuild better-sqlite3` if it was built for Electron).
import Database from 'better-sqlite3'
import assert from 'node:assert/strict'
import { runMigrations } from '../../migrations.js'
import {
  TransactionRepository,
  ProductRepository,
  SettingsRepository,
  CustomerRepository,
  SupplierRepository,
} from './repositories.js'
import { AccountingRepository, REPORT_NAMES } from './accounting-repository.js'

const db = new Database(':memory:')
db.pragma('foreign_keys = ON')
runMigrations(db)
const settings = new SettingsRepository(db)
settings.update({ default_tax_rate: '15', company_vat: 'VAT-777' })
const acc = new AccountingRepository(db),
  tx = new TransactionRepository(db)
const cust = new CustomerRepository(db).create({ name: 'Acme' })
const sup = new SupplierRepository(db).create({ name: 'Tiles Ltd' })
const prod = new ProductRepository(db).create({
  name: 'Paint',
  sku: 'P1',
  cost_price: 60,
  selling_price: 115,
  stock_qty: 100,
})
const bal = (key) => acc.accounts().find((a) => a.system_key === key).balance
const item = (qty, price = 115, rate = 15) => ({
  product_id: prod.id,
  name: 'Paint',
  quantity: qty,
  unit_price: price,
  box_size: null,
  box_count: null,
  discount_pct: 0,
  tax_rate: rate,
  line_total: 0,
})
const tb = () => acc.report('trialBalance', {})
const ok = (label) => console.log('  ok -', label)

// 1. credit invoice
const inv = tx.create({ type: 'invoice', customerId: cust.id, items: [item(2)] })
assert.equal(bal('ar'), 230)
assert.equal(bal('sales'), 200)
assert.equal(bal('vat_output'), 30)
assert.equal(bal('cogs'), 120)
assert.equal(tb().meta.balanced, true)
ok('credit invoice posts AR / sales / VAT / COGS, balanced')

// 2. part + full payment
acc.recordCustomerPayment({ transactionId: inv.id, method: 'eft', amount: 100 })
assert.equal(tx.find(inv.id).status, 'invoice')
assert.equal(bal('bank'), 100)
assert.throws(
  () => acc.recordCustomerPayment({ transactionId: inv.id, amount: 999 }),
  /more than the balance/,
)
const p2 = acc.recordCustomerPayment({ transactionId: inv.id, method: 'cash', amount: 130 })
assert.equal(tx.find(inv.id).status, 'paid')
assert.equal(bal('ar'), 0)
acc.deleteCustomerPayment(p2.id)
assert.equal(tx.find(inv.id).status, 'invoice')
assert.equal(bal('ar'), 130)
acc.recordCustomerPayment({ transactionId: inv.id, method: 'cash', amount: 130 })
ok('part payments, status paid/unpaid, overpay refused')

// 3. voiding an invoice that has payments is refused
assert.throws(() => tx.update(inv.id, { items: [item(2)], status: 'void' }), /Remove the payments/)
ok('void with payments refused')

// 4. POS cash with change, and split
tx.create({ type: 'invoice', customerId: null, items: [item(1)], amountTendered: 200 })
assert.equal(bal('cash'), 130 + 115)
assert.equal(bal('ar'), 0)
tx.create({
  type: 'invoice',
  customerId: null,
  items: [item(1)],
  payments: [
    { method: 'speedpoint', amount: 50 },
    { method: 'cash', amount: 100 },
  ],
})
assert.equal(bal('bank'), 150)
assert.equal(bal('cash'), 130 + 115 + 65)
ok('POS cash change + split payment')

// 5. header discount shrinks VAT proportionally
const disc = tx.create({
  type: 'invoice',
  customerId: cust.id,
  items: [item(2)],
  discountTotal: 23,
})
const d = acc
  .journalEntries({ sourceType: 'invoice' })
  .find((e) => e.memo === `Sale ${disc.number}`)
assert.equal(d.total, 207 + 120) // AR 207 + COGS 120 debits
assert.equal(d.lines.find((l) => l.account_code === '2100').credit, 27) // 30 * 207/230
assert.equal(tb().meta.balanced, true)
ok('invoice discount')

// 6. edit invoice re-posts (no duplicates); void unposts
tx.update(disc.id, { items: [item(1)], discountTotal: 0 })
assert.equal(
  acc.journalEntries({ sourceType: 'invoice' }).filter((e) => e.memo === `Sale ${disc.number}`)
    .length,
  1,
)
tx.update(disc.id, { items: [item(1)], discountTotal: 0, status: 'void' })
assert.equal(
  acc.journalEntries({ sourceType: 'invoice' }).filter((e) => e.memo === `Sale ${disc.number}`)
    .length,
  0,
)
ok('edit re-posts, void unposts')

// 7. quote -> invoice, delete
const q = tx.create({ type: 'quote', customerId: cust.id, items: [item(1)] })
assert.equal(acc.journalEntries({}).filter((e) => e.memo === `Sale ${q.number}`).length, 0)
const conv = tx.convertQuoteToInvoice(q.id)
assert.equal(
  acc.journalEntries({ sourceType: 'invoice' }).some((e) => e.memo === `Sale ${conv.number}`),
  true,
)
tx.delete(conv.id)
assert.equal(
  acc.journalEntries({ sourceType: 'invoice' }).some((e) => e.memo === `Sale ${conv.number}`),
  false,
)
ok('quote convert + delete')

// 8. cost snapshot survives cost price change
const before = bal('cogs')
db.prepare('UPDATE products SET cost_price = 999 WHERE id = ?').run(prod.id)
acc.rebuild()
assert.equal(bal('cogs'), before)
ok('cost snapshot kept after cost_price edit')

// 9. expenses with VAT (registered) and without
const exp = acc.accounts().find((a) => a.code === '6000')
const e1 = acc.createExpense({
  accountId: exp.id,
  amount: 115,
  includesVat: true,
  method: 'cash',
  description: 'Rent',
})
assert.equal(e1.tax_amount, 15)
assert.equal(bal('vat_input'), 15)
acc.updateExpense(e1.id, {
  accountId: exp.id,
  amount: 230,
  includesVat: true,
  method: 'eft',
  expenseDate: acc._today(),
})
assert.equal(bal('vat_input'), 30)
settings.update({ company_vat: '' })
const e2 = acc.createExpense({ accountId: exp.id, amount: 115, includesVat: true, method: 'cash' })
assert.equal(e2.tax_amount, 0)
settings.update({ company_vat: 'VAT-777' })
acc.deleteExpense(e2.id)
ok('expenses, VAT only when VAT number set')

// 10. bills
const bill = acc.createBill({
  supplierId: sup.id,
  billNumber: 'B1',
  amount: 575,
  includesVat: true,
  accountId: acc._acct('inventory'),
})
assert.equal(bal('ap'), 575)
acc.recordBillPayment({ billId: bill.id, amount: 300, method: 'eft' })
assert.equal(bal('ap'), 275)
assert.throws(() => acc.deleteBill(bill.id), /Remove the payments/)
acc.recordBillPayment({ billId: bill.id, amount: 275, method: 'cash' })
assert.equal(acc.bills()[0].status, 'paid')
ok('bills + payments')

// 11. manual journal + opening stock + lock
assert.throws(
  () =>
    acc.createJournalEntry({
      date: '2026-01-01',
      lines: [
        { accountId: 1, debit: 10 },
        { accountId: 2, credit: 5 },
      ],
    }),
  /not balanced/,
)
acc.createJournalEntry({
  date: '2026-01-01',
  memo: 'Owner capital',
  lines: [
    { accountId: acc._acct('cash'), debit: 1000 },
    { accountId: acc._acct('equity'), credit: 1000 },
  ],
})
acc.postOpeningStock({ date: '2026-01-01' })
assert.throws(() => acc.postOpeningStock({}), /already been posted/)
acc.setLockDate('2026-01-31')
assert.throws(
  () =>
    acc.createJournalEntry({
      date: '2026-01-15',
      lines: [
        { accountId: 1, debit: 1 },
        { accountId: 2, credit: 1 },
      ],
    }),
  /closed up to/,
)
acc.setLockDate('')
ok('manual journal, opening stock, period lock')

// 12. every report runs; balance sheet balances; exports shape
const t = acc.today ?? acc._today()
for (const n of REPORT_NAMES) {
  const r = acc.report(n, { accountId: acc._acct('cash'), from: '2026-01-01', to: t, asOf: t })
  assert.ok(r.columns.length && Array.isArray(r.rows), n)
}
assert.equal(acc.report('balanceSheet', {}).meta.balanced, true)
assert.equal(acc.report('trialBalance', {}).meta.balanced, true)
const vat = acc.report('vat', { from: '2026-01-01', to: t })
console.log('  VAT payable', vat.meta.vatPayable)
const pl = acc.report('profitAndLoss', { from: '2026-01-01', to: t })
console.log('  P&L net profit', pl.rows.at(-1).amount)
console.log('  overview', JSON.stringify(acc.overview().cash), 'AR', acc.overview().receivables)
ok('all reports run, books balance')

// 13. backfill on legacy data
const db2 = new Database(':memory:')
db2.pragma('foreign_keys = ON')
runMigrations(db2)
db2.prepare("UPDATE settings SET value='15' WHERE key='default_tax_rate'").run()
db2
  .prepare("INSERT INTO products (name,cost_price,selling_price,stock_qty) VALUES ('X',10,23,5)")
  .run()
db2
  .prepare(
    "INSERT INTO transactions (number,type,status,subtotal,tax_total,grand_total,issued_at) VALUES ('INV-1','invoice','paid',20,3,23,'2026-02-01')",
  )
  .run()
db2
  .prepare(
    "INSERT INTO transactions (number,type,status,subtotal,tax_total,grand_total,issued_at) VALUES ('INV-2','invoice','invoice',20,3,23,'2026-02-02')",
  )
  .run()
db2
  .prepare(
    "INSERT INTO transaction_items (transaction_id,product_id,name,quantity,unit_price,tax_rate,line_total) VALUES (1,1,'X',1,23,15,23),(2,1,'X',1,23,15,23)",
  )
  .run()
const a2 = new AccountingRepository(db2)
console.log('  backfill', a2.ensureBackfilled(), a2.ensureBackfilled())
assert.equal(a2.openInvoices({}).length, 1)
assert.equal(a2.report('trialBalance', {}).meta.balanced, true)
assert.equal(a2.accounts().find((a) => a.system_key === 'ar').balance, 23)
ok('backfill: paid legacy invoice settled, unpaid stays receivable')
console.log('ALL PASSED')
