// Signal detection from engagement data
// References: SIGNAL_ENGINE.md Part 2 (S03, S04, S08) + Part 8 (Comment Classification)

function detectSignals(profile, engagementContext, campaign) {
  const signals = [];
  const painKeywords = (campaign && campaign.painKeywords) || [];
  const competitors = (campaign && campaign.competitors) || [];

  // S04: Base engagement signal — always fires for engagers
  const engagementScore = classifyEngagement(engagementContext);
  signals.push({
    type: 'S04',
    label: 'Engagement Behavior',
    score: engagementScore.score,
    detectedAt: new Date(),
    details: engagementScore.details
  });

  // S03: Content creation — if this person is a post author
  if (engagementContext.isContentCreator && engagementContext.postText) {
    const relevance = scoreContentRelevance(engagementContext.postText, painKeywords);
    if (relevance.score > 0) {
      signals.push({
        type: 'S03',
        label: 'Content Narrative',
        score: relevance.score,
        detectedAt: new Date(),
        details: `Posted: "${engagementContext.postText}"`
      });
    }
  }

  // S08: Pain expression — if comment contains pain keywords
  if (engagementContext.commentText) {
    const pain = scorePainExpression(engagementContext.commentText, painKeywords, competitors);
    if (pain.score >= 5) {
      signals.push({
        type: 'S08',
        label: 'Pain Expression',
        score: pain.score,
        detectedAt: new Date(),
        details: `Pain: "${engagementContext.commentText}"`
      });
    }
  }

  return signals;
}

// Classify comment type per SIGNAL_ENGINE.md engagement taxonomy
function classifyEngagement(ctx) {
  const text = (ctx.commentText || '').toLowerCase();
  const isReaction = ctx.engagementType === 'reaction';

  if (isReaction || !text) {
    return { score: 3, tier: 8, type: 'reaction', details: 'Reacted to relevant content' };
  }

  // Tier 1: Direct question
  if (/\?/.test(text) && /(does anyone|has anyone|recommend|suggest|what do you use|looking for|anyone know)/i.test(text)) {
    return { score: 10, tier: 1, type: 'direct_question', details: `Asked: "${text}"` };
  }

  // Tier 2: Personal experience
  if (/(we're dealing|we tried|we faced|in my experience|at our company|we struggled|we're going through)/i.test(text)) {
    return { score: 9, tier: 2, type: 'personal_experience', details: `Shared experience: "${text}"` };
  }

  // Tier 3: Colleague tag
  if (/@/.test(text) && text.length > 20) {
    return { score: 9, tier: 3, type: 'colleague_tag', details: `Tagged colleague: "${text}"` };
  }

  // Tier 4: Opinion/insight (long, substantive)
  if (text.length > 100 && /(key thing|what worked|in my view|the real issue|from our perspective|the important part)/i.test(text)) {
    return { score: 8, tier: 4, type: 'opinion_insight', details: `Insight: "${text}"` };
  }

  // Tier 7: Short agreement
  if (text.length < 50 && /(so true|this!|exactly|agree|100%|well said|spot on|great post|love this)/i.test(text)) {
    return { score: 5, tier: 7, type: 'short_agreement', details: 'Agreed with relevant content' };
  }

  // Default: general comment (Tier 5-6)
  return { score: 6, tier: 6, type: 'general_comment', details: `Commented: "${text}"` };
}

function scoreContentRelevance(text, painKeywords) {
  if (!text) return { score: 0 };
  const lower = text.toLowerCase();
  let matches = 0;
  for (const kw of painKeywords) {
    if (kw && lower.includes(kw.toLowerCase())) matches++;
  }

  // Also check universal pain indicators
  const painIndicators = ['struggling', 'challenge', 'bottleneck', 'need help', 'looking for solutions', 'frustrated'];
  for (const p of painIndicators) {
    if (lower.includes(p)) matches++;
  }

  if (matches === 0) return { score: 0 };
  if (matches >= 4) return { score: 9 };
  if (matches >= 2) return { score: 7 };
  return { score: 5 };
}

function scorePainExpression(text, painKeywords, competitors) {
  if (!text) return { score: 0 };
  const lower = text.toLowerCase();
  let score = 0;

  // Strong pain language
  const strongPain = ['frustrated', 'struggling', 'broken', 'nightmare', 'terrible', 'worst',
    'hate', "doesn't work", 'failing', 'disaster', 'waste of money', 'looking for alternative',
    'switching from', 'disappointed'];
  for (const p of strongPain) { if (lower.includes(p)) score += 3; }

  // Campaign-specific pain keywords
  for (const kw of painKeywords) {
    if (kw && lower.includes(kw.toLowerCase())) score += 2;
  }

  // Competitor mentions
  for (const comp of competitors) {
    if (comp && lower.includes(comp.toLowerCase())) score += 2;
  }

  return { score: Math.min(10, score) };
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.substring(0, len) + '...' : str;
}

module.exports = { detectSignals, classifyEngagement, scoreContentRelevance, scorePainExpression };
