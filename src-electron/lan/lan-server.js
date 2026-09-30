// Runs on the MAIN PC. Other PCs send their database calls here over the LAN.
// Pure Node (no Electron imports) so it can be tested on its own.
import http from 'node:http';
import crypto from 'node:crypto';

const MAX_BODY_BYTES = 25 * 1024 * 1024;
const HEARTBEAT_MS = 15000;

// Repository methods that only read. Everything else is a write and is
// announced to the other PCs so they refresh their screens.
const READ_ONLY = /^(all|find\w*|history|summary|pending|getCursor)$/;

function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

/**
 * options:
 *  port        TCP port (0 = pick a free one, used by tests)
 *  getKey()    current access key
 *  version     app version; clients on a different version are refused
 *  hostName    shown to clients
 *  dispatchDb({ repository, method, args })   runs the database call
 *  printReceipt({ html })                     prints on this PC's receipt printer
 *  onRemoteChange(info)                       called after a remote PC changed data
 */
export function createLanServer(options) {
  const { port, getKey, version, hostName = '', dispatchDb, printReceipt, onRemoteChange } = options;
  const listeners = new Set();

  function broadcast(info) {
    const line = `data: ${JSON.stringify({ type: 'changed', at: Date.now(), ...info })}\n\n`;
    for (const res of listeners) res.write(line);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      const authorized = safeEqual(req.headers['x-pos-key'], getKey());

      if (req.method === 'GET' && url.pathname === '/ping') {
        return send(res, 200, { app: 'nid-pos', version, name: hostName, authorized });
      }
      if (!authorized) {
        return send(res, 401, { ok: false, code: 'UNAUTHORIZED', error: 'Wrong access key. Pair this PC with the main PC again.' });
      }
      if (req.headers['x-pos-version'] !== version) {
        return send(res, 409, {
          ok: false,
          code: 'VERSION_MISMATCH',
          error: `This PC runs a different version of the POS than the main PC (main PC: ${version}). Install the same version on every PC.`,
        });
      }

      if (req.method === 'GET' && url.pathname === '/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write(': connected\n\n');
        const beat = setInterval(() => res.write(': hb\n\n'), HEARTBEAT_MS);
        listeners.add(res);
        req.on('close', () => {
          clearInterval(beat);
          listeners.delete(res);
        });
        return undefined;
      }

      if (req.method === 'POST' && url.pathname === '/rpc/db') {
        const payload = JSON.parse(await readBody(req));
        try {
          const result = await dispatchDb(payload);
          if (payload.repository !== 'sync' && !READ_ONLY.test(payload.method)) {
            const info = { repository: payload.repository, method: payload.method };
            broadcast(info);
            onRemoteChange?.(info);
          }
          return send(res, 200, { ok: true, result: result === undefined ? null : result });
        } catch (err) {
          return send(res, 200, { ok: false, error: err?.message || 'Database operation failed' });
        }
      }

      if (req.method === 'POST' && url.pathname === '/rpc/print-receipt') {
        const payload = JSON.parse(await readBody(req));
        try {
          return send(res, 200, { ok: true, result: await printReceipt(payload) });
        } catch (err) {
          return send(res, 200, { ok: false, error: err?.message || 'Printing failed' });
        }
      }

      return send(res, 404, { ok: false, error: 'Not found' });
    } catch (err) {
      return send(res, err?.status || 400, { ok: false, error: err?.message || 'Bad request' });
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', (err) => {
      reject(err?.code === 'EADDRINUSE'
        ? new Error(`Port ${port} is already in use on this PC. Close the other program or choose another port.`)
        : err);
    });
    server.listen(port, '0.0.0.0', () => {
      resolve({
        port: server.address().port,
        broadcast,
        close: () => {
          for (const res of listeners) res.end();
          listeners.clear();
          server.close();
          server.closeAllConnections?.();
        },
      });
    });
  });
}
