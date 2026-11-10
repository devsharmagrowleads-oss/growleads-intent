// ═══ PERSISTENT COMPANY CACHE ════════════════════════════════════════════════
// Single source of truth for company data, so we NEVER re-scrape a company we
// already have — every hit is 0 credits. Backed by the `company_scrape` table
// (survives restarts, unlike an in-memory cache).
//
// Flow (credit-saving):
//   lookup(url)         → read the DB. Present & fresh? return it (0 credits).
//   scrapeMissing(urls) → scrape ONLY the urls not already cached, via the bulk
//                         /companies endpoint (5 links/request), then persist.
//
// Uses the "Linkedin bulk data api" POST /companies endpoint (RAPIDAPI_COMPANIES_URL
// + RAPIDAPI_BULK_KEY). The endpoint accepts 25 links but only scrapes the first 5
// per request, so we chunk by 5.

const axios = require('axios');
const { db } = require('../models/db');

const URL = () => process.env.RAPIDAPI_COMPANIES_URL || `https://${process.env.RAPIDAPI_HOST}/companies`;
const KEY = () => process.env.RAPIDAPI_BULK_KEY || process.env.RAPIDAPI_KEY;
const HOST = () => (URL().match(/^https?:\/\/([^/]+)/) || [])[1];
const TTL_DAYS = () => parseInt(process.env.COMPANY_CACHE_TTL_DAYS || '30');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const slugOf = u => (u || '').toLowerCase().replace(/\/+$/, '').split('/company/')[1]?.split(/[/?#]/)[0] || '';

function ensureTable() {
  db.exec(`CREATE TABLE IF NOT EXISTS company_scrape (
    slug TEXT PRIMARY KEY, company_url TEXT, name TEXT, employee_count INTEGER,
    emp_start INTEGER, emp_end INTEGER, industry TEXT, tagline TEXT, description TEXT,
    website TEXT, headquarter TEXT, scraped_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
}

// Read one company from the persistent cache. Returns the row (or null). A row
// with name=null means "scraped, but LinkedIn returned no data" — still a cache
// hit (don't re-scrape). Pass {ignoreTtl:true} to accept any age.
function lookup(companyUrl, { ignoreTtl = false } = {}) {
  ensureTable();
  const slug = slugOf(companyUrl); if (!slug) return null;
  const row = db.prepare('select * from company_scrape where slug = ?').get(slug);
  if (!row) return null;
  if (!ignoreTtl && row.scraped_at) {
    const ageDays = (Date.now() - new Date(row.scraped_at + 'Z').getTime()) / 86400000;
    if (Number.isFinite(ageDays) && ageDays > TTL_DAYS()) return null; // stale → allow re-scrape
  }
  return row;
}

function isCached(companyUrl, opts) { return !!lookup(companyUrl, opts); }

const insert = () => db.prepare(`INSERT OR REPLACE INTO company_scrape
  (slug,company_url,name,employee_count,emp_start,emp_end,industry,tagline,description,website,headquarter,scraped_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`);

function store(slug, companyUrl, D) {
  const hq = D?.headquarter ? [D.headquarter.city, D.headquarter.geographicArea, D.headquarter.country].filter(Boolean).join(', ') : null;
  const industry = D ? ((Array.isArray(D.industries) ? D.industries.join(', ') : D.industry) || null) : null;
  insert().run(
    slug, companyUrl, D?.companyName || D?.name || null,
    Number.isFinite(D?.employeeCount) ? D.employeeCount : null,
    D?.employeeCountRange?.start ?? null, D?.employeeCountRange?.end ?? null,
    industry, D?.tagline || null, (D?.description || '').slice(0, 1000) || null,
    D?.websiteUrl || null, hq
  );
}

async function postCompanies(links, attempt = 0) {
  try {
    const { data } = await axios.post(URL(), { links }, {
      headers: { 'x-rapidapi-key': KEY(), 'x-rapidapi-host': HOST(), 'Content-Type': 'application/json' },
      timeout: 120000,
    });
    return data?.data || [];
  } catch (e) {
    if (attempt < 2) { await sleep(2000 * (attempt + 1)); return postCompanies(links, attempt + 1); }
    throw e;
  }
}

// Scrape ONLY the companies we don't already have cached, persist them, and
// return a Map(slug → row) for the requested urls. Existing ones cost 0 credits.
async function scrapeMissing(companyUrls, { throttleMs = 1400, onProgress } = {}) {
  ensureTable();
  const bySlug = new Map();
  const todo = [];
  for (const u of companyUrls) {
    const slug = slugOf(u); if (!slug || bySlug.has(slug)) continue;
    const hit = lookup(u);
    if (hit) { bySlug.set(slug, hit); continue; }         // already cached → skip (0 credits)
    todo.push({ slug, url: u });
    bySlug.set(slug, null);
  }
  for (let i = 0; i < todo.length; i += 5) {              // endpoint scrapes 5/request
    const chunk = todo.slice(i, i + 5);
    let items = [];
    try { items = await postCompanies(chunk.map(c => c.url)); }
    catch { continue; }
    const byKey = new Map();
    for (const it of items) { const k = slugOf(it?.entry) || (it?.data?.universalName || '').toLowerCase(); if (k) byKey.set(k, it?.data || null); }
    db.exec('BEGIN');
    for (const c of chunk) { const D = byKey.get(c.slug); store(c.slug, c.url, D); bySlug.set(c.slug, lookup(c.url, { ignoreTtl: true })); }
    db.exec('COMMIT');
    if (onProgress) onProgress(Math.min(i + 5, todo.length), todo.length);
    if (i + 5 < todo.length) await sleep(throttleMs);
  }
  return bySlug;
}

// Convenience: get one company's data, scraping only if not cached.
async function getCompany(companyUrl) {
  const hit = lookup(companyUrl);
  if (hit) return hit;
  const map = await scrapeMissing([companyUrl]);
  return map.get(slugOf(companyUrl)) || null;
}

module.exports = { slugOf, ensureTable, lookup, isCached, scrapeMissing, getCompany };
