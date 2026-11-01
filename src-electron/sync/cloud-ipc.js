import os from 'node:os';
import * as outbox from './outbox.js';
import { ensureTriggers, removeTriggers } from './triggers.js';
import { isBusinessDataEmpty, restoreFromCloud } from './cloud-restore.js';
import { normalizeServerUrl } from './cloud-config.js';

/**
 * Everything the Settings screen can ask for. Channels are all "cloud:*".
 * On a LAN client PC (no local database) every call answers { supported: false }.
 */
export function registerCloudIpc({ ipcMain, db, worker, client, config, role, broadcast }) {
  const supported = !!db && role !== 'client';
  const unsupported = {
    supported: false,
    enabled: false,
    state: 'disabled',
    reason: role === 'client' ? "This PC uses the main PC's database. Set up cloud backup on the main PC." : 'No local database.',
  };
  const guard = (fn) => async (event, payload) => {
    if (!supported) return unsupported;
    return fn(payload || {});
  };

  const status = () => ({ ...worker.status(), role, canRestore: isBusinessDataEmpty(db), restoreSupported: true });

  ipcMain.handle('cloud:status', guard(() => status()));

  ipcMain.handle(
    'cloud:listDevices',
    guard(async ({ serverUrl, enrollmentKey }) => client.listDevices({ serverUrl: normalizeServerUrl(serverUrl), enrollmentKey })),
  );

  ipcMain.handle(
    'cloud:connect',
    guard(async ({ serverUrl, enrollmentKey, deviceName, adoptDeviceId = null }) => {
      if (!enrollmentKey) throw new Error('Enter the enrollment key from your server.');
      const url = normalizeServerUrl(serverUrl);
      const res = await client.enroll({ serverUrl: url, enrollmentKey, deviceName: deviceName || os.hostname(), adoptDeviceId });
      config.save({ serverUrl: url, deviceId: res.device_id, deviceName: res.name, token: res.token, enabled: true });
      ensureTriggers(db);
      outbox.clear(db);
      // A brand-new device uploads everything it has. A replacement PC (adopt) does not:
      // the user chooses between "Restore from cloud" and "Upload everything".
      if (!adoptDeviceId) outbox.enqueueSnapshot(db);
      worker.start();
      return status();
    }),
  );

  ipcMain.handle('cloud:syncNow', guard(async () => ({ ...status(), ...(await worker.syncNow()) })));

  ipcMain.handle(
    'cloud:uploadAll',
    guard(async () => {
      outbox.enqueueSnapshot(db);
      return { ...status(), ...(await worker.syncNow()) };
    }),
  );

  ipcMain.handle(
    'cloud:restore',
    guard(async () => {
      worker.pause();
      try {
        const result = await restoreFromCloud({ db, client, onProgress: (p) => broadcast('cloud:restore-progress', p) });
        outbox.clear(db);
        return { ...result, status: status() };
      } finally {
        worker.resume();
      }
    }),
  );

  ipcMain.handle(
    'cloud:disconnect',
    guard(() => {
      worker.stop();
      removeTriggers(db);
      outbox.clear(db);
      config.clear();
      worker.emit('status', worker.status());
      return status();
    }),
  );

  ipcMain.handle('cloud:rejected', guard(() => outbox.listRejected(db)));
  ipcMain.handle('cloud:retryRejected', guard(() => ({ retried: outbox.retryRejected(db), ...status() })));

  worker.on('status', (s) => broadcast('cloud:status-changed', { ...s, role }));
}
