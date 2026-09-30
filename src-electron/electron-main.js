import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { initDb, getDb, closeDb, getBackupDir, takeRecoveryNotice } from './db/connection.js';
import { createBackup } from './db/backup.js';
import { registerIpcHandlers } from './db/ipc-handlers.js';
import { loadShortcutsFromDb, getShortcutMap, comboFromInput } from './shortcuts.js';
import { lan, clientEndpoint } from './lan/runtime.js';
import { loadNetworkConfig } from './lan/network-config.js';
import { registerNetworkIpc } from './lan/network-ipc.js';
import { createLanServer } from './lan/lan-server.js';
import { subscribeToChanges } from './lan/lan-client.js';
import { ensureFirewallRule } from './lan/firewall.js';

// needed in case process is undefined under Linux
const platform = process.platform || os.platform();

const currentDir = fileURLToPath(new URL('.', import.meta.url));

let mainWindow;

// ---- Close / backup flow -------------------------------------------------
// Closing the window is intercepted: the renderer shows a "save your work"
// prompt and, when the user confirms, calls app:confirmClose which takes the
// daily backup and then really quits. If the renderer can't answer (crashed,
// still loading, page error) we never trap the user: after 3 s without an
// acknowledgement we back up and close anyway.
let allowClose = false;
let closeHandlerReady = false;
let ackTimer = null;

function backupNow() {
  // Client PCs have no local database: the main PC does the backups.
  if (lan.mode === 'client') return null;
  return createBackup(getDb(), getBackupDir());
}

function finishClose() {
  allowClose = true;
  clearTimeout(ackTimer);
  lan.stopEvents?.();
  lan.server?.close();
  closeDb();
  app.quit();
}

function quitWithBackupNoPrompt() {
  try {
    backupNow();
  } catch (err) {
    console.error('[backup] backup on close failed:', err);
  }
  finishClose();
}

function requestClose() {
  const wc = mainWindow?.webContents;
  if (!wc || wc.isDestroyed() || wc.isCrashed() || !closeHandlerReady) {
    quitWithBackupNoPrompt();
    return;
  }
  clearTimeout(ackTimer);
  ackTimer = setTimeout(quitWithBackupNoPrompt, 3000);
  wc.send('app:close-requested');
}

function registerCloseHandlers() {
  ipcMain.removeAllListeners('app:close-ack');
  ipcMain.on('app:close-ack', () => clearTimeout(ackTimer));

  ipcMain.removeAllListeners('app:close-handler-ready');
  ipcMain.on('app:close-handler-ready', (event, ready) => {
    closeHandlerReady = Boolean(ready);
  });

  ipcMain.removeHandler('app:confirmClose');
  ipcMain.handle('app:confirmClose', async (event, options) => {
    clearTimeout(ackTimer);
    const wantsBackup = options?.backup !== false && lan.mode !== 'client';
    if (wantsBackup) {
      try {
        backupNow();
      } catch (err) {
        console.error('[backup] backup on close failed:', err);
        const { response } = await dialog.showMessageBox(mainWindow, {
          type: 'warning',
          buttons: ['Exit anyway', 'Stay open'],
          defaultId: 1,
          cancelId: 1,
          title: 'Backup failed',
          message: 'The database backup could not be created.',
          detail: String(err?.message || err),
        });
        if (response === 1) return { closed: false, error: String(err?.message || err) };
      }
    }
    finishClose();
    return { closed: true };
  });
}

function readBrandingFromDb() {
  if (lan.mode === 'client') return { companyName: 'My Company' }; // the renderer sets the real name from the main PC's settings
  const db = getDb();
  if (!db) return { companyName: 'My Company' };

  const row = db
    .prepare(`SELECT value FROM settings WHERE key = 'company_name'`)
    .get();

  const companyName = String(row?.value || 'My Company').trim() || 'My Company';
  return { companyName };
}

