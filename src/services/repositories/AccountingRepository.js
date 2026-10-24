import { BaseRepository } from './BaseRepository';

/**
 * Accounting always talks to the LOCAL database (single PC) or to the main PC's
 * database (LAN client) through dbBridge. It is intentionally not routed through
 * the internet API / sync queue - the accounting tables only exist in the desktop
 * database. Method names below are NOT in BaseRepository's MUTATING_METHODS set,
 * so nothing here is queued for sync.
 */
class AccountingRepository extends BaseRepository {
  constructor() { super('accounting'); }

  call(method, ...args) {
    if (!window.dbBridge) {
      throw new Error('Accounting is only available inside the desktop app.');
    }
    return window.dbBridge.call(this.name, method, JSON.parse(JSON.stringify(args)));
  }

  overview() { return this.call('overview'); }
  /** name: trialBalance | profitAndLoss | balanceSheet | generalLedger | journal | cashBook | arAging | apAging | vat | salesByProduct | stockValuation | chartOfAccounts */
  report(name, params = {}) { return this.call('report', name, params); }
  rebuild() { return this.call('rebuild'); }

  openInvoices(opts = {}) { return this.call('openInvoices', opts); }
  customerPayments(opts = {}) { return this.call('customerPayments', opts); }
  recordCustomerPayment(data) { return this.call('recordCustomerPayment', data); }
  deleteCustomerPayment(id) { return this.call('deleteCustomerPayment', id); }

  expenses(opts = {}) { return this.call('expenses', opts); }
  createExpense(data) { return this.call('createExpense', data); }
  updateExpense(id, data) { return this.call('updateExpense', id, data); }
  deleteExpense(id) { return this.call('deleteExpense', id); }

  bills(opts = {}) { return this.call('bills', opts); }
  billPayments(billId) { return this.call('billPayments', billId); }
  purchaseOrdersToBill() { return this.call('purchaseOrdersToBill'); }
  createBill(data) { return this.call('createBill', data); }
  updateBill(id, data) { return this.call('updateBill', id, data); }
  deleteBill(id) { return this.call('deleteBill', id); }
  recordBillPayment(data) { return this.call('recordBillPayment', data); }
  deleteBillPayment(id) { return this.call('deleteBillPayment', id); }

  accounts(opts = {}) { return this.call('accounts', opts); }
  createAccount(data) { return this.call('createAccount', data); }
  updateAccount(id, data) { return this.call('updateAccount', id, data); }
  deleteAccount(id) { return this.call('deleteAccount', id); }

  journalEntries(opts = {}) { return this.call('journalEntries', opts); }
  createJournalEntry(data) { return this.call('createJournalEntry', data); }
  deleteJournalEntry(id) { return this.call('deleteJournalEntry', id); }
  postOpeningStock(opts = {}) { return this.call('postOpeningStock', opts); }
  getLockDate() { return this.call('getLockDate'); }
  setLockDate(date) { return this.call('setLockDate', date); }
}

export default new AccountingRepository();
