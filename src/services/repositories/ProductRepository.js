import { BaseRepository } from './BaseRepository';

class ProductRepository extends BaseRepository {
  constructor() { super('products'); }

  all(filters = {}) { return this.call('all', filters); }
  find(id) { return this.call('find', id); }
  findByBarcode(barcode) { return this.call('findByBarcode', barcode); }
  create(data) { return this.call('create', data); }
  update(id, data) { return this.call('update', id, data); }
  delete(id) { return this.call('delete', id); }
}

export default new ProductRepository();
