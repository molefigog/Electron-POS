/**
 * Database backup + recovery helpers (main process, no Electron imports so the
 * logic stays easy to test).
 *
 * Model: ONE backup file per calendar day, newest MAX_BACKUPS days kept.
 *   nid-pos_2026-09-28.sqlite3
 * A second backup on the same day replaces that day's file with the latest
 * state, so five copies always means five different days of history.
 *
 * Backups are made with `VACUUM INTO`, which writes a consistent, compact copy
 * of a live WAL-mode database in one step (no half-written pages, no -wal/-shm
 * files to chase). Each copy is integrity-checked before it replaces anything,
 * so a bad copy can never overwrite a good backup.
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export const MAX_BACKUPS = 5;
const BACKUP_RE = /^nid-pos_(\d{4}-\d{2}-\d{2})\.sqlite3$/;
const MAX_SAFETY_COPIES = 3;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function localDateStamp(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function timeStamp(date = new Date()) {
  const t = [date.getHours(), date.getMinutes(), date.getSeconds()].map((n) => String(n).padStart(2, '0')).join('-');
  return `${localDateStamp(date)}_${t}`;
}

/** Only genuine corruption should trigger a restore - not locked files or permission errors. */
export function isCorruptionError(err) {
  const code = String(err?.code || '');
  return code.startsWith('SQLITE_CORRUPT') || code === 'SQLITE_NOTADB' || err?.isIntegrityFailure === true;
}

/**
 * Opens `file` read-only and runs an integrity check. `full` uses
 * integrity_check (thorough, used for backups); otherwise quick_check (fast,
 * used at startup). Returns { ok, detail }.
 */
export function verifyDatabaseFile(file, { full = true } = {}) {
  let d;
  try {
    d = new Database(file, { readonly: true, fileMustExist: true });
    const result = d.pragma(full ? 'integrity_check' : 'quick_check', { simple: true });
    return { ok: result === 'ok', detail: String(result) };
  } catch (err) {
    return { ok: false, detail: err.message, error: err };
  } finally {
    try { d?.close(); } catch { /* ignore */ }
  }
}

/**
 * Opens the live database and makes sure it is healthy (fast quick_check).
 * Throws an error that isCorruptionError() recognises when the file is damaged;
 * other failures (locked file, permissions) keep their original error so a
 * healthy DB is never mistaken for a broken one.
 */
export function openVerifiedDatabase(file) {
  let d;
  try {
    d = new Database(file);
    d.pragma('journal_mode = WAL');
    const result = d.pragma('quick_check', { simple: true });
    if (result !== 'ok') {
      const err = new Error(`Integrity check failed: ${result}`);
      err.isIntegrityFailure = true;
      throw err;
    }
    return d;
  } catch (err) {
    try { d?.close(); } catch { /* ignore */ }
    throw err;
  }
}

function moveFile(from, to) {
  try {
    fs.renameSync(from, to);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    fs.copyFileSync(from, to); // different drive: copy then remove
    fs.rmSync(from, { force: true });
  }
}

