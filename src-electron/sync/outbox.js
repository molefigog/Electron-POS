import { SYNC_SCHEMA } from './schema.js';
import { payloadExpr, skipClause } from './triggers.js';

/**
 * The outbox is a local queue of "this row changed" events. Everything that
 * touches it lives here, so the rest of the sync code never writes SQL for it.
 */

export function getState(db, key, fallback = '') {
  return db.prepare(`SELECT value FROM sync_state WHERE key = ?`).get(key)?.value ?? fallback;
}

export function setState(db, key, value) {
  db.prepare(`INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, String(value));
}

export function stats(db) {
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN sent_at IS NULL AND rejected_at IS NULL THEN 1 ELSE 0 END), 0) AS pending,
         COALESCE(SUM(CASE WHEN rejected_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS rejected,
         MIN(CASE WHEN sent_at IS NULL AND rejected_at IS NULL THEN created_at END) AS oldest_pending
       FROM sync_outbox`,
    )
    .get();
  return { pending: row.pending, rejected: row.rejected, oldestPending: row.oldest_pending };
}

/**
 * Next batch to upload. Because every event carries the WHOLE row, only the newest
 * event per row matters ("compaction"): ten edits of one invoice upload once.
 * `covers` maps each sent event id to every older event id it replaces, so all of
 * them are marked done when the server acknowledges the survivor.
 */
export function nextBatch(db, { maxEvents = 200, maxBytes = 1_500_000 } = {}) {
  const rows = db
    .prepare(
      `SELECT id, entity, row_key, op, payload, created_at FROM sync_outbox
       WHERE sent_at IS NULL AND rejected_at IS NULL ORDER BY id LIMIT ?`,
    )
    .all(maxEvents * 4);

  const newest = new Map();
  const covered = new Map();
  for (const r of rows) {
    const k = `${r.entity}\u0000${r.row_key}`;
    newest.set(k, r);
    if (!covered.has(k)) covered.set(k, []);
    covered.get(k).push(r.id);
  }

  const events = [];
  const covers = new Map();
  let bytes = 0;
  for (const r of [...newest.values()].sort((a, b) => a.id - b.id)) {
    const size = (r.payload ? r.payload.length : 0) + 160;
    if (events.length && (events.length >= maxEvents || bytes + size > maxBytes)) break;
    events.push({
      id: r.id,
      entity: r.entity,
      key: r.row_key,
      op: r.op,
      payload: r.payload ? JSON.parse(r.payload) : null,
      at: r.created_at,
    });
    covers.set(r.id, covered.get(`${r.entity}\u0000${r.row_key}`));
    bytes += size;
  }
  return { events, covers, ackIds: (ids) => ids.flatMap((id) => covers.get(id) || []) };
}

export function markAttempt(db, ids) {
  db.prepare(`UPDATE sync_outbox SET attempts = attempts + 1 WHERE id IN (SELECT value FROM json_each(?))`).run(JSON.stringify(ids));
}

export function markSent(db, ids) {
  if (!ids.length) return;
  db.prepare(`UPDATE sync_outbox SET sent_at = CURRENT_TIMESTAMP WHERE id IN (SELECT value FROM json_each(?))`).run(JSON.stringify(ids));
}

export function markRejected(db, ids, reason) {
  if (!ids.length) return;
  db.prepare(
    `UPDATE sync_outbox SET rejected_at = CURRENT_TIMESTAMP, reject_reason = ? WHERE id IN (SELECT value FROM json_each(?))`,
  ).run(String(reason || 'rejected').slice(0, 300), JSON.stringify(ids));
}

export function listRejected(db, limit = 50) {
  return db
    .prepare(`SELECT id, entity, row_key, op, reject_reason, rejected_at FROM sync_outbox WHERE rejected_at IS NOT NULL ORDER BY id DESC LIMIT ?`)
    .all(limit);
}

/** Put rejected events back in the queue (after you fixed the cause, e.g. updated the server). */
export function retryRejected(db) {
  return db.prepare(`UPDATE sync_outbox SET rejected_at = NULL, reject_reason = NULL WHERE rejected_at IS NOT NULL`).run().changes;
}

/** Delete events the server already has. Keeps a week by default as a local audit trail. */
export function prune(db, keepDays = 7) {
  return db.prepare(`DELETE FROM sync_outbox WHERE sent_at IS NOT NULL AND sent_at < datetime('now', ?)`).run(`-${Number(keepDays)} days`).changes;
}

export function clear(db) {
  db.prepare(`DELETE FROM sync_outbox`).run();
}

/**
 * Queue every existing row of every mirrored table, parents first. Used when a PC
 * connects for the first time, and by "Upload everything again".
 */
export function enqueueSnapshot(db, schema = SYNC_SCHEMA) {
  const counts = {};
  db.transaction(() => {
    for (const name of schema.order) {
      const e = schema.entities[name];
      const k = `"${e.key.name}"`;
      const where = skipClause(e, 'src').replace(/^ AND /, ' WHERE ');
      const info = db
        .prepare(
          `INSERT INTO sync_outbox (entity, row_key, op, payload)
           SELECT '${name}', CAST(src.${k} AS TEXT), 'upsert', ${payloadExpr(e, 'src')} FROM "${e.table}" AS src${where} ORDER BY src.${k}`,
        )
        .run();
      counts[name] = info.changes;
    }
    setState(db, 'cloud_snapshot_enqueued_at', new Date().toISOString());
  })();
  return counts;
}
