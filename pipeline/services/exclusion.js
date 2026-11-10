// ═══ COMPANY EXCLUSION — Outbound / Sales-Tech / GTM peers ════════════════════
// Auto-removes Clay / Smartlead / Unify (outbound sales-tech software),
// Cold IQ (GTM/outbound agencies), and Sales Rebellion (sales training/community)
// type companies from every qualified list. These are Growleads' OWN space —
// competitors / mining sites, never customers.
//
// Rule = the KEYWORD regex below (auto-catches NEW companies by what they sell)
//        + the slug denylist parsed from docs/exclusion.md (known companies).
// The doc is the human-editable source: add a company by adding its LinkedIn
// slug under the "## Denylist" section of docs/exclusion.md.

const fs = require('fs');
const path = require('path');

// A company SELLS one of these → it's an outbound/sales-tech/GTM/training peer.
// (High-precision seller phrases; deliberately not bare "sales"/"revenue"/"crm".)
const KEYWORD = /(cold email|cold[- ]?call|cold outreach|\boutbound\b|lead gen(eration)?|leadgen|lead[- ]?maker|appointment setting|booked meetings|meetings booked|\bsdr\b|\bbdr\b|sales development rep|sales engagement|sales automation|linkedin automation|linkedin outreach|linkedin lead|data enrichment|waterfall enrichment|email deliverability|email infrastructure|email warm|email finder|email verification|sales coach|sales training|sales bootcamp|sales academy|sales enablement|\bai sdr\b|\bai bdr\b|prospecting|social selling|done[- ]for[- ]you (outbound|lead|appointment|sales|meetings)|book(ed|ing)? (you |your )?(more )?meetings|b2b lead)/i;

// Never exclude these — they can contain "go-to-market" etc. as customers, not sellers.
const PROTECT = /(market research|consumer insight)/i;

// Venture capital / private equity / investment firms — the investors themselves.
// Judged mainly on the company's INDUSTRY (reliable), plus unambiguous text.
const INVEST_INDUSTRY = /(venture capital|private equity|investment (management|banking|advisory)|capital markets|\bventure fund\b)/i;
const INVEST_TEXT = /(venture capital|private equity|\bvc firm\b|early[- ]stage (investor|fund|vc)|we invest in (startups|founders|companies)|venture fund|angel (investor|fund)|investment firm|family office|fund manager|we back (founders|startups))/i;

