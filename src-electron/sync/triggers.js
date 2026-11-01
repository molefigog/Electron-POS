import { SYNC_SCHEMA, payloadColumns, schemaHash } from './schema.js';

/**
 * SQLite triggers that copy every change of a mirrored table into sync_outbox,
 * inside the same transaction as the change itself - so a sale and its outbox
 * event are saved together or not at all, whichever code path wrote the sale.
 *
 * Triggers are generated from sync-schema.json (never hand-written) and are only
 * installed while this PC is connected to a cloud server, so an unused feature
 * costs nothing. Names start with "cloud_" so they can be found and replaced.
 */
const PREFIX = 'cloud_';
const GENERATOR_VERSION = 1; // bump if the SQL below changes shape
const q = (name) => `"${name}"`;

/** json_object('id', NEW."id", 'name', NEW."name", ...) */
export function payloadExpr(entity, ref) {
  return `json_object(${payloadColumns(entity).map((c) => `'${c}', ${ref}.${q(c)}`).join(', ')})`;
}

/** SQL fragment that is false for rows that must never leave this PC (e.g. cloud_* settings). */
export function skipClause(entity, ref) {
  return (entity.skipKeyPrefixes || [])
    .map((p) => ` AND ${ref}.${q(entity.key.name)} NOT LIKE '${p.replace(/_/g, '\\_')}%' ESCAPE '\\'`)
    .join('');
}

export function buildTriggerSql(schema = SYNC_SCHEMA) {
  const sql = [];
  for (const name of schema.order) {
    const e = schema.entities[name];
    const k = q(e.key.name);
    const notApplying = '(SELECT applying FROM sync_control WHERE id = 1) = 0';
    const upsert = (when, ref) =>
      `INSERT INTO sync_outbox (entity, row_key, op, payload) VALUES ('${name}', CAST(${ref}.${k} AS TEXT), 'upsert', ${payloadExpr(e, ref)});`;
    sql.push(
      `CREATE TRIGGER ${PREFIX}ai_${e.table} AFTER INSERT ON ${q(e.table)} WHEN ${notApplying}${skipClause(e, 'NEW')} BEGIN ${upsert('ai', 'NEW')} END`,
      `CREATE TRIGGER ${PREFIX}au_${e.table} AFTER UPDATE ON ${q(e.table)} WHEN ${notApplying}${skipClause(e, 'NEW')} BEGIN ${upsert('au', 'NEW')} END`,
      `CREATE TRIGGER ${PREFIX}ad_${e.table} AFTER DELETE ON ${q(e.table)} WHEN ${notApplying}${skipClause(e, 'OLD')} BEGIN ` +
        `INSERT INTO sync_outbox (entity, row_key, op, payload) VALUES ('${name}', CAST(OLD.${k} AS TEXT), 'delete', NULL); END`,
    );
  }
  return sql;
}

function existingTriggers(db) {
  return db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'cloud\\_%' ESCAPE '\\'`)
    .all()
    .map((r) => r.name);
}

export function hasTriggers(db) {
  return existingTriggers(db).length > 0;
}

export function removeTriggers(db) {
  db.transaction(() => {
    for (const name of existingTriggers(db)) db.exec(`DROP TRIGGER IF EXISTS ${q(name)}`);
    db.prepare(`DELETE FROM sync_state WHERE key = 'cloud_triggers_hash'`).run();
  })();
}

export function installTriggers(db, schema = SYNC_SCHEMA) {
  db.transaction(() => {
    for (const name of existingTriggers(db)) db.exec(`DROP TRIGGER IF EXISTS ${q(name)}`);
    for (const statement of buildTriggerSql(schema)) db.exec(statement);
    db.prepare(`INSERT INTO sync_state (key, value) VALUES ('cloud_triggers_hash', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(
      schemaHash(schema, GENERATOR_VERSION),
    );
  })();
}

/** Cheap check at every start: rebuild only if the schema changed or a trigger went missing. */
export function ensureTriggers(db, schema = SYNC_SCHEMA) {
  const stored = db.prepare(`SELECT value FROM sync_state WHERE key = 'cloud_triggers_hash'`).get()?.value;
  const expected = schema.order.length * 3;
  if (stored === schemaHash(schema, GENERATOR_VERSION) && existingTriggers(db).length === expected) return false;
  installTriggers(db, schema);
  return true;
}
