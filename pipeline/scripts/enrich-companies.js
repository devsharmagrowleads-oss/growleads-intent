#!/usr/bin/env node
// ═══ BULK COMPANY ENRICHMENT (batch driver) ══════════════════════════════════
// Enriches every company we have a LinkedIn URL for, using the shared persistent
// cache in services/companyCache. Credit-saving by design: companies already in
// the company_scrape table are skipped (0 credits); only new ones are scraped
// (bulk /companies endpoint, 5 links/request) and saved.
//
// Fully resumable — run again any time to fill in whatever's missing.
//   node scripts/enrich-companies.js
//
require('dotenv').config();
process.env.NODE_NO_WARNINGS = '1';
const { pool, initDb } = require('../models/db');
const cc = require('../services/companyCache');

(async () => {
  await initDb();
  cc.ensureTable();

  const rows = (await pool.query(`select distinct company_url from scraped_profiles where company_url like '%linkedin.com/company/%'`)).rows;
  const urls = rows.map(r => r.company_url);
  const already = urls.filter(u => cc.isCached(u, { ignoreTtl: true })).length;

  console.log(`companies: ${urls.length} total | ${already} already cached (0 credits) | ${urls.length - already} to fetch`);
  if (urls.length - already === 0) { console.log('nothing to do — all cached.'); await pool.end(); return; }

  await cc.scrapeMissing(urls, {
    onProgress: (done, total) => process.stdout.write(`\r  fetching new companies: ${done}/${total}   `),
  });

  const { db } = require('../models/db');
  const n = db.prepare('select count(*) n from company_scrape').get().n;
  const withEmp = db.prepare('select count(*) n from company_scrape where employee_count is not null').get().n;
  console.log(`\n\ndone. cache now holds ${n} companies (${withEmp} with an exact employeeCount).`);
  await pool.end();
})();
