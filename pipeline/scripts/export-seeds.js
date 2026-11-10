#!/usr/bin/env node
/**
 * Export every seed profile in the intent system to CSV.
 * Usage: node scripts/export-seeds.js [outfile]
 */
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DB = process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'growleads.db');
const OUT = process.argv[2] || path.join(__dirname, '..', '..', 'output', 'growleads_seed_profiles.csv');

const db = new DatabaseSync(DB, { readOnly: true });

const COLS = [
  'full_name', 'first_name', 'last_name', 'headline', 'current_title', 'current_company',
  'location', 'linkedin_url', 'public_identifier',
  'follower_count', 'connection_count',
  'is_creator', 'is_influencer', 'avg_likes', 'avg_comments',
  'total_posts_scraped', 'recent_posts_count',
  'relevance_score', 'relevance_tier',
  'pipeline_count', 'enriched', 'activity_scraped',
  'campaign_id', 'added_from', 'created_at', 'last_scraped_at',
  'company_description',
];

const rows = db.prepare(`SELECT ${COLS.join(', ')} FROM seeds
  ORDER BY pipeline_count DESC, follower_count DESC, full_name ASC`).all();

// leads actually sourced from each seed, straight from the pipeline table
let leadsBySeed = {};
try {
  leadsBySeed = Object.fromEntries(
    db.prepare('SELECT seed_id, COUNT(*) c FROM pipeline_leads GROUP BY seed_id').all()
      .map(r => [r.seed_id, r.c])
  );
} catch { /* column may not exist */ }

const csv = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v).replace(/\r?\n/g, ' ').trim();
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const header = COLS.join(',');
const lines = rows.map(r => COLS.map(c => csv(r[c])).join(','));

fs.writeFileSync(OUT, [header, ...lines].join('\n') + '\n');

const tiers = rows.reduce((a, r) => (a[r.relevance_tier || 'unscored'] = (a[r.relevance_tier || 'unscored'] || 0) + 1, a), {});
console.log(`Exported ${rows.length} seed profiles → ${OUT}`);
console.log(`  creators/influencers : ${rows.filter(r => r.is_creator || r.is_influencer).length}`);
console.log(`  activity scraped     : ${rows.filter(r => r.activity_scraped).length}`);
console.log(`  produced leads       : ${rows.filter(r => r.pipeline_count > 0).length}`);
console.log(`  tiers                : ${Object.entries(tiers).map(([k, v]) => `${k}=${v}`).join(', ')}`);