const slugOf = u => (u || '').toLowerCase().replace(/\/+$/, '').split('/company/')[1]?.split(/[/?#]/)[0] || '';

let _deny = null;
function denySlugs() {
  if (_deny) return _deny;
  _deny = new Set();
  try {
    const md = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'exclusion.md'), 'utf8');
    // machine-read: bullet lines that are a bare LinkedIn slug (under "## Denylist").
    for (const line of md.split(/\r?\n/)) {
      const m = line.match(/^\s*[-*]\s*([a-z0-9][a-z0-9._-]{1,})\s*(?:<!--|$|#)/i);
      if (m && !m[1].includes(' ')) _deny.add(m[1].toLowerCase());
    }
  } catch { /* no doc yet → keyword rule still applies */ }
  return _deny;
}

// company: { name, tagline, description, industry, companyUrl|slug }
function isExcludedCompany(company = {}) {
  const hay = [company.name, company.tagline, company.description].filter(Boolean).join(' ');
  if (PROTECT.test(hay)) return false;
  const slug = company.slug || slugOf(company.companyUrl);
  if (slug && denySlugs().has(slug)) return true;
  if (INVEST_INDUSTRY.test(company.industry || '') || INVEST_TEXT.test(hay)) return true; // VC / investment firm
  return KEYWORD.test(hay);
}

// ── PERSON-LEVEL (ecosystem interlink) ───────────────────────────────────────
// Even when a person's CURRENT company isn't a denylisted peer, their identity
// can tie them to the outbound/sales-tech world: they're a Clay/Smartlead
// certified partner or expert, an outbound/GTM operator, or they list a
// denylisted company in their work history. Those people are peers too.

// (a) tool/agency partner or certified expert
const PARTNER = /\b(clay|smartlead|instantly|lemlist|coldiq|cold iq|unify|salesloft|apollo)\b[^.|]{0,22}\b(expert|certified|partner|consultant|specialist|ambassador|affiliate|reseller|\bpro\b|wizard|builder|enablement|agency)|\b(certified|expert|official)\b[^.|]{0,16}\b(clay|smartlead|instantly|lemlist|coldiq|unify)\b/i;
// (b) outbound / sales-tech operator identity
const ROLE = /(gtm engineer|growth engineer|clay engineer|outbound (expert|consultant|specialist|strateg|coach|architect|system|automation|agency|marketer|lead)|cold[- ]?email (expert|consultant|specialist|wizard|system|infrastructure|marketer|agency)|cold outbound|cold calling|lead gen(eration)? (expert|consultant|specialist|agency|machine|wizard|man)|demand gen(eration)? (expert|consultant|agency)|appointment setter|appointment setting|email deliverability|deliverability (expert|consultant)|sales (coach|trainer|training)|prospecting (expert|coach|system)|social selling (expert|coach|trainer)|founder[^.|]{0,34}(outbound|cold email|cold outbound|lead gen|sales agency|appointment|sdr agency|demand gen)|help(ing)?[^.|]{0,30}book (more )?meetings|book(ed|ing)?[^.|]{0,12}meetings (for|with)|helping (sdrs|bdrs|sales teams|founders)[^.|]{0,22}(book|outbound|prospect|pipeline)|predictable pipeline|systemi[sz]ed outbound)/i;

const cleanName = s => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\b(inc|ltd|llc|the|io|ai|co|gmbh)\b/g, '').replace(/\s+/g, ' ').trim();

// (c) non-buyer functional TITLES — account management, creative, commercial.
// These pass the seniority filter but aren't the AI-Visibility buyer. Founders /
// CEOs / owners are exempt (they're the decision-maker whatever hat they wear).
const TITLE_EXEMPT = /\b(founder|co-?founder|ceo|chief executive|owner|president|proprietor)\b/i;
const TITLE_EXCLUDE = /\b(creative director|art director|head of creative|creative lead|design director|design lead|product design|product designer|head of design|graphic designer|ux designer|ui designer|ux\/ui|chief commercial officer|\(cco\)|\bcco\b|commercial director|commercial officer|director of commercial|vp,? commercial|account manager|account management|account director|director of account|head of accounts?|key account (manager|director)|human resources|chief people officer|chief human resources|chief talent officer|\bchro\b|head of (people|talent|hr|human resources)|vp,? ?(of )?(people|talent|hr|human resources)|people experience|director of (people|talent|hr|human resources|recruiting|talent acquisition)|people operations|people (and|&) (operations|culture)|talent acquisition|hr (manager|director|business partner|lead|generalist|head)|\bhr\b|recruit(er|ing|ment)|talent partner|people partner|talent management)\b/i;

function isExcludedTitle(title) {
  const t = title || '';
  if (TITLE_EXEMPT.test(t)) return null;          // founders/CEOs/owners always kept
  const m = t.match(TITLE_EXCLUDE);
  return m ? `non-buyer role (${m[0]})` : null;
}

let _names = null;
function denyNames() {
  if (_names) return _names;
  _names = new Set();
  try {
    const md = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'exclusion.md'), 'utf8');
    for (const line of md.split(/\r?\n/)) {
      const m = line.match(/<!--\s*(.+?)\s*-->/);
      if (m) { const n = cleanName(m[1]); if (n && n.length > 2) _names.add(n); }
    }
  } catch { /* ignore */ }
  return _names;
}

// profile: { title, headline, about, summary, experiences:[{title,subtitle}], skills:[] }
// Returns { excluded: bool, reason: string|null }.
function isExcludedPerson(profile = {}) {
  const badTitle = isExcludedTitle(profile.title);
  if (badTitle) return { excluded: true, reason: badTitle };
  const exps = Array.isArray(profile.experiences) ? profile.experiences : [];
  const expText = exps.map(e => [e.title, e.subtitle].filter(Boolean).join(' ')).join(' | ');
  const hay = [profile.headline, profile.about || profile.summary, expText].filter(Boolean).join('  ');

  if (PARTNER.test(hay)) return { excluded: true, reason: 'tool partner/expert (Clay/Smartlead/…)' };
  // interlink: they list a denylisted PEER company in their work history. Match on
  // the company NAME only (denylist name, or the name itself is an outbound/sales-
  // tech peer) — NOT the job title, so "SDR at Lenovo" is not a false interlink.
  for (const e of exps) {
    const co = (e.subtitle || '').replace(/\s*[·|.].*$/, '').trim();   // strip "· Full-time" etc.
    if (!co) continue;
    if (denyNames().has(cleanName(co)) || KEYWORD.test(co))
      return { excluded: true, reason: `experience at peer company (${co})` };
  }
  if (ROLE.test(hay)) return { excluded: true, reason: 'outbound/sales-tech operator identity' };
  return { excluded: false, reason: null };
}

module.exports = { isExcludedCompany, isExcludedPerson, isExcludedTitle, slugOf, KEYWORD, PROTECT, PARTNER, ROLE, TITLE_EXCLUDE, denySlugs, denyNames, cleanName, _reset: () => { _deny = null; _names = null; } };
