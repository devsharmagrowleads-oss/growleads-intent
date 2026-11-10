#!/usr/bin/env node
// ═══ LEAD GENERATION (OUTBOUND) QUALIFIER ════════════════════════════════════
// SEPARATE from AI Visibility. Lead Gen is the NARROW net: booked meetings for
// companies that need pipeline. A person qualifies only if their CURRENT company
// AND their role both pass the strict rules in services/filter.js:
//
//   REJECT (isDisqualified): individual-contributor titles, investors,
//     sales-tech / outbound vendors, AEO/GEO sellers, agencies / billable-hours,
//     coaches / training, B2C, excluded industries, banned regions, sub-5, etc.
//   Then matchesICP: B2B keyword gate, size band, persona bracket, geography.
//
// This is deliberately DIFFERENT from scripts/qualify-ai-visibility.js (wide net).
//
// Flow per person: read title/headline/summary → identify their CURRENT company
// → qualify the person+company for Lead Gen. Writes a ranked CSV to output/.
//
require('dotenv').config();
process.env.NODE_NO_WARNINGS = '1';
const fs = require('fs');
const path = require('path');
const { pool, initDb } = require('../models/db');
const f = require('../services/filter');
const c = require('../services/campaign');

function esc(v) { if (v == null) return ''; let s = String(v).replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim(); if (/[",]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'; return s; }

(async () => {
  await initDb();
  const camp = c.parseCampaign(c.getActiveCampaignFile());
  const rows = (await pool.query(`
    select full_name, current_title, current_company, headline, summary, company_description,
           company_url, total_experience_years, location, linkedin_url
    from scraped_profiles
    where current_company is not null and current_company <> ''`)).rows;

  const kept = [];
  const stats = { total: rows.length, disq: 0, noIcp: 0, qualified: 0 };
  const disqReasons = {};
  for (const r of rows) {
    const lead = {
      currentTitle: r.current_title, currentCompany: r.current_company, headline: r.headline,
      summary: r.summary, companyDescription: r.company_description, companyUrl: r.company_url,
      companyEmployeeCount: null, totalExperienceYears: r.total_experience_years,
      location: r.location, fullName: r.full_name, linkedinUrl: r.linkedin_url,
    };
    const d = f.isDisqualified(lead, camp);
    if (d.disqualified) { stats.disq++; const k = d.reason.split(':')[0]; disqReasons[k] = (disqReasons[k] || 0) + 1; continue; }
    const icp = f.matchesICP(lead, camp);
    if (!icp.matched) { stats.noIcp++; continue; }
    stats.qualified++;
    kept.push({ ...r, personaBracket: icp.personaBracket || '', priority: icp.priority || '', geographyTier: icp.geographyTier || '' });
  }

  const rank = { top: 0, high: 1, medium: 2, low: 3, '': 4 };
  kept.sort((a, b) => (rank[a.priority] - rank[b.priority]));

  const H = ['Priority', 'Persona', 'Contact', 'Title', 'Company', 'Employees', 'Geo', 'LinkedIn URL', 'Location', 'Headline'];
  const lines = [H.join(',')];
  for (const r of kept) lines.push([r.priority, r.personaBracket, r.full_name, r.current_title, r.current_company, r.company_employee_count ?? '', r.geographyTier, r.linkedin_url, r.location, (r.headline || '').slice(0, 140)].map(esc).join(','));
  const out = path.join(__dirname, '..', '..', 'output', 'growleads_leadgen_qualified.csv');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, '﻿' + lines.join('\n') + '\n');

  console.log('\n═══ LEAD-GEN qualification (narrow net, deterministic, no agents) ═══');
  console.log(`profiles scanned : ${stats.total}`);
  console.log(`  disqualified   : ${stats.disq}`);
  console.log(`  failed ICP     : ${stats.noIcp}`);
  console.log(`  QUALIFIED      : ${stats.qualified}`);
  console.log('top disqualify reasons:');
  Object.entries(disqReasons).sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([k, v]) => console.log(`  ${String(v).padStart(4)}  ${k}`));
  console.log(`\nwrote → output/growleads_leadgen_qualified.csv (${kept.length} people)`);
  await pool.end();
})();
