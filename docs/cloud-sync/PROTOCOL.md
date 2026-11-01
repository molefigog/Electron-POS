# Cloud-sync protocol, version 1

The desktop app keeps working from its own SQLite database. Every change is also queued and uploaded to this
server, which keeps a **mirror** of each PC's data so that a lost PC (or dead SSD) can be rebuilt.

* Same text lives in both repos: desktop `docs/cloud-sync/PROTOCOL.md`, server `docs/PROTOCOL.md`. Keep them identical.
* Executable specification (desktop side): `src-electron/sync/fake-server.mjs` + `cloud-selftest.mjs`.
* Server tests: `tests/Feature/SyncApiTest.php`.

## Ideas

| Idea | What it means |
|---|---|
| Device | One PC (the "host" PC when several share a database over the LAN). Has its own token; its data is stored apart from every other device's. |
| Entity | One mirrored table, listed in `sync-schema.json` (same file in both repos). |
| Event | `{ id, entity, key, op, payload, at }`. `payload` is the WHOLE row, so applying an event is a plain upsert or delete. |
| Event id | The desktop outbox row id. Unique per device. The server stores it, so a re-sent event is acknowledged but not applied twice. |
| Compaction | Only the newest event per row is uploaded; older ones for the same row are marked done with it. |
| Schema version | `version` in `sync-schema.json`. Bump it only for a breaking change; push is refused with 409 if the two sides differ. |

## Endpoints (base: `https://<server>/api/v1`)

All requests send `Accept: application/json` and `X-App-Version`.

| Method + path | Auth | Purpose |
|---|---|---|
| `POST /devices/enroll` | `X-Enrollment-Key` | Body `{ name, adopt_device_id? }`. Returns `201 { device_id, name, token, schema_version }`. The token is shown once. With `adopt_device_id` a replacement PC takes over a lost PC's device: the old token stops working. |
| `GET /devices` | `X-Enrollment-Key` | `{ devices: [ { id, name, last_seen_at, last_push_at } ] }` so a replacement PC can choose which PC it replaces. |
| `GET /ping` | Bearer token | `{ ok, device, schema_version, server_time }`. Also used as a heartbeat. |
| `POST /sync/push` | Bearer token | Body `{ schema_version, events: [...] }` (max 500). Returns `{ acked: [event ids], rejected: [ { id, reason } ] }`. |
| `GET /sync/manifest` | Bearer token | `{ schema_version, order, counts: { entity: rows } }` |
| `GET /sync/snapshot?entity=&after=&limit=` | Bearer token | One page in key order: `{ rows: [payload...], next_after }`. `next_after` is `null` on the last page. |
| `GET /sync/status` | Bearer token | Last seen / last upload, audit-log size. |

## Rules

1. **Acked = safe on the server.** The desktop marks an event done only after it is in `acked`.
2. **Rejected = refused, not lost.** The desktop sets it aside (visible in Settings) and carries on; one bad row never blocks the queue.
3. **Idempotent.** Re-sending an event id changes nothing and is acknowledged again.
4. **Offline.** Any network failure leaves events in the outbox. The desktop retries after 5s, 15s, 30s, 1m, 2m, then every 5m; "Sync now" retries immediately.
5. **Status codes the desktop reacts to:** `401/403` token revoked (stop, ask to reconnect); `409` version mismatch (show the message; keeps retrying with back-off in case the server gets updated); `413` batch too large (halve it; a single oversize event is rejected); anything else is retried with back-off.
6. **Never synced:** settings whose key starts with `cloud_`, `device_` or `lan_` (this PC's own connection details), the outbox itself, the legacy API-mode `sync_queue`, and migrations.

## Restore ("my SSD died")

1. Install the app on the new PC, open Settings > Cloud backup, enter server address + enrollment key.
2. Choose "This PC replaces a lost one", find the old PC in the list, connect (this revokes the old token).
3. Press **Restore from cloud**. The app reads `/sync/manifest`, then pages through `/sync/snapshot` table by table
   (parents first) into the empty database, keeping the original ids, with foreign keys checked afterwards.
4. The restore is not queued for upload again. New sales continue the numbering.

What can be lost: only changes that were still in the outbox when the PC died (the Settings page and the toolbar icon show how many are waiting).

## Changing the schema (new column or table)

1. Edit `sync-schema.json` in the desktop repo (`src-electron/sync/`), add the column/table (and `order`, parents first).
2. Run `npm run sync:selftest` - it fails if the JSON and the real SQLite tables disagree.
3. Copy the file to the server repo (`resources/sync/sync-schema.json`), run `php artisan sync:install` (adds missing columns/tables; no new migration file needed).
4. Restart the desktop app: triggers are rebuilt automatically when the file changes.
5. Only bump `version` for a breaking change (renaming/removing a column, changing a key). Then update the server first, then the apps.
