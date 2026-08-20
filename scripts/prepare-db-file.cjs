const path = require('node:path');
const fs = require('node:fs');

const dbPath = path.resolve(process.cwd(), 'nid-pos.sqlite3');

if (!fs.existsSync(dbPath)) {
    console.error(`Missing required database file: ${dbPath}`);
    console.error('Place your existing nid-pos.sqlite3 in the project root before building the installer.');
    process.exit(1);
} else {
    console.log(`Using existing database file: ${dbPath}`);
}
