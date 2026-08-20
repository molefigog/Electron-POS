import { BaseRepository } from './BaseRepository';

class StockRepository extends BaseRepository {
  constructor() { super('stock'); }

  history(productId) { return this.call('history', productId); }
  /** type: 'in' | 'out' | 'adjustment' */
  record(payload) { return this.call('record', payload); }
}

export default new StockRepository();
