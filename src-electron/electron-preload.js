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
  printHtml: (options) => ipcRenderer.invoke('app:printHtml', toPlain(options)),
  getPrinters: () => ipcRenderer.invoke('app:getPrinters'),
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  updateBranding: (payload) => ipcRenderer.invoke('app:updateBranding', toPlain(payload)),
});
