const { createModel } = require('./db');

module.exports = createModel('pipeline_leads', [
  'seedSource', 'campaignId', 'source', 'linkedinUrl', 'publicIdentifier',
  'firstName', 'lastName', 'fullName', 'headline', 'summary', 'location',
  'profilePicture', 'connectionCount', 'currentCompany', 'currentTitle', 'companyDescription',
  'signals', 'compositeScore', 'intentTier', 'icpMatch', 'personalizationNotes',
  'recommendedAngle', 'engagementType', 'engagementContext', 'intentSource',
  'seedSourceName', 'lastScrapedAt', 'rawData', 'createdAt',
  // Gate 0-4 fields (see /ICP.md)
  'companyUrl', 'companyEmployeeCount', 'sizeTier', 'personaBracket',
  'hiringTopPriority', 'directIntent', 'directIntentSource', 'directIntentMatch',
  'priority', 'totalExperienceYears', 'geographyTier',
  // Pipeline-expansion: track when we last scraped this lead's own posts
  // (looking for new content to attract more engagers). Used by the
  // /api/expand-pipeline endpoint to cooldown-skip leads we just checked.
  'lastPostsScrapedAt', 'postsRelevantCount',
  // Soft-disqualification + batch qualification (see models/db.js)
  'disqualified', 'disqualifiedReason', 'disqualifiedAt',
  'qualificationStatus', 'qualifiedBy', 'qualifiedAt'
], 'created_at DESC');
