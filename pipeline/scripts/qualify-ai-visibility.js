#!/usr/bin/env node
// ═══ AI-VISIBILITY (AEO/GEO) QUALIFIER ═══════════════════════════════════════
// SEPARATE from Lead Gen. AI Visibility is a WIDE net: getting a company cited
// inside AI answers (ChatGPT/Perplexity/etc.). Almost any real B2B-ish company
// with a web presence wants this. Per the ICP engine, a company qualifies for
// AI Visibility unless it fails one of a SMALL set of gates:
//
//   REJECT only if:
//     1. the company SELLS AEO/GEO / AI-visibility itself   (direct competitor)
//     2. gambling / iGaming operator                        (excluded market)
//     3. located in a banned region  (AF / BD / NP / PK)
//     4. not a real company: 1 employee, or a personal free-email "company"
//     5. company headcount > 1000                           (big enterprise — excluded)
//   Size floor: below 5 employees is NOT accepted. Unknown headcount is kept
//   (unknown is not a kill — flagged for later enrichment).
//
// Everything else — agencies, B2C, healthcare, staffing, most industries — KEEPS
// for AI Visibility. (That is the whole point: they all want to be found in AI.)
//
// This is deliberately DIFFERENT from scripts/qualify-leadgen.js (narrow rules).
//
// Flow per person: read title/headline/summary → identify their CURRENT company
// → qualify the COMPANY for AI Visibility. One row per company (most-senior
// contact kept). Writes a ranked CSV to output/. No agents.
//
require('dotenv').config();
process.env.NODE_NO_WARNINGS = '1';
const fs = require('fs');
const path = require('path');
const { pool, initDb, db } = require('../models/db');
const exclusion = require('../services/exclusion'); // outbound/sales-tech/GTM peers

// ── company dedupe key ──
const cleanKey = s => (s || '').toLowerCase()
  .replace(/\s*[·|].*$/, '').replace(/[.,]/g, '')
  .replace(/\b(inc|ltd|llc|gmbh|corp|co|pvt|limited|the|®|™)\b/g, '')
  .replace(/\s+/g, ' ').trim();

// ── contact seniority (to pick the most reachable buyer as the contact) ──
function seniority(t) {
  t = (t || '').toLowerCase();
  if (/founder|co-?founder|ceo|owner|president|chief|c[teomf]o|cro|managing director/.test(t)) return 3;
  if (/\bvp\b|vice president|head of|\bdirector\b|managing partner/.test(t)) return 2;
  if (/lead|manager|principal/.test(t)) return 1;
  return 0;
}

// ── AI-Visibility gates (the ONLY reasons to reject) ──
const AEO_GEO_SELLER = /(answer engine optimi[sz]|generative engine optimi[sz]|\baeo\b|\bgeo\b (service|agency|optimi)|ai visibility|llm visibility|llm seo|\bai seo\b|ai search optimi[sz]|citation (building|tracking|monitoring)|(get|gets|getting) (you |your |brands? |clients? )?cited|cited (in|by) (chatgpt|perplexity|claude|gemini|ai|llms?)|prompt (tracking|monitoring)|ai[ -]?mention (tracking|monitoring))/i;
const GAMBLING = /\b(igaming|i-gaming|online gaming operator|bookmaker|sportsbook|sports ?betting|casino operator|casino platform|lottery operator|wagering|gambling (industry|operator|platform))\b/i;
const BANNED_REGION = /\b(afghanistan|bangladesh|nepal|pakistan|kabul|dhaka|kathmandu|karachi|lahore|islamabad)\b/i;
const FREE_EMAIL = /@(gmail|googlemail|yahoo|hotmail|outlook|live|aol|icloud|proton|protonmail|gmx|mail\.com|yandex|zoho)\./i;

function aiVisibilityVerdict(lead) {
  const sells = [lead.currentCompany, lead.companyDescription].filter(Boolean).join(' \n ').toLowerCase();
  const loc = (lead.location || '').toLowerCase();
  const emp = lead.companyEmployeeCount;

  if (AEO_GEO_SELLER.test(sells)) return { ok: false, reason: 'sells AEO/GEO (competitor)' };
  if (GAMBLING.test(sells))       return { ok: false, reason: 'gambling operator' };
  if (BANNED_REGION.test(loc))    return { ok: false, reason: 'banned region' };
  if (FREE_EMAIL.test(lead.currentCompany || '')) return { ok: false, reason: 'personal free-email, not a company' };
  if (typeof emp === 'number' && emp >= 1 && emp < 5)  return { ok: false, reason: `too small (${emp} employees)` };
  if (typeof emp === 'number' && emp > 1000)           return { ok: false, reason: `big enterprise (${emp} employees)` };

  // priority label (informational, never rejects): sweet spot 101-200, primary geo
  const PRIMARY = /\b(united states|usa|canada|united kingdom|\buk\b|ireland|germany|france|spain|netherlands|sweden|denmark|norway|switzerland|austria|belgium|uae|dubai|saudi|qatar|israel|europe)\b/i;
  let tier = 'qualified';
  if (typeof emp === 'number' && emp >= 101 && emp <= 200 && PRIMARY.test(loc)) tier = 'priority';
  else if ((typeof emp !== 'number') ) tier = 'qualified-size-unknown';
  return { ok: true, reason: 'real company, in a served market, not a competitor', tier };
}

