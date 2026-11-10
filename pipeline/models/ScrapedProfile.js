const { createModel } = require('./db');

// Cache of every LinkedIn profile we've ever scraped via /person. Keyed by
// linkedin_url. Used by getProfileCached to avoid re-spending /person credits
// when the same engager shows up on multiple posts or in a re-run.
module.exports = createModel('scraped_profiles', [
  'linkedinUrl', 'publicIdentifier', 'firstName', 'lastName', 'fullName',
  'headline', 'summary', 'location', 'profilePicture',
  'connectionCount', 'followerCount',
  'currentCompany', 'currentTitle', 'companyDescription',
  'companyUrl', 'totalExperienceYears',
  'isCreator', 'isInfluencer',
  'rawData', 'scrapedAt'
], 'scraped_at DESC');
