const axios = require('axios');

function h() {
  return {
    'x-rapidapi-key': process.env.RAPIDAPI_KEY,
    'x-rapidapi-host': process.env.RAPIDAPI_HOST
  };
}

// ─── GLOBAL RATE LIMITER ─────────────────────────────────────────────────────
// Provider rule: max 1 request per 1.3 seconds, no concurrent requests.
// Every call to the API goes through throttle() which serializes requests AND
// enforces the minimum interval. This kills bursting at the source — no matter
// how many post-pagination loops, engager loops, or company-enrichments are
// happening, they all funnel through this single gate.
//
// Override via env: RAPIDAPI_MIN_INTERVAL_MS (default 1300).

const MIN_INTERVAL_MS = parseInt(process.env.RAPIDAPI_MIN_INTERVAL_MS || '1300') || 1300;
let lastApiCall = 0;
let chain = Promise.resolve(); // serializes concurrent callers into a queue

async function throttle() {
  // Chain through a single in-flight promise so two callers can't race past
  // the same lastApiCall timestamp and burst together.
  const next = chain.then(async () => {
    const since = Date.now() - lastApiCall;
    if (since < MIN_INTERVAL_MS) {
      await new Promise(r => setTimeout(r, MIN_INTERVAL_MS - since));
    }
    lastApiCall = Date.now();
  });
  chain = next.catch(() => {}); // never reject the chain
  return next;
}

// Retry wrapper.
//   - 429 (rate limit): retryable. 3 retries with 3s/9s/27s backoff. Honors Retry-After.
//   - 5xx (server errors, including 500/502/503/504): retryable. 3 retries with 2s/6s/18s backoff.
//     This API is genuinely flaky — short retry budgets caused real data loss.
//   - Other 4xx (400, 401, 403, 404): fail fast — re-trying won't help.
async function withRetry(fn, _maxRetries = 3, _delayMs = 2000) {
  let lastErr;
  let rateLimitRetries = 0;
  let serverErrorRetries = 0;
  const MAX_RATE_LIMIT_RETRIES = 3;
  const MAX_SERVER_ERROR_RETRIES = 3;

  while (true) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err?.response?.status;
      const body = err?.response?.data;
      const bodyMsg = typeof body === 'string' ? body : (body?.message || '');

      // Provider-side capacity blip: "No free account spotted." — the pool of
      // LinkedIn accounts is momentarily exhausted on their side. This often
      // clears within seconds as accounts free up. Retry up to 3 times with
      // 30s backoff; only then mark as a hard outage.
      if (typeof bodyMsg === 'string' && /no free account/i.test(bodyMsg)) {
        if (rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
          rateLimitRetries++;
          await new Promise(r => setTimeout(r, 30000)); // 30s wait for pool to free up
          continue;
        }
        err.isProviderCapacity = true;
        throw err;
      }

      // 429 — rate limit. Long dedicated backoff. Honor Retry-After if set.
      if (status === 429 && rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
        const retryAfterHeader = err?.response?.headers?.['retry-after'];
        const retryAfterSec = parseInt(retryAfterHeader);
        const backoffMs = !isNaN(retryAfterSec)
          ? retryAfterSec * 1000
          : Math.pow(3, rateLimitRetries + 1) * 1000; // 3s, 9s, 27s
        rateLimitRetries++;
        await new Promise(r => setTimeout(r, backoffMs));
        continue;
      }

      // 5xx — server errors. Retry with exponential backoff (2s, 6s, 18s).
      if (status >= 500 && status < 600 && serverErrorRetries < MAX_SERVER_ERROR_RETRIES) {
        const backoffMs = Math.pow(3, serverErrorRetries) * 2000; // 2s, 6s, 18s
        serverErrorRetries++;
        await new Promise(r => setTimeout(r, backoffMs));
        continue;
      }

      // Other 4xx — fail fast (404, 403, 400 won't get better with retry).
      if (status && status >= 400 && status < 500) throw err;

      // Network/unknown errors with no status — same budget as 5xx
      if (!status && serverErrorRetries < MAX_SERVER_ERROR_RETRIES) {
        const backoffMs = Math.pow(3, serverErrorRetries) * 2000;
        serverErrorRetries++;
        await new Promise(r => setTimeout(r, backoffMs));
        continue;
      }

      throw err;
    }
  }
}

