import { createHash } from 'node:crypto';
import schemaJson from './sync-schema.json' with { type: 'json' };

/**
 * Cloud-sync schema helpers. The JSON file next to this one is the single source
 * of truth for WHICH tables/columns are mirrored; the Laravel server reads an
 * identical copy. Nothing else in the app hard-codes table names for sync.
 */
export const SYNC_SCHEMA = schemaJson;

export function loadSchema() {
  return SYNC_SCHEMA;
}

/** All mirrored columns of an entity, key first - exactly what the outbox payload contains. */
export function payloadColumns(entity) {
  return [entity.key.name, ...Object.keys(entity.columns)];
}

/** Changes whenever the JSON changes; stored so triggers are rebuilt only when needed. */
export function schemaHash(schema = SYNC_SCHEMA, generatorVersion = 1) {
  return createHash('sha1').update(`${generatorVersion}:${JSON.stringify(schema)}`).digest('hex');
}
