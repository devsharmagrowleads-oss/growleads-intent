// ─── CORE ENRICHMENT PIPELINE ────────────────────────────────────────────────
//
// The brain of the system, extracted from the old Express route handler so the
// CLI can drive it directly. No web server, no SSE, no OpenAI qualifier.
//
// Flow:  seed → 60-day posts → [lead-magnet post filter] → paginate engagers →
//        each engager through the deterministic gate ladder → saved as a
//        `pending` pipeline lead (final qualification is the CLI/Claude pass).
//
// Everything the old inline OpenAI qualifier used to decide is now deferred to
// `cli.js qualify`. This file only runs deterministic gates.

const Seed = require('../models/Seed');
const Pipeline = require('../models/Pipeline');
const PostScraped = require('../models/PostScraped');
const { pool } = require('../models/db');
const linkedin = require('../services/linkedin');
const { getActiveCampaign } = require('../services/campaign');
const {
  matchesICP, isDisqualified, isVendorNotOperator, isCompetitorRole, classifyPersonaBracket,
} = require('../services/filter');
const { enrichCompanySignals } = require('../services/companyEnrichment');
const { detectDirectIntent } = require('../services/directIntent');
const { decideCapAction, normalizeCompanyKey } = require('../services/pipelineCap');
const { detectSignals } = require('../services/signals');
const { computeScore } = require('../services/scorer');
const { generatePersonalizationNotes, recommendAngle } = require('../services/personalizer');
const { scoreSeedRelevance } = require('../services/seedScorer');
const { isLeadMagnetPost } = require('../services/leadMagnet');
const log = require('../services/logger');

const COOLDOWN_DAYS = 30;
const CB_THRESHOLD = 5;   // consecutive failures before circuit-break
const MAX_PAGES = 15;     // per reactions/comments feed