// POST /person — profile data. Body: { link }
// Raw API call — use getProfileCached() for credit-saving behavior.
async function getProfileByUrl(linkedinUrl) {
  return withRetry(async () => {
    await throttle();
    const { data } = await axios.post(process.env.RAPIDAPI_PERSON_URL,
      { link: linkedinUrl },
      { headers: h() }
    );
    return data;
  });
}

// Cached wrapper for /person. Reads scraped_profiles DB cache first (30-day
// TTL); only spends an API credit on miss. Always returns { raw, normalized,
// fromCache } so the caller can log credit usage transparently.
async function getProfileCached(linkedinUrl, opts = {}) {
  const ttlMs = (opts.cacheTtlDays ?? 30) * 24 * 60 * 60 * 1000;
  // Lazy require to avoid circular import with db.js
  const ScrapedProfile = require('../models/ScrapedProfile');
  const cleanUrl = cleanLinkedInUrl(linkedinUrl) || linkedinUrl;

  // Credit-saving person dedupe: the SAME person appears under two URL forms —
  // the obfuscated "ACoAA..." URL (from post engagers) and the vanity
  // "/in/<public_id>" URL (from seeds / similar-profiles). A profile scraped
  // under either form stores its vanity `publicIdentifier`, so we match on both:
  //   1) exact cleaned URL, then
  //   2) the vanity public_identifier extracted from the URL (if any).
  // Either hit means we already have this person → 0 credits.
  let existing = await ScrapedProfile.findOne({ linkedinUrl: cleanUrl });
  if (!existing) {
    const pid = vanityPublicId(cleanUrl);
    if (pid) existing = await ScrapedProfile.findOne({ publicIdentifier: pid });
  }
  if (existing && existing.scrapedAt) {
    const age = Date.now() - new Date(existing.scrapedAt).getTime();
    if (age < ttlMs) {
      // Cache hit — reconstruct normalized object from cached columns
      const normalized = {
        linkedinUrl: existing.linkedinUrl,
        publicIdentifier: existing.publicIdentifier,
        firstName: existing.firstName,
        lastName: existing.lastName,
        fullName: existing.fullName,
        headline: existing.headline,
        summary: existing.summary,
        location: existing.location,
        profilePicture: existing.profilePicture,
        connectionCount: existing.connectionCount,
        followerCount: existing.followerCount,
        currentCompany: existing.currentCompany,
        currentTitle: existing.currentTitle,
        companyDescription: existing.companyDescription,
        companyUrl: existing.companyUrl,
        totalExperienceYears: existing.totalExperienceYears,
        isCreator: existing.isCreator,
        isInfluencer: existing.isInfluencer,
        rawData: existing.rawData
      };
      return { raw: existing.rawData, normalized, fromCache: true };
    }
  }

  // Cache miss — fetch fresh and write through
  const raw = await getProfileByUrl(cleanUrl);
  const normalized = normalizeProfile(raw, cleanUrl);
  try {
    if (existing) {
      await ScrapedProfile.findByIdAndUpdate(existing._id, {
        ...normalized,
        scrapedAt: new Date()
      });
    } else {
      await ScrapedProfile.create({
        ...normalized,
        scrapedAt: new Date()
      });
    }
  } catch (err) {
    // Cache write failure should never fail the caller — log and continue
    console.warn(`[ProfileCache] write failed for ${cleanUrl}: ${err.message}`);
  }
  return { raw, normalized, fromCache: false };
}

