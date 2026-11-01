# Cloud backup (real-time sync to your server)

Every sale and every other change is also saved to your own Laravel/MySQL server. If the PC is lost or its disk
dies, a new PC restores everything. The app keeps working with no internet: changes queue up and upload by
themselves later. Server side: the separate **ERP Sync Server** repo (Laravel 13).

* Protocol: [PROTOCOL.md](PROTOCOL.md) (same text in the server repo)
* Change history of this feature: [CHANGES.md](CHANGES.md) - add a line every time you touch it
* Off by default. Nothing runs, no triggers exist, until a PC is connected in **Settings > Cloud backup**.

## How a change travels

```
any code saves a row                      (repositories, accounting, restore of a backup... anything)
  -> SQLite trigger cloud_* copies the row into sync_outbox     same transaction: saved together or not at all
  -> ipc-handlers.js dispatchDb() calls kickCloudSync()         "something changed"
  -> CloudWorker waits ~0.4 s, then POSTs a batch to /sync/push
       ok          -> events marked sent
       no internet -> stays in sync_outbox, retries 5s..5min, "Sync now" retries at once
```

## File map (desktop repo)

| Piece | File | Notes |
|---|---|---|
| **Which tables/columns are backed up** | `src-electron/sync/sync-schema.json` | Single source of truth. Same file lives in the server repo. |
| Read the schema in JS | `src-electron/sync/schema.js` | |
| Create the outbox tables | `migrations.js` (v18) | Only `sync_outbox` + `sync_control`. |
| Triggers that fill the outbox | `src-electron/sync/triggers.js` | Generated from the JSON at start; only while connected. |
| The queue (batching, compaction, retry bookkeeping, snapshot) | `src-electron/sync/outbox.js` | |
| Server URL + token (encrypted with Windows DPAPI) | `src-electron/sync/cloud-config.js` | File `cloud-sync.json` in the app's user-data folder, not in the database. |
| Talking HTTP | `src-electron/sync/cloud-client.js` | The only file that knows the URLs. |
| Background uploader, back-off, status | `src-electron/sync/cloud-worker.js` | |
| Restore onto an empty PC | `src-electron/sync/cloud-restore.js` | |
| Buttons in Settings -> main process | `src-electron/sync/cloud-ipc.js` (`cloud:*` channels) | |
| Start-up wiring | `src-electron/sync/index.js`, one call in `electron-main.js`, one in `db/ipc-handlers.js` (`kickCloudSync`) | |
| Renderer bridge | `src-electron/electron-preload.js` (`cloudBridge`) | |
| Screens | `src/components/cloud/CloudBackupCard.vue` (Settings), `CloudSyncBadge.vue` (toolbar), `src/stores/cloudSync.js` | |
| Executable spec | `src-electron/sync/fake-server.mjs`, `cloud-selftest.mjs` | `npm run sync:selftest` |

## Why it is built this way

* **Triggers, not code hooks.** Every write path is captured, including ones added later (the accounting module posts
  journal entries through plain SQL). Nobody has to remember to "also queue it".
* **The mirror is per PC.** The server stores each device's rows under its own `device_id` with the PC's original ids,
  so no id translation exists to go wrong, and a restore brings back identical ids, invoice numbers and links.
* **Whole-row events.** Applying is an upsert/delete; lost or repeated events cannot corrupt anything. Only the newest
  event per row is uploaded (compaction).
* **Everything is backed up**, not only sales: customers, products, stock movements, expenses, bills, payments, the
  chart of accounts and journal. Without them a restore would give sales but a broken business.
* **Private things stay home:** settings starting with `cloud_`, `device_`, `lan_`; the token; the outbox; the legacy API-mode `sync_queue`.

## Operations

**Normal day:** the toolbar cloud icon is green. Orange = offline (changes are waiting, nothing lost). Red = needs
attention (message in Settings > Cloud backup).

**Disaster drill (do this once before you need it):**
1. On a spare PC, install the app, open Settings > Cloud backup.
2. Server address + enrollment key -> "This PC replaces a lost one" -> pick the old PC -> Connect.
3. "Restore from cloud". Check a few invoices, customers and the accounting reports.
4. Do not leave two PCs running as the same device: the old PC's token is revoked by step 2.

**What can still be lost:** changes that had not uploaded when the PC died. The pending count is shown in Settings.
Keep the existing local backups too (the app's own daily backup is unchanged).

**Turning it off:** Settings -> Disconnect. Triggers are removed and the queue emptied; the server keeps its copy.

## Changing the schema

See "Changing the schema" in [PROTOCOL.md](PROTOCOL.md). Short version: edit `sync-schema.json` -> `npm run sync:selftest`
(fails if JSON and tables disagree) -> copy the file to the server repo -> `php artisan sync:install` there -> restart the app.

## Known limits

* One writer per database: on a LAN, only the **host** PC syncs; client PCs use the host's database.
* Data is restored into an **empty** installation only. Replacing a non-empty database is deliberately not offered.
* Restore is not one big atomic step; if it is interrupted, run it again (it starts by clearing the seed rows).
* Pull/merge between several independent PCs is not part of v1 (each PC has its own mirror).
* Needs Electron's `safeStorage` for token encryption; if the OS does not offer it the token is stored unencrypted (file is user-only).
* Lekuka (RSL e-invoicing) is NOT implemented here; see the server README.

## Roll back

1. Settings -> Disconnect (removes triggers and queue).
2. `git revert` the `sync 4/5`, `sync 3/5`, `sync 3b`, `sync 2/5` commits (newest first). Leave `sync 1/5` (migration v18, two harmless tables) unless you also want those gone - never edit a migration that has already run.
