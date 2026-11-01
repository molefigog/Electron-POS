import http from 'node:http';
import crypto from 'node:crypto';
import { SYNC_SCHEMA } from './sync-schema-bridge.mjs';

/**
 * A tiny in-memory server that speaks the cloud-sync protocol (docs/cloud-sync/README.md).
 * It is the executable specification the desktop self-test runs against, and the
 * reference the Laravel implementation (tests/Feature/SyncApiTest.php) mirrors.
 * Not for production use.
 */
export async function startFakeServer({ enrollmentKey = 'test-key', schema = SYNC_SCHEMA } = {}) {
  const devices = new Map(); // id -> { id, name, tokenHash, revoked }
  const mirror = new Map(); // deviceId -> Map(entity -> Map(key -> payload))
  const seen = new Set(); // `${deviceId}:${eventId}`
  const log = [];
  const control = { offline: false, failNext: null, pushes: 0, eventsReceived: 0 };
  let nextId = 1;

  const rows = (deviceId, entity) => mirror.get(deviceId)?.get(entity) || new Map();
  const reply = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer(async (req, res) => {
    if (control.offline) return req.socket.destroy(); // looks like "no internet" to the client
    if (control.failNext) {
      const status = control.failNext;
      control.failNext = null;
      return reply(res, status, { message: `forced ${status}` });
    }
    const url = new URL(req.url, 'http://x');
    const route = url.pathname.replace(/^\/api\/v1/, '');
    let body = '';
    for await (const chunk of req) body += chunk;
    const json = body ? JSON.parse(body) : {};

    if (route === '/devices/enroll' && req.method === 'POST') {
      if (req.headers['x-enrollment-key'] !== enrollmentKey) return reply(res, 403, { message: 'Invalid enrollment key' });
      const token = crypto.randomBytes(24).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      let device;
      if (json.adopt_device_id) {
        device = devices.get(json.adopt_device_id);
        if (!device) return reply(res, 404, { message: 'Device not found' });
        Object.assign(device, { tokenHash, revoked: false }); // old PC's token stops working
      } else {
        device = { id: nextId++, name: json.name || 'PC', tokenHash, revoked: false };
        devices.set(device.id, device);
        mirror.set(device.id, new Map());
      }
      return reply(res, 201, { device_id: device.id, name: device.name, token, schema_version: schema.version });
    }
    if (route === '/devices' && req.method === 'GET') {
      if (req.headers['x-enrollment-key'] !== enrollmentKey) return reply(res, 403, { message: 'Invalid enrollment key' });
      return reply(res, 200, { devices: [...devices.values()].map(({ id, name }) => ({ id, name })) });
    }

    const bearer = (req.headers.authorization || '').replace(/^Bearer /, '');
    const hash = crypto.createHash('sha256').update(bearer).digest('hex');
    const device = [...devices.values()].find((d) => d.tokenHash === hash && !d.revoked);
    if (!device) return reply(res, 401, { message: 'Unauthenticated' });

    if (route === '/ping') return reply(res, 200, { ok: true, device: { id: device.id, name: device.name }, schema_version: schema.version });

    if (route === '/sync/push' && req.method === 'POST') {
      if (json.schema_version !== schema.version) return reply(res, 409, { message: 'schema_mismatch', server_version: schema.version });
      control.pushes += 1;
      const acked = [];
      const rejected = [];
      for (const ev of json.events || []) {
        const entity = schema.entities[ev.entity];
        if (!entity) {
          rejected.push({ id: ev.id, reason: `Unknown entity ${ev.entity}` });
          continue;
        }
        const dedupe = `${device.id}:${ev.id}`;
        if (!seen.has(dedupe)) {
          seen.add(dedupe);
          control.eventsReceived += 1;
          log.push({ device: device.id, ...ev });
          const bucket = mirror.get(device.id);
          if (!bucket.has(ev.entity)) bucket.set(ev.entity, new Map());
          if (ev.op === 'delete') bucket.get(ev.entity).delete(String(ev.key));
          else bucket.get(ev.entity).set(String(ev.key), ev.payload);
        }
        acked.push(ev.id);
      }
      return reply(res, 200, { acked, rejected });
    }

    if (route === '/sync/manifest') {
      const counts = Object.fromEntries(schema.order.map((n) => [n, rows(device.id, n).size]));
      return reply(res, 200, { schema_version: schema.version, order: schema.order, counts });
    }

    if (route === '/sync/snapshot') {
      const entity = schema.entities[url.searchParams.get('entity')];
      if (!entity) return reply(res, 422, { message: 'Unknown entity' });
      const limit = Number(url.searchParams.get('limit') || 500);
      const after = url.searchParams.get('after');
      const isInt = entity.key.type === 'int';
      const all = [...rows(device.id, url.searchParams.get('entity')).values()].sort((a, b) =>
        isInt ? a[entity.key.name] - b[entity.key.name] : String(a[entity.key.name]).localeCompare(String(b[entity.key.name])),
      );
      const start = after === null ? all : all.filter((r) => (isInt ? r[entity.key.name] > Number(after) : String(r[entity.key.name]) > after));
      const page = start.slice(0, limit);
      const more = start.length > limit;
      return reply(res, 200, { rows: page, next_after: more ? page[page.length - 1][entity.key.name] : null });
    }
    return reply(res, 404, { message: 'Not found' });
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    control,
    devices,
    mirror,
    log,
    rows,
    revoke: (id) => (devices.get(id).revoked = true),
    close: () => new Promise((r) => server.close(r)),
  };
}
