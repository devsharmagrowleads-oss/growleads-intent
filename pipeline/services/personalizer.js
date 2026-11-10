// Personalization engine
// References: SIGNAL_ENGINE.md Part 7

// ─── Company Name Cleaning ───────────────────────────────────────────────────

const COMPANY_SUFFIXES = [
  // Must be ordered longest-first to avoid partial matches
  'S\\.A\\. de C\\.V\\.',
  'Private Limited',
  'Pvt\\.? Ltd\\.?',
  'Pty\\.? Ltd\\.?',
  'PTY LTD',
  'GmbH & Co\\. KG',
  'GmbH',
  'Co\\.? Ltd\\.?',
  'Ltd\\.?',
  'LLC',
  'LLP',
  'L\\.P\\.',
  'Inc\\.?',
  'Corp\\.?',
  'S\\.A\\.',
  'S\\.L\\.',
  'S\\.r\\.l\\.',
  'B\\.V\\.',
  'N\\.V\\.',
  'A\\.S\\.',
  'A/S',
  'AG',
  'PLC',
  'SE',
  'SAS',
  'SARL',
  'OY',
  'AB',
  'ApS',
];

const SUFFIX_PATTERN = new RegExp(
  '\\s*[,.]?\\s*(?:' + COMPANY_SUFFIXES.join('|') + ')\\s*\\.?\\s*$',
  'i'
);

function cleanCompanyName(name) {
  if (!name || typeof name !== 'string') return '';
  let cleaned = name.trim();
  // Run twice to catch stacked suffixes like "Acme Pty Ltd Inc"
  cleaned = cleaned.replace(SUFFIX_PATTERN, '').trim();
  cleaned = cleaned.replace(SUFFIX_PATTERN, '').trim();
  // Strip trailing commas or dots left behind
  cleaned = cleaned.replace(/[,.\s]+$/, '').trim();
  return cleaned;
}

// ─── Geography Pair Resolution ───────────────────────────────────────────────

