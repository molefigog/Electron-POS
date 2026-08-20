import { BaseRepository } from './BaseRepository';

class CustomerRepository extends BaseRepository {
  constructor() { super('customers'); }

  all(filters = {}) { return this.call('all', filters); }
  find(id) { return this.call('find', id); }
  create(data) { return this.call('create', data); }
  update(id, data) { return this.call('update', id, data); }
  delete(id) { return this.call('delete', id); }
}

export default new CustomerRepository();