export function listBackups(backupDir) {
  if (!fs.existsSync(backupDir)) return [];
  return fs
    .readdirSync(backupDir)
    .map((name) => ({ name, match: BACKUP_RE.exec(name) }))
    .filter((e) => e.match)
    .map(({ name, match }) => {
      const stat = fs.statSync(path.join(backupDir, name));
      return { name, date: match[1], size: stat.size, modified: stat.mtime.toISOString() };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first
}

export function pruneBackups(backupDir, max = MAX_BACKUPS) {
  const removed = [];
  for (const entry of listBackups(backupDir).slice(max)) {
    fs.rmSync(path.join(backupDir, entry.name), { force: true });
    removed.push(entry.name);
  }
  return removed;
}

/**
 * Writes today's backup from the live `db`. Verifies the copy first, then swaps
 * it in, then prunes to `max` files. Throws (and leaves existing backups
 * untouched) if anything fails.
 */
export function createBackup(db, backupDir, { max = MAX_BACKUPS, now = new Date() } = {}) {
  ensureDir(backupDir);
  const finalName = `nid-pos_${localDateStamp(now)}.sqlite3`;
  const finalPath = path.join(backupDir, finalName);
  const tmpPath = path.join(backupDir, `.tmp-${process.pid}-${Date.now()}.sqlite3`);
  try {
    db.prepare('VACUUM INTO ?').run(tmpPath);
    const check = verifyDatabaseFile(tmpPath, { full: true });
    if (!check.ok) throw new Error(`Backup failed its integrity check: ${check.detail}`);
    fs.renameSync(tmpPath, finalPath);
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }
  const removed = pruneBackups(backupDir, max);
  const stat = fs.statSync(finalPath);
  return { name: finalName, path: finalPath, size: stat.size, removed };
}

/** True when the DB already holds tables (skip backing up a brand-new empty file). */
export function hasUserTables(db) {
  return db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).get().n > 0;
}

/** Start-of-day safety net: only creates a backup if today has none yet. */
export function ensureDailyBackup(db, backupDir, opts = {}) {
  const today = `nid-pos_${localDateStamp(opts.now || new Date())}.sqlite3`;
  if (fs.existsSync(path.join(backupDir, today))) return null;
  if (!hasUserTables(db)) return null;
  return createBackup(db, backupDir, opts);
}

function pruneSafety(safetyDir) {
  if (!fs.existsSync(safetyDir)) return;
  const files = fs
    .readdirSync(safetyDir)
    .filter((n) => /\.sqlite3$/.test(n))
    .map((n) => ({ n, t: fs.statSync(path.join(safetyDir, n)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const f of files.slice(MAX_SAFETY_COPIES)) {
    fs.rmSync(path.join(safetyDir, f.n), { force: true });
    fs.rmSync(path.join(safetyDir, `${f.n}-wal`), { force: true });
    fs.rmSync(path.join(safetyDir, `${f.n}-shm`), { force: true });
  }
}

/** Keeps a copy of the current DB before it is replaced (kept: newest 3). */
function quarantine(dbPath, safetyDir, label) {
  ensureDir(safetyDir);
  const dest = path.join(safetyDir, `${label}_${timeStamp()}.sqlite3`);
  const moved = [];
  const relocate = (from, to) => {
    if (!fs.existsSync(from)) return;
    moveFile(from, to);
    moved.push([from, to]);
  };
  relocate(dbPath, dest);
  // A stale WAL/SHM next to a replaced DB file can corrupt it - always clear them.
  for (const suffix of ['-wal', '-shm']) relocate(`${dbPath}${suffix}`, `${dest}${suffix}`);
  pruneSafety(safetyDir);
  // If installing the replacement fails we put everything back, so a failed
  // restore can never leave the app without a database.
  const undo = () => {
    for (const [from, to] of moved) {
      if (fs.existsSync(to)) moveFile(to, from);
    }
  };
  return { dest, undo };
}

function installBackupFile(backupPath, dbPath) {
  const staging = `${dbPath}.restoring`;
  fs.copyFileSync(backupPath, staging);
  fs.renameSync(staging, dbPath);
}

/**
 * Startup recovery: the DB failed its check. Move the damaged files aside and
 * install the newest backup that passes a full integrity check. Throws if no
 * usable backup exists (the damaged file is then left exactly where it was).
 */
export function recoverFromBackup(dbPath, backupDir, safetyDir) {
  const candidate = listBackups(backupDir).find((b) => verifyDatabaseFile(path.join(backupDir, b.name), { full: true }).ok);
  if (!candidate) {
    throw new Error(`The database is damaged and no valid backup was found in:\n${backupDir}`);
  }
  const damaged = quarantine(dbPath, safetyDir, 'damaged');
  try {
    installBackupFile(path.join(backupDir, candidate.name), dbPath);
  } catch (err) {
    damaged.undo();
    throw err;
  }
  return { restoredFrom: candidate.name, backupDate: candidate.date, damagedCopy: damaged.dest };
}

/**
 * Manual restore of a chosen backup. The caller must have CLOSED the live
 * connection first. The current DB is kept in the safety folder.
 */
export function assertRestorableBackup(backupDir, fileName) {
  if (!BACKUP_RE.test(fileName || '')) throw new Error('Invalid backup file name');
  const source = path.join(backupDir, fileName);
  if (!fs.existsSync(source)) throw new Error('Backup file not found');
  const check = verifyDatabaseFile(source, { full: true });
  if (!check.ok) throw new Error(`This backup is damaged and cannot be restored: ${check.detail}`);
  return source;
}

export function restoreBackupFile(dbPath, backupDir, safetyDir, fileName) {
  const source = assertRestorableBackup(backupDir, fileName);
  const previous = quarantine(dbPath, safetyDir, 'before-restore');
  try {
    installBackupFile(source, dbPath);
  } catch (err) {
    previous.undo();
    throw err;
  }
  return { restoredFrom: fileName, previousCopy: previous.dest };
}
