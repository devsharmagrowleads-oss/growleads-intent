#!/usr/bin/env node
// ─── growleads CLI ───────────────────────────────────────────────────────────
// The whole system, driven from the terminal. No server, no dashboard, no API.
//
//   growleads seeds add <linkedin-url>     add a seed to mine
//   growleads seeds list                   list seeds
//   growleads scrape [--force] [--no-cache]  mine engagers → pending leads
//   growleads status                       show counts
//   growleads qualify export [file]        write pending leads for review
//   growleads qualify import <file>        apply KEEP/REJECT verdicts
//   growleads export [file]                write campaign CSV of qualified leads
//   growleads campaign [list|use <file>]   show / switch active campaign
//
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const OUTPUT_DIR = path.join(__dirname, '..', 'output');
function outPath(name) { fs.mkdirSync(OUTPUT_DIR, { recursive: true }); return path.join(OUTPUT_DIR, name); }
const { initDb } = require('./models/db');
const { pool } = require('./models/db');
const campaignSvc = require('./services/campaign');
const pipeline = require('./core/pipeline');
const Seed = require('./models/Seed');
const Pipeline = require('./models/Pipeline');

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  let s = String(v).replace(/\r?\n/g, ' ').trim();
  if (/[",]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function toCsv(headers, rows) {
  return '﻿' + [headers.join(','), ...rows.map((r) => r.map(csvEscape).join(','))].join('\n') + '\n';
}
function flag(args, name) { const i = args.indexOf(name); if (i >= 0) { args.splice(i, 1); return true; } return false; }

const COMMANDS = {
  async 'seeds'(args) {
    const sub = args.shift();
    if (sub === 'add') {
      const url = args[0];
      if (!url) throw new Error('usage: growleads seeds add <linkedin-url>');
      await pipeline.addSeed(url);
    } else if (sub === 'list' || !sub) {
      const seeds = await Seed.find({}).sort({ createdAt: -1 });
      console.log(`\n${seeds.length} seeds:`);
      for (const s of seeds) console.log(`  ${(s.relevanceTier || '?').padEnd(10)} ${(s.fullName || '').padEnd(28).slice(0, 28)} ${s.currentTitle || ''} @ ${s.currentCompany || ''}`);
    } else {
      throw new Error(`unknown: seeds ${sub}`);
    }
  },

  async 'scrape'(args) {
    const force = flag(args, '--force');
    const noCache = flag(args, '--no-cache');
    await pipeline.enrichAll({ force, noCache });
  },

  async 'status'() {
    const q = async (s) => (await pool.query(s)).rows[0];
    const seeds = await q('select count(*) n from seeds');
    const leads = await q(`select
      count(*) total,
      count(*) filter (where not disqualified) active,
      count(*) filter (where disqualified) disqualified,
      count(*) filter (where qualification_status='pending' and not disqualified) pending,
      count(*) filter (where qualification_status='qualified') qualified
      from pipeline_leads`);
    const camp = campaignSvc.getActiveCampaign();
    console.log(`\nActive campaign : ${camp ? camp.id : '(none)'}`);
    console.log(`Seeds           : ${seeds.n}`);
    console.log(`Pipeline leads  : ${leads.total} total`);
    console.log(`  qualified     : ${leads.qualified}`);
    console.log(`  pending review: ${leads.pending}`);
    console.log(`  disqualified  : ${leads.disqualified}`);
  },

  async 'qualify'(args) {
    const sub = args.shift();
    if (sub === 'export') {
      const file = args[0] || outPath('pending_review.csv');
      const rows = (await pool.query(`
        select full_name, current_title, current_company, linkedin_url, location,
               company_employee_count, persona_bracket, priority,
               left(coalesce(headline,''),200) headline,
               left(coalesce(summary,''),300) summary
        from pipeline_leads
        where qualification_status='pending' and not disqualified
        order by full_name`)).rows;
      const csv = toCsv(
        ['verdict', 'name', 'title', 'company', 'linkedin_url', 'location', 'employees', 'persona', 'priority', 'headline', 'summary'],
        rows.map((r) => ['', r.full_name, r.current_title, r.current_company, r.linkedin_url, r.location, r.company_employee_count, r.persona_bracket, r.priority, r.headline, r.summary])
      );
      fs.writeFileSync(file, csv);
      console.log(`Wrote ${rows.length} pending leads → ${file}`);
      console.log(`Fill the "verdict" column with KEEP or REJECT (leave blank to skip), then: growleads qualify import ${file}`);
    } else if (sub === 'import') {
      const file = args[0];
      if (!file || !fs.existsSync(file)) throw new Error('usage: growleads qualify import <file.csv>');
      const lines = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
      const header = lines.shift().split(',');
      const vIdx = header.indexOf('verdict'), uIdx = header.indexOf('linkedin_url');
      let kept = 0, rejected = 0;
      for (const line of lines) {
        // minimal CSV split good enough for our own export
        const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));
        const verdict = (cells[vIdx] || '').trim().toUpperCase();
        const url = cells[uIdx];
        if (!url || !verdict) continue;
        if (verdict === 'KEEP') { await pool.query(`update pipeline_leads set qualification_status='qualified', qualified_by='cli', qualified_at=now(), disqualified=false where linkedin_url=$1`, [url]); kept++; }
        else if (verdict === 'REJECT') { await pool.query(`update pipeline_leads set qualification_status='rejected', disqualified=true, disqualified_reason='CLI review', disqualified_at=now() where linkedin_url=$1`, [url]); rejected++; }
      }
      console.log(`Applied verdicts: ${kept} kept, ${rejected} rejected`);
    } else {
      throw new Error('usage: growleads qualify export|import');
    }
  },

  async 'export'(args) {
    const file = args[0] || outPath('growleads_campaign_ready.csv');
    const rows = (await pool.query(`
      select full_name, current_title, current_company, linkedin_url, location,
             company_employee_count, persona_bracket, priority, geography_tier,
             composite_score, engagement_type, seed_source_name,
             left(coalesce(headline,''),160) headline
      from pipeline_leads
      where qualification_status='qualified' and not disqualified
      order by
        case priority when 'top' then 1 when 'high' then 2 when 'medium' then 3 else 4 end,
        case persona_bracket when 'founder' then 1 when 'executive' then 2 else 3 end,
        company_employee_count desc nulls last`)).rows;
    const csv = toCsv(
      ['Name', 'Title', 'Company', 'LinkedIn URL', 'Location', 'Employees', 'Persona', 'Priority', 'Geo', 'Score', 'Engagement', 'Source Seed', 'Headline'],
      rows.map((r) => [r.full_name, r.current_title, r.current_company, r.linkedin_url, r.location, r.company_employee_count, r.persona_bracket, r.priority, r.geography_tier, r.composite_score, r.engagement_type, r.seed_source_name, r.headline])
    );
    fs.writeFileSync(file, csv);
    console.log(`Wrote ${rows.length} qualified leads → ${file}`);
  },

  async 'campaign'(args) {
    const sub = args.shift();
    if (sub === 'use') {
      campaignSvc.setActiveCampaign(args[0]);
      console.log(`Active campaign → ${args[0]}`);
    } else {
      const list = campaignSvc.listCampaigns();
      const active = path.basename(campaignSvc.getActiveCampaignFile() || '');
      console.log('\nCampaigns:');
      for (const c of list) console.log(`  ${c.filename === active ? '* ' : '  '}${c.filename}`);
    }
  },
};

function usage() {
  console.log(`growleads — signal-based outbound, CLI edition

  growleads seeds add <linkedin-url>       add a seed to mine
  growleads seeds list                     list seeds
  growleads scrape [--force] [--no-cache]  mine engagers → pending leads
  growleads status                         counts
  growleads qualify export [file]          write pending leads for review
  growleads qualify import <file>          apply KEEP/REJECT verdicts
  growleads export [file]                  write campaign CSV of qualified leads
  growleads campaign [use <file>]          show / switch active campaign
`);
}

(async () => {
  const args = process.argv.slice(2);
  const cmd = args.shift();
  if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') { usage(); process.exit(0); }
  if (!COMMANDS[cmd]) { console.error(`unknown command: ${cmd}\n`); usage(); process.exit(1); }
  try {
    await initDb();
    // auto-activate a campaign if none is set
    if (!campaignSvc.getActiveCampaignFile()) {
      const list = campaignSvc.listCampaigns();
      if (list.length) campaignSvc.setActiveCampaign(list[0].filename);
    }
    await COMMANDS[cmd](args);
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error(`\nError: ${err.message}`);
    try { await pool.end(); } catch (_) {}
    process.exit(1);
  }
})();