const GEO_RULES = [
  // Country-level matches (checked first)
  { pattern: /\b(united states|usa|u\.s\.)\b/i,      pair: 'US/UK' },
  { pattern: /\b(united kingdom|england|scotland|wales)\b/i, pair: 'UK/EU' },
  { pattern: /\b(australia)\b/i,                      pair: 'AU/UK' },
  { pattern: /\b(new zealand)\b/i,                    pair: 'AU/UK' },
  { pattern: /\b(canada)\b/i,                         pair: 'US/UK' },
  { pattern: /\b(mexico|m[eé]xico)\b/i,              pair: 'Mexico/US' },
  { pattern: /\b(uae|dubai|abu dhabi|united arab emirates)\b/i, pair: 'UAE/UK' },
  { pattern: /\b(saudi|bahrain|qatar|oman|kuwait)\b/i, pair: 'UAE/UK' },
  { pattern: /\b(india|mumbai|delhi|bangalore|bengaluru|hyderabad)\b/i, pair: 'APAC/UK' },
  { pattern: /\b(singapore|hong kong|tokyo|japan|korea|seoul)\b/i, pair: 'APAC/UK' },
  { pattern: /\b(china|shanghai|beijing|shenzhen)\b/i, pair: 'APAC/UK' },
  { pattern: /\b(indonesia|vietnam|thailand|malaysia|philippines)\b/i, pair: 'APAC/UK' },
  { pattern: /\b(south africa|nigeria|kenya|ghana|egypt|cairo)\b/i, pair: 'Africa/UK' },
  { pattern: /\b(brazil|colombia|argentina|chile|peru)\b/i, pair: 'LATAM/US' },

  // Region-level matches
  { pattern: /\b(europe|eu|european)\b/i,             pair: 'EU/UK' },
  { pattern: /\b(asia|apac|asia.pacific)\b/i,         pair: 'APAC/UK' },
  { pattern: /\b(middle east|mena|gcc)\b/i,           pair: 'UAE/UK' },
  { pattern: /\b(latin america|latam)\b/i,            pair: 'LATAM/US' },
  { pattern: /\b(africa)\b/i,                         pair: 'Africa/UK' },

  // European country matches
  { pattern: /\b(germany|berlin|munich|frankfurt)\b/i, pair: 'EU/UK' },
  { pattern: /\b(france|paris|lyon)\b/i,              pair: 'EU/UK' },
  { pattern: /\b(netherlands|amsterdam|rotterdam)\b/i, pair: 'EU/UK' },
  { pattern: /\b(spain|madrid|barcelona)\b/i,         pair: 'EU/UK' },
  { pattern: /\b(italy|milan|rome)\b/i,               pair: 'EU/UK' },
  { pattern: /\b(ireland|dublin)\b/i,                 pair: 'UK/EU' },
  { pattern: /\b(portugal|lisbon)\b/i,                pair: 'EU/UK' },
  { pattern: /\b(switzerland|zurich|geneva)\b/i,      pair: 'EU/UK' },
  { pattern: /\b(sweden|stockholm)\b/i,               pair: 'EU/UK' },
  { pattern: /\b(norway|oslo)\b/i,                    pair: 'EU/UK' },
  { pattern: /\b(denmark|copenhagen)\b/i,             pair: 'EU/UK' },
  { pattern: /\b(finland|helsinki)\b/i,                pair: 'EU/UK' },
  { pattern: /\b(poland|warsaw)\b/i,                  pair: 'EU/UK' },
  { pattern: /\b(austria|vienna)\b/i,                 pair: 'EU/UK' },
  { pattern: /\b(belgium|brussels)\b/i,               pair: 'EU/UK' },
  { pattern: /\b(czech|prague)\b/i,                   pair: 'EU/UK' },
  { pattern: /\b(greece|athens)\b/i,                  pair: 'EU/UK' },
  { pattern: /\b(romania|bucharest)\b/i,              pair: 'EU/UK' },
  { pattern: /\b(turkey|istanbul|ankara)\b/i,         pair: 'EU/UK' },

  // US state/city heuristics
  { pattern: /\b(california|new york|texas|florida|illinois|georgia|ohio|pennsylvania|virginia|washington|massachusetts|colorado|arizona|north carolina|oregon|nevada|michigan|tennessee|maryland|minnesota|wisconsin|missouri|connecticut|utah|louisiana|alabama|kentucky|indiana|iowa|arkansas|mississippi|kansas|nebraska|idaho|montana|hawaii|maine|new hampshire|vermont|rhode island|delaware|wyoming|south dakota|north dakota|west virginia|new mexico|new jersey|south carolina|oklahoma)\b/i, pair: 'US/UK' },
  { pattern: /\b(los angeles|san francisco|chicago|houston|phoenix|miami|seattle|boston|denver|atlanta|dallas|austin|nashville|portland|san diego|charlotte|raleigh|minneapolis|detroit|philadelphia|pittsburgh|san jose|salt lake city|las vegas|tampa|orlando|jacksonville|st\. louis|kansas city|cincinnati|cleveland|sacramento|richmond|baltimore|indianapolis|memphis|milwaukee|omaha|tucson|albuquerque)\b/i, pair: 'US/UK' },

  // UK city heuristics
  { pattern: /\b(london|manchester|birmingham|leeds|glasgow|edinburgh|bristol|liverpool|sheffield|newcastle|nottingham|cardiff|belfast|cambridge|oxford|brighton|reading|southampton|bath)\b/i, pair: 'UK/EU' },

  // Australian city heuristics
  { pattern: /\b(sydney|melbourne|brisbane|perth|adelaide|canberra|gold coast|hobart|darwin)\b/i, pair: 'AU/UK' },
];

function getGeoPair(location) {
  if (!location || typeof location !== 'string') return 'US/UK';
  for (const rule of GEO_RULES) {
    if (rule.pattern.test(location)) {
      return rule.pair;
    }
  }
  // Default fallback
  return 'US/UK';
}

// ─── Seed Topic Resolution ───────────────────────────────────────────────────

function getSeedTopic(seedName, campaign) {
  if (!seedName) return (campaign && campaign.industry) || 'industry insights';

  // Check campaign.messaging.seedTopics for an override keyed by seed name
  if (
    campaign &&
    campaign.messaging &&
    campaign.messaging.seedTopics &&
    typeof campaign.messaging.seedTopics === 'object'
  ) {
    // Try exact match first
    if (campaign.messaging.seedTopics[seedName]) {
      return campaign.messaging.seedTopics[seedName];
    }
    // Try case-insensitive first-name match
    const seedLower = seedName.toLowerCase();
    for (const [key, value] of Object.entries(campaign.messaging.seedTopics)) {
      if (key.toLowerCase() === seedLower) return value;
      // Also match if the key is a full name and seedName is the first name
      const keyFirst = key.split(/\s+/)[0].toLowerCase();
      if (keyFirst === seedLower) return value;
    }
  }

  // Fallback to campaign industry
  return (campaign && campaign.industry) || 'industry insights';
}

// ─── Personalized Message Builder ────────────────────────────────────────────

