import { SYNC_SCHEMA } from './schema.js';
import { normalizeServerUrl } from './cloud-config.js';

/** Could not reach the server at all (offline, DNS, timeout, TLS). Always safe to retry later. */
export class NetworkError extends Error {}

/** The server answered with an error status. 401 = token revoked, 409 = schema mismatch, 5xx = server trouble. */
export class HttpError extends Error {
  constructor(status, message, body = null) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/**
 * The only file that knows the server's URLs. Protocol reference: docs/cloud-sync/README.md.
 * `getConfig()` is read on every call, so connect/disconnect take effect immediately.
 */
export class CloudClient {
  constructor({ getConfig, version = '0.0.0', fetchImpl = globalThis.fetch, timeoutMs = 20000 }) {
    this.getConfig = getConfig;
    this.version = version;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async request(method, url, { token = '', enrollmentKey = '', body } = {}) {
    const headers = { Accept: 'application/json', 'X-App-Version': this.version };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    if (enrollmentKey) headers['X-Enrollment-Key'] = enrollmentKey;

    let res;
    try {
      res = await this.fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new NetworkError(err?.cause?.code || err?.message || 'Network error');
    }

    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON (e.g. a hosting error page) */
    }
    if (!res.ok) {
      throw new HttpError(res.status, json?.message || json?.error || `Server answered ${res.status}`, json);
    }
    return json;
  }

  #authed(method, path, body) {
    const c = this.getConfig();
    if (!c?.serverUrl || !c.token) throw new HttpError(401, 'This PC is not connected to a cloud server');
    return this.request(method, `${normalizeServerUrl(c.serverUrl)}/api/v1${path}`, { token: c.token, body });
  }

  // ---- connecting (uses the enrollment key, not a device token) ------------
  enroll({ serverUrl, enrollmentKey, deviceName, adoptDeviceId = null }) {
    return this.request('POST', `${normalizeServerUrl(serverUrl)}/api/v1/devices/enroll`, {
      enrollmentKey,
      body: { name: deviceName, adopt_device_id: adoptDeviceId },
    });
  }

  listDevices({ serverUrl, enrollmentKey }) {
    return this.request('GET', `${normalizeServerUrl(serverUrl)}/api/v1/devices`, { enrollmentKey });
  }

  // ---- normal operation (device token) -------------------------------------
  ping() {
    return this.#authed('GET', '/ping');
  }

  push(events) {
    return this.#authed('POST', '/sync/push', { schema_version: SYNC_SCHEMA.version, events });
  }

  manifest() {
    return this.#authed('GET', '/sync/manifest');
  }

  snapshotPage({ entity, after = null, limit = 500 }) {
    const q = new URLSearchParams({ entity, limit: String(limit) });
    if (after !== null && after !== undefined) q.set('after', String(after));
    return this.#authed('GET', `/sync/snapshot?${q}`);
  }
}
