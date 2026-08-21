import {
  ProductRepository, CategoryRepository, TaxRepository,
  CustomerRepository, StockRepository, TransactionRepository, SettingsRepository,
} from './repositories.js';
import { app, BrowserWindow, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { setShortcutMap } from '../shortcuts.js';

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


export function registerIpcHandlers(ipcMain, db) {
  const repos = {
    products: new ProductRepository(db),
    categories: new CategoryRepository(db),
    taxes: new TaxRepository(db),
    customers: new CustomerRepository(db),
    stock: new StockRepository(db),
    transactions: new TransactionRepository(db),
    settings: new SettingsRepository(db),
  };

  // Allow-list of which methods may be invoked from the renderer, per repo.
  // This is the whole point of the bridge: the renderer can never run raw SQL.
  const allowList = {
    products: ['all', 'find', 'findByBarcode', 'create', 'update', 'delete'],
    categories: ['all', 'create', 'delete'],
    taxes: ['all', 'create', 'delete'],
    customers: ['all', 'find', 'create', 'update', 'delete'],
    stock: ['history', 'record'],
    transactions: ['all', 'find', 'create', 'update', 'delete', 'convertQuoteToInvoice'],
    settings: ['all', 'update'],
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

    const printWin = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
    let tempHtml = null;
    try {
      tempHtml = writeTempHtml(html);
      await printWin.loadFile(tempHtml.filePath);
      await waitForDocumentAssets(printWin);
      const options = {
        silent: Boolean(silent),
        deviceName: deviceName || undefined,
        printBackground: true,
      };

      await new Promise((resolve, reject) => {
        printWin.webContents.print(options, (success, failureReason) => {
          if (!success) {
            reject(new Error(failureReason || 'Print failed'));
            return;
          }
          resolve();
        });
      });
    } finally {
      printWin.close();
      if (tempHtml) {
        fs.rmSync(tempHtml.dir, { recursive: true, force: true });
      }
    }

    return { success: true };
  });

  /**
   * Renders the given HTML to an A4 PDF, saves it silently (no save dialog)
   * to ~/Documents/receipts, and opens it with the OS's default PDF viewer.
   * `defaultFileName` should already be a sensible name, e.g. "INV-00001.pdf" -
   * a numeric suffix is appended automatically if that name is already taken.
   */
  ipcMain.handle('app:printPdf', async (event, { html, defaultFileName }) => {
    // Build a "21-Aug-2026" style folder name from today's date
    const dateFolder = new Date().toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).replace(/ /g, '-'); // "21 Aug 2026" -> "21-Aug-2026"

    const receiptsDir = path.join(os.homedir(), 'Documents', 'receipts', dateFolder);
    if (!fs.existsSync(receiptsDir)) {
      fs.mkdirSync(receiptsDir, { recursive: true });
    }

    const filename = defaultFileName || 'document.pdf';
    const baseName = path.parse(filename).name;
    const ext = path.extname(filename) || '.pdf';
    const safeFilename = getAvailableFilename(receiptsDir, baseName, ext);
    const fullPath = path.join(receiptsDir, safeFilename);

    const printWin = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
    let tempHtml = null;
    try {
      tempHtml = writeTempHtml(html);
      await printWin.loadFile(tempHtml.filePath);
      await waitForDocumentAssets(printWin);
      const pdfBuffer = await printWin.webContents.printToPDF({ pageSize: 'A4', printBackground: true });
      fs.writeFileSync(fullPath, pdfBuffer);
    } finally {
      printWin.close();
      if (tempHtml) {
        fs.rmSync(tempHtml.dir, { recursive: true, force: true });
      }
    }

    const openError = await shell.openPath(fullPath);
    return {
      filePath: fullPath,
      opened: !openError,
      openError: openError || null,
    };
  });
}