// GET /profile_updates — seed's own recent posts.  Params: profile_url, page
// Response: { posts: [{ postText, postLink, urn, reactionsUrn, commentsUrn, postedAt, ... }] }
//
// Growleads rule (per /ICP.md "Seed Sourcing"): take the last `limit` posts
// returned, then keep only those published within `maxAgeDays`. Defaults
// reflect the policy: 20 posts, 60 days. Pass {limit, maxAgeDays} to override.
async function getProfilePosts(profileUrl, opts = {}) {
  // Back-compat: callers used to pass a `page` number as 2nd arg
  if (typeof opts === 'number') opts = { page: opts };
  const { page = 1, limit = 20, maxAgeDays = 60 } = opts;

  const data = await withRetry(async () => {
    await throttle();
    const r = await axios.get(process.env.RAPIDAPI_PROFILE_UPDATES_URL, {
      headers: h(),
      params: { profile_url: profileUrl, page }
    });
    return r.data;
  });

  const rawPosts = Array.isArray(data?.posts)
    ? data.posts
    : (Array.isArray(data?.response?.posts) ? data.response.posts : []);

  // Step 1: drop reposts. Repost engagement belongs to the original author's
  // audience, not the seed's — we don't want their engagers in the pipeline.
  const ownPosts = rawPosts.filter(p => !p?.is_repost);

  // Step 2: take last `limit` own posts (already reverse-chronological from API)
  const sliced = ownPosts.slice(0, limit);

  // Step 3: drop posts older than maxAgeDays. Use ISO postedAt when present;
  // when missing, keep the post (don't punish API gaps).
  const cutoffMs = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const filtered = sliced.filter(p => {
    if (!p?.postedAt) return true;
    const t = Date.parse(p.postedAt);
    return isNaN(t) || t >= cutoffMs;
  });

  // Step 4: dedupe by stable id (some feeds surface the same post twice when
  // the seed self-reposts; reactionsUrn / urn / postLink may collide).
  const seenKeys = new Set();
  const deduped = [];
  for (const p of filtered) {
    const k = p.reactionsUrn || p.urn || p.commentsUrn || p.postLink;
    if (!k) { deduped.push(p); continue; }
    if (seenKeys.has(k)) continue;
    seenKeys.add(k);
    deduped.push(p);
  }

  return {
    ...data,
    posts: deduped,
    _meta: {
      rawCount: rawPosts.length,
      repostsDropped: rawPosts.length - ownPosts.length,
      slicedCount: sliced.length,
      droppedByAge: sliced.length - filtered.length,
      duplicatesDropped: filtered.length - deduped.length,
      filteredCount: deduped.length,
      limit,
      maxAgeDays
    }
  };
}

// GET /post_reactions — reactors on a post.  Params: reactionsUrn, page
// Response: { reactions: [{ title, subtitle, navigationUrl, reactionType, ... }] }
async function getPostReactions(reactionsUrn, page = 1) {
  return withRetry(async () => {
    await throttle();
    const { data } = await axios.get(process.env.RAPIDAPI_POST_REACTIONS_URL, {
      headers: h(),
      params: { reactionsUrn, page }
    });
    return data;
  });
}

// GET /post_comments — commenters on a post.  Params: commentsUrn, page
// Response: { comments: [{ commenter: { navigationUrl, title, subtitle }, ... }] }
async function getPostComments(commentsUrn, page = 1) {
  return withRetry(async () => {
    await throttle();
    const { data } = await axios.get(process.env.RAPIDAPI_POST_COMMENTS_URL, {
      headers: h(),
      params: { commentsUrn, page }
    });
    return data;
  });
}

// GET /comments_from_recent_activity — posts the seed commented on + who they were from
// Params: profile_url, page
// Response: { posts_with_comments: [{ actor: { actorLink, actorName }, highlightedComment: { commenter: { navigationUrl }, reply: { commenter: { navigationUrl } } }, ... }] }
async function getInteractedProfiles(profileUrl, page = 1) {
  return withRetry(async () => {
    await throttle();
    const { data } = await axios.get(process.env.RAPIDAPI_INTERACTED_PROFILES_URL, {
      headers: h(),
      params: { profile_url: profileUrl, page }
    });
    return data;
  });
}

// Compute total years of professional experience by finding the earliest
// start-year across all experiences and subtracting from current year. This
// avoids inflating the number when someone has overlapping roles (e.g., a
// board membership during their main job). Returns null if no parseable year.
function computeTotalExperienceYears(experiences) {
  if (!Array.isArray(experiences) || experiences.length === 0) return null;
  let earliest = null;
  for (const exp of experiences) {
    // Inspect every text-bearing field — caption is primary, others are fallbacks
    const text = [
      exp.caption,
      exp.subtitle,
      ...(Array.isArray(exp.subComponents) ? exp.subComponents.map(s => JSON.stringify(s)) : [])
    ].filter(Boolean).join(' ');
    // First 4-digit year in 1950-2099 range
    const re = /\b(19[5-9]\d|20\d{2})\b/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const y = parseInt(m[1]);
      if (earliest === null || y < earliest) earliest = y;
    }
  }
  if (earliest === null) return null;
  const now = new Date().getFullYear();
  const years = now - earliest;
  return years >= 0 && years <= 70 ? years : null;
}

