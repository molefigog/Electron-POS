// IPC handlers behind Settings -> Network.
import { app } from 'electron';
import os from 'node:os';
import { lan } from './runtime.js';
import { loadNetworkConfig, saveNetworkConfig } from './network-config.js';
import { pingHost } from './lan-client.js';
import {
  DEFAULT_PORT, decodeConnectionCode, encodeConnectionCode, generateKey, listLanAddresses,
} from './pairing.js';

const CHANNELS = ['network:getConfig', 'network:save', 'network:applyCode', 'network:test', 'network:regenerateKey', 'network:restart'];

function view() {
  const cfg = loadNetworkConfig();
  const addresses = cfg.mode === 'host' ? listLanAddresses() : [];
  return {
    mode: cfg.mode,
    activeMode: lan.mode, // what is running right now (changes only after a restart)
    port: cfg.port,
    hostAddress: cfg.hostAddress,
    hostName: cfg.hostName,
    thisPcName: os.hostname(),
    receiptPrinter: cfg.receiptPrinter,
    version: app.getVersion(),
    addresses,
    connectionCodes: cfg.mode === 'host' && cfg.key
      ? addresses.map((address) => ({ address, code: encodeConnectionCode({ address, port: cfg.port, key: cfg.key, name: os.hostname() }) }))
      : [],
    serverRunning: Boolean(lan.server),
    serverError: lan.serverError,
    clientConnected: lan.clientConnected,
  };
}

export function registerNetworkIpc(ipcMain) {
  CHANNELS.forEach((c) => ipcMain.removeHandler(c));

  ipcMain.handle('network:getConfig', () => view());

  ipcMain.handle('network:save', (event, patch = {}) => {
    const cfg = loadNetworkConfig();
    const before = { mode: cfg.mode, port: cfg.port };

    if (patch.receiptPrinter !== undefined) cfg.receiptPrinter = String(patch.receiptPrinter || '');
    if (patch.port !== undefined) {
      const port = Number(patch.port);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port must be a number between 1024 and 65535.');
      cfg.port = port;
    }
    if (patch.mode !== undefined) {
      if (!['single', 'host', 'client'].includes(patch.mode)) throw new Error('Unknown mode.');
      if (patch.mode === 'client' && !(cfg.mode === 'client' && cfg.hostAddress && cfg.key)) {
        throw new Error('Paste the connection code from the main PC and press Connect first.');
      }
      // A key belongs to one role. Becoming the main PC always issues a fresh key.
      if (patch.mode === 'host' && cfg.mode !== 'host') cfg.key = generateKey();
      if (patch.mode === 'single') cfg.key = '';
      cfg.mode = patch.mode;
    }
    saveNetworkConfig(cfg);
    return { restartRequired: before.mode !== cfg.mode || before.port !== cfg.port, config: view() };
  });

  ipcMain.handle('network:applyCode', async (event, { code } = {}) => {
    const parsed = decodeConnectionCode(code);
    const info = await pingHost({ address: parsed.address, port: parsed.port, key: parsed.key, version: app.getVersion() });
    const cfg = loadNetworkConfig();
    saveNetworkConfig({
      ...cfg,
      mode: 'client',
      hostAddress: parsed.address,
      port: parsed.port,
      key: parsed.key,
      hostName: info.hostName || parsed.name,
    });
    return { restartRequired: true, hostName: info.hostName || parsed.name, hostVersion: info.hostVersion };
  });

  ipcMain.handle('network:test', async () => {
    const cfg = loadNetworkConfig();
    if (cfg.mode === 'client') {
      const info = await pingHost({ address: cfg.hostAddress, port: cfg.port, key: cfg.key, version: app.getVersion() });
      return { ok: true, ms: info.ms, message: `Connected to ${info.hostName || cfg.hostAddress} (${info.ms} ms)` };
    }
    if (cfg.mode === 'host') {
      return lan.server
        ? { ok: true, message: `Listening on port ${cfg.port}. Other PCs can connect.` }
        : { ok: false, message: lan.serverError || 'The network server is not running. Restart the POS.' };
    }
    return { ok: true, message: 'This PC works on its own.' };
  });

  ipcMain.handle('network:regenerateKey', () => {
    const cfg = loadNetworkConfig();
    if (cfg.mode !== 'host') throw new Error('Only the main PC issues connection codes.');
    cfg.key = generateKey();
    saveNetworkConfig(cfg);
    lan.key = cfg.key; // running server switches to the new key immediately; paired PCs must reconnect
    return view();
  });

  ipcMain.handle('network:restart', () => {
    // `quasar dev` ties Electron to its dev server, so only relaunch when packaged.
    if (app.isPackaged) app.relaunch();
    app.exit(0);
  });
}

export { DEFAULT_PORT };
