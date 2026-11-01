import { createConfigStore } from './cloud-config.js';
import { CloudClient } from './cloud-client.js';
import { CloudWorker } from './cloud-worker.js';
import { registerCloudIpc } from './cloud-ipc.js';
import { ensureTriggers, hasTriggers, removeTriggers } from './triggers.js';
import * as outbox from './outbox.js';

/**
 * Cloud backup - entry point. electron-main.js calls initCloudSync() once after the
 * database is open; ipc-handlers.js calls kickCloudSync() after every database call.
 * Map of the feature: docs/cloud-sync/README.md
 */
let current = null;

/** Tell the worker "something was saved". No-op when cloud backup is not set up. */
export function kickCloudSync() {
  current?.worker.kick();
}

export function stopCloudSync() {
  current?.worker.stop();
  current = null;
}

export function initCloudSync({ db, ipcMain, userDataDir, version, safeStorage, broadcast, role }) {
  const crypto = safeStorage?.isEncryptionAvailable?.()
    ? {
        available: true,
        encrypt: (text) => safeStorage.encryptString(text).toString('base64'),
        decrypt: (b64) => safeStorage.decryptString(Buffer.from(b64, 'base64')),
      }
    : { available: false };

  const store = createConfigStore({ dir: userDataDir, crypto });
  let cached = store.load(); // decrypting is slow-ish: keep it in memory
  const config = {
    save: (c) => {
      store.save(c);
      cached = store.load();
    },
    clear: () => {
      store.clear();
      cached = store.load();
    },
  };
  const getConfig = () => cached;

  const client = new CloudClient({ getConfig, version });
  const worker = new CloudWorker({ db, client, getConfig });

  if (db && role !== 'client') {
    db.prepare('UPDATE sync_control SET applying = 0 WHERE id = 1').run(); // recover from a crash during a restore
    if (cached.enabled) {
      ensureTriggers(db);
      outbox.prune(db);
      worker.start();
    } else if (hasTriggers(db)) {
      removeTriggers(db); // e.g. a database copied from another PC: do not queue events nobody will upload
      outbox.clear(db);
    }
  }

  registerCloudIpc({ ipcMain, db, worker, client, config, role, broadcast });
  current = { worker, client, config };
  return current;
}