// Extract location from API data — checks all possible fields
function extractLocation(d, experiences) {
  // Primary fields
  if (d.addressWithCountry) return d.addressWithCountry;
  if (d.addressWithoutCountry) return d.addressWithoutCountry;

  // Geo object variants
  if (d.geo?.full) return d.geo.full;
  if (d.geo?.city && d.geo?.country) return `${d.geo.city}, ${d.geo.country}`;
  if (d.geoLocation) return d.geoLocation;
  if (d.locationName) return d.locationName;
  if (d.geoLocationName) return d.geoLocationName;

  // Fallback: experience metadata (e.g. "Dubai, United Arab Emirates · On-site")
  const exp = experiences || [];
  for (const e of exp) {
    if (e.metadata) {
      // Strip work type suffixes like "· On-site", "· Remote", "· Hybrid"
      return e.metadata.replace(/\s*·\s*(On-site|Remote|Hybrid|On-Site).*$/i, '').trim();
    }
  }

  return '';
}

// Normalize /person response into Lead schema
// /person returns: { success, status, data: { firstName, lastName, fullName, publicIdentifier,
//   headline, connections, followers, addressWithCountry, profilePic, experiences: [...] } }
function normalizeProfile(raw, linkedinUrl) {
  const d = raw?.data || {};
  const exp = Array.isArray(d.experiences) ? d.experiences : [];
  const first = exp[0] || {};

  // Company name extraction:
  // - Breakdown experiences: title = company name, subtitle = "Full-time · 3 yrs", subComponents[0].title = job title
  // - Normal experiences: subtitle = company name (e.g. "PriceLabs · Full-time"), title = job title
  let companyName = '';
  if (first.breakdown) {
    // Breakdown: title IS the company name
    companyName = first.title || '';
  } else {
    // Normal: company is in subtitle
    companyName = first.subtitle || first.company?.name || first.companyName || '';
    // If subtitle is a duration like "3 yrs 6 mos", title might be company
    if (/^\d/.test(companyName) || !companyName) {
      companyName = first.title || '';
    }
  }
  // Strip employment type suffixes: "PriceLabs · Full-time" → "PriceLabs"
  companyName = companyName.replace(/\s*·\s*(Full-time|Part-time|Self-employed|Freelance|Contract|Internship|Seasonal|Apprenticeship).*$/i, '').trim();
  // If still looks like a duration or employment type, try companyLink1/2
  if (/^\d+\s*(yr|mo)/i.test(companyName) || /^(Full-time|Part-time|Self-employed)/i.test(companyName)) {
    const link = first.companyLink1 || first.companyLink2;
    if (link) {
      const match = link.match(/\/company\/([^/]+)/);
      if (match) companyName = match[1].replace(/-/g, ' ');
    }
  }

  // Title: for breakdown experiences, the actual title is in subComponents[0].title
  let title = first.title || '';
  if (first.breakdown && first.subComponents?.[0]?.title) {
    title = first.subComponents[0].title;
  }
  // Strip employment type from title too
  title = title.replace(/\s*·\s*(Full-time|Part-time|Self-employed|Freelance|Contract|Internship|Seasonal|Apprenticeship).*$/i, '').trim();

  // Company description from subComponents
  let companyDescription = '';
  if (first.subComponents?.[0]?.description?.[0]?.text) {
    companyDescription = first.subComponents[0].description[0].text;
  }

  // Name fallback chain: fullName → firstName+lastName → publicIdentifier
  let fullName = (d.fullName || '').trim();
  let firstName = (d.firstName || '').trim();
  let lastName = (d.lastName || '').trim();

  if (!fullName) fullName = `${firstName} ${lastName}`.trim();
  if (!fullName && d.publicIdentifier) {
    // Extract name from publicIdentifier: "jacob-croker-5b688040" → "Jacob Croker"
    let clean = d.publicIdentifier.replace(/-[a-f0-9]{6,}$/i, '');
    fullName = clean.split('-').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const parts = fullName.split(' ');
    firstName = parts[0] || '';
    lastName = parts.slice(1).join(' ') || '';
  }

  // Company URL: prefer companyLink1, fall back to companyLink2, then construct from name slug
  let companyUrl = first.companyLink1 || first.companyLink2 || '';
  if (companyUrl) {
    // Normalize: strip query params and trailing slashes
    try { companyUrl = new URL(companyUrl).origin + new URL(companyUrl).pathname; }
    catch { companyUrl = companyUrl.split('?')[0]; }
    companyUrl = companyUrl.replace(/\/$/, '');
  }

  return {
    linkedinUrl,
    publicIdentifier: d.publicIdentifier || '',
    firstName,
    lastName,
    fullName,
    headline:         d.headline   || '',
    summary:          d.summary    || d.about || '',
    location:         extractLocation(d, exp),
    profilePicture:   d.profilePic || '',
    connectionCount:  d.connections || 0,
    followerCount:    d.followers || 0,
    currentCompany:   companyName,
    currentTitle:     title,
    companyDescription,
    companyUrl,
    totalExperienceYears: computeTotalExperienceYears(exp),
    // Influence signals from /person (this provider doesn't expose follower
    // counts; creator + influencer are the only social-graph signals available)
    isCreator:    !!d.creator,
    isInfluencer: !!d.influencer,
    rawData: raw
  };
}

