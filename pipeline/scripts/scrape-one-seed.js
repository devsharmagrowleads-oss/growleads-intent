#!/usr/bin/env node
/**
 * Mine engagers for ONE seed, not the whole seed list.
 *
 * `cli.js scrape` calls enrichAll() over every seed. This runs enrichSeed()
 * against a single seed matched by URL fragment, so a scoped run (see
 * scope-seed-posts.js) doesn't spend credits on the other seeds.
 *
 * Usage: node scripts/scrape-one-seed.js <seed-url-fragment> [--force] [--no-cache]
 */
require('dotenv').config();
const Seed = require('../models/Seed');
const pipeline = require('../core/pipeline');
const { getActiveCampaign } = require('../services/campaign');

const args = process.argv.slice(2);
const frag = args.find(a => !a.startsWith('--'));
const force = args.includes('--force');
const noCache = args.includes('--no-cache');

if (!frag) { console.error('usage: scrape-one-seed.js <seed-url-fragment> [--force] [--no-cache]'); process.exit(1); }

(async () => {
  const seeds = await Seed.find({});
  const seed = seeds.find(s => (s.linkedinUrl || '').includes(frag));
  if (!seed) { console.error(`no seed matching "${frag}"`); process.exit(1); }

  const campaign = getActiveCampaign();
  console.log(`Scraping ONE seed: ${seed.fullName} (${seed.linkedinUrl})`);
  console.log(`Campaign: ${campaign?.id || 'none'} | force=${force} noCache=${noCache}\n`);

  const t = await pipeline.enrichSeed(seed, { campaign, force, noCache });
  console.log(`\nRESULT ${seed.fullName}: +${t.added} pending, ${t.rejected} rejected, ${t.autoSeeded} auto-seeded, ${t.postsProcessed} posts processed`);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
