/**
 * Renderer-side repository base. Every real repository below just names
 * itself and calls through window.dbBridge (exposed by electron-preload.js).
 * Keeping this as a class (not scattered fetch-like calls) means stores
 * never know or care that the "backend" is Electron IPC + SQLite - swap
 * this layer for an HTTP client later and nothing above it changes.
 */
import { apiClient } from '../api-client';
import { isApiMode } from '../connection';

const MUTATING_METHODS = new Set(['create', 'update', 'delete', 'record', 'convertQuoteToInvoice']);

function newSyncId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export class BaseRepository {
  constructor(name) {
    this.name = name;
  }

  call(method, ...args) {
    if (isApiMode()) {
      return apiClient.call(this.name, method, args);
    }
    if (!window.dbBridge) {
      throw new Error('dbBridge is not available. Are you running inside Electron?');
    }
    // Electron IPC uses the structured clone algorithm under the hood.
    // Pinia/Vue reactive state is wrapped in Proxies, which structured
    // clone can't always handle ("An object could not be cloned"). A
    // JSON round-trip strips reactivity and leaves plain data - safe here
    // since every payload we send is plain JSON-shaped (no Dates, functions,
    // Maps, etc.).
    const plainArgs = JSON.parse(JSON.stringify(args));
    return window.dbBridge.call(this.name, method, plainArgs).then((result) => {
      if (MUTATING_METHODS.has(method) && this.name !== 'settings' && this.name !== 'sync') {
        return window.dbBridge.call('sync', 'enqueue', {
          syncId: newSyncId(),
          repository: this.name,
          method,
          args: plainArgs,
        }).then(() => result);
      }
      return result;
    });
  }
}
