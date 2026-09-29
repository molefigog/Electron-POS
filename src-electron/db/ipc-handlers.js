import {
  ProductRepository, CategoryRepository, TaxRepository,
  CustomerRepository, SupplierRepository, StockRepository, TransactionRepository, SettingsRepository,
} from './repositories.js';
import { SyncRepository } from './sync-repository.js';
import { app, BrowserWindow, dialog, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setShortcutMap } from '../shortcuts.js';
import { closeDb, getBackupDir, getDbPath, getSafetyDir } from './connection.js';
import { MAX_BACKUPS, assertRestorableBackup, createBackup, listBackups, restoreBackupFile } from './backup.js';

const execFileAsync = promisify(execFile);

/**
 * Returns a filename guaranteed not to collide with an existing file in
 * `dir`, appending " (1)", " (2)", etc. as needed - same convention as
 * Windows/macOS "Save" dialogs use for duplicates.
 */
function getAvailableFilename(dir, baseName, ext) {
  let candidate = `${baseName}${ext}`;
  let counter = 1;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${baseName} (${counter})${ext}`;
    counter += 1;
  }
  return candidate;
}

function writeTempHtml(html) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-print-'));
  const filePath = path.join(dir, 'document.html');
  fs.writeFileSync(filePath, html, 'utf8');
  return { dir, filePath };
}

function getReceiptsDirectory() {
  return path.join(os.homedir(), 'Documents', 'receipts');
}

async function waitForDocumentAssets(win) {
  try {
    await win.webContents.executeJavaScript(`
      Promise.all([
        document.fonts ? document.fonts.ready : Promise.resolve(),
        Promise.all(Array.from(document.images || []).map((img) => {
          if (img.complete) return Promise.resolve();
          return new Promise((resolve) => {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
          });
        }))
      ])
    `);
  } catch {
    // Best-effort only: never block printing if probing fails.
  }
}

// ---- Printing (A4 only) --------------------------------------------------
// No POS/receipt printer is supported yet: everything is A4 portrait.
// Hidden print windows are NOT offscreen: offscreen mode keeps painting
// bitmaps (extra CPU/RAM on 4 GB PCs) and is unreliable for print jobs.
const A4_PRINT_OPTIONS = {
  pageSize: 'A4',
  landscape: false,
  printBackground: true,
  margins: { marginType: 'none' }, // page margins come from the template's @page rule
};

const SILENT_PRINT_TIMEOUT_MS = 30000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createPrintWindow() {
  return new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
}

/**
 * Sends the loaded page to the printer. Resolves { success, cancelled }.
 * A silent job that the printer/spooler never acknowledges is rejected after
 * a timeout instead of leaving the UI waiting forever.
 */
function sendToPrinter(win, options, timeoutMs = 0) {
  return new Promise((resolve, reject) => {
    let timer = null;
    if (timeoutMs) {
      timer = setTimeout(() => {
        reject(new Error(
          'The printer did not respond. Check that it is online (not "Use Printer Offline") and clear the Windows print queue.'
        ));
      }, timeoutMs);
    }
    win.webContents.print(options, (success, failureReason) => {
      clearTimeout(timer);
      if (success) {
        resolve({ success: true, cancelled: false });
      } else if (String(failureReason || '').toLowerCase().includes('cancel')) {
        resolve({ success: false, cancelled: true });
      } else {
        reject(new Error(failureReason || 'Print failed'));
      }
    });
  });
}

// ---- In-app PDF viewer -----------------------------------------------------
// Generated PDFs open in the app's own Chromium PDF viewer instead of handing
// them to Edge/Chrome/whatever the OS default is. One viewer window at a time
// keeps memory low.
let pdfViewerWindow = null;

function openPdfInApp(filePath) {
  if (pdfViewerWindow && !pdfViewerWindow.isDestroyed()) {
    pdfViewerWindow.destroy();
  }
  const win = new BrowserWindow({
    width: 1000,
    height: 900,
    title: path.basename(filePath),
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  pdfViewerWindow = win;
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // -3 (ERR_ABORTED) is normal for the PDF viewer; anything else means the
  // viewer could not load, so fall back to the OS default app.
  win.webContents.on('did-fail-load', (_event, errorCode) => {
    if (errorCode === -3 || win.isDestroyed()) return;
    win.destroy();
    shell.openPath(filePath);
  });
  win.on('closed', () => {
    if (pdfViewerWindow === win) pdfViewerWindow = null;
  });
  win.loadURL(pathToFileURL(filePath).href).catch(() => {});
}

async function createPdfFile(html, defaultFileName) {
  const dateFolder = new Date().toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  }).replace(/ /g, '-');
  const receiptsDir = path.join(getReceiptsDirectory(), dateFolder);
  fs.mkdirSync(receiptsDir, { recursive: true });
  const filename = defaultFileName || 'document.pdf';
  const baseName = path.parse(filename).name;
  const ext = path.extname(filename) || '.pdf';
  const fullPath = path.join(receiptsDir, getAvailableFilename(receiptsDir, baseName, ext));
  const printWin = createPrintWindow();
  let tempHtml = null;
  try {
    tempHtml = writeTempHtml(html);
    await printWin.loadFile(tempHtml.filePath);
    await waitForDocumentAssets(printWin);
    const pdfBuffer = await printWin.webContents.printToPDF({
      pageSize: 'A4',
      landscape: false,
      printBackground: true,
      preferCSSPageSize: true,
    });
    fs.writeFileSync(fullPath, pdfBuffer);
  } finally {
    printWin.destroy();
    if (tempHtml) fs.rmSync(tempHtml.dir, { recursive: true, force: true });
  }
  return fullPath;
}

function encodePowerShellValue(value) {
  return Buffer.from(String(value || ''), 'utf8').toString('base64');
}

async function openOutlookDraft({ to, subject, body, htmlBody }) {
  const decode = (value) => `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodePowerShellValue(value)}'))`;
  const script = `$to=${decode(to)};$subject=${decode(subject)};$body=${decode(body)};$htmlBody=${decode(htmlBody)};` +
    '$outlook=New-Object -ComObject Outlook.Application;$mail=$outlook.CreateItem(0);' +
    '$mail.To=$to;$mail.Subject=$subject;$mail.Body=$body;$mail.HTMLBody=$htmlBody;$mail.Display();';
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true });
}


