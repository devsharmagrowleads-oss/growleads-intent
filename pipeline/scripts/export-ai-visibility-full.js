#!/usr/bin/env node
// ═══ FULL AI-VISIBILITY CONTACT EXPORT ═══════════════════════════════════════
// Every decision-maker at every AI-Visibility-qualified company, with EVERYTHING
// we have: full profile, rich fields (about, skills, latest role, education),
// full company data, and the discovery trail (which seed, which post, what
// activity — reaction/comment — led us to them).
//   node scripts/export-ai-visibility-full.js
//
require('dotenv').config();
process.env.NODE_NO_WARNINGS = '1';
const fs = require('fs');
const path = require('path');
const { pool, initDb, db } = require('../models/db');
const exclusion = require('../services/exclusion'); // strips outbound/sales-tech/GTM peers

const slugOf = u => (u || '').toLowerCase().replace(/\/+$/, '').split('/company/')[1]?.split(/[/?#]/)[0] || '';
const inKey = u => { const m = (u || '').toLowerCase().match(/\/in\/([^/?#]+)/); return m ? m[1] : ''; };
const sen = t => { t = (t || '').toLowerCase(); if (/\bfounder\b|co-?founder|\bceo\b|owner|president|chief|c[teomf]o|\bcro\b|managing director/.test(t)) return 3; if (/\bvp\b|vice president|head of|\bdirector\b|managing partner/.test(t)) return 2; if (/lead|manager|principal/.test(t)) return 1; return 0; };
const AEO = /(answer engine optimi|generative engine optimi|\baeo\b|ai visibility|llm visibility|llm seo|\bai seo\b|ai search optimi|citation (building|tracking|monitoring)|get (you |your |brands? )?cited|cited (in|by) (chatgpt|perplexity|gemini|ai|llms?)|prompt (tracking|monitoring))/i;
const GAMB = /\b(igaming|sportsbook|sports ?betting|casino operator|casino platform|gambling operator|lottery operator)\b/i;
const BAN = /\b(afghanistan|bangladesh|nepal|pakistan|karachi|lahore|dhaka|kathmandu|islamabad)\b/i;
function esc(v) { if (v == null) return ''; let s = String(v).replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim(); if (/[",]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'; return s; }

(async () => {
  await initDb();

  // 1) qualified company data by slug
  const co = new Map();
  let excludedCompanies = 0;
  for (const r of db.prepare('select slug,name,employee_count,emp_start,emp_end,industry,tagline,description,website,headquarter,company_url from company_scrape where employee_count is not null').all()) {
    const emp = r.employee_count; const sells = [r.name, r.description, r.tagline, r.industry].filter(Boolean).join(' ').toLowerCase(); const loc = (r.headquarter || '').toLowerCase();
    if (emp < 5 || emp > 1000 || BAN.test(loc) || AEO.test(sells) || GAMB.test(sells)) continue; // >1000 = big enterprise, excluded
    // outbound / sales-tech / GTM / sales-training peers → auto-excluded (see docs/exclusion.md)
    if (exclusion.isExcludedCompany({ name: r.name, tagline: r.tagline, description: r.description, industry: r.industry, slug: r.slug })) { excludedCompanies++; continue; }
    co.set(r.slug, r);
  }

  // 2) seed id -> {name,url}
  const seed = new Map();
  for (const s of (await pool.query('select id, full_name, linkedin_url, current_title, current_company from seeds')).rows) seed.set(String(s.id), s);

  // 3) person /in/ key -> discovery events
  const disc = new Map();
  for (const p of (await pool.query('select post_link,post_text,seed_source,engager_urls,reaction_count,comment_count from posts_scraped where engager_urls is not null')).rows) {
    let eu = p.engager_urls; if (typeof eu === 'string') { try { eu = JSON.parse(eu); } catch { eu = []; } }
    if (!Array.isArray(eu)) continue;
    for (const e of eu) {
      const k = inKey(e?.url); if (!k) continue;
      if (!disc.has(k)) disc.set(k, []);
      disc.get(k).push({ post: p.post_link, text: (p.post_text || '').slice(0, 200), type: e?.engagementType || 'engagement', seed: p.seed_source, rc: p.reaction_count, cc: p.comment_count });
    }
  }

  // 4) assemble rows: decision-makers at qualified companies.
  //    DEDUPE BY PERSON (public_identifier) — the same person can be stored under
  //    two different linkedin_url forms; merge them into one contact.
  const rawRows = (await pool.query(`select * from scraped_profiles where company_url like '%linkedin.com/company/%'`)).rows;
  const persons = new Map();
  for (const r of rawRows) {
    if (!co.has(slugOf(r.company_url))) continue;                      // company must be AI-Vis qualified
    if (sen(r.current_title) < 2) continue;                           // must be a decision-maker
    const pk = (r.public_identifier || inKey(r.linkedin_url) || r.linkedin_url || '').toLowerCase();
    if (!pk) continue;
    const cur = persons.get(pk);
    if (!cur) { persons.set(pk, { row: r, urls: [r.linkedin_url] }); continue; }
    cur.urls.push(r.linkedin_url);
    // keep the richer row (has raw_data, then more connections)
    const better = (!!r.raw_data && !cur.row.raw_data) || ((!!r.raw_data === !!cur.row.raw_data) && (r.connection_count || 0) > (cur.row.connection_count || 0));
    if (better) cur.row = r;
  }

  const out = [];
  const removedPeople = [];   // ecosystem interlink log (who + why)
  for (const { row: r, urls } of persons.values()) {
    const c = co.get(slugOf(r.company_url));
    let rd = r.raw_data; if (typeof rd === 'string') { try { rd = JSON.parse(rd); } catch { rd = null; } }
    const D = rd?.data || rd || {};

    // PERSON-LEVEL exclusion: tool partner/expert, outbound operator, or a
    // denylisted company in their work history (see docs/exclusion.md).
    const pv = exclusion.isExcludedPerson({ title: r.current_title, headline: r.headline, summary: r.summary, about: D.about, experiences: D.experiences });
    if (pv.excluded) { removedPeople.push({ name: r.full_name, title: r.current_title, company: c?.name || r.current_company, url: r.linkedin_url, reason: pv.reason, headline: (r.headline || '').slice(0, 160) }); continue; }

    const skills = Array.isArray(D.skills) ? D.skills.map(s => s.title).filter(Boolean).slice(0, 10).join('; ') : '';
    const exp = Array.isArray(D.experiences) ? D.experiences.slice(0, 2).map(e => [e.title, e.subtitle, e.caption].filter(Boolean).join(' — ')).join(' | ') : '';
    const edu = Array.isArray(D.educations) ? D.educations.slice(0, 2).map(e => [e.title, e.subtitle].filter(Boolean).join(' — ')).join(' | ') : '';

    // merge discovery events across ALL of this person's linkedin_url variants
    const ev = [...new Set(urls)].flatMap(u => disc.get(inKey(u)) || []);
    const types = [...new Set(ev.map(e => e.type))].join(', ');
    const seedNames = [...new Set(ev.map(e => seed.get(String(e.seed))?.full_name).filter(Boolean))].join(' | ');
    const seedUrls = [...new Set(ev.map(e => seed.get(String(e.seed))?.linkedin_url).filter(Boolean))].join(' | ');
    const primary = ev[0] || {};
    const allPosts = [...new Set(ev.map(e => e.post))].join(' | ');

    out.push({
      // ── identity ──
      full_name: r.full_name, first: r.first_name, last: r.last_name,
      title: r.current_title, seniority: sen(r.current_title) === 3 ? 'Founder/C-suite' : 'VP/Head/Director',
      headline: r.headline, location: r.location,
      linkedin_url: r.linkedin_url, public_id: r.public_identifier, profile_pic: r.profile_picture,
      // ── profile depth ──
      about: (D.about || r.summary || '').slice(0, 600),
      person_industry: D.industry || '',
      connections: r.connection_count, followers: r.follower_count,
      experience_years: r.total_experience_years, is_creator: r.is_creator, is_influencer: r.is_influencer,
      top_skills: skills, recent_experience: exp, education: edu,
      // ── company ──
      company: c.name, company_employees: c.employee_count,
      company_size_range: c.emp_start && c.emp_end ? `${c.emp_start}-${c.emp_end}` : '',
      company_industry: c.industry || '', company_tagline: c.tagline || '',
      company_description: (c.description || '').slice(0, 500),
      company_website: c.website || '', company_hq: c.headquarter || '', company_linkedin: r.company_url,
      // ── discovery trail ──
      found_via_seed: seedNames, seed_linkedin: seedUrls,
      activity: types, posts_engaged: new Set(ev.map(e => e.post)).size,
      first_post_link: primary.post || '', first_post_text: primary.text || '',
      first_post_reactions: primary.rc ?? '', first_post_comments: primary.cc ?? '',
      all_post_links: allPosts,
    });
  }

  // sort: best targets first — sweet-spot company size (101-200), then 51-500,
  // then 11-50, then the rest; founders ahead of VPs within each band.
  const band = e => (e >= 101 && e <= 200) ? 0 : (e >= 51 && e <= 500) ? 1 : (e >= 11) ? 2 : (e >= 5) ? 3 : 4;
  out.sort((a, b) =>
    band(a.company_employees) - band(b.company_employees)
    || (b.seniority === 'Founder/C-suite') - (a.seniority === 'Founder/C-suite')
    || (b.company_employees - a.company_employees));

  const H = ['Full Name', 'First', 'Last', 'Title', 'Seniority', 'Headline', 'Location', 'LinkedIn URL', 'Public ID', 'Profile Pic',
    'About', 'Person Industry',
    'Company', 'Company Employees', 'Company Size Range', 'Company Industry', 'Company Tagline', 'Company Description', 'Company Website', 'Company HQ', 'Company LinkedIn',
    'Connections', 'Followers', 'Experience Years', 'Is Creator', 'Is Influencer', 'Top Skills', 'Recent Experience', 'Education',
    'Found Via Seed', 'Seed LinkedIn', 'Activity (reaction/comment)', 'Posts Engaged', 'Post Link', 'Post Text', 'Post Reactions', 'Post Comments', 'All Post Links'];
  const keys = ['full_name', 'first', 'last', 'title', 'seniority', 'headline', 'location', 'linkedin_url', 'public_id', 'profile_pic',
    'about', 'person_industry',
    'company', 'company_employees', 'company_size_range', 'company_industry', 'company_tagline', 'company_description', 'company_website', 'company_hq', 'company_linkedin',
    'connections', 'followers', 'experience_years', 'is_creator', 'is_influencer', 'top_skills', 'recent_experience', 'education',
    'found_via_seed', 'seed_linkedin', 'activity', 'posts_engaged', 'first_post_link', 'first_post_text', 'first_post_reactions', 'first_post_comments', 'all_post_links'];
  const lines = [H.join(',')];
  for (const o of out) lines.push(keys.map(k => esc(o[k])).join(','));

  const file = path.join(__dirname, '..', '..', 'output', 'growleads_ai_visibility_contacts_FULL.csv');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '﻿' + lines.join('\n') + '\n');

  // write the person-exclusion log (audit trail of every ecosystem interlink removed)
  const logH = ['Name', 'Title', 'Company', 'LinkedIn URL', 'Exclusion Reason', 'Headline'];
  const logLines = [logH.join(',')];
  const byReason = {};
  for (const p of removedPeople) { byReason[p.reason] = (byReason[p.reason] || 0) + 1; logLines.push([p.name, p.title, p.company, p.url, p.reason, p.headline].map(esc).join(',')); }
  const logFile = path.join(__dirname, '..', '..', 'output', 'ai_visibility_excluded_people_log.csv');
  fs.writeFileSync(logFile, '﻿' + logLines.join('\n') + '\n');

  const withDisc = out.filter(o => o.first_post_link).length;
  console.log(`\n═══ FULL AI-VISIBILITY CONTACT EXPORT ═══`);
  console.log(`outbound/sales-tech/GTM peer COMPANIES stripped : ${excludedCompanies}  (per docs/exclusion.md)`);
  console.log(`ecosystem-interlink PEOPLE stripped            : ${removedPeople.length}`);
  Object.entries(byReason).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`     ${String(v).padStart(3)}  ${k}`));
  console.log(`   → logged to output/ai_visibility_excluded_people_log.csv`);
  console.log(`decision-makers on FINAL list          : ${out.length}`);
  console.log(`   founders/C-suite                    : ${out.filter(o => o.seniority === 'Founder/C-suite').length}`);
  console.log(`   VP/Head/Director                    : ${out.filter(o => o.seniority === 'VP/Head/Director').length}`);
  console.log(`   with a known discovery post         : ${withDisc}`);
  console.log(`   columns per row                     : ${H.length}`);
  console.log(`\nwrote → output/growleads_ai_visibility_contacts_FULL.csv`);
  await pool.end();
})();
