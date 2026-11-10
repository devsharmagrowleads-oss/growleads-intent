const { createModel } = require('./db');

module.exports = createModel('posts_scraped', [
  'postUrn', 'postLink', 'postText', 'seedSource',
  'reactionsUrn', 'commentsUrn', 'engagersScraped',
  'scrapedAt', 'engagerCount', 'reactionCount', 'commentCount',
  'engagerUrls',
  // Per-post AI relevance gate. Judged once on first encounter; future runs
  // replay the cached decision instead of re-paying for the AI call.
  'relevanceDecision', 'relevanceReason', 'relevanceJudgedAt'
], 'scraped_at DESC');
