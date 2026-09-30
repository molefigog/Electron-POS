import { contextBridge, ipcRenderer } from 'electron';

/**
 * Strips Vue/Pinia reactivity (Proxies) and any other non-plain data before
 * it crosses the context bridge. contextBridge uses the structured clone
 * algorithm, which throws "An object could not be cloned" on Proxies,
 * class instances, functions, etc. A JSON round-trip guarantees plain,
 * cloneable data. This is the correct place to do it - it's the actual
 * boundary, so it protects every caller regardless of what happens
 * upstream in the renderer.
 */
function toPlain(value) {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

/**
 * Single generic "db:query" channel keeps the attack surface small:
 * the renderer can never run arbitrary SQL, only call a whitelisted
 * repository method name with args. See db/ipc-handlers.js for the allow-list.
 */
contextBridge.exposeInMainWorld('dbBridge', {
  call: (repository, method, args) => ipcRenderer.invoke('db:call', { repository, method, args: toPlain(args) }),
  onNavigate: (callback) =>
    ipcRenderer.on('navigate', (_, route) => callback(route)),

  onAbout: (callback) =>
    ipcRenderer.on('menu-about', callback)
});

contextBridge.exposeInMainWorld('appBridge', {
  printPdf: (options) => ipcRenderer.invoke('app:printPdf', toPlain(options)),
  emailPdf: (options) => ipcRenderer.invoke('app:emailPdf', toPlain(options)),
  printHtml: (options) => ipcRenderer.invoke('app:printHtml', toPlain(options)),
  /** 80 mm thermal receipt. Always prints on the main PC's receipt printer. */
  printReceipt: (options) => ipcRenderer.invoke('app:printReceipt', toPlain(options)),
  openCalculator: () => ipcRenderer.invoke('app:openCalculator'),
  openReceiptsFolder: () => ipcRenderer.invoke('app:openReceiptsFolder'),
  getPrinters: () => ipcRenderer.invoke('app:getPrinters'),
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  updateBranding: (payload) => ipcRenderer.invoke('app:updateBranding', toPlain(payload)),
  updateShortcuts: (map) => ipcRenderer.invoke('app:updateShortcuts', toPlain(map)),
  /**
   * callback() fires when the user tries to close the app. Acknowledges to the
   * main process immediately (so it knows a prompt is being shown), then calls
   * the callback. Returns an unsubscribe function.
   */
  onCloseRequested: (callback) => {
    const listener = () => {
      ipcRenderer.send('app:close-ack');
      callback();
    };
    ipcRenderer.on('app:close-requested', listener);
    ipcRenderer.send('app:close-handler-ready', true);
    return () => {
      ipcRenderer.removeListener('app:close-requested', listener);
      ipcRenderer.send('app:close-handler-ready', false);
    };
  },
  /** options: { backup: boolean }. Resolves { closed: false } only if a failed backup was declined. */
  confirmClose: (options) => ipcRenderer.invoke('app:confirmClose', toPlain(options)),
  backups: {
    list: () => ipcRenderer.invoke('backup:list'),
    create: () => ipcRenderer.invoke('backup:create'),
    openFolder: () => ipcRenderer.invoke('backup:openFolder'),
    restore: (fileName) => ipcRenderer.invoke('backup:restore', toPlain({ fileName })),
  },
  /** callback(actionId) fires whenever a mapped Ctrl/Shift+digit combo is pressed anywhere in the window. Returns an unsubscribe function. */
  onShortcut: (callback) => {
    const listener = (_event, actionId) => callback(actionId);
    ipcRenderer.on('shortcut:trigger', listener);
    return () => ipcRenderer.removeListener('shortcut:trigger', listener);
  },
});

/** Network setup (Settings > Network) and live "data changed" notices from the other PCs. */
contextBridge.exposeInMainWorld('networkBridge', {
  getConfig: () => ipcRenderer.invoke('network:getConfig'),
  save: (patch) => ipcRenderer.invoke('network:save', toPlain(patch)),
  applyCode: (code) => ipcRenderer.invoke('network:applyCode', toPlain({ code })),
  test: () => ipcRenderer.invoke('network:test'),
  regenerateKey: () => ipcRenderer.invoke('network:regenerateKey'),
  restart: () => ipcRenderer.invoke('network:restart'),
  onChanged: (callback) => {
    const listener = (_event, info) => callback(info);
    ipcRenderer.on('lan:changed', listener);
    return () => ipcRenderer.removeListener('lan:changed', listener);
  },
  onStatus: (callback) => {
    const listener = (_event, connected) => callback(connected);
    ipcRenderer.on('lan:status', listener);
    return () => ipcRenderer.removeListener('lan:status', listener);
  },
});
