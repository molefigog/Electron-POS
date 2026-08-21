import { SettingsRepository } from './db/repositories.js';

/** Module-level singleton so both electron-main.js (before-input-event) and ipc-handlers.js (the update endpoint) see the same live map without extra plumbing. */
let currentMap = {};

export function loadShortcutsFromDb(db) {
  const settingsRepo = new SettingsRepository(db);
  const raw = settingsRepo.get('keyboard_shortcuts', '{}');
  try {
    currentMap = JSON.parse(raw) || {};
  } catch {
    currentMap = {};
  }
  return currentMap;
}

export function getShortcutMap() {
  return currentMap;
}

export function setShortcutMap(map) {
  currentMap = map && typeof map === 'object' ? map : {};
}

/**
 * Builds a normalized combo string like "ctrl+1" or "shift+7" from an
 * Electron `before-input-event` `input` object, or null if this keystroke
 * isn't a shortcut candidate. Deliberately narrow: exactly one modifier
 * (ctrl or shift - meta is treated as ctrl for cross-platform consistency)
 * plus a single digit 0-9. This is what keeps the feature from ever
 * colliding with normal typing, text editing, or other app shortcuts.
 */
export function comboFromInput(input) {
  if (!/^[0-9]$/.test(input.key)) return null;
  if (input.alt) return null; // keep Alt combos free for OS/menu use
  const mods = [];
  if (input.control || input.meta) mods.push('ctrl');
  if (input.shift) mods.push('shift');
  if (mods.length !== 1) return null;
  return `${mods[0]}+${input.key}`;
}
