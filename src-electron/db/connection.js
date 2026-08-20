import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { runMigrations } from './migrations.js';

let db;

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
  db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);

  return db;
}

export function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}
