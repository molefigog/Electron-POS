// Cloud sync self-test:  node src-electron/sync/cloud-selftest.mjs   (npm run sync:selftest)
// Needs better-sqlite3 built for plain Node (`npm rebuild better-sqlite3` if it was built for Electron).
import Database from 'better-sqlite3';
import assert from 'node:assert/strict';
import { runMigrations } from '../../migrations.js';
import { TransactionRepository, ProductRepository, CustomerRepository, SettingsRepository } from '../db/repositories.js';
import { AccountingRepository } from '../db/accounting-repository.js';
import { SYNC_SCHEMA, payloadColumns } from './schema.js';
import { ensureTriggers } from './triggers.js';
import * as outbox from './outbox.js';
import { CloudClient } from './cloud-client.js';
import { CloudWorker } from './cloud-worker.js';
import { restoreFromCloud } from './cloud-restore.js';
import { startFakeServer } from './fake-server.mjs';

const ok = (label) => console.log(`  ok - ${label}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const newDb = () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
};
const skip = (entity, key) => (entity.skipKeyPrefixes || []).some((p) => String(key).startsWith(p));

/** Every mirrored table, as the exact JSON the server should hold. */
function dump(db) {
  const out = {};
  for (const name of SYNC_SCHEMA.order) {
    const e = SYNC_SCHEMA.entities[name];
    const cols = payloadColumns(e).map((c) => `"${c}"`).join(', ');
    out[name] = db
      .prepare(`SELECT ${cols} FROM "${e.table}" ORDER BY "${e.key.name}"`)
      .all()
      .filter((r) => !skip(e, r[e.key.name]));
  }
  return out;
}
const serverDump = (server, deviceId) =>
  Object.fromEntries(
    SYNC_SCHEMA.order.map((n) => {
      const e = SYNC_SCHEMA.entities[n];
      const isInt = e.key.type === 'int';
      return [n, [...server.rows(deviceId, n).values()].sort((a, b) => (isInt ? a[e.key.name] - b[e.key.name] : String(a[e.key.name]).localeCompare(String(b[e.key.name]))))];
    }),
  );
const assertMirrorEqual = (db, server, deviceId, label) => assert.deepEqual(serverDump(server, deviceId), dump(db), `mirror differs from local DB: ${label}`);

// ---------------------------------------------------------------- 0. schema contract
{
  const db = newDb();
  for (const name of SYNC_SCHEMA.order) {
    const e = SYNC_SCHEMA.entities[name];
    const actual = db.prepare(`PRAGMA table_info("${e.table}")`).all();
    const pk = actual.find((c) => c.pk)?.name;
    assert.equal(pk, e.key.name, `${name}: key column`);
    assert.deepEqual(actual.filter((c) => !c.pk).map((c) => c.name).sort(), Object.keys(e.columns).sort(), `${name}: sync-schema.json is out of date with the table - update it (see docs/cloud-sync/README.md)`);
  }
  ok('sync-schema.json matches every table in the database');
}

// ---------------------------------------------------------------- set up a shop + server
const server = await startFakeServer();
const db = newDb();
new SettingsRepository(db).update({ default_tax_rate: '15', company_vat: 'VAT-1', company_name: 'Test Shop' });
const tx = new TransactionRepository(db);
const acc = new AccountingRepository(db);
const customer = new CustomerRepository(db).create({ name: 'Acme' });
const paint = new ProductRepository(db).create({ name: 'Paint', sku: 'P1', cost_price: 60, selling_price: 115, stock_qty: 100 });
const item = (q) => ({ product_id: paint.id, name: 'Paint', quantity: q, box_size: null, box_count: null, unit_price: 115, discount_pct: 0, tax_rate: 15, line_total: 0 });
const sale = (q = 1, extra = {}) => tx.create({ type: 'invoice', customerId: customer.id, items: [item(q)], ...extra });

let cfg = { enabled: false, serverUrl: server.url, deviceId: null, deviceName: 'Shop PC', token: '' };
const client = new CloudClient({ getConfig: () => cfg, version: 'test', timeoutMs: 2000 });
const enrolled = await client.enroll({ serverUrl: server.url, enrollmentKey: 'test-key', deviceName: 'Shop PC' });
cfg = { ...cfg, enabled: true, deviceId: enrolled.device_id, token: enrolled.token };
await assert.rejects(() => client.enroll({ serverUrl: server.url, enrollmentKey: 'wrong', deviceName: 'x' }), /Invalid enrollment key/);

// rows that existed BEFORE connecting
sale(2);
acc.createExpense({ accountId: acc.accounts().find((a) => a.code === '6000').id, amount: 400, method: 'cash', description: 'Rent' });
db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('cloud_secret', 'never-leaves-this-pc')").run();

ensureTriggers(db);
outbox.enqueueSnapshot(db);
const worker = new CloudWorker({ db, client, getConfig: () => cfg, intervalMs: 60, kickDelayMs: 15, heartbeatMs: 60 });
worker.start();

// ---------------------------------------------------------------- 1. first upload
await worker.syncNow();
assert.equal(worker.status().pending, 0);
assertMirrorEqual(db, server, enrolled.device_id, 'initial upload');
assert.equal(server.rows(enrolled.device_id, 'settings').has('cloud_secret'), false);
ok('existing data uploaded; this PC\'s own cloud_* settings stay home');

// ---------------------------------------------------------------- 2. realtime
const before = server.control.eventsReceived;
const credit = sale(3); // creates the invoice, its items, journal entries (via the accounting engine)
await sleep(300);
assert.equal(worker.status().pending, 0, 'uploaded without pressing anything');
assert.ok(server.control.eventsReceived > before);
assertMirrorEqual(db, server, enrolled.device_id, 'realtime');
acc.recordCustomerPayment({ transactionId: credit.id, method: 'eft', amount: 100 });
await sleep(300);
assertMirrorEqual(db, server, enrolled.device_id, 'payment + status change');
ok('a new sale (with accounting entries) reaches the server by itself');

// ---------------------------------------------------------------- 3. offline, then back
server.control.offline = true;
const offlineSales = [sale(1), sale(2), sale(1)];
for (let i = 0; i < 4; i += 1) tx.update(offlineSales[0].id, { items: [item(1 + i)] }); // many edits of one invoice
await worker.syncNow();
assert.equal(worker.status().state, 'offline');
assert.ok(worker.status().pending > 10, 'events wait in the outbox');
assert.ok(worker.status().nextRetryAt, 'a retry is scheduled');
server.control.offline = false;
const eventsBefore = server.control.eventsReceived;
await worker.syncNow();
assert.equal(worker.status().state, 'idle');
assert.equal(worker.status().pending, 0);
assertMirrorEqual(db, server, enrolled.device_id, 'after offline period');
assert.ok(server.control.eventsReceived - eventsBefore < 60, 'repeated edits are compacted into one upload per row');
ok('offline: nothing lost, everything uploads when the server is back (edits compacted)');

// ---------------------------------------------------------------- 4. deletes
const expenseId = db.prepare('SELECT id FROM expenses').get().id;
acc.deleteExpense(expenseId);
await worker.syncNow();
assert.equal(server.rows(enrolled.device_id, 'expenses').size, 0);
assertMirrorEqual(db, server, enrolled.device_id, 'delete');
ok('deletes are mirrored');

// ---------------------------------------------------------------- 5. retries are idempotent
{
  const some = server.log.slice(-5);
  const res = await client.push(some.map(({ id, entity, key, op, payload, at }) => ({ id, entity, key, op, payload, at })));
  assert.equal(res.acked.length, 5);
  assertMirrorEqual(db, server, enrolled.device_id, 'duplicate delivery');
  ok('re-sending the same events changes nothing');
}

// ---------------------------------------------------------------- 6. a rejected event never blocks the queue
db.prepare("INSERT INTO sync_outbox (entity, row_key, op, payload) VALUES ('bogus', '1', 'upsert', '{}')").run();
sale(1);
await worker.syncNow();
assert.equal(worker.status().pending, 0);
assert.equal(worker.status().rejected, 1);
assert.match(outbox.listRejected(db)[0].reject_reason, /Unknown entity/);
assertMirrorEqual(db, server, enrolled.device_id, 'after a rejected event');
ok('one bad event is set aside; the rest keeps flowing');

// ---------------------------------------------------------------- 7. server errors back off, revoked token stops
server.control.failNext = 500;
sale(1);
await worker.syncNow();
assert.equal(worker.status().state, 'offline');
await worker.syncNow();
assert.equal(worker.status().state, 'idle');
const lastSynced = dump(db); // what the cloud holds from here on: later sales cannot reach it
server.revoke(enrolled.device_id);
sale(1);
await worker.syncNow();
assert.equal(worker.status().state, 'error');
assert.equal(worker.status().nextRetryAt, null);
assert.match(worker.status().lastError, /no longer accepts/);
ok('server trouble backs off; a revoked PC stops retrying and says why');
worker.stop();

// ---------------------------------------------------------------- 8. disaster: new PC restores everything
{
  // the shop PC is "lost". A fresh install enrolls as the SAME device and restores.
  const fresh = newDb();
  let cfg2 = { enabled: false, serverUrl: server.url, deviceId: null, deviceName: 'Replacement PC', token: '' };
  const client2 = new CloudClient({ getConfig: () => cfg2, version: 'test', timeoutMs: 2000 });
  const listed = await client2.listDevices({ serverUrl: server.url, enrollmentKey: 'test-key' });
  assert.equal(listed.devices.length, 1);
  const adopted = await client2.enroll({ serverUrl: server.url, enrollmentKey: 'test-key', deviceName: 'Replacement PC', adoptDeviceId: enrolled.device_id });
  assert.equal(adopted.device_id, enrolled.device_id);
  cfg2 = { ...cfg2, enabled: true, deviceId: adopted.device_id, token: adopted.token };
  await assert.rejects(() => client.ping(), /Unauthenticated|no longer|connected/, 'the lost PC\'s old token no longer works');
  ensureTriggers(fresh);

  const progress = [];
  const res = await restoreFromCloud({ db: fresh, client: client2, onProgress: (p) => progress.push(p) });
  assert.equal(res.foreignKeyProblems, 0);
  assert.ok(progress.length > 5);
  const a = dump(fresh);
  const b = lastSynced; // the sale made after the token was revoked never left the lost PC
  delete a.settings; // the fresh install keeps its own device settings; business settings are checked below
  delete b.settings;
  assert.deepEqual(a, b, 'restored database equals the last synced state');
  assert.equal(new SettingsRepository(fresh).all?.().company_name ?? fresh.prepare("SELECT value FROM settings WHERE key='company_name'").get().value, 'Test Shop');
  assert.equal(outbox.stats(fresh).pending, 0, 'restoring is not queued for upload again');
  ok('SSD-died drill: a blank PC restores every table, with the original ids, and re-uploads nothing');

  // and it keeps working: new sales on the restored PC are tracked and keep their numbering
  const tx2 = new TransactionRepository(fresh);
  const nextSale = tx2.create({ type: 'invoice', customerId: customer.id, items: [item(1)] });
  assert.ok(outbox.stats(fresh).pending > 0);
  assert.ok(nextSale.id > Math.max(...lastSynced.transactions.map((t) => t.id)), 'ids continue after the restored ones');
  const again = await restoreFromCloud({ db: fresh, client: client2 }).catch((e) => e.message);
  assert.match(again, /empty installation/);
  ok('after a restore new sales continue the numbering; a second restore is refused');
}

await server.close();
console.log('CLOUD SYNC SELF-TEST PASSED');
process.exit(0);