// ─── cooldown ────────────────────────────────────────────────────────────────
async function isPersonOnCooldown(url) {
  const cutoff = new Date(Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
  const idMatch = url.match(/\/in\/([^/?]+)/);
  const publicId = idMatch ? idMatch[1] : null;
  const or = (u) => ({ $or: [{ linkedinUrl: u }, ...(publicId ? [{ publicIdentifier: publicId }] : [])] });

  const seedMatch = await Seed.findOne(or(url));
  if (seedMatch && seedMatch.lastScrapedAt && seedMatch.lastScrapedAt > cutoff)
    return { onCooldown: true, where: 'seed', name: seedMatch.fullName, lastScraped: seedMatch.lastScrapedAt };
  const pipeMatch = await Pipeline.findOne(or(url));
  if (pipeMatch && pipeMatch.lastScrapedAt && pipeMatch.lastScrapedAt > cutoff)
    return { onCooldown: true, where: 'pipeline', name: pipeMatch.fullName, lastScraped: pipeMatch.lastScrapedAt };
  if (seedMatch) return { onCooldown: false, exists: true, where: 'seed', doc: seedMatch };
  if (pipeMatch) return { onCooldown: false, exists: true, where: 'pipeline', doc: pipeMatch };
  return { onCooldown: false, exists: false };
}

// Auto-seed a vendor/competitor/seed-company person we rejected from the pipeline.
//
// OFF BY DEFAULT since 2026-08-27. The seed list is a deliberate, hand-picked
// set — never something a scrape grows on its own. Left enabled it compounds:
// one Harry Stebbings run promoted 255 engagers to seeds, which then made
// "works at a seed company" the single largest rejection reason (256 people),
// most of them rejected against companies that had only become seeds minutes
// earlier in that same run. Set AUTO_SEED_ENABLED=true to opt back in.
const AUTO_SEED_ENABLED = process.env.AUTO_SEED_ENABLED === 'true';

async function tryAddAsSeed(profile, reason, campaign, addedFrom) {
  if (!AUTO_SEED_ENABLED) return false;
  const existing = await Seed.findOne({
    $or: [
      { linkedinUrl: profile.linkedinUrl },
      ...(profile.publicIdentifier ? [{ publicIdentifier: profile.publicIdentifier }] : []),
    ],
  });
  if (existing) return false;
  const relevance = scoreSeedRelevance(profile, [], campaign);
  await Seed.create({
    ...profile,
    campaignId: campaign?.id || null,
    addedFrom: addedFrom || null,
    relevanceScore: relevance.relevanceScore,
    relevanceTier: relevance.tier,
    relevanceDetails: `${relevance.details} | auto-seeded: ${reason}`,
    lastScrapedAt: new Date(),
  });
  return true;
}

// ─── add a seed ──────────────────────────────────────────────────────────────
async function addSeed(url, { campaign } = {}) {
  campaign = campaign || getActiveCampaign();
  log.info(`Adding seed: ${url}`);
  const raw = await linkedin.getProfileByUrl(url);
  const profile = linkedin.normalizeProfile(raw, url);

  const postsResp = await linkedin.getProfilePosts(url, { limit: 20, maxAgeDays: 60 });
  const posts = postsResp.posts || [];
  const stats = linkedin.computeEngagementStats(postsResp);
  const relevance = scoreSeedRelevance(profile, posts, campaign);

  const existing = await Seed.findOne({ linkedinUrl: url });
  const seedRow = {
    ...profile,
    campaignId: campaign?.id || null,
    isCreator: profile.isCreator,
    isInfluencer: profile.isInfluencer,
    avgLikes: stats.avgLikes,
    avgComments: stats.avgComments,
    totalPostsScraped: stats.totalPostsScraped,
    recentPostsCount: stats.ownPostCount,
    recentPostsCheckedAt: new Date(),
    relevanceScore: relevance.relevanceScore,
    relevanceTier: relevance.tier,
    relevanceDetails: relevance.details,
    activityScraped: false,
    lastScrapedAt: new Date(),
  };
  const seed = existing
    ? await Seed.findByIdAndUpdate(existing._id, seedRow)
    : await Seed.create(seedRow);

  // persist the seed's posts for later engager mining
  let saved = 0;
  for (const post of posts) {
    const postUrn = post.reactionsUrn || post.commentsUrn || post.urn || post.postLink;
    if (!postUrn) continue;
    await PostScraped.findOneAndUpdate(
      { postUrn },
      {
        postUrn,
        postLink: post.postLink || null,
        postText: (post.postText || '').substring(0, 500),
        seedSource: seed._id.toString(),
        reactionsUrn: post.reactionsUrn || null,
        commentsUrn: post.commentsUrn || null,
        engagersScraped: false,
      },
      { upsert: true }
    ).catch(() => {});
    saved++;
  }

  log.ok(`Seed saved: ${profile.fullName} | ${profile.currentTitle} @ ${profile.currentCompany} | relevance ${relevance.relevanceScore} (${relevance.tier}) | ${saved} posts | ${stats.ownPostCount} recent posts`);
  return { seed, postsSaved: saved, relevance };
}

// ─── enrich one seed: mine its post engagers into pending pipeline leads ──────
async function enrichSeed(seed, { campaign, force = false, noCache = false } = {}) {
  campaign = campaign || getActiveCampaign();
  if (!campaign) throw new Error('No active campaign — set one before enriching.');

  const totals = { added: 0, rejected: 0, autoSeeded: 0, postsProcessed: 0 };
  const seenUrls = new Set();
  let i = 0, consecutiveFailures = 0, stopFlag = false;
  const SKIP_FIRST = force ? 0 : (seed.enrichmentProgress || 0);

  // seed-company exclusion set (engagers who work at a seed's company become
  // auto-seeds, not leads).
  const allSeeds = await Seed.find({}, { currentCompany: 1 });
  const seedCompanies = new Set(
    allSeeds.map((s) => (s.currentCompany || '').toLowerCase()
      .replace(/\s*·\s*(full-time|part-time|self-employed|freelance|contract).*/i, '').trim())
      .filter((c) => c && c.length > 1)
  );

  // ── the gate ladder for one engager ──
  async function processEngager(url, ctx) {
    if (stopFlag) return 'stop';
    if (consecutiveFailures >= CB_THRESHOLD) {
      log.error(`CIRCUIT BREAKER: ${consecutiveFailures} consecutive failures — aborting. Resume later.`);
      return 'stop';
    }
    if (!url) return 'done';
    if (seenUrls.has(url)) return 'skipped-seen';
    seenUrls.add(url);
    i++;
    if (i <= SKIP_FIRST) return 'skipped-resume';

    try {
      if (url.includes('/company/')) { consecutiveFailures = 0; return 'done'; }

      const cooldown = await isPersonOnCooldown(url);
      if (cooldown.onCooldown) {
        const days = Math.round((Date.now() - new Date(cooldown.lastScraped).getTime()) / 86400000);
        log.warn(`[#${i}] COOLDOWN: ${cooldown.name} (${cooldown.where}, ${days}d ago)`);
        return 'done';
      }

      const cached = await linkedin.getProfileCached(url, noCache ? { cacheTtlDays: 0 } : {});
      const p = cached.normalized;
      log.info(`[#${i}] ${cached.fromCache ? 'Cached' : 'Scraped'}: ${p.fullName} | ${p.currentTitle} @ ${p.currentCompany} | ${ctx.engagementType}${cached.fromCache ? ' (0 credits)' : ''}`);

      if (cooldown.exists) {
        const model = cooldown.where === 'pipeline' ? Pipeline : Seed;
        await model.findByIdAndUpdate(cooldown.doc._id, { ...p, lastScrapedAt: new Date() });
        return 'done';
      }

      // Gate: works at a seed company → auto-seed
      const co = (p.currentCompany || '').toLowerCase().trim();
      const hl = (p.headline || '').toLowerCase();
      const matchedSeedCo = [...seedCompanies].find((sc) => (co && (co.includes(sc) || sc.includes(co))) || hl.includes(sc));
      if (matchedSeedCo) {
        const seeded = await tryAddAsSeed(p, `Seed company: "${matchedSeedCo}"`, campaign, seed._id.toString());
        log.warn(`[#${i}] REJECTED: seed company "${matchedSeedCo}"${seeded ? ' → AUTO-SEEDED' : ''}`);
        if (seeded) totals.autoSeeded++;
        totals.rejected++; return 'done';
      }

      // Gate: sales-tech vendor → auto-seed
      const vendor = isVendorNotOperator(p);
      if (vendor.isVendor) {
        const seeded = await tryAddAsSeed(p, vendor.reason, campaign, seed._id.toString());
        log.warn(`[#${i}] REJECTED: ${vendor.reason}${seeded ? ' → AUTO-SEEDED' : ''}`);
        if (seeded) totals.autoSeeded++;
        totals.rejected++; return 'done';
      }

      // Gate: competitor role → auto-seed
      const compRole = isCompetitorRole(p);
      if (compRole.isCompetitor) {
        const seeded = await tryAddAsSeed(p, compRole.reason, campaign, seed._id.toString());
        log.warn(`[#${i}] REJECTED: ${compRole.reason}${seeded ? ' → AUTO-SEEDED' : ''}`);
        if (seeded) totals.autoSeeded++;
        totals.rejected++; return 'done';
      }

      // Gate: hard disqualifiers (IC titles, lead-magnet, exclusions — hardened 2026-07)
      const dq = isDisqualified(p, campaign);
      if (dq.disqualified) {
        log.warn(`[#${i}] DISQUALIFIED: ${dq.reason}`);
        totals.rejected++; return 'done';
      }

      // Direct-intent fast-path (regex; OpenAI stage is skipped without a key)
      if (campaign?.personaConfig?.enabled && ctx.engagementType === 'comment') {
        try {
          const di = await detectDirectIntent(ctx.commentText);
          p.directIntent = di.directIntent;
          p.directIntentSource = di.source;
          p.directIntentMatch = di.matchedPhrase;
          if (di.directIntent) log.info(`[#${i}] DIRECT INTENT (${di.source}: "${di.matchedPhrase}")`);
        } catch (_) {}
      }

      if (!p.directIntent && campaign?.personaConfig?.enabled) classifyPersonaBracket(p, campaign);

      // Company enrichment (RapidAPI) — headcount, size tier, hiring signal.
      // This is what closes the "blank employee count" loophole.
      if (campaign?.personaConfig?.enabled) {
        try { await enrichCompanySignals(p, campaign); }
        catch (err) { log.warn(`[#${i}] company enrichment failed: ${err.message}`); }
      }

      const icp = matchesICP(p, campaign);
      const signals = detectSignals(p, ctx, campaign);
      const { compositeScore, intentTier } = computeScore(signals, campaign?.signalWeights, null);
      log.info(`[#${i}] ICP:${icp.matched ? 'MATCH' : 'no'} bracket=${icp.personaBracket || '-'} priority=${icp.priority || '-'} size=${p.sizeTier || '-'}(${p.companyEmployeeCount ?? '?'}) geo=${icp.geographyTier || '-'} signal=${compositeScore}/${intentTier}`);

      if (!icp.matched) { log.warn(`[#${i}] REJECTED: ${icp.reason}`); totals.rejected++; return 'done'; }
      if (intentTier === 'none') { log.warn(`[#${i}] REJECTED: score too low`); totals.rejected++; return 'done'; }

      // Dedup
      const dup = await Pipeline.findOne({
        $or: [{ linkedinUrl: p.linkedinUrl }, ...(p.publicIdentifier ? [{ publicIdentifier: p.publicIdentifier }] : [])],
      });
      if (dup) { log.warn(`[#${i}] DUPLICATE: ${p.fullName}`); totals.rejected++; return 'done'; }

      // Company cap: max 2 per company
      if (campaign?.personaConfig?.enabled && p.currentCompany) {
        const coKey = normalizeCompanyKey(p.currentCompany);
        if (coKey) {
          const candidates = await Pipeline.find({
            currentCompany: { $regex: new RegExp(coKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
          });
          const sameCo = candidates.filter((e) => normalizeCompanyKey(e.currentCompany) === coKey);
          const decision = decideCapAction(
            { fullName: p.fullName, personaBracket: icp.personaBracket, priority: icp.priority, createdAt: new Date() },
            sameCo, 2
          );
          if (decision.action === 'reject') { log.warn(`[#${i}] COMPANY CAP: ${decision.reason}`); totals.rejected++; return 'done'; }
          if (decision.action === 'displace' && decision.displaceId) {
            await Pipeline.findByIdAndDelete(decision.displaceId);
            log.info(`[#${i}] COMPANY CAP: displaced lower-priority lead`);
          }
        }
      }

      // PASSED all deterministic gates → save as PENDING for the CLI/Claude pass.
      const notes = generatePersonalizationNotes(p, signals, campaign);
      const angle = recommendAngle(signals, campaign);
      let engagementContext = '';
      if (ctx.engagementType === 'comment') engagementContext = ctx.commentText ? `Commented: "${ctx.commentText}"` : 'Commented on post';
      else if (ctx.engagementType === 'reaction') engagementContext = ctx.postText ? `Reacted to: "${ctx.postText}"` : 'Reacted to post';
      else if (ctx.engagementType === 'content_creator') engagementContext = 'Content creator in the space';

      await Pipeline.create({
        ...p,
        seedSource: seed._id.toString(),
        seedSourceName: seed.fullName,
        campaignId: campaign?.id || null,
        source: 'intent',
        engagementType: ctx.engagementType || '',
        engagementContext,
        intentSource: ctx.postLink || '',
        signals, compositeScore, intentTier,
        icpMatch: { matched: icp.matched, score: icp.score, reason: icp.reason },
        personalizationNotes: notes, recommendedAngle: angle,
        personaBracket: icp.personaBracket || null,
        priority: icp.priority || null,
        geographyTier: icp.geographyTier || null,
        disqualified: false,
        qualificationStatus: 'pending',   // ← awaits `cli.js qualify`
        lastScrapedAt: new Date(),
      });
      log.ok(`[#${i}] PENDING LEAD: ${p.fullName} | bracket=${icp.personaBracket || '-'} priority=${icp.priority || '-'} [${ctx.engagementType} on ${seed.fullName}]`);
      totals.added++;
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures++;
      if (err.isProviderCapacity || /no free account/i.test(err?.response?.data?.message || '')) {
        log.error(`[#${i}] PROVIDER OUTAGE — aborting run.`);
        return 'stop';
      }
      if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|getaddrinfo|connect/i.test(err.message)) {
        log.error(`[#${i}] network/DB error: ${err.message} — pausing 5s`);
        await new Promise((r) => setTimeout(r, 5000));
      } else {
        log.error(`[#${i}] failed: ${err.message}`);
      }
    }

    if (i % 10 === 0) {
      await Seed.findByIdAndUpdate(seed._id, { enrichmentProgress: SKIP_FIRST + i, enrichmentProgressAt: new Date() }).catch(() => {});
    }
    return 'done';
  }

  // fetch the seed's current 60-day posts (always re-fetch so new posts appear)
  const postsResp = await linkedin.getProfilePosts(seed.linkedinUrl, { limit: 20, maxAgeDays: 60 });
  const posts = postsResp.posts || [];
  log.info(`Seed ${seed.fullName}: ${posts.length} posts in the last 60 days`);

  for (let pi = 0; pi < posts.length && !stopFlag; pi++) {
    const post = posts[pi];
    const postUrn = post.reactionsUrn || post.commentsUrn || post.urn || post.postLink;
    const postText = post.postText || '';
    const postLink = post.postLink || '';
    totals.postsProcessed++;
    log.info(`Post ${pi + 1}/${posts.length}: "${postText.substring(0, 60)}..."`);

    // DETERMINISTIC post-relevance: skip lead-magnet giveaway posts (was an OpenAI call).
    const existingPost = postUrn ? await PostScraped.findOne({ postUrn }) : null;
    let decision = existingPost?.relevanceDecision || null;
    if (!decision) {
      decision = isLeadMagnetPost(postText) ? 'NO' : 'YES';
      if (postUrn) {
        await PostScraped.findOneAndUpdate(
          { postUrn },
          { postUrn, relevanceDecision: decision, relevanceReason: decision === 'NO' ? 'lead-magnet giveaway post' : 'ok', relevanceJudgedAt: new Date() },
          { upsert: true }
        ).catch(() => {});
      }
    }
    if (decision === 'NO') { log.warn(`  POST SKIPPED: lead-magnet giveaway`); continue; }

    // Cache layer: replay saved engager URLs (0 credits)
    let saved = existingPost && Array.isArray(existingPost.engagerUrls) ? existingPost.engagerUrls
      : (existingPost && typeof existingPost.engagerUrls === 'string' ? JSON.parse(existingPost.engagerUrls || '[]') : null);
    if (saved && saved.length && !noCache) {
      log.info(`  Replaying ${saved.length} cached engagers (0 credits)`);
      for (const e of saved) {
        if (!e?.url || e.url === seed.linkedinUrl) continue;
        const r = await processEngager(e.url, { engagementType: e.engagementType || 'reaction', commentText: e.commentText || '', postText, postLink });
        if (r === 'stop') { stopFlag = true; break; }
      }
      continue;
    }

    // Cache miss: paginate reactions + comments
    const engagers = [];
    if (post.reactionsUrn) {
      for (let pg = 1; pg <= MAX_PAGES; pg++) {
        try {
          const data = await linkedin.getPostReactions(post.reactionsUrn, pg);
          const rs = data?.reactions || [];
          for (const r of rs) if (r.navigationUrl && r.navigationUrl !== seed.linkedinUrl) engagers.push({ url: r.navigationUrl, engagementType: 'reaction' });
          log.info(`    reactions page ${pg}: +${rs.length}`);
          if (rs.length < 10) break;
        } catch (e) { break; }
      }
    }
    if (post.commentsUrn) {
      for (let pg = 1; pg <= MAX_PAGES; pg++) {
        try {
          const data = await linkedin.getPostComments(post.commentsUrn, pg);
          const cs = data?.comments || [];
          for (const c of cs) {
            const url = c?.commenter?.navigationUrl || c?.navigationUrl;
            if (url && url !== seed.linkedinUrl) engagers.push({ url, engagementType: 'comment', commentText: c?.text || c?.comment || '' });
          }
          log.info(`    comments page ${pg}: +${cs.length}`);
          if (cs.length < 10) break;
        } catch (e) { break; }
      }
    }

    // persist engager URLs so the next run replays at 0 credits
    if (postUrn) {
      await PostScraped.findOneAndUpdate(
        { postUrn },
        {
          postUrn, postLink: postLink || null, postText: postText.substring(0, 500),
          seedSource: seed._id.toString(), reactionsUrn: post.reactionsUrn || null, commentsUrn: post.commentsUrn || null,
          engagersScraped: true, engagerCount: engagers.length, engagerUrls: engagers,
        },
        { upsert: true }
      ).catch(() => {});
    }

    log.info(`  ${engagers.length} engagers — qualifying...`);
    for (const e of engagers) {
      const r = await processEngager(e.url, { engagementType: e.engagementType, commentText: e.commentText || '', postText, postLink });
      if (r === 'stop') { stopFlag = true; break; }
    }
  }

  await Seed.findByIdAndUpdate(seed._id, {
    enriched: true, enrichedAt: new Date(),
    enrichmentProgress: SKIP_FIRST + i, enrichmentProgressAt: new Date(),
  }).catch(() => {});

  log.ok(`=== ${seed.fullName} DONE: +${totals.added} pending, ${totals.rejected} rejected, ${totals.autoSeeded} auto-seeded, ${totals.postsProcessed} posts ===`);
  return totals;
}

// ─── enrich every seed, sequentially (parallel = 429 cascade) ────────────────
async function enrichAll({ force = false, noCache = false } = {}) {
  const campaign = getActiveCampaign();
  if (!campaign) throw new Error('No active campaign.');
  const seeds = await Seed.find({});
  log.info(`Enriching ${seeds.length} seeds sequentially...`);
  const grand = { added: 0, rejected: 0, autoSeeded: 0 };
  for (let s = 0; s < seeds.length; s++) {
    log.info(`\n── Seed ${s + 1}/${seeds.length}: ${seeds[s].fullName} ──`);
    try {
      const t = await enrichSeed(seeds[s], { campaign, force, noCache });
      grand.added += t.added; grand.rejected += t.rejected; grand.autoSeeded += t.autoSeeded;
    } catch (err) {
      log.error(`Seed ${seeds[s].fullName} failed: ${err.message}`);
    }
  }
  log.ok(`=== ALL SEEDS DONE: +${grand.added} pending leads, ${grand.rejected} rejected, ${grand.autoSeeded} auto-seeded ===`);
  return grand;
}

module.exports = { addSeed, enrichSeed, enrichAll, isPersonOnCooldown };
