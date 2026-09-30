// Run with:  node src-electron/lan/selftest.mjs
// Exercises the LAN server + client on this machine (no Electron needed).
import assert from 'node:assert/strict';
import { createLanServer } from './lan-server.js';
import { remoteCall, pingHost, subscribeToChanges, LanError } from './lan-client.js';
import { generateKey, encodeConnectionCode, decodeConnectionCode, listLanAddresses } from './pairing.js';

const key = generateKey();
const calls = [];
const printed = [];
const changes = [];

const server = await createLanServer({
  port: 0,
  getKey: () => key,
  version: '1.2.3',
  hostName: 'PC3',
  dispatchDb: async (p) => {
    calls.push(p);
    if (p.method === 'boom') throw new Error('Out of stock');
    return p.method === 'all' ? [{ id: 1, stock_qty: 9 }] : { id: 2 };
  },
  printReceipt: async ({ html }) => { printed.push(html); return { success: true }; },
  onRemoteChange: (i) => changes.push(i),
});
const ep = { address: '127.0.0.1', port: server.port, key, version: '1.2.3' };

// pairing code round trip
const code = encodeConnectionCode({ address: '192.168.1.20', port: 3737, key, name: 'PC3' });
assert.deepEqual(decodeConnectionCode(code), { address: '192.168.1.20', port: 3737, key, name: 'PC3' });
assert.throws(() => decodeConnectionCode('garbage'), /not a valid connection code/);
assert.throws(() => decodeConnectionCode(code.slice(0, -6)), /damaged|invalid|missing/);
assert.ok(Array.isArray(listLanAddresses()));

// ping: ok, wrong key, wrong version
assert.equal((await pingHost(ep)).hostName, 'PC3');
await assert.rejects(pingHost({ ...ep, key: 'x'.repeat(32) }), (e) => e instanceof LanError && e.code === 'UNAUTHORIZED');
await assert.rejects(pingHost({ ...ep, version: '9.9.9' }), (e) => e.code === 'VERSION_MISMATCH');

// calls: read, write, application error, bad key, version mismatch
assert.deepEqual(await remoteCall(ep, '/rpc/db', { repository: 'products', method: 'all', args: [] }), [{ id: 1, stock_qty: 9 }]);
await assert.rejects(remoteCall(ep, '/rpc/db', { repository: 'products', method: 'boom', args: [] }), /Out of stock/);
await assert.rejects(remoteCall({ ...ep, key: 'y'.repeat(32) }, '/rpc/db', {}), (e) => e.code === 'UNAUTHORIZED');
await assert.rejects(remoteCall({ ...ep, version: '0.0.1' }, '/rpc/db', {}), (e) => e.code === 'VERSION_MISMATCH');

// change announcements reach a subscriber; reads and the sync repo do not announce
const seen = [];
const stop = subscribeToChanges(ep, { onChange: (i) => seen.push(i) });
await new Promise((r) => setTimeout(r, 300));
await remoteCall(ep, '/rpc/db', { repository: 'products', method: 'all', args: [] });
await remoteCall(ep, '/rpc/db', { repository: 'sync', method: 'enqueue', args: [{}] });
await remoteCall(ep, '/rpc/db', { repository: 'stock', method: 'record', args: [{ qty: -1 }] });
await new Promise((r) => setTimeout(r, 300));
stop();
assert.equal(seen.length, 1);
assert.equal(seen[0].repository, 'stock');
assert.equal(changes.length, 1); // only stock.record: reads, failed calls and the sync repo never announce

// receipt printing is routed to the main PC's printer
assert.deepEqual(await remoteCall(ep, '/rpc/print-receipt', { html: '<p>hi</p>' }), { success: true });
assert.deepEqual(printed, ['<p>hi</p>']);

// unreachable main PC gives a friendly error
server.close();
await assert.rejects(remoteCall(ep, '/rpc/db', {}), (e) => e.code === 'UNREACHABLE' && /Cannot reach the main PC/.test(e.message));

console.log('LAN self-test: all checks passed');
