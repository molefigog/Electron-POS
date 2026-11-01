import fs from 'node:fs';
import path from 'node:path';

/**
 * Where this PC remembers its cloud connection: a small JSON file in the app's
 * user-data folder (NOT in the database, so a restored or copied database can
 * never carry another PC's credentials). The token is encrypted with Electron's
 * safeStorage (Windows DPAPI) whenever the OS offers it.
 *
 * `crypto` is injected so tests do not need Electron: { encrypt(text) -> string, decrypt(string) -> text, available }.
 */
export function createConfigStore({ dir, crypto, fileName = 'cloud-sync.json' }) {
  const file = path.join(dir, fileName);

  function read() {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  }

  function load() {
    const raw = read();
    if (!raw) return { enabled: false, serverUrl: '', deviceId: null, deviceName: '', token: '' };
    const token = (() => {
      try {
        return raw.tokenEnc ? crypto.decrypt(raw.tokenEnc) : raw.tokenPlain || '';
      } catch {
        return ''; // encrypted on another Windows account/PC: the user must connect again
      }
    })();
    return {
      enabled: !!raw.enabled && !!token,
      serverUrl: raw.serverUrl || '',
      deviceId: raw.deviceId ?? null,
      deviceName: raw.deviceName || '',
      token,
    };
  }

  function save({ serverUrl, deviceId, deviceName, token, enabled = true }) {
    fs.mkdirSync(dir, { recursive: true });
    const body = { enabled, serverUrl, deviceId, deviceName };
    if (crypto.available) body.tokenEnc = crypto.encrypt(token);
    else body.tokenPlain = token;
    fs.writeFileSync(file, JSON.stringify(body, null, 2), { mode: 0o600 });
  }

  function clear() {
    try {
      fs.unlinkSync(file);
    } catch {
      /* already gone */
    }
  }

  return { load, save, clear, file };
}

/** "https://shop.example.com/" or ".../api" or ".../api/v1" -> "https://shop.example.com" */
export function normalizeServerUrl(input) {
  let url = String(input || '').trim().replace(/\/+$/, '');
  url = url.replace(/\/api(\/v1)?$/i, '');
  if (!/^https?:\/\//i.test(url)) throw new Error('The server address must start with https://');
  return url;
}
