import { defineStore } from 'pinia';
import { cleanError } from 'src/composables/useAccountingUi';

/**
 * Renderer side of cloud backup. All real work happens in the Electron main
 * process (src-electron/sync/); this store only mirrors its status and forwards
 * button presses. File map: docs/cloud-sync/README.md
 */
const bridge = () => (typeof window !== 'undefined' ? window.cloudBridge : undefined);

export const useCloudSyncStore = defineStore('cloudSync', {
  state: () => ({
    status: null, // last object from cloud:status
    busy: false,
    progress: null, // { entity, done, total } while restoring
  }),

  getters: {
    available: () => !!bridge(),
    supported: (state) => !!state.status?.supported,
    connected: (state) => !!state.status?.enabled,
    pending: (state) => state.status?.pending || 0,
    /** One word the UI can colour: off | ok | working | waiting | error */
    tone() {
      const s = this.status;
      if (!s?.enabled) return 'off';
      if (s.state === 'error') return 'error';
      if (s.state === 'offline') return 'waiting';
      if (s.state === 'syncing' || s.pending > 0) return 'working';
      return 'ok';
    },
    summary() {
      const s = this.status;
      if (!s?.enabled) return 'Cloud backup is off';
      if (s.state === 'error') return s.lastError || 'Cloud backup needs attention';
      if (s.state === 'offline') return `Offline: ${s.pending} change${s.pending === 1 ? '' : 's'} waiting to upload`;
      if (s.state === 'syncing') return 'Uploading...';
      if (s.pending > 0) return `${s.pending} change${s.pending === 1 ? '' : 's'} waiting to upload`;
      return 'Backed up to the cloud';
    },
  },

  actions: {
    async init() {
      if (!bridge() || this._unsubscribe) return;
      this._unsubscribe = bridge().onStatus((s) => {
        this.status = { ...this.status, ...s };
      });
      await this.refresh();
    },

    async refresh() {
      if (!bridge()) return;
      this.status = await bridge().status();
    },

    async run(action) {
      this.busy = true;
      try {
        const result = await action(bridge());
        await this.refresh();
        return result;
      } catch (err) {
        throw new Error(cleanError(err), { cause: err });
      } finally {
        this.busy = false;
      }
    },

    listDevices: (options) => bridge().listDevices(options).catch((err) => Promise.reject(new Error(cleanError(err)))),
    connect(options) {
      return this.run((b) => b.connect(options));
    },
    syncNow() {
      return this.run((b) => b.syncNow());
    },
    uploadAll() {
      return this.run((b) => b.uploadAll());
    },
    disconnect() {
      return this.run((b) => b.disconnect());
    },
    retryRejected() {
      return this.run((b) => b.retryRejected());
    },
    rejected() {
      return bridge().rejected();
    },

    async restore() {
      const off = bridge().onRestoreProgress((p) => {
        this.progress = p;
      });
      try {
        return await this.run((b) => b.restore());
      } finally {
        off();
        this.progress = null;
      }
    },
  },
});
