// Gate 4 — Pipeline Cap and Deduplication
//
// Enforces the max-two-leads-per-company rule. When a third qualifying lead
// arrives for a company that already has two, rank all three and keep the
// top two by:
//   1. Persona bracket (Founder > Executive > Operator)
//   2. Composite priority label (top > high > medium > low)
//   3. Most recent engagement (newest wins)
//
// Returns:
//   { action: 'allow' | 'displace' | 'reject',
//     displaceId: ObjectId | null,
//     reason: string }

const BRACKET_RANK = { founder: 3, executive: 2, operator: 1 };
const PRIORITY_RANK = { top: 4, high: 3, medium: 2, low: 1 };

// Normalize a company name for "same company" comparison. Mirrors the cleanup
// used in personalizer.js so that "Acme Inc.", "Acme Pvt Ltd", and "Acme"
// match each other.
function normalizeCompanyKey(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/\b(pvt\.?\s*ltd\.?|private\s+limited|limited|llc|inc\.?|corp\.?|corporation|gmbh|s\.a\.|sa|pty\.?\s*ltd\.?|ltd\.?|co\.?|company|technologies?|tech|solutions?|systems?)\b/gi, '')
    .replace(/[.,'"!?()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Score a lead for ranking. Higher = keep.
// score = bracketRank * 1000 + priorityRank * 10 + recency_minutes (capped)
function scoreForCap(lead) {
  const bracket = (lead.personaBracket || '').toLowerCase();
  const priority = (lead.priority || '').toLowerCase();
  const bRank = BRACKET_RANK[bracket] || 0;
  const pRank = PRIORITY_RANK[priority] || 0;
  // Recency: most-recent createdAt wins as tiebreaker. Use epoch_minutes / 1e6
  // so it stays well below the priority multiplier.
  const ts = lead.createdAt ? new Date(lead.createdAt).getTime() : Date.now();
  const recencyComponent = Math.min(ts / 6e10, 1); // 0..1
  return bRank * 1000 + pRank * 10 + recencyComponent;
}

// Decide what to do when inserting a new lead. existingLeads is an array of
// Pipeline docs already in the DB for the same company (the caller queries
// for these). Returns the action to take.
function decideCapAction(newLead, existingLeads, cap = 2) {
  if (existingLeads.length < cap) {
    return { action: 'allow', displaceId: null, reason: `${existingLeads.length}/${cap} slots used` };
  }

  // Cap reached. Rank everyone and decide.
  const newScore = scoreForCap(newLead);
  const ranked = existingLeads
    .map(l => ({ lead: l, score: scoreForCap(l) }))
    .sort((a, b) => a.score - b.score); // ascending — worst first

  const worst = ranked[0];
  if (newScore > worst.score) {
    return {
      action: 'displace',
      displaceId: worst.lead._id,
      reason: `New lead score ${newScore.toFixed(1)} > worst existing ${worst.score.toFixed(1)} (${worst.lead.fullName})`
    };
  }

  return {
    action: 'reject',
    displaceId: null,
    reason: `Cap reached (${cap}/${cap}); new score ${newScore.toFixed(1)} not higher than worst ${worst.score.toFixed(1)}`
  };
}

module.exports = {
  decideCapAction,
  normalizeCompanyKey,
  scoreForCap,
  // Exposed for tests:
  BRACKET_RANK,
  PRIORITY_RANK
};
