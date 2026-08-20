import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { initDb, getDb } from './db/connection.js';
import { registerIpcHandlers } from './db/ipc-handlers.js';

// needed in case process is undefined under Linux
const platform = process.platform || os.platform();

const currentDir = fileURLToPath(new URL('.', import.meta.url));

let mainWindow;
function readBrandingFromDb() {
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
        { label: 'Exit', click: () => app.quit() },
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
  await initDb();
  registerIpcHandlers(ipcMain, getDb());

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
  await createWindow()
  applyBranding(readBrandingFromDb())
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
