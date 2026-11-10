#!/usr/bin/env node
// ─── DB RESTORE ──────────────────────────────────────────────────────────────
//
// Unpacks pipeline/data/snapshot/growleads.db.gz into
// pipeline/data/growleads.db. This is the one command a fresh clone runs to
// get the whole dataset.
//
//   npm run db:restore            # refuses if a database already exists
//   npm run db:restore -- --force # overwrite it (a .bak- copy is kept)

process.env.NODE_NO_WARNINGS = '1';
const { DatabaseSync } = require('node:sqlite');
const zlib = require('zlib');
const path = require('path');
const fs = require('fs');

const DB_PATH   = process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'growleads.db');
const SNAP_PATH = path.join(__dirname, '..', 'data', 'snapshot', 'growleads.db.gz');
const force     = process.argv.includes('--force');

const mb = b => (b / 1048576).toFixed(1) + ' MB';

if (!fs.existsSync(SNAP_PATH)) {
  console.error(`✖ No snapshot at ${SNAP_PATH}`);
  console.error('  Nothing to restore — run the pipeline to build a database from scratch.');
  process.exit(1);
}

if (fs.existsSync(DB_PATH) && !force) {
  console.error(`✖ A database already exists at ${DB_PATH} (${mb(fs.statSync(DB_PATH).size)}).`);
  console.error('  Restoring would replace it. Re-run with --force if that is what you want:');
  console.error('    npm run db:restore -- --force');
  process.exit(1);
}

if (fs.existsSync(DB_PATH)) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
  const bak = `${DB_PATH}.bak-${stamp}`;
  fs.renameSync(DB_PATH, bak);
  console.log(`Existing database moved aside → ${path.basename(bak)}`);
}

// A stale WAL/SHM from the old database would shadow the restored file.
for (const suffix of ['-wal', '-shm']) fs.rmSync(DB_PATH + suffix, { force: true });

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
console.log('Decompressing…');
fs.writeFileSync(DB_PATH, zlib.gunzipSync(fs.readFileSync(SNAP_PATH)));

const db = new DatabaseSync(DB_PATH, { readOnly: true });
const tables = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
).all();
console.log(`\n✔ Restored ${mb(fs.statSync(DB_PATH).size)} to ${path.relative(process.cwd(), DB_PATH)}\n`);
for (const { name } of tables) {
  const { n } = db.prepare(`SELECT COUNT(*) n FROM "${name}"`).get();
  console.log(`  ${String(n).padStart(8)}  ${name}`);
}
db.close();
console.log('\nNext:  node cli.js status');
