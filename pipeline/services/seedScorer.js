// Seed Relevance Scorer
//
// Seeds are competitors / influencers / content creators whose audience
// contains our prospects. We score them on five dimensions, each contributing
// a continuous sub-score (not fixed buckets) so the final score actually
// differentiates between candidates instead of clustering at the top.
//
// Sub-score caps:
//   industryFit     — 0–35  (keyword density in headline + summary + company)
//   contentFit      — 0–35  (% of recent posts containing industry keywords)
//   influenceFlags  — 0–15  (creator +5, influencer +10)
//   contentQuality  — 0–15  (substantive long-form / educational posts)
// Total: 100. Engagement averages were dropped — the post window itself
// (last 20 within 60 days) is what we use; we don't summarize it.
// Tier thresholds set so the spread is meaningful for 5–20 seeds.

function scoreSeedRelevance(profile, posts, campaign) {
  const industryKeywords = buildIndustryKeywords(campaign);
  const details = [];
  const scores = {
    industryFit: 0,
    contentFit: 0,
    influenceFlags: 0,
    contentQuality: 0
  };

  // ── 1. Industry fit (0–35) — keyword density in profile text ───────────
  const profileText = [
    profile.headline || '',
    profile.currentTitle || '',
    profile.summary || '',
    profile.currentCompany || '',
    profile.companyDescription || ''
  ].join(' ').toLowerCase();

  let profileMatches = 0;
  const matchedTerms = new Set();
  for (const kw of industryKeywords) {
    if (profileText.includes(kw)) {
      profileMatches++;
      matchedTerms.add(kw);
    }
  }
  // 3.5 points per match, capped at 35 (10+ matches saturates)
  scores.industryFit = Math.min(35, Math.round(profileMatches * 3.5));
  if (profileMatches > 0) {
    details.push(`${profileMatches} industry keywords in profile`);
  }

  // Competitor company match overrides to max
  const competitors = (campaign?.competitors || []).map(c => c.toLowerCase()).filter(Boolean);
  const company = (profile.currentCompany || '').toLowerCase();
  if (competitors.some(c => c.length > 2 && (company.includes(c) || c.includes(company)))) {
    scores.industryFit = 35;
    details.push(`competitor: ${profile.currentCompany}`);
  }

  // ── 2. Content fit (0–35) — % of recent posts touching the industry ────
  const ownPosts = (posts || []).filter(p => !p?.is_repost);
  if (ownPosts.length > 0) {
    let relevantPosts = 0;
    for (const post of ownPosts) {
      const text = (post.postText || post.text || '').toLowerCase();
      if (!text) continue;
      let hits = 0;
      for (const kw of industryKeywords) {
        if (text.includes(kw)) { hits++; if (hits >= 1) break; } // one match is enough to count this post
      }
      if (hits > 0) relevantPosts++;
    }
    const ratio = relevantPosts / ownPosts.length;
    scores.contentFit = Math.round(ratio * 35); // linear 0–35
    if (relevantPosts > 0) {
      details.push(`${relevantPosts}/${ownPosts.length} own posts on-topic (${Math.round(ratio * 100)}%)`);
    }
  } else if ((posts || []).length > 0) {
    details.push(`${posts.length} posts but all reposts`);
  } else {
    details.push('no posts');
  }

  // ── 3. Influence flags (0–15) — creator (+5) and influencer (+10) ──────
  if (profile.isCreator)    { scores.influenceFlags += 5;  details.push('creator badge'); }
  if (profile.isInfluencer) { scores.influenceFlags += 10; details.push('influencer badge'); }

  // ── 4. Content quality (0–15) — substantive educational posts ──────────
  const qualityKeywords = [
    "how to", "tips", "strategy", "here's what", "lesson", "insight",
    "mistake", "the key", "we found", "data shows", "results",
    "case study", "our clients", "we helped", "best practice",
    "playbook", "framework", "step by step", "deep dive", "breakdown",
    "announcement", "excited to share", "launching", "introducing"
  ];
  let qualityHits = 0;
  for (const post of ownPosts) {
    const text = (post.postText || post.text || '').toLowerCase();
    if (text.length > 200 && qualityKeywords.some(k => text.includes(k))) qualityHits++;
  }
  // 2.5 points per quality post, capped at 15 (6+ saturates)
  scores.contentQuality = Math.min(15, Math.round(qualityHits * 2.5));
  if (qualityHits > 0) details.push(`${qualityHits} substantive posts`);

  // ── Composite ──────────────────────────────────────────────────────────
  const relevanceScore = Math.min(100,
    scores.industryFit +
    scores.contentFit +
    scores.influenceFlags +
    scores.contentQuality
  );

  // Tier thresholds — calibrated for 5–20 seed sets
  let tier;
  if (relevanceScore >= 75)      tier = 'high';
  else if (relevanceScore >= 55) tier = 'moderate';
  else if (relevanceScore >= 30) tier = 'low';
  else                           tier = 'irrelevant';

  return {
    relevanceScore,
    tier,
    scores,
    details: details.join(' | ') || 'no signals matched'
  };
}

function buildIndustryKeywords(campaign) {
  const kws = new Set();
  for (const ind of (campaign?.targetIndustries || [])) {
    for (const word of ind.toLowerCase().split(/[\s-]+/)) {
      if (word.length > 3) kws.add(word);
    }
    kws.add(ind.toLowerCase());
  }
  for (const pk of (campaign?.painKeywords || [])) {
    const lower = pk.toLowerCase();
    if (lower.length > 4) kws.add(lower);
    for (const word of lower.split(/\s+/)) {
      if (word.length > 4) kws.add(word);
    }
  }
  for (const comp of (campaign?.competitors || [])) {
    kws.add(comp.toLowerCase());
  }
  // Also include the campaign's Primary B2B keywords as a natural industry vocabulary
  for (const kw of (campaign?.icpKeywordsPrimary || campaign?.icpKeywordsStrong || [])) {
    kws.add(kw.toLowerCase());
  }
  return Array.from(kws);
}

module.exports = { scoreSeedRelevance };
