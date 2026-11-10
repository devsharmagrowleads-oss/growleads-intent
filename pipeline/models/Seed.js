const { createModel } = require('./db');

module.exports = createModel('seeds', [
  'linkedinUrl', 'publicIdentifier', 'firstName', 'lastName', 'fullName',
  'headline', 'summary', 'location', 'profilePicture', 'connectionCount',
  'followerCount', 'currentCompany', 'currentTitle', 'companyDescription',
  'campaignId', 'addedFrom', 'relevanceScore', 'relevanceTier', 'relevanceDetails',
  'enriched', 'enrichedAt', 'pipelineCount', 'similarPage', 'activityScraped',
  'lastScrapedAt', 'rawData', 'createdAt',
  // Richer influence signals captured during scrape
  'isCreator', 'isInfluencer', 'avgLikes', 'avgComments', 'totalPostsScraped',
  // Seed-quality gate + auto-resume progress
  'recentPostsCount', 'recentPostsCheckedAt',
  'enrichmentProgress', 'enrichmentTotal', 'enrichmentProgressAt'
], 'created_at DESC');
