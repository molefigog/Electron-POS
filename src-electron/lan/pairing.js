// Pure helpers (no Electron imports) for pairing PCs on a local network.
import crypto from 'node:crypto';
import os from 'node:os';

export const DEFAULT_PORT = 3737;
const CODE_PREFIX = 'POS1.';

/** Random access key shared by the main PC with the PCs that pair with it. */
export function generateKey() {
  return crypto.randomBytes(24).toString('base64url');
}

/** Private IPv4 addresses of this PC (what other PCs on the same router can reach). */
export function listLanAddresses() {
  const out = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (a.address.startsWith('169.254.')) continue; // link-local, not a real LAN address
      out.push(a.address);
    }
  }
  return [...new Set(out)];
}

/** The string the user copies from the main PC and pastes on the other PCs. */
export function encodeConnectionCode({ address, port, key, name }) {
  const json = JSON.stringify({ a: address, p: port, k: key, n: name || '' });
  return CODE_PREFIX + Buffer.from(json, 'utf8').toString('base64url');
}

/** Validates and decodes a connection code. Throws a friendly Error when it is wrong. */
export function decodeConnectionCode(code) {
  const text = String(code || '').trim().replace(/\s+/g, '');
  if (!text.startsWith(CODE_PREFIX)) {
    throw new Error('That is not a valid connection code. Copy it again from the main PC.');
  }
  let data;
  try {
    data = JSON.parse(Buffer.from(text.slice(CODE_PREFIX.length), 'base64url').toString('utf8'));
  } catch {
    throw new Error('The connection code is damaged. Copy it again from the main PC.');
  }
  const address = String(data?.a || '');
  const port = Number(data?.p);
  const key = String(data?.k || '');
  if (!/^[A-Za-z0-9.\-]{1,253}$/.test(address)) throw new Error('The connection code has an invalid address.');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('The connection code has an invalid port.');
  if (key.length < 16) throw new Error('The connection code is missing its access key.');
  return { address, port, key, name: String(data?.n || '') };
}
