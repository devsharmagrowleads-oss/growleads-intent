#!/usr/bin/env node
// ─── DB SNAPSHOT ─────────────────────────────────────────────────────────────
//
// Packs pipeline/data/growleads.db into a committable gzip at
// pipeline/data/snapshot/growleads.db.gz so a fresh clone gets the full
// dataset — including the 30-day scraped_profiles cache, which is what lets
// a clone replay engagers at 0 RapidAPI credits.
//
//   npm run db:snapshot
//
// VACUUM INTO folds in the WAL and drops free pages, so the snapshot is a
// clean, compact copy — not a torn read of a live file.

process.env.NODE_NO_WARNINGS = '1';
const { DatabaseSync } = require('node:sqlite');
const zlib = require('zlib');
const path = require('path');
const fs = require('fs');

const DB_PATH   = process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'growleads.db');
const SNAP_DIR  = path.join(__dirname, '..', 'data', 'snapshot');
const SNAP_PATH = path.join(SNAP_DIR, 'growleads.db.gz');
const TMP_PATH  = path.join(SNAP_DIR, '.vacuum.tmp.db');

const mb = b => (b / 1048576).toFixed(1) + ' MB';

if (!fs.existsSync(DB_PATH)) {
  console.error(`✖ No database at ${DB_PATH}`);
  process.exit(1);
}

fs.mkdirSync(SNAP_DIR, { recursive: true });
fs.rmSync(TMP_PATH, { force: true });

console.log('Vacuuming a clean copy…');
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec(`VACUUM INTO '${TMP_PATH.replace(/'/g, "''")}'`);

const tables = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
).all();
for (const { name } of tables) {
  const { n } = db.prepare(`SELECT COUNT(*) n FROM "${name}"`).get();
  console.log(`  ${String(n).padStart(8)}  ${name}`);
}
db.close();

console.log('Compressing…');
fs.writeFileSync(SNAP_PATH, zlib.gzipSync(fs.readFileSync(TMP_PATH), { level: 9 }));
fs.rmSync(TMP_PATH, { force: true });

const raw = fs.statSync(DB_PATH).size;
const gz  = fs.statSync(SNAP_PATH).size;
console.log(`\n✔ ${path.relative(process.cwd(), SNAP_PATH)}`);
console.log(`  ${mb(raw)} → ${mb(gz)} (${(100 - gz / raw * 100).toFixed(0)}% smaller)`);
if (gz > 95 * 1048576) console.error('\n⚠  Over GitHub\'s 100 MB file limit — use a Release asset instead.');
