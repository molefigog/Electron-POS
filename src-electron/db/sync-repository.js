export class SyncRepository {
    constructor(db) { this.db = db; }

    pending() {
        return this.db.prepare(`
      SELECT id, sync_id, repository, method, args, created_at
      FROM sync_queue
      WHERE status = 'pending'
      ORDER BY id ASC
    `).all().map((row) => ({ ...row, args: JSON.parse(row.args) }));
    }

    getCursor() {
        return this.db.prepare(`SELECT value FROM sync_state WHERE key = 'cursor'`).get()?.value || null;
    }

    enqueue({ syncId, repository, method, args }) {
        this.db.prepare(`
      INSERT OR IGNORE INTO sync_queue (sync_id, repository, method, args)
      VALUES (?, ?, ?, ?)
    `).run(syncId, repository, method, JSON.stringify(args));
        return { syncId };
    }

    acknowledge({ ids = [], cursor = null }) {
        const run = this.db.transaction(() => {
            if (ids.length) {
                const placeholders = ids.map(() => '?').join(', ');
                this.db.prepare(`UPDATE sync_queue SET status = 'synced', synced_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`).run(...ids);
            }
            if (cursor !== null) {
                this.db.prepare(`INSERT INTO sync_state (key, value) VALUES ('cursor', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(cursor));
            }
        });
        run();
        return { success: true };
    }
}
