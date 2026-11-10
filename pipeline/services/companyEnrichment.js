// Gate 3 — Company Enrichment for Priority Signals
//
// Calls POST /company and POST /company_jobs for a lead's company, computes the
// company size tier and the sales/growth/SEO hiring priority flag, and attaches
// the result to the lead object. See /ICP.md Gate 3 for the spec.
//
// Cost: 2 RapidAPI credits per unique company. Results cached in-memory by
// normalized companyUrl for the configured TTL (default 30 days).
//
// On any failure (no companyUrl, API error, malformed response) the function
// returns the lead with sizeTier='unknown' and hiringTopPriority=false. The
// lead is not rejected — Gate 3 signals never reject, they only prioritize.

const { getCompanyData, getCompanyJobs } = require('./linkedin');
const { classifyCompanySizeTier } = require('./filter');
const companyCache = require('./companyCache'); // persistent, credit-saving company store

// In-memory cache: normalized companyUrl → { ts: epoch_ms, value: {...} }
const cache = new Map();

function normalizeCompanyUrl(url) {
  if (!url) return null;
  let u = url.trim();
  try { u = new URL(u).origin + new URL(u).pathname; }
  catch { u = u.split('?')[0]; }
  return u.replace(/\/$/, '').toLowerCase();
}

function getCached(key, ttlMs) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > ttlMs) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCached(key, value) {
  cache.set(key, { ts: Date.now(), value });
}

// Pure function — compute enrichment signals from API responses.
// Returns { employeeCount, employeeCountRange, sizeTier, hiringTopPriority, salesJobsFound }.
function computeEnrichmentSignals(companyData, jobsData, campaign) {
  const cfg = campaign?.personaConfig;
  const hiringRegex = new RegExp(
    cfg?.hiringRegex || 'sales|sdr|bdr|account\\s*exec|cro|chief\\s*revenue|vp\\s*sales|head\\s*of\\s*sales|sales\\s*director|revenue\\s*lead|growth|seo|gtm|demand\\s*gen',
    'i'
  );

  const empCount = companyData?.data?.employeeCount ?? null;
  const empRange = companyData?.data?.employeeCountRange || null;

  // /company_jobs response shape: { response: { data: { jobs: [...] } } }
  const jobs =
    jobsData?.response?.data?.jobs
    || jobsData?.data?.jobs
    || jobsData?.jobs
    || [];
  const matchedJobs = jobs.filter(j => hiringRegex.test(j?.title || ''));
  const hiringTopPriority = matchedJobs.length > 0;

  const sizeTier = classifyCompanySizeTier(empCount, campaign);

  return {
    employeeCount: empCount,
    employeeCountRange: empRange,
    sizeTier,
    hiringTopPriority,
    salesJobsFound: matchedJobs.map(j => j.title).slice(0, 5)
  };
}

// Build signals from a persistent company_scrape row (already-scraped data).
function signalsFromCacheRow(row, jobsData, campaign) {
  const cfg = campaign?.personaConfig;
  const hiringRegex = new RegExp(
    cfg?.hiringRegex || 'sales|sdr|bdr|account\\s*exec|cro|chief\\s*revenue|vp\\s*sales|head\\s*of\\s*sales|sales\\s*director|revenue\\s*lead|growth|seo|gtm|demand\\s*gen',
    'i'
  );
  const empCount = Number.isFinite(row?.employee_count) ? row.employee_count : (row?.emp_end ?? null);
  const empRange = (row?.emp_start != null && row?.emp_end != null) ? { start: row.emp_start, end: row.emp_end } : null;
  const jobs = jobsData?.response?.data?.jobs || jobsData?.data?.jobs || jobsData?.jobs || [];
  const matchedJobs = jobs.filter(j => hiringRegex.test(j?.title || ''));
  return {
    employeeCount: empCount,
    employeeCountRange: empRange,
    sizeTier: classifyCompanySizeTier(empCount, campaign),
    hiringTopPriority: matchedJobs.length > 0,
    salesJobsFound: matchedJobs.map(j => j.title).slice(0, 5),
    companyIndustry: row?.industry || null,
    companyName: row?.name || null,
    companyWebsite: row?.website || null,
  };
}

// Enrich a lead with company priority signals. Mutates and returns the lead.
// If campaign doesn't have personaConfig.enabled, returns lead unmodified.
//
// CREDIT-SAVING: company data comes from the PERSISTENT company_scrape cache
// (services/companyCache). If the company was already scraped (by this lead or
// any other), it is a 0-credit DB read. Only genuinely-new companies hit the API,
// and their result is saved for every future lead at the same company.
async function enrichCompanySignals(lead, campaign, opts = {}) {
  const cfg = campaign?.personaConfig;
  if (!cfg?.enabled) return lead;

  const companyUrl = lead.companyUrl || opts.companyUrl;
  if (!companyUrl) {
    lead.enrichmentSkipped = 'no companyUrl on lead';
    lead.sizeTier = 'unknown';
    lead.hiringTopPriority = false;
    return lead;
  }

  // 1) persistent cache: already scraped this company? → 0 credits.
  let row = companyCache.lookup(companyUrl);
  let fromCache = !!row;

  // 2) not cached (or stale) → scrape once via the bulk endpoint and persist.
  if (!row) {
    try { row = await companyCache.getCompany(companyUrl); }
    catch (err) {
      lead.enrichmentSkipped = `company scrape failed: ${err.message}`;
      lead.sizeTier = 'unknown';
      lead.hiringTopPriority = false;
      return lead;
    }
  }

  // hiring signal (best-effort). The /company_jobs endpoint is gated on the
  // current plan, so it's OFF by default — enabling it would burn time/credits
  // retrying a 500. Set COMPANY_JOBS_ENABLED=1 only if the plan supports it.
  let jobsData = null;
  if (process.env.COMPANY_JOBS_ENABLED === '1') {
    try { jobsData = await getCompanyJobs(companyUrl, 25, 0); }
    catch (err) { lead.hiringJobsLookupFailed = err.message; }
  }

  const signals = signalsFromCacheRow(row, jobsData, campaign);
  Object.assign(lead, signals, { enrichmentFromCache: fromCache });
  lead.companyEmployeeCount = signals.employeeCount;   // mirrored for matchesICP's size cap
  return lead;
}

module.exports = {
  enrichCompanySignals,
  computeEnrichmentSignals,
  normalizeCompanyUrl,
  // Backward-compat alias for old callers — points to the same function
  enrichWithStrength: enrichCompanySignals,
  // Test/debug helpers:
  _cache: cache,
  _clearCache: () => cache.clear()
};