// Compute average engagement from a seed's recent posts (own posts only,
// reposts excluded — reposts inflate numbers without reflecting the seed's
// own audience).
function computeEngagementStats(postsResponse) {
  const posts = postsResponse?.posts || [];
  const ownPosts = posts.filter(p => !p.is_repost);
  if (ownPosts.length === 0) {
    return { avgLikes: 0, avgComments: 0, totalPostsScraped: posts.length, ownPostCount: 0 };
  }
  let likes = 0, comments = 0;
  for (const p of ownPosts) {
    likes    += p?.socialCount?.numLikes    || 0;
    comments += p?.socialCount?.numComments || 0;
  }
  return {
    avgLikes:    Math.round(likes    / ownPosts.length),
    avgComments: Math.round(comments / ownPosts.length),
    totalPostsScraped: posts.length,
    ownPostCount: ownPosts.length
  };
}

// Strip query params from a LinkedIn URL (e.g. actorLink has ?miniProfileUrn=...)
function cleanLinkedInUrl(url) {
  if (!url) return null;
  let u;
  try { u = new URL(url).origin + new URL(url).pathname; }
  catch { u = url.split('?')[0]; }
  return u.replace(/\/+$/, '');   // strip trailing slash so ".../in/x" and ".../in/x/" are one key
}

// A LinkedIn /in/ URL is either a vanity public identifier (usable as a person
// key) or an obfuscated member URN ("ACoAA..."). Return the public id ONLY for
// the vanity form — the obfuscated form is not a stable public_identifier.
function vanityPublicId(url) {
  const m = (url || '').match(/\/in\/([^/?#]+)/i);
  if (!m) return null;
  let id = m[1];
  try { id = decodeURIComponent(id); } catch {}
  if (/^ACoA/i.test(id)) return null;   // obfuscated URN — not a public identifier
  return id.toLowerCase();
}

// GET /similar_profiles — find similar profiles to a given profile
// Params: profileUrl, page
// Response: { success, status, response: [{ publicIdentifier, titleV2, subtitleV2, textActionTarget, ... }] }
async function getSimilarProfiles(profileUrl, page = 1) {
  return withRetry(async () => {
    await throttle();
    const { data } = await axios.get(process.env.RAPIDAPI_SIMILAR_PROFILES_URL, {
      headers: h(),
      params: { profileUrl, page }
    });
    return data;
  });
}

// POST /company — company-level data for strength scoring.  Body: { link: companyUrl }
// Response: { success, status, data: { companyName, companyId, employeeCount, employeeCountRange:{start,end}, locations[], specialities[], ... } }
// Default endpoint: https://linkedin-bulk-data-scraper.p.rapidapi.com/company (1 RapidAPI credit per call)
async function getCompanyData(companyUrl) {
  const url = process.env.RAPIDAPI_COMPANY_URL || `https://${process.env.RAPIDAPI_HOST}/company`;
  return withRetry(async () => {
    await throttle();
    const { data } = await axios.post(url,
      { link: companyUrl },
      { headers: h() }
    );
    return data;
  });
}

// POST /company_jobs — list of open job postings at a company. Used to detect sales-hiring flag.
// Body: { company_url, count, start }
// Response: { success, status, response: { data: { jobs: [{ title, companyName, ... }] } } }
// Default endpoint: https://linkedin-bulk-data-scraper.p.rapidapi.com/company_jobs (1 RapidAPI credit per call)
async function getCompanyJobs(companyUrl, count = 25, start = 0) {
  const url = process.env.RAPIDAPI_COMPANY_JOBS_URL || `https://${process.env.RAPIDAPI_HOST}/company_jobs`;
  return withRetry(async () => {
    await throttle();
    const { data } = await axios.post(url,
      { company_url: companyUrl, count, start },
      { headers: h() }
    );
    return data;
  });
}

module.exports = {
  getProfileByUrl,
  getProfileCached,
  getProfilePosts,
  getPostReactions,
  getPostComments,
  getInteractedProfiles,
  getSimilarProfiles,
  getCompanyData,
  getCompanyJobs,
  normalizeProfile,
  computeEngagementStats,
  cleanLinkedInUrl
};
