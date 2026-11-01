import { SYNC_SCHEMA, payloadColumns } from './schema.js';

/**
 * "My SSD died" path: copy everything the cloud holds for this device back into
 * an EMPTY local database, keeping the original row ids (so invoice numbers,
 * foreign keys and the chart of accounts come back exactly as they were).
 *
 * Safety rules
 *  - refuses unless the database has no business data yet (fresh install)
 *  - sync_control.applying = 1 while writing, so the restore is not queued for upload again
 *  - foreign keys are switched off while loading (pages arrive table by table) and
 *    verified afterwards with PRAGMA foreign_key_check
 */
const PAGE = 500;

export function isBusinessDataEmpty(db) {
  const n = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM transactions) + (SELECT COUNT(*) FROM products) +
              (SELECT COUNT(*) FROM customers) + (SELECT COUNT(*) FROM expenses) AS n`,
    )
    .get().n;
  return n === 0;
}

function insertStatement(db, entity) {
  const cols = payloadColumns(entity);
  const names = cols.map((c) => `"${c}"`).join(', ');
  const marks = cols.map((c) => `@${c}`).join(', ');
  if (entity.key.type === 'string') {
    const updates = cols.filter((c) => c !== entity.key.name).map((c) => `"${c}" = excluded."${c}"`).join(', ');
    return db.prepare(`INSERT INTO "${entity.table}" (${names}) VALUES (${marks}) ON CONFLICT("${entity.key.name}") DO UPDATE SET ${updates}`);
  }
  return db.prepare(`INSERT OR REPLACE INTO "${entity.table}" (${names}) VALUES (${marks})`);
}

export async function restoreFromCloud({ db, client, schema = SYNC_SCHEMA, onProgress = () => {} }) {
  if (!isBusinessDataEmpty(db)) {
    throw new Error('Restore only works on a new, empty installation. This PC already has products, customers or sales.');
  }
  const manifest = await client.manifest();
  if (manifest.schema_version !== schema.version) {
    throw new Error(`The server uses sync version ${manifest.schema_version} but this app uses ${schema.version}. Update the older one first.`);
  }

  const totals = manifest.counts || {};
  const result = {};
  db.pragma('foreign_keys = OFF');
  db.prepare('UPDATE sync_control SET applying = 1 WHERE id = 1').run();
  try {
    // Fresh installs contain seed rows (default tax, chart of accounts...). The cloud copy replaces them.
    db.transaction(() => {
      for (const name of [...schema.order].reverse()) {
        if (schema.entities[name].key.type === 'string') continue; // settings are merged, not wiped
        db.prepare(`DELETE FROM "${schema.entities[name].table}"`).run();
      }
    })();

    for (const name of schema.order) {
      const entity = schema.entities[name];
      const insert = insertStatement(db, entity);
      const cols = payloadColumns(entity);
      const write = db.transaction((rows) => {
        for (const row of rows) insert.run(Object.fromEntries(cols.map((c) => [c, row[c] ?? null])));
      });
      let after = null;
      let done = 0;
      for (;;) {
        const page = await client.snapshotPage({ entity: name, after, limit: PAGE });
        write(page.rows || []);
        done += (page.rows || []).length;
        onProgress({ entity: name, done, total: totals[name] ?? done });
        if (page.next_after === null || page.next_after === undefined) break;
        after = page.next_after;
      }
      result[name] = done;
    }
  } finally {
    db.prepare('UPDATE sync_control SET applying = 0 WHERE id = 1').run();
    db.pragma('foreign_keys = ON');
  }
  const problems = db.pragma('foreign_key_check');
  return { restored: result, foreignKeyProblems: problems.length };
}
