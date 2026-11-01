// Lets plain Node scripts (self-tests) read the same JSON the app bundles.
import schema from './sync-schema.json' with { type: 'json' };
export const SYNC_SCHEMA = schema;
