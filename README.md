# New Interior Decorators POS (NID POS)

A desktop point-of-sale and business management application built with Quasar, Vue 3, Electron, and SQLite.

## Features

- Create quotations, invoices, and purchase orders; convert quotations to invoices.
- Manage products, customers, suppliers, stock movements, and barcode-scanned sales.
- Print A4 documents and 80 mm receipts, export PDFs, and create business letters.
- Track double-entry accounting, expenses, bills, payments, and receivables; export accounting data.
- Use the app on a single PC or connect multiple PCs to one database over a local network.
- Optionally back up data to a separately hosted Laravel sync server. Cloud sync is off until configured in Settings.
- Export product and accounting data to spreadsheet and other supported formats.

The Lekuka e-invoicing provider can currently be selected in Settings, but it is not connected for invoice submission yet; RSL credentials and certificate setup are still required.

For detailed feature notes, see [CHANGELOG.md](CHANGELOG.md), [ACCOUNTING.md](ACCOUNTING.md), and the [cloud backup guide](docs/cloud-sync/README.md).

## Use the POS

1. Open Dashboard and confirm the application loads.
2. Set your business details, tax, currency, and print preferences in Settings.
3. Add products, customers, and suppliers as needed.
4. Create a quotation, invoice, or purchase order in Transactions. Add items by search, SKU, or barcode scanner, then save.
5. Print the document, export it as a PDF, or convert a quotation to an invoice.
6. Use Stock, Accounting, and Reports to manage inventory and review business activity.
7. Configure a receipt printer, LAN host/client, or cloud backup from Settings when needed.

## Requirements

- Node.js and npm. The current `package.json` engine range supports Node.js 20, 22, 24, 26, and 28.
- Windows is required to build the Windows NSIS installer.
- The project root must contain `nid-pos.sqlite3` when building the Electron installer. The build script checks for it and packages that database file.

## Set up a clone or fork

```bash
git clone https://github.com/molefigog/Electron-POS
cd Electron-POS
npm install
```

If you cloned into a folder with a different name, change into that folder instead. Start the app in a browser during development:

```bash
npm run dev
```

Run the desktop app in development mode:

```bash
npm run dev:electron
```

## Change the application icon

After forking or cloning the repository, use [Quasar Icon Genie](https://quasar.dev/icongenie/) to generate the Electron icon files from your own PNG. Icon Genie requires Node.js 22 or later; install it globally:

```bash
npm install --global @quasar/icongenie
```

From the project root, run the generator with a square PNG source image (at least 64 x 64 pixels; 1024 x 1024 pixels is recommended):

```bash
icongenie generate --mode electron --icon path/to/your-icon.png
```

Icon Genie generates the Electron icon assets in `src-electron/icons/`, including `icon.ico` for the Windows installer. Review the generated files, then build the installer to apply the new icon. Commit the generated icon files to your fork if you want to keep the change.

## Build and checks

Build the web application:

```bash
npm run build
```

Build the Windows Electron installer:

```bash
npm run build:electron
```

The installer and other Electron build output are written to `dist/electron`. The installer is an NSIS `.exe` file.

Run the available lint and self-tests:

```bash
npm run lint
npm run sync:selftest
npm run accounting:selftest
```

## Feature requests

- Email: elliot@gw-ent.co.za
- Website: https://nid.gw-ent.co.za

## Quasar configuration

See [Configuring quasar.config.js](https://v2.quasar.dev/quasar-cli-vite/quasar-config-js).