export function registerIpcHandlers(ipcMain, db) {
  const repos = {
    products: new ProductRepository(db),
    categories: new CategoryRepository(db),
    taxes: new TaxRepository(db),
    customers: new CustomerRepository(db),
    suppliers: new SupplierRepository(db),
    stock: new StockRepository(db),
    transactions: new TransactionRepository(db),
    settings: new SettingsRepository(db),
    sync: new SyncRepository(db),
  };

  // Allow-list of which methods may be invoked from the renderer, per repo.
  // This is the whole point of the bridge: the renderer can never run raw SQL.
  const allowList = {
    products: ['all', 'find', 'findByBarcode', 'findBySku', 'findAnyByBarcode', 'findAnyBySku', 'create', 'update', 'delete'],
    categories: ['all', 'create', 'delete'],
    taxes: ['all', 'create', 'delete'],
    customers: ['all', 'find', 'create', 'update', 'delete'],
    suppliers: ['all', 'find', 'create', 'update', 'delete'],
    stock: ['history', 'summary', 'record'],
    transactions: ['all', 'find', 'create', 'update', 'delete', 'convertQuoteToInvoice'],
    settings: ['all', 'update'],
    sync: ['pending', 'getCursor', 'enqueue', 'acknowledge'],
  };

  ipcMain.handle('db:call', async (event, { repository, method, args }) => {
    const repo = repos[repository];
    if (!repo) throw new Error(`Unknown repository: ${repository}`);
    if (!allowList[repository]?.includes(method)) {
      throw new Error(`Method "${method}" is not allowed on repository "${repository}"`);
    }
    try {
      // args is expected to be an array of positional args, or a single object
      const argArray = Array.isArray(args) ? args : args === undefined ? [] : [args];
      const result = repo[method](...argArray);
      // Guarantee the return value is plain, cloneable data. better-sqlite3
      // rows are already plain objects, but this protects against edge cases
      // like BigInt row ids or Date instances slipping through, which the
      // Electron context bridge / structured clone cannot serialize.
      return result === undefined ? result : JSON.parse(JSON.stringify(result, (key, value) => (typeof value === 'bigint' ? value.toString() : value)));
    } catch (err) {
      // Surface a clean message to the renderer instead of a stack trace
      throw new Error(err.message || 'Database operation failed');
    }
  });

  ipcMain.handle('app:getVersion', () => app.getVersion());

  // ---- Database backups (see db/backup.js) ----
  ipcMain.handle('backup:list', () => ({
    dir: getBackupDir(),
    max: MAX_BACKUPS,
    backups: listBackups(getBackupDir()),
  }));

  ipcMain.handle('backup:create', () => {
    const result = createBackup(db, getBackupDir());
    return { name: result.name, size: result.size, dir: getBackupDir() };
  });

  ipcMain.handle('backup:openFolder', async () => {
    const dir = getBackupDir();
    fs.mkdirSync(dir, { recursive: true });
    const openError = await shell.openPath(dir);
    if (openError) throw new Error(openError);
    return { success: true, dir };
  });

  ipcMain.handle('backup:restore', (event, payload = {}) => {
    const fileName = String(payload?.fileName || '');
    // Validate first (name, file exists, passes integrity check) while the app
    // is still fully working - a bad request must never close the database.
    assertRestorableBackup(getBackupDir(), fileName);

    const restart = () => {
      // `quasar dev` ties Electron to its dev server, so only relaunch when packaged.
      if (app.isPackaged) app.relaunch();
      app.exit(0);
    };

    // The live connection must be closed before its file is replaced.
    closeDb();
    try {
      restoreBackupFile(getDbPath(), getBackupDir(), getSafetyDir(), fileName);
    } catch (err) {
      // Rolled back: the original database is still in place. Restart so it reopens.
      dialog.showErrorBox('Restore failed', `${err.message}\n\nYour current data was not changed.`);
      restart();
      return { restarted: app.isPackaged, failed: true };
    }
    restart();
    return { restarted: app.isPackaged };
  });

  ipcMain.handle('app:openCalculator', () => {
    if (process.platform === 'win32') {
      spawn('calc.exe', [], { detached: true, stdio: 'ignore' }).unref();
      return { success: true };
    }

    const command = process.platform === 'darwin' ? 'open' : 'gnome-calculator';
    spawn(command, process.platform === 'darwin' ? ['-a', 'Calculator'] : [], {
      detached: true,
      stdio: 'ignore',
    }).unref();
    return { success: true };
  });

  ipcMain.handle('app:openReceiptsFolder', async () => {
    const receiptsDir = getReceiptsDirectory();
    fs.mkdirSync(receiptsDir, { recursive: true });
    const openError = await shell.openPath(receiptsDir);
    if (openError) throw new Error(openError);
    return { success: true, filePath: receiptsDir };
  });

  /**
   * Called from SettingsPage.vue right after saving keyboard_shortcuts, so
   * the before-input-event handler in electron-main.js starts using the
   * new combos immediately - no app restart needed.
   */
  ipcMain.handle('app:updateShortcuts', (event, map) => {
    setShortcutMap(map);
    return { success: true };
  });

  ipcMain.handle('app:getPrinters', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return [];

    const printers = await win.webContents.getPrintersAsync();
    return printers.map((printer) => ({
      name: printer.name,
      displayName: printer.displayName || printer.name,
      isDefault: !!printer.isDefault,
      status: printer.status,
    }));
  });

  ipcMain.handle('app:printHtml', async (event, { html, silent = false, deviceName = null }) => {
    if (!html) throw new Error('No print content provided');

    const printWin = createPrintWindow();
    let tempHtml = null;
    try {
      tempHtml = writeTempHtml(html);
      await printWin.loadFile(tempHtml.filePath);
      await waitForDocumentAssets(printWin);

      const options = { ...A4_PRINT_OPTIONS, silent: Boolean(silent) };

      if (silent) {
        // Silent jobs must target a printer that really exists right now;
        // a stale/renamed printer is a classic "queued but never printed".
        const printers = await printWin.webContents.getPrintersAsync();
        const target = deviceName
          ? printers.find((p) => p.name === deviceName)
          : printers.find((p) => p.isDefault);
        if (!target) {
          throw new Error(deviceName
            ? `Printer "${deviceName}" was not found. Choose another printer in Settings.`
            : 'No default printer found. Choose a printer in Settings.');
        }
        options.deviceName = target.name;
      }

      // Silent: timeout protects against a hung spooler.
      // Dialog: no timeout, the user may take as long as they need.
      const result = await sendToPrinter(printWin, options, silent ? SILENT_PRINT_TIMEOUT_MS : 0);
      if (silent && result.success) await delay(1500); // let the spooler take the job before the window goes
      return result;
    } finally {
      if (!printWin.isDestroyed()) printWin.destroy();
      if (tempHtml) {
        fs.rmSync(tempHtml.dir, { recursive: true, force: true });
      }
    }
  });

  /**
   * Renders the given HTML to an A4 PDF, saves it silently (no save dialog)
   * to ~/Documents/receipts, and opens it in the app's own PDF viewer window.
   * `defaultFileName` should already be a sensible name, e.g. "INV-00001.pdf" -
   * a numeric suffix is appended automatically if that name is already taken.
   */
  ipcMain.handle('app:printPdf', async (event, { html, defaultFileName }) => {
    const fullPath = await createPdfFile(html, defaultFileName);
    openPdfInApp(fullPath);
    return {
      filePath: fullPath,
      opened: true,
      openError: null,
    };
  });

  ipcMain.handle('app:emailPdf', async (event, { to, subject, body, htmlBody }) => {
    if (!body && !htmlBody) throw new Error('No email content provided');
    try {
      await openOutlookDraft({ to, subject, body, htmlBody });
      return { html: true };
    } catch {
      const mailto = `mailto:${encodeURIComponent(to || '')}?subject=${encodeURIComponent(subject || '')}&body=${encodeURIComponent(body || '')}`;
      await shell.openExternal(mailto);
      return { html: false };
    }
  });
}
