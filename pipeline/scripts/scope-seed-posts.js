#!/usr/bin/env node
/**
 * Scope which of a seed's posts get mined for engagers.
 *
 * enrichSeed() mines every post a seed has. This script pre-sets the
 * `relevance_decision` column that enrichSeed already honours:
 *
 *     let decision = existingPost?.relevanceDecision || null;   // core/pipeline.js
 *     if (decision === 'NO') continue;                          // post skipped
 *
 * So marking the unwanted posts 'NO' scopes the scrape with no code change.
 * Reversible: re-run with --reset to clear every decision for the seed.
 *
 * Usage:
 *   node scripts/scope-seed-posts.js <seed-url-fragment> <urn> [urn...]
 *   node scripts/scope-seed-posts.js <seed-url-fragment> --reset
 */
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB = process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'growleads.db');
const [frag, ...rest] = process.argv.slice(2);

if (!frag || rest.length === 0) {
  console.error('usage: scope-seed-posts.js <seed-url-fragment> <urn> [urn...] | --reset');
  process.exit(1);
}

const db = new DatabaseSync(DB);
const seed = db.prepare('SELECT id, full_name FROM seeds WHERE linkedin_url LIKE ?').get(`%${frag}%`);
if (!seed) { console.error(`no seed matching "${frag}"`); process.exit(1); }

const now = new Date().toISOString();

if (rest[0] === '--reset') {
  const r = db.prepare(
    'UPDATE posts_scraped SET relevance_decision=NULL, relevance_reason=NULL, relevance_judged_at=NULL WHERE seed_source=?'
  ).run(seed.id);
  console.log(`reset ${r.changes} posts for ${seed.full_name} — all will be mined again`);
  process.exit(0);
}

const keep = new Set(rest);
const posts = db.prepare('SELECT post_urn, post_text FROM posts_scraped WHERE seed_source=?').all(seed.id);

const missing = [...keep].filter(u => !posts.some(p => p.post_urn === u));
if (missing.length) {
  console.error(`these URNs are not stored under ${seed.full_name}:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}

db.exec('BEGIN');
let mine = 0, skip = 0;
for (const p of posts) {
  if (keep.has(p.post_urn)) {
    db.prepare('UPDATE posts_scraped SET relevance_decision=?, relevance_reason=?, relevance_judged_at=? WHERE post_urn=?')
      .run('YES', 'manually scoped: selected for mining', now, p.post_urn);
    mine++;
  } else {
    db.prepare('UPDATE posts_scraped SET relevance_decision=?, relevance_reason=?, relevance_judged_at=? WHERE post_urn=?')
      .run('NO', 'manually scoped: out of selected set', now, p.post_urn);
    skip++;
  }
}
db.exec('COMMIT');

console.log(`${seed.full_name}: ${mine} posts will be mined, ${skip} skipped`);
for (const p of posts.filter(x => keep.has(x.post_urn))) {
  console.log(`  MINE  ${p.post_urn}  ${(p.post_text || '').replace(/\n+/g, ' ').slice(0, 60)}`);
}
console.log(`\nreverse with:  node scripts/scope-seed-posts.js ${frag} --reset`);
