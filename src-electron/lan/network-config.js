// Stores how this PC is set up for networking. Kept in a small JSON file in the
// user-data folder (NOT in the database, because it decides which database to use).
import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_PORT } from './pairing.js';

const DEFAULTS = {
  mode: 'single', // 'single' | 'host' | 'client'
  port: DEFAULT_PORT,
  hostAddress: '', // client mode: the main PC's address
  hostName: '', // client mode: the main PC's name (display only)
  receiptPrinter: '', // host/single: Windows printer name for 80 mm receipts
  key: '', // host: the access key it issues; client: the key it was given
};

const filePath = () => path.join(app.getPath('userData'), 'network-config.json');

function readSecret(raw) {
  if (raw.keyEnc) {
    try {
      return safeStorage.decryptString(Buffer.from(raw.keyEnc, 'base64'));
    } catch {
      return ''; // encrypted by another Windows user: the PC must be paired again
    }
  }
  return String(raw.key || '');
}

export function loadNetworkConfig() {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
  } catch {
    /* first run */
  }
  const cfg = { ...DEFAULTS, ...raw, key: readSecret(raw) };
  delete cfg.keyEnc;
  if (!['single', 'host', 'client'].includes(cfg.mode)) cfg.mode = 'single';
  if (cfg.mode === 'client' && (!cfg.hostAddress || !cfg.key)) cfg.mode = 'single'; // half-paired: fall back safely
  if (cfg.mode === 'host' && !cfg.key) cfg.mode = 'single';
  return cfg;
}

export function saveNetworkConfig(cfg) {
  const { key, ...rest } = cfg;
  const out = { ...rest };
  if (key) {
    if (safeStorage.isEncryptionAvailable()) out.keyEnc = safeStorage.encryptString(key).toString('base64');
    else out.key = key;
  }
  const target = filePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2));
  fs.renameSync(tmp, target);
}