function buildPersonalizedMessage(lead, campaign) {
  if (!lead || !campaign) return null;

  const messaging = (campaign && campaign.messaging) || {};

  // Extract first name from lead. `firstName`/`fullName` are the actual
  // pipeline_leads columns; `name` is kept for legacy callers.
  const leadFirstName = extractFirstName(lead.firstName || lead.fullName || lead.name || '');
  if (!leadFirstName) return null;

  // Extract seed first name. The column is `seedSourceName` — reading only
  // `seedName`/`seed` produced "Saw you engaging with 's content".
  const seedFullName = lead.seedSourceName || lead.seedName || lead.seed || '';
  const seedFirstName = extractFirstName(seedFullName);

  // Get topic area for this seed
  const topicArea = getSeedTopic(seedFullName, campaign) || getSeedTopic(seedFirstName, campaign);

  // Clean company name. The column is `currentCompany` — reading only
  // `company`/`companyName` meant {company} never substituted and every lead
  // silently fell through to the no-company fallback line.
  const rawCompany = lead.currentCompany || lead.company || lead.companyName || '';
  const company = cleanCompanyName(rawCompany);

  // Resolve geography pair
  const location = lead.location || lead.geo || '';
  const geoPair = getGeoPair(location);

  // Pull messaging components from campaign config
  const intentLine = messaging.intentLine || '';
  const statistic = messaging.statistic || '';
  const portfolioNoun = messaging.portfolioNoun || 'businesses';
  const cta = messaging.cta || 'Open to a quick breakdown?';

  // Build company-specific line
  let companyLine = '';
  if (company) {
    companyLine = messaging.companyLine
      ? messaging.companyLine.replace(/\{company\}/gi, company)
      : `If useful, I can show ${company} where these usually hide.`;
  } else {
    companyLine = messaging.noCompanyLine || 'If useful, I can show you where these usually hide.';
  }

  // Assemble the message (no em dashes, no dashes, no emojis).
  // Without a seed name the opener has to stand on its own, otherwise it reads
  // "Saw you engaging with 's content around ...".
  const opener = seedFirstName
    ? `Saw you engaging with ${seedFirstName}'s content around ${topicArea}.`
    : `Saw you engaging with content around ${topicArea}.`;

  const lines = [
    `Hey ${leadFirstName},`,
    '',
    opener + (intentLine ? ` ${intentLine}` : ''),
    '',
    `Across the ${geoPair} ${portfolioNoun} we support, we keep seeing the same pattern: ${statistic}`,
    '',
    companyLine,
    '',
    cta,
  ];

  return lines.join('\n');
}

function extractFirstName(fullName) {
  if (!fullName || typeof fullName !== 'string') return '';
  return fullName.trim().split(/\s+/)[0];
}

// ─── Existing Functions (preserved) ──────────────────────────────────────────

function generatePersonalizationNotes(lead, signals, campaign) {
  const notes = [];

  // Signal-specific context
  for (const signal of (signals || [])) {
    if (signal.details) {
      const tag = signalTag(signal.type);
      notes.push(`[${tag}] ${signal.details}`);
    }
  }

  // Campaign-level acknowledgment
  if (campaign && campaign.acknowledgmentPoints && campaign.acknowledgmentPoints.length > 0) {
    notes.push(`[Acknowledge] ${campaign.acknowledgmentPoints[0]}`);
  }

  // Campaign-level proof point
  if (campaign && campaign.caseStudies && campaign.caseStudies.length > 0) {
    notes.push(`[Proof] ${campaign.caseStudies[0]}`);
  }

  return notes.join(' | ') || null;
}

function recommendAngle(signals, campaign) {
  if (!signals || signals.length === 0) return 'Angle A: Direct Value';

  const types = new Set(signals.map(s => s.type));

  if (types.has('S08')) return 'Angle B: Pain/Dissatisfaction — reference their specific complaint';
  if (types.has('S03')) return 'Angle C: Thought Leadership — reference their content';
  if (types.has('S01') || types.has('S07')) return 'Angle D: Milestone — congratulate on event, connect to next challenge';
  if (types.has('S04')) return 'Angle A: Shared Interest — reference the content they engaged with';

  return 'Angle A: Direct Value — lead with insight about their role/industry';
}

function signalTag(type) {
  const tags = {
    S01: 'Trigger', S02: 'Hiring', S03: 'Content', S04: 'Engagement',
    S05: 'Tech', S06: 'Community', S07: 'News', S08: 'Pain',
    S09: 'Regulatory', S10: 'Filing', S11: 'Timing', S12: 'Proximity'
  };
  return tags[type] || type;
}

module.exports = {
  generatePersonalizationNotes,
  recommendAngle,
  cleanCompanyName,
  getGeoPair,
  buildPersonalizedMessage,
  getSeedTopic,
};
