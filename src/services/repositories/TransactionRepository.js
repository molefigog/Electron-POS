import { BaseRepository } from './BaseRepository';

class TransactionRepository extends BaseRepository {
  constructor() { super('transactions'); }

  all(filters = {}) { return this.call('all', filters); }
  find(id) { return this.call('find', id); }
  create(data) { return this.call('create', data); }
  update(id, data) { return this.call('update', id, data); }
  delete(id) { return this.call('delete', id); }
  /** The one that matters: quote -> invoice, no re-entry of data. overrides: { issuedAt? } */
  convertToInvoice(quoteId, overrides = {}) { return this.call('convertQuoteToInvoice', quoteId, overrides); }
}

export default new TransactionRepository();
