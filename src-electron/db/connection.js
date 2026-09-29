import { app } from 'electron';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { runMigrations } from '../../migrations.js';
import {
  ensureDailyBackup,
  isCorruptionError,
  openVerifiedDatabase,
  recoverFromBackup,
} from './backup.js';

let db;
let currentDbPath = null;
let recoveryNotice = null;

/**
 * Backups live in the user's Documents folder (not next to the app) so they
 * survive a reinstall or a wiped install folder. Dev builds use their own
 * folder so test data never pushes real backups out of the 5-copy limit.
 */
export function getBackupDir() {
  let documents;
  try {
    documents = app.getPath('documents');
  } catch {
    documents = path.join(os.homedir(), 'Documents');
  }
  return path.join(documents, app.isPackaged ? 'POS Backups' : 'POS Backups (dev)');
}

export function getSafetyDir() {
  return path.join(getBackupDir(), 'safety');
}

export function getDbPath() {
  return currentDbPath;
}

/** Returns (once) details of an automatic recovery that happened at startup. */
export function takeRecoveryNotice() {
  const notice = recoveryNotice;
  recoveryNotice = null;
  return notice;
}

export function closeDb() {
  try {
    db?.close();
  } catch {
    /* already closed */
  }
  db = undefined;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function canWriteToDir(dirPath) {
  try {
    ensureDir(dirPath);
    fs.accessSync(dirPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveDbPath() {
  const userDataPath = app.getPath('userData');
  const devPath = path.join(userDataPath, 'nid-pos.sqlite3');

  // Development keeps DB in userData to avoid polluting the project folder.
  if (!app.isPackaged) {
    ensureDir(userDataPath);
    return devPath;
  }

  // Production target: same folder as App.exe.
  const exeDir = path.dirname(app.getPath('exe'));
  if (canWriteToDir(exeDir)) {
    const exeDbPath = path.join(exeDir, 'nid-pos.sqlite3');
    const packagedSeedPath = path.join(process.resourcesPath, 'nid-pos.sqlite3');

    // On first run, seed the writable DB beside the executable from packaged resources.
    if (!fs.existsSync(exeDbPath) && fs.existsSync(packagedSeedPath)) {
      fs.copyFileSync(packagedSeedPath, exeDbPath);
    }

    return exeDbPath;
  }

  // Fallback for locked install locations (e.g., Program Files).
  ensureDir(userDataPath);
  return devPath;
}

export async function initDb() {
  const dbPath = resolveDbPath();
  currentDbPath = dbPath;

  try {
    db = openVerifiedDatabase(dbPath);
  } catch (err) {
    if (!isCorruptionError(err)) throw err;
    console.error('[db] database failed its integrity check, attempting recovery:', err.message);
    // Moves the damaged file aside and installs the newest healthy backup.
    // Throws a readable error if there is no usable backup.
    recoveryNotice = recoverFromBackup(dbPath, getBackupDir(), getSafetyDir());
    db = openVerifiedDatabase(dbPath);
  }

  db.pragma('foreign_keys = ON');

  // Start-of-day safety net (only if today has no backup yet) - taken BEFORE
  // migrations so a bad migration can also be rolled back.
  try {
    ensureDailyBackup(db, getBackupDir());
  } catch (err) {
    console.error('[backup] startup backup failed:', err.message);
  }

  runMigrations(db);

  return db;
}

export function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}
