import { EventEmitter } from 'node:events';
import * as outbox from './outbox.js';
import { HttpError, NetworkError } from './cloud-client.js';

const BACKOFF_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000];

/**
 * Pushes the outbox to the server.
 *
 *   online  : a change is uploaded about half a second after it is saved ("kick")
 *   offline : nothing is lost - events wait in the outbox; retries back off
 *             5s -> 15s -> 30s -> 1m -> 2m -> 5m, and "Sync now" retries at once
 *   revoked : 401/403 stops retrying until the user connects again
 *
 * States: disabled | idle | syncing | offline | error
 * Emits 'status' (with the object from status()) whenever something visible changes.
 */
export class CloudWorker extends EventEmitter {
  constructor({
    db,
    client,
    getConfig,
    intervalMs = 30_000,
    heartbeatMs = 300_000,
    kickDelayMs = 400,
    maxEvents = 200,
    now = () => Date.now(),
  }) {
    super();
    Object.assign(this, { db, client, getConfig, intervalMs, heartbeatMs, kickDelayMs, maxEvents, now });
    this.state = 'disabled';
    this.lastSyncAt = null;
    this.lastContactAt = 0;
    this.lastError = '';
    this.backoffStep = 0;
    this.nextRetryAt = null;
    this.running = false;
    this.dirty = false;
    this.paused = false;
    this.stopped = true;
    this.timer = null;
    this.tick = null;
    this.lastEmit = '';
  }

  start() {
    if (!this.stopped) {
      this.kick(0); // already running (e.g. connect again): just flush
      return;
    }
    this.stopped = false;
    this.tick = setInterval(() => this.#onTick(), this.intervalMs);
    this.tick.unref?.();
    this.#refresh();
    this.kick(0);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearInterval(this.tick);
    this.timer = this.tick = null;
  }

  /** Restore/maintenance: no uploads while paused. */
  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
    this.kick(0);
  }

  /** Call after any local write. Cheap: it only schedules a flush. */
  kick(delay = this.kickDelayMs) {
    if (this.stopped) return;
    this.#emit();
    if (this.paused || this.#inBackoff()) return;
    if (this.running) {
      this.dirty = true;
      return;
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), delay);
  }

  /** The "Sync now" button: ignore any back-off and try right away. */
  async syncNow() {
    this.backoffStep = 0;
    this.nextRetryAt = null;
    await this.flush();
    return this.status();
  }

  async flush() {
    if (this.running || this.stopped || this.paused) return;
    if (!this.getConfig().enabled) {
      this.#refresh();
      return;
    }
    this.running = true;
    this.state = 'syncing';
    this.#emit();
    try {
      let sent = 0;
      for (;;) {
        const batch = outbox.nextBatch(this.db, { maxEvents: this.maxEvents });
        if (!batch.events.length) break;
        await this.#push(batch);
        sent += batch.events.length;
      }
      if (!sent) await this.client.ping(); // nothing to send: still prove the server is reachable
      this.lastContactAt = this.now();
      this.lastSyncAt = new Date(this.now()).toISOString();
      this.lastError = '';
      this.backoffStep = 0;
      this.nextRetryAt = null;
      this.state = 'idle';
    } catch (err) {
      this.#fail(err);
    } finally {
      this.running = false;
      this.#emit();
      if (this.dirty) {
        this.dirty = false;
        this.kick();
      }
    }
  }

  async #push(batch) {
    let events = batch.events;
    for (;;) {
      outbox.markAttempt(this.db, events.map((e) => e.id));
      try {
        const res = await this.client.push(events);
        const acked = res?.acked || [];
        const rejected = res?.rejected || [];
        if (!acked.length && !rejected.length) throw new Error('The server did not acknowledge the upload');
        outbox.markSent(this.db, batch.ackIds(acked));
        for (const r of rejected) outbox.markRejected(this.db, batch.ackIds([r.id]), r.reason);
        return;
      } catch (err) {
        if (err instanceof HttpError && err.status === 413) {
          if (events.length > 1) {
            events = events.slice(0, Math.ceil(events.length / 2)); // too big: halve and retry
            continue;
          }
          outbox.markRejected(this.db, batch.ackIds([events[0].id]), 'Too large for the server (raise post_max_size in PHP)');
          return;
        }
        throw err;
      }
    }
  }

  #fail(err) {
    if (err instanceof HttpError && (err.status === 401 || err.status === 403)) {
      this.state = 'error';
      this.lastError = 'The server no longer accepts this PC. Connect again in Settings > Cloud backup.';
      this.nextRetryAt = null; // do not hammer a revoked token
      return;
    }
    if (err instanceof HttpError && err.status === 409) {
      this.state = 'error';
      this.lastError = err.message || 'The app and the server use different sync versions. Update the older one.';
    } else if (err instanceof NetworkError) {
      this.state = 'offline';
      this.lastError = 'No connection to the server. Sales are saved and will upload when it is back.';
    } else {
      this.state = 'offline';
      this.lastError = err?.message || 'The server could not be reached';
    }
    const delay = BACKOFF_MS[Math.min(this.backoffStep, BACKOFF_MS.length - 1)];
    this.backoffStep += 1;
    this.nextRetryAt = this.now() + delay;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), delay);
  }

  #inBackoff() {
    return this.nextRetryAt !== null && this.now() < this.nextRetryAt;
  }

  #onTick() {
    if (this.running || this.paused || this.#inBackoff() || !this.getConfig().enabled) return;
    const { pending } = outbox.stats(this.db);
    if (pending > 0 || this.now() - this.lastContactAt > this.heartbeatMs) this.flush();
  }

  #refresh() {
    this.state = this.getConfig().enabled ? (this.state === 'disabled' ? 'idle' : this.state) : 'disabled';
    this.#emit();
  }

  status() {
    const cfg = this.getConfig();
    return {
      supported: true,
      enabled: !!cfg.enabled,
      state: cfg.enabled ? this.state : 'disabled',
      serverUrl: cfg.serverUrl || '',
      deviceId: cfg.deviceId ?? null,
      deviceName: cfg.deviceName || '',
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError,
      nextRetryAt: this.nextRetryAt ? new Date(this.nextRetryAt).toISOString() : null,
      ...(cfg.enabled ? outbox.stats(this.db) : { pending: 0, rejected: 0, oldestPending: null }),
    };
  }

  #emit() {
    const s = this.status();
    const key = JSON.stringify(s);
    if (key === this.lastEmit) return;
    this.lastEmit = key;
    this.emit('status', s);
  }
}