function esc(v) { if (v == null) return ''; let s = String(v).replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim(); if (/[",]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'; return s; }

(async () => {
  await initDb();
  const rows = (await pool.query(`
    select full_name, current_title, current_company, headline, summary, company_description,
           company_url, location, linkedin_url
    from scraped_profiles
    where current_company is not null and current_company <> ''`)).rows;

  // Real company data (exact employeeCount + description + industry) from the
  // bulk /companies scrape, keyed by LinkedIn company slug.
  const slugOf = u => (u || '').toLowerCase().replace(/\/+$/, '').split('/company/')[1]?.split(/[/?#]/)[0] || '';
  const scrape = new Map();
  try { for (const s of db.prepare('select slug,name,employee_count,emp_end,industry,tagline,description,headquarter from company_scrape').all()) scrape.set(s.slug, s); } catch {}
  console.log(`real company data available for ${scrape.size} companies (bulk scrape)`);

  // one row per company, keep most-senior contact (prefer one with description/headcount)
  const byCo = new Map();
  for (const r of rows) {
    const k = cleanKey(r.current_company); if (!k || k.length < 2) continue;
    const cur = byCo.get(k);
    if (!cur) { byCo.set(k, r); continue; }
    const rank = x => seniority(x.current_title) * 2 + (x.company_description ? 1 : 0);
    if (rank(r) > rank(cur)) byCo.set(k, r);
  }
  const companies = [...byCo.values()];

  const kept = [];
  const stats = { total: companies.length, rejected: 0, priority: 0, qualified: 0, sizeUnknown: 0 };
  const rejReasons = {};
  for (const r of companies) {
    const sc = scrape.get(slugOf(r.company_url)) || null;
    const emp = sc && Number.isFinite(sc.employee_count) ? sc.employee_count : (sc && sc.emp_end) || null;
    r.company_employee_count = emp;
    r._industry = sc?.industry || null;
    const lead = {
      currentTitle: r.current_title, currentCompany: r.current_company, headline: r.headline,
      summary: r.summary,
      companyDescription: [r.company_description, sc?.description, sc?.tagline, sc?.industry].filter(Boolean).join(' \n '),
      companyUrl: r.company_url,
      companyEmployeeCount: emp, location: (r.location || '') + ' ' + (sc?.headquarter || ''),
    };
    // outbound / sales-tech / GTM / sales-training peers → excluded (docs/exclusion.md)
    if (exclusion.isExcludedCompany({ name: sc?.name || r.current_company, tagline: sc?.tagline, description: [r.company_description, sc?.description].filter(Boolean).join(' '), slug: slugOf(r.company_url) })) {
      stats.rejected++; rejReasons['outbound/sales-tech peer'] = (rejReasons['outbound/sales-tech peer'] || 0) + 1; continue;
    }
    const v = aiVisibilityVerdict(lead);
    if (!v.ok) { stats.rejected++; const key = v.reason.replace(/\(.*/, '').replace(/\d+ employees/, 'size').trim(); rejReasons[key] = (rejReasons[key] || 0) + 1; continue; }
    if (v.tier === 'priority') stats.priority++;
    else if (v.tier === 'qualified-size-unknown') stats.sizeUnknown++;
    else stats.qualified++;
    kept.push({ ...r, tier: v.tier });
  }

  // rank: priority first, then known-size, then by contact seniority
  const order = { priority: 0, qualified: 1, 'qualified-size-unknown': 2 };
  kept.sort((a, b) => (order[a.tier] - order[b.tier]) || (seniority(b.current_title) - seniority(a.current_title)));

  const H = ['Tier', 'Contact', 'Title', 'Company', 'Employees', 'LinkedIn URL', 'Location', 'Company URL', 'Headline'];
  const lines = [H.join(',')];
  for (const r of kept) lines.push([r.tier, r.full_name, r.current_title, r.current_company, r.company_employee_count ?? '', r.linkedin_url, r.location, r.company_url, (r.headline || '').slice(0, 140)].map(esc).join(','));
  const out = path.join(__dirname, '..', '..', 'output', 'growleads_ai_visibility_qualified.csv');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, '﻿' + lines.join('\n') + '\n');

  console.log('\n═══ AI-VISIBILITY qualification (wide net, deterministic, no agents) ═══');
  console.log(`unique companies scanned : ${stats.total}`);
  console.log(`  rejected               : ${stats.rejected}`);
  console.log(`  QUALIFIED              : ${kept.length}`);
  console.log(`     priority (101-200, primary geo): ${stats.priority}`);
  console.log(`     qualified (known size)         : ${stats.qualified}`);
  console.log(`     qualified (size unknown)       : ${stats.sizeUnknown}`);
  console.log('reject reasons:');
  Object.entries(rejReasons).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${String(v).padStart(4)}  ${k}`));
  console.log(`\nwrote → output/growleads_ai_visibility_qualified.csv (${kept.length} companies)`);
  await pool.end();
})();