function createMenu(branding = {}) {
  const companyName = String(branding.companyName || 'My Company').trim() || 'My Company';
  const template = [
    {
      label: 'File',
      submenu: [
        { role: 'reload' },
        { type: 'separator' },
        { label: 'Exit', click: () => mainWindow?.close() },
      ],
    },

    {
      label: 'Menu',
      submenu: [
        {
          label: 'Dashboard',
          accelerator: 'F1',
          click: () => mainWindow.webContents.send('navigate', '/'),
        },
        {
          label: 'Transactions',
          accelerator: 'F2',
          click: () => mainWindow.webContents.send('navigate', '/transactions'),
        },
        {
          label: 'Products',
          accelerator: 'F3',
          click: () => mainWindow.webContents.send('navigate', '/products'),
        },
        {
          label: 'Customers',
          accelerator: 'F4',
          click: () => mainWindow.webContents.send('navigate', '/customers'),
        },
        {
          label: 'Stock',
          accelerator: 'F5',
          click: () => mainWindow.webContents.send('navigate', '/stock'),
        },
        {
          label: 'Reports',
          accelerator: 'F6',
          click: () => mainWindow.webContents.send('navigate', '/reports'),
        },
        {
          label: 'Settings',
          accelerator: 'F7',
          click: () => mainWindow.webContents.send('navigate', '/settings'),
        },
      ],
    },

    {
      label: 'Help',
      submenu: [
        {
          label: `Company: ${companyName}`,
          enabled: false,
        },
        { type: 'separator' },
        {
          label: `About ${companyName}`,
          click: () => mainWindow.webContents.send('menu-about'),
        },
      ],
    },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

function applyBranding(branding = {}) {
  const companyName = String(branding.companyName || 'My Company').trim() || 'My Company';
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitle(companyName);
  }
  createMenu({ companyName });
}

async function createWindow() {
  // Initialize SQLite (creates file + runs migrations) BEFORE the window loads,
  // and BEFORE any IPC handlers are registered, so the renderer never races the DB.
  // Network role of this PC: 'single' (own database), 'host' (main PC, serves the
  // other PCs) or 'client' (no local database, uses the main PC's).
  lan.config = loadNetworkConfig();
  lan.mode = lan.config.mode;
  lan.key = lan.config.key;
  registerNetworkIpc(ipcMain);

  let handlers;
  if (lan.mode === 'client') {
    handlers = registerIpcHandlers(ipcMain, null);
  } else {
    await initDb();
    loadShortcutsFromDb(getDb());
    handlers = registerIpcHandlers(ipcMain, getDb());
  }

  if (lan.mode === 'host') {
    try {
      lan.server = await createLanServer({
        port: lan.config.port,
        getKey: () => lan.key,
        version: app.getVersion(),
        hostName: os.hostname(),
        dispatchDb: handlers.dispatchDb,
        printReceipt: handlers.printReceiptLocal,
        onRemoteChange: (info) => mainWindow?.webContents.send('lan:changed', info),
      });
      lan.serverError = '';
      ensureFirewallRule(lan.config.port); // Windows: let other PCs on the private network in
    } catch (err) {
      // Not fatal: this PC still works on its own. Settings > Network shows the reason.
      lan.serverError = String(err?.message || err);
      console.error('[network] server failed to start:', err);
    }
  }

  mainWindow = new BrowserWindow({
    icon: path.resolve(currentDir, 'icons/icon.png'),
    width: 1400,
    height: 900,
    useContentSize: true,
    webPreferences: {
      contextIsolation: true,
      preload: path.resolve(
        currentDir,
        path.join(process.env.QUASAR_ELECTRON_PRELOAD_FOLDER, 'electron-preload' + process.env.QUASAR_ELECTRON_PRELOAD_EXTENSION)
      ),
    },
  });

  // Intercepted here, before Chromium's default handling, so it works
  // regardless of which element has focus (including inputs where a plain
  // renderer keydown listener can get eaten by native behavior) and can't
  // be blocked by a component that stops event propagation. Only digit keys
  // combined with exactly one modifier ever match (see comboFromInput), so
  // normal typing is never affected.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const combo = comboFromInput(input);
    if (!combo) return;
    const action = getShortcutMap()[combo];
    if (action) {
      event.preventDefault();
      mainWindow.webContents.send('shortcut:trigger', action);
    }
  });

  if (lan.mode === 'client') {
    // Other PCs tell us when data changed, so screens stay fresh without manual refresh.
    lan.stopEvents = subscribeToChanges(clientEndpoint(app.getVersion()), {
      onChange: (info) => mainWindow?.webContents.send('lan:changed', info),
      onStatus: (connected) => {
        lan.clientConnected = connected;
        mainWindow?.webContents.send('lan:status', connected);
      },
    });
  }

  if (process.env.DEV) {
    mainWindow.loadURL(process.env.APP_URL);
  } else {
    mainWindow.loadFile('index.html');
  }

  if (process.env.DEBUGGING) {
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow.webContents.closeDevTools();
    });
  }

  closeHandlerReady = false; // the renderer re-announces itself once it has loaded
  mainWindow.webContents.on('did-start-loading', () => {
    closeHandlerReady = false;
  });

  mainWindow.on('close', (event) => {
    if (allowClose) return;
    event.preventDefault();
    requestClose();
  });

  // Windows shutdown / log-off: no time for a prompt, just take the backup.
  mainWindow.on('session-end', () => {
    allowClose = true;
    try {
      backupNow();
    } catch (err) {
      console.error('[backup] backup at session end failed:', err);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  ipcMain.removeHandler('app:updateBranding');
  ipcMain.handle('app:updateBranding', (event, payload = {}) => {
    const companyName = String(payload.companyName || '').trim() || readBrandingFromDb().companyName;
    applyBranding({ companyName });
    return { success: true };
  });
}

app.whenReady().then(async () => {
  registerCloseHandlers()
  try {
    await createWindow()
  } catch (err) {
    console.error('[startup] failed:', err)
    dialog.showErrorBox('The POS could not start', String(err?.message || err))
    app.exit(1)
    return
  }
  applyBranding(readBrandingFromDb())

  // If the database was damaged, initDb() already restored the newest healthy
  // backup - tell the user exactly what happened and what was lost.
  const recovery = takeRecoveryNotice()
  if (recovery) {
    dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Database restored from backup',
      message: 'The database was damaged, so it was restored from your latest healthy backup.',
      detail:
        `Backup used: ${recovery.restoredFrom}\n\n` +
        `Anything entered after ${recovery.backupDate} may be missing.\n\n` +
        `The damaged file was kept here in case it is needed:\n${recovery.damagedCopy}`,
    })
  }
})

app.on('window-all-closed', () => {
  if (platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', async () => {
  if (mainWindow === null) {
    await createWindow();
    applyBranding(readBrandingFromDb());
  }
});
