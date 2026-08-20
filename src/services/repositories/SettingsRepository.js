import { BaseRepository } from './BaseRepository';

class SettingsRepository extends BaseRepository {
  constructor() { super('settings'); }

  all() { return this.call('all'); }
  update(values) { return this.call('update', values); }
}

export default new SettingsRepository();
