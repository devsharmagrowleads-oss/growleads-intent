// ICP matching + disqualification filters

const SENIORITY_MAP = {
  'C-Suite': ['chief', 'ceo', 'cto', 'cfo', 'coo', 'cmo', 'chro', 'cio', 'cxo', 'founder', 'co-founder', 'cofounder'],
  'VP': ['vp', 'vice president', 'svp', 'evp'],
  'Director': ['director', 'head of', 'head -', 'principal'],
  'Manager': ['manager', 'lead', 'senior manager', 'team lead']
};

// ─── STR/PROPERTY FALLBACK (used only when campaign has no icpKeywords) ─────

const STR_KEYWORDS_STRONG = [
  'holiday home', 'holiday homes', 'vacation rental', 'vacation rentals',
  'short-term rental', 'short term rental', 'serviced apartment', 'aparthotel',
  'holiday letting', 'holiday lettings', 'property management', 'property manager',
  'property portfolio', 'superhost', 'co-host', 'cohost', 'airbnb host', 'vrbo host',
  'rental property', 'rental properties', 'rental business', 'lettings',
  'str operator', 'str portfolio', 'occupancy rate', 'ota ranking', 'nightly rate',
];

const STR_KEYWORDS_WEAK = [
  'property', 'properties', 'villa', 'villas', 'cottage', 'airbnb', 'vrbo',
  'host', 'hosting', 'accommodation', 'lodging', 'occupancy', 'revenue management',
  'dynamic pricing', 'channel manager', 'guest experience', 'real estate', 'hospitality',
];

// Vendor patterns for STR — people who SELL TO operators, not operators themselves
const STR_VENDOR_PATTERNS = [
  /helping\s+(vacation|short.?term|str|rental|property|holiday)\s*(rental|manager|operator|owner|home|company|business|pmc)/i,
  /I\s+help\s+(short|str|vacation|rental|property|holiday)/i,
  /for\s+(vacation|short.?term|str|rental|property|holiday)\s*(rental|manager|operator|owner|home|company|business|pmc|host)/i,
  /solutions?\s+for\s+(property|str|vacation|rental|holiday)/i,
  /fractional\s+(leader|cmo|cfo|coo|cto|revenue|distribution|strategy|executive)/i,
  /revenue\s+management\s+(tool|software|platform|solution|system|company|saas|for)/i,
  /pricing\s+(tool|software|platform|solution|system|saas)/i,
];

// Vendor patterns for Growleads — people who SELL outbound services (peers, not buyers)
const GROWLEADS_VENDOR_PATTERNS = [
  /lead\s*gen(eration)?\s+(agency|agent|specialist|service|expert)/i,
  /(outbound|cold\s*email|cold\s*outreach)\s+(agency|service|expert|consultant|specialist)/i,
  /i\s+help\s+(b2b|saas|founders|companies)\s+(get|book|build)\s+(pipeline|meetings|demos|leads)/i,
  /fractional\s+(cmo|cro|head\s+of\s+sales|gtm|sales\s+leader)/i,
  /(sdr|bdr|sales\s+development)\s+(as\s+a\s+service|outsourcing|agency)/i,
  /we\s+book\s+(meetings|demos|qualified\s+calls)/i,
];

// Competitor role patterns for STR — people who DO revenue management (peers, not buyers)
const STR_COMPETITOR_ROLE_PATTERNS = [
  /\brevenue\s+(manager|director|analyst|strategist|specialist|consultant|lead|head|officer)\b/i,
  /\b(director|head|vp)\s+of\s+revenue\b/i,
  /\brevenue\s+management\b/i,
  /\bpricing\s+(manager|director|analyst|strategist|specialist|consultant)\b/i,
  /\byield\s+(manager|analyst|director)\b/i,
];

const CITY_ALIASES = {
  'bangalore': ['bangalore', 'bengaluru'],
  'mumbai': ['mumbai', 'bombay'],
  'delhi': ['delhi', 'new delhi', 'delhi ncr', 'ncr', 'gurgaon', 'gurugram', 'noida'],
  'chennai': ['chennai', 'madras'],
  'kolkata': ['kolkata', 'calcutta'],
  'hyderabad': ['hyderabad', 'secunderabad']
};

// ─── ICP RELEVANCE ─────────────────────────────────────────────────────────────
// Uses campaign.icpKeywordsPrimary/Secondary when available; falls back to STR
// defaults. Named hasPropertyRelevance for backward compat with routes/leads.js.

function hasPropertyRelevance(lead, campaign) {
  const text = [
    lead.currentTitle, lead.headline, lead.currentCompany, lead.summary, lead.companyDescription
  ].filter(Boolean).join(' ').toLowerCase();

  // 1. Campaign target industries (always checked first)
  const industries = campaign?.targetIndustries || [];
  for (const ind of industries) {
    if (text.includes(ind.toLowerCase())) return { relevant: true, reason: `Industry: ${ind}` };
  }

  // 2. Campaign-specific keywords (parsed from campaign file).
  //    Prefer Primary/Secondary; accept legacy Strong/Weak as fallback.
  const primaryKws   = campaign?.icpKeywordsPrimary   || campaign?.icpKeywordsStrong || [];
  const secondaryKws = campaign?.icpKeywordsSecondary || campaign?.icpKeywordsWeak   || [];

  if (primaryKws.length > 0 || secondaryKws.length > 0) {
    for (const kw of primaryKws) {
      if (text.includes(kw)) return { relevant: true, reason: `ICP signal: ${kw}` };
    }
    const secondaryMatches = secondaryKws.filter(kw => text.includes(kw));
    if (secondaryMatches.length >= 2) return { relevant: true, reason: `ICP signals: ${secondaryMatches.slice(0, 3).join(', ')}` };
    return { relevant: false, reason: 'No ICP signals in profile' };
  }

  // 3. Fallback: STR/property hardcoded keywords (StrategyCues compat)
  for (const kw of STR_KEYWORDS_STRONG) {
    if (text.includes(kw)) return { relevant: true, reason: `Property: ${kw}` };
  }
  const weakMatches = STR_KEYWORDS_WEAK.filter(kw => text.includes(kw));
  if (weakMatches.length >= 2) return { relevant: true, reason: `Property signals: ${weakMatches.slice(0, 3).join(', ')}` };

  return { relevant: false, reason: 'No ICP signals in profile' };
}

// ─── VENDOR FILTER ────────────────────────────────────────────────────────────
// People who SELL TO the ICP rather than being the ICP themselves.

function isVendorNotOperator(lead) {
  const text = [lead.headline, lead.summary, lead.companyDescription].filter(Boolean).join(' ');
  // Try Growleads vendor patterns first (most likely to match for the active campaign),
  // then STR vendor patterns for backward compat with StrategyCues.
  for (const pattern of GROWLEADS_VENDOR_PATTERNS) {
    const match = text.match(pattern);
    if (match) return { isVendor: true, reason: `Vendor: "${match[0]}"` };
  }
  for (const pattern of STR_VENDOR_PATTERNS) {
    const match = text.match(pattern);
    if (match) return { isVendor: true, reason: `Vendor: "${match[0]}"` };
  }
  return { isVendor: false, reason: null };
}

// ─── COMPETITOR ROLE FILTER ───────────────────────────────────────────────────
// People whose job IS what the client sells — they don't need to buy it.

function isCompetitorRole(lead) {
  const title = (lead.currentTitle || lead.headline || '');
  for (const pattern of STR_COMPETITOR_ROLE_PATTERNS) {
    const match = title.match(pattern);
    if (match) return { isCompetitor: true, reason: `Competitor role: "${match[0]}"` };
  }
  return { isCompetitor: false, reason: null };
}

// ─── COMPETITOR-SIGNAL KEYWORDS (Gate 1 Row 1.2) ──────────────────────────────
// Profile contains phrases that mark them as a peer/competitor agency
// (e.g., "B2B marketing agency", "B2B outbound expert"). Anyone whose own bio
// describes Growleads-style services is not a buyer.
function hasCompetitorKeywords(lead, campaign) {
  const signals = campaign?.competitorSignals || [];
  if (signals.length === 0) return { match: false };
  const text = [lead.headline, lead.summary, lead.companyDescription]
    .filter(Boolean).join(' ').toLowerCase();
  for (const kw of signals) {
    if (text.includes(kw)) return { match: true, keyword: kw };
  }
  return { match: false };
}

// ─── INDIVIDUAL CONTRIBUTOR DETECTION ────────────────────────────────────────
// Returns true if the title clearly indicates an IC (not a decision-maker).
// These titles get rejected BEFORE bracket classification because:
//   1. The fuzzy match leaks them into Operator bracket (e.g., "Lead
//      Generation Specialist" hits "Demand Generation Lead" on word overlap).
//   2. ICs whose job IS lead-gen / demand-gen / outbound / SDR work are
//      execution-layer staff at the very functions Growleads sells. They're
//      neither buyers nor a useful lead — at best they're a peer/competitor.
function isIndividualContributorTitle(rawTitle) {
  if (!rawTitle) return false;
  const t = rawTitle.toLowerCase();

  // Override: if the title ALSO contains a strong senior marker, trust the
  // senior marker (e.g., "Senior Director of Demand Generation Specialist
  // Team" — unusual but conceivable).
  const seniorOverride = /\b(founder|co-?founder|ceo|cto|cpo|coo|cfo|cmo|cro|chief|owner|managing\s+(partner|director)|president|head\s+of|vp|vice\s+president|director\s+of|director,|senior\s+vice\s+president|svp|evp)\b/i;
  if (seniorOverride.test(t)) return false;

  // IC indicators that beat anything else.
  // Grouped by family. Every entry here was observed leaking into the pipeline
  // during the 2026-07 audit (460/597 accepted leads were false positives, and
  // ~300 of those were individual contributors).
  const icPattern = new RegExp([
    // Generic seniority-negative markers
    'specialist|coordinator|associate|analyst|junior|intern|trainee|assistant|apprentice',
    // Quota-carrying sellers. "Enterprise/Strategic/Senior/Founding/Corporate/
    // Mid-Market/Velocity/Field Account Executive" all reduce to "account executive".
    'account\\s+executive|\\bae\\b|account\\s+manager|account\\s+director|account\\s+development',
    'sales\\s+executive|sales\\s+representative|sales\\s+rep\\b|inside\\s+sales|field\\s+sales',
    'client\\s+partner|client\\s+executive|strategic\\s+accounts?\\b|enterprise\\s+sales',
    // Pipeline-generation ICs and the people who manage them. These run outbound
    // in-house; they are DIY practitioners, not buyers of outbound services.
    'sales\\s+development|business\\s+development\\s+(representative|manager|executive|associate|officer|consultant)',
    '\\bsdr\\b|\\bbdr\\b|appointment\\s+setter|prospector|lead\\s+gen(eration)?\\s+manager',
    // Ops practitioners
    'revenue\\s+operations|sales\\s+operations|gtm\\s+operations|marketing\\s+operations',
    // Post-sales and support
    'customer\\s+success|customer\\s+service|customer\\s+support|billing|implementation\\s+manager',
    // Pre-sales / technical ICs
    'solutions?\\s+(engineer|consultant|architect)|sales\\s+engineer|presales|pre-sales',
    // Non-GTM functions that cannot buy outbound
    'software\\s+engineer|data\\s+engineer|qa\\s+|quality\\s+assurance|product\\s+manager',
    'program\\s+manager|project\\s+manager|product\\s+marketing\\s+manager',
    // Territory / regional sellers dressed up as managers
    'territory|regional\\s+sales\\s+manager|area\\s+manager|business\\s+area\\s+manager',
    // Explicit
    'outbound\\s+specialist|outbound\\s+expert|demand\\s+gen(eration)?\\s+specialist',
    'growth\\s+specialist|individual\\s+contributor',
  ].join('|'), 'i');
  return icPattern.test(t);
}

// Title normalization — expand industry abbreviations BEFORE bracket matching
// so "BD Lead" matches "Business Development Lead", "RevOps Manager" matches
// "Revenue Operations Manager", etc. Anchored on word boundaries to avoid
// false expansions like "abducted" → "abusiness developmenucted".
function normalizeTitle(rawTitle) {
  if (!rawTitle) return '';
  let t = ' ' + rawTitle.toLowerCase() + ' ';
  const subs = [
    [/\bbd\b/g, 'business development'],
    [/\bbiz\s*dev\b/g, 'business development'],
    [/\brevops\b/g, 'revenue operations'],
    [/\brev\s+ops\b/g, 'revenue operations'],
    [/\bsalesops\b/g, 'sales operations'],
    [/\bsales\s+ops\b/g, 'sales operations'],
    [/\bgtmops\b/g, 'gtm operations'],
    [/\bgtm\s+ops\b/g, 'gtm operations'],
    [/\bops\b/g, 'operations'],
    [/\bmd\b/g, 'managing director'],
    [/\bsvp\b/g, 'senior vice president'],
    [/\bevp\b/g, 'executive vice president'],
    [/\bvp\b/g, 'vice president']
  ];
  for (const [re, rep] of subs) t = t.replace(re, rep);
  return t.trim();
}

// ─── PERSONA BRACKET CLASSIFICATION (Gate 2) ──────────────────────────────────
// Returns the bracket name ('founder' | 'executive' | 'operator') or null if
// the lead is not a decision-maker. All three brackets are valid Pipeline
// entries — the bracket is informational, not selective.
function classifyPersonaBracket(lead, campaign) {
  const cfg = campaign?.personaConfig;
  if (!cfg?.enabled || !cfg.brackets) return null;
  const rawTitle = (lead.currentTitle || lead.headline || '').toLowerCase();
  const title = normalizeTitle(rawTitle);

  // IC short-circuit — before fuzzy matching can leak them into Operator.
  // Check against BOTH the raw and normalized forms so we don't miss "SDR"
  // because of the expansion.
  if (isIndividualContributorTitle(rawTitle) || isIndividualContributorTitle(title)) return null;

  // Order matters: founder > executive > operator. A founder who also wrote
  // "VP" in their headline still classifies as founder.
  for (const bracket of ['founder', 'executive', 'operator']) {
    const titles = cfg.brackets[bracket] || [];
    for (const t of titles) {
      const normalizedTarget = normalizeTitle(t.toLowerCase());
      if (fuzzyTitleMatch(title, normalizedTarget)) return bracket;
    }
  }
  return null;
}

// ─── COMPANY SIZE TIER (Gate 3 Signal A) ──────────────────────────────────────
// Returns 'sweet_spot' | 'growth' | 'scale' | 'early' | 'unknown'.
// 'enterprise' would have rejected at Gate 1 Row 1.5 and never reaches here.
function classifyCompanySizeTier(employeeCount, campaign) {
  const tiers = campaign?.personaConfig?.sizeTiers;
  if (!tiers || typeof employeeCount !== 'number') return 'unknown';
  for (const tier of ['sweet_spot', 'growth', 'scale', 'early']) {
    const range = tiers[tier];
    if (!range) continue;
    if (employeeCount >= range[0] && employeeCount <= range[1]) return tier;
  }
  return 'unknown';
}

// ─── GEOGRAPHY TIER (Gate 3 Signal C) ─────────────────────────────────────────
// Returns 'priority' | 'secondary' | 'unknown'. Hard-excluded geographies
// (Section 4 "Excluded Geographies") reject earlier in isDisqualified and
// never reach this function.
function classifyGeographyTier(lead, campaign) {
  const location = (lead.location || '').toLowerCase();
  if (!location) return 'unknown';
  for (const geo of (campaign?.geographyPrimary || [])) {
    if (location.includes(geo.toLowerCase().trim())) return 'priority';
  }
  for (const geo of (campaign?.geographySecondary || [])) {
    if (location.includes(geo.toLowerCase().trim())) return 'secondary';
  }
  return 'unknown';
}

// ─── COMPOSITE PRIORITY (Gate 3 final label) ──────────────────────────────────
// 'top' | 'high' | 'medium' | 'low' — drives Final-sheet ordering.
// directIntent overrides everything else: a direct buying signal is the
// strongest indicator regardless of size or geo.
function computePriority({ directIntent, sizeTier, hiringTopPriority, geographyTier }) {
  if (directIntent) return 'top';
  if (hiringTopPriority) return 'top';
  if (sizeTier === 'sweet_spot' && geographyTier === 'priority') return 'top';
  if ((sizeTier === 'sweet_spot' || sizeTier === 'growth') && geographyTier === 'priority') return 'high';
  if ((sizeTier === 'growth' || sizeTier === 'scale') &&
      (geographyTier === 'priority' || geographyTier === 'secondary')) return 'medium';
  return 'low';
}

// ─── SIZE-CONDITIONAL GATE 2 RULES ────────────────────────────────────────────
// At sizeTier='early' (under 10 employees):
//   - Operator bracket is rejected (titles like "Director of Sales" at a 5-person
//     company usually indicate misrepresentation).
//   - Founder / Executive require lead.totalExperienceYears >= legitimacyMinYears
//     (default 6) to filter out hobbyists / fake founders without budget.
//   - employeeCount === 1 (true solo) is rejected outright — these are almost
//     always personal brands, coaches, consultants, or methodology vendors,
//     not real B2B product companies we can sell outbound services to.
// All checks are bypassed when directIntent=true — the buying signal overrides.
function applySizeConditionalRules(lead, bracket, campaign) {
  const directIntent = !!lead.directIntent;
  if (directIntent) return { pass: true, reason: 'directIntent bypass' };

  const sizeTier = lead.sizeTier;
  if (sizeTier !== 'early') return { pass: true };

  // Hard reject: 1-employee "companies" — solo founders selling methodology,
  // coaching, consulting, or just their personal brand. Doesn't matter what
  // their experience says; the company size is the tell.
  if (lead.companyEmployeeCount === 1) {
    return { pass: false, reason: 'Solo founder (employeeCount=1) — likely personal brand or methodology vendor, not a real product company' };
  }

  if (bracket === 'operator') {
    return { pass: false, reason: 'Operator bracket rejected at <10 emp (misrepresentation risk)' };
  }

  const minYears = campaign?.personaConfig?.legitimacyMinYears ?? 6;
  const exp = lead.totalExperienceYears;
  if (typeof exp !== 'number') {
    // Unknown experience — log but pass (don't reject on missing data).
    return { pass: true, reason: 'experience unknown — passed but flagged' };
  }
  if (exp < minYears) {
    return { pass: false, reason: `Legitimacy: ${exp} yrs experience < ${minYears} required at sizeTier=early` };
  }
  return { pass: true, reason: `Legitimacy: ${exp} yrs experience >= ${minYears}` };
}

// ─── ICP MATCH ────────────────────────────────────────────────────────────────

function matchesICP(lead, campaign) {
  if (!campaign) return { matched: false, score: 0, propertyRelevant: false, reason: 'No active campaign' };

  const cfg = campaign.personaConfig;
  const title    = (lead.currentTitle || lead.headline || '').toLowerCase();
  const location = (lead.location || '').toLowerCase();
  let score = 0;
  const reasons = [];

  // Gate 1 Row 1.1 — B2B keyword relevance
  const relevance = hasPropertyRelevance(lead, campaign);
  if (relevance.relevant) {
    score += 5;
    reasons.push(relevance.reason);
  }

  // Gate 1 Row 1.2 — competitor-signal keywords (e.g., "B2B outbound agency").
  // Only applied when the campaign defines competitorSignals (Growleads); skipped otherwise.
  const compKw = hasCompetitorKeywords(lead, campaign);
  if (compKw.match) {
    return {
      matched: false, score: 0, propertyRelevant: relevance.relevant,
      reason: `Competitor signal: "${compKw.keyword}"`
    };
  }

  // Gate 1 Row 1.5 — enterprise cap (requires enrichment with companyEmployeeCount)
  const empCount = lead.companyEmployeeCount;
  if (cfg?.enabled && typeof empCount === 'number' && empCount >= (cfg.enterpriseCap || 5000)) {
    return {
      matched: false, score: 0, propertyRelevant: relevance.relevant,
      reason: `Enterprise cap: employeeCount ${empCount} >= ${cfg.enterpriseCap}`
    };
  }

  // Gate 2 — Persona bracket classification. Reject if no bracket matches.
  // Falls back to legacy primary/secondary-title flow for campaigns without
  // personaConfig (e.g., StrategyCues).
  let titleMatch = { primary: false, secondary: false, matched: null };
  let personaBracket = null;
  if (cfg?.enabled) {
    personaBracket = classifyPersonaBracket(lead, campaign);
    // Bracket=null is NOT a hard reject anymore. The IC short-circuit inside
    // classifyPersonaBracket already filters out clear individual contributors
    // (Specialist/Coordinator/AE/SDR/etc.). Anyone who passes the IC check but
    // doesn't match a bracket template is an ambiguous senior title — let AI
    // judge instead of throwing them away (e.g., "Director of Strategy",
    // operations leaders, BD abbreviations, non-English titles).
    if (!personaBracket) {
      titleMatch.matched = 'unknown';
      reasons.push('Bracket: unknown (passed to AI for final decision)');
      // No +3 score — bracket is unknown. AI is the deciding gate.
    } else {
      // Size-conditional rules only apply when we have a confirmed bracket.
      const sizeRules = applySizeConditionalRules(lead, personaBracket, campaign);
      if (!sizeRules.pass) {
        return {
          matched: false, score: 0, propertyRelevant: relevance.relevant,
          personaBracket,
          reason: sizeRules.reason
        };
      }
      score += 3;
      reasons.push(`Bracket: ${personaBracket}`);
      if (sizeRules.reason) reasons.push(sizeRules.reason);
      titleMatch.primary = true;
      titleMatch.matched = personaBracket;
    }
  } else {
    titleMatch = checkTitleMatch(title, campaign.primaryTitles, campaign.secondaryTitles);
    if (titleMatch.primary)        { score += 3; reasons.push(`Title: ${titleMatch.matched}`); }
    else if (titleMatch.secondary) { score += 2; reasons.push(`Secondary title: ${titleMatch.matched}`); }
  }

  // Gate 3 priority signals (informational; never reject)
  const sizeTier = lead.sizeTier || classifyCompanySizeTier(empCount, campaign);
  const geographyTier = classifyGeographyTier(lead, campaign);
  const hiringTopPriority = !!lead.hiringTopPriority;
  const directIntent = !!lead.directIntent;
  const priority = cfg?.enabled
    ? computePriority({ directIntent, sizeTier, hiringTopPriority, geographyTier })
    : null;

  // Legacy score components — still useful for non-personaConfig campaigns
  const seniorityMatch = checkSeniorityMatch(title, campaign.seniorityLevel);
  if (seniorityMatch) { score += 2; reasons.push(`Seniority: ${seniorityMatch}`); }
  const geographyMatch = checkGeographyMatch(location, campaign.geographyPrimary);
  if (geographyMatch) { score += 2; reasons.push(`Geography: ${location}`); }

  const matched = relevance.relevant && score >= 7;

  return {
    matched,
    score,
    titleMatch: titleMatch.primary || titleMatch.secondary,
    seniorityMatch: !!seniorityMatch,
    geographyMatch,
    propertyRelevant: relevance.relevant,
    personaBracket,
    sizeTier,
    geographyTier,
    hiringTopPriority,
    directIntent,
    priority,
    reason: reasons.join(' | ') || 'No ICP match'
  };
}

// ─── DISQUALIFICATION ─────────────────────────────────────────────────────────

// Sales-tech / outbound / B2B-prospecting vendor patterns.
// These companies sell TO outbound teams — they are peers/competitors of any
// outbound agency, NOT buyers. Match anywhere in company name, headline,
// summary, or company description (all lower-cased before check).
const SALES_TECH_BRAND_NAMES = [
  // Data / enrichment / contact APIs
  'fullenrich', 'full enrich', 'clay.com', 'clay labs', 'apollo.io',
  'zoominfo', 'lusha', 'cognism', 'hunter.io', 'rocketreach', 'kaspr',
  'leadiq', 'seamless.ai', 'datagma', 'findymail', 'wiza', 'contactout',
  'uplead', 'lead411', 'signalhire', 'bettercontact', 'prospeo',
  'persana ai', 'persana.ai', 'crustdata', 'predictleads', 'coresignal',
  // Sequencer / sender / engagement
  'lemlist', 'smartlead', 'instantly.ai', 'salesloft', 'outreach.io',
  'reply.io', 'saleshandy', 'mailshake', 'woodpecker.co', 'quickmail',
  'klenty', 'lavender.ai', 'la growth machine', 'heyreach', 'expandi',
  'dripify', 'salesflow', 'closely.io',
  // Lead-gen / intent / GTM intelligence SaaS
  'bombora', '6sense', 'demandbase', 'clearbit', 'leadfeeder', 'albacross',
  'visitor queue', 'warmly.ai', 'rb2b', 'trigify', 'common room',
  'champify', 'pocus', 'usergems', 'default.com',
  // AI-GTM / outbound-automation platforms. Added 2026-07 after the audit found
  // five Landbase employees (including their CEO) sitting in the pipeline.
  'landbase', 'intentsify', 'peoplelinx', 'clustr', 'seven signals',
  'gojiberryai', 'gojiberry ai', 'sending.ac', 'techsalerator', 'sqleads',
  'oliv ai', 'oliv.ai', 'onfire ai', 'quasar ai',
  // SDR-as-a-service / outbound agencies. Direct competitors.
  'growth era', 'the pipeline group', 'beyond codes', 'revnew', 'salesaladin',
  'belkins', 'cience', 'martal group', 'memorysales', 'sdrx'
];
const SALES_TECH_PHRASES = [
  'data aggregator', 'waterfall enrichment', 'email finder', 'phone finder',
  'lead database', 'prospecting platform', 'prospecting tool',
  'outbound platform', 'cold email tool', 'cold-email sender',
  'sales engagement platform', 'sales sequencer', 'b2b data provider',
  'b2b contact data', 'lookalike data', 'intent data provider'
];

function checkSalesTechVendor(lead) {
  // Brand names identify the COMPANY — match them only in the company NAME, where
  // a vendor's own employee would carry it. Descriptions and summaries routinely
  // list these brands as tools the person USES ("intent orchestration via Apollo,
  // Lusha, Clay") — matching there wrongly disqualified real buyers. The "what a
  // company does" phrases still scan the wider text.
  const companyName = (lead.currentCompany || '').toLowerCase();
  const fullText = [lead.currentCompany, lead.headline, lead.summary, lead.companyDescription, lead.currentTitle]
    .filter(Boolean).join(' \n ').toLowerCase();

  for (const brand of SALES_TECH_BRAND_NAMES) {
    // Bound by non-word characters so 'apollo.io' doesn't match a substring
    // like 'apollohealth', and 'clay.com' doesn't match 'clayton.com'.
    const re = new RegExp(`(^|[^a-z0-9])${brand.replace(/[.+*?^$()[\]{}|\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
    if (companyName && re.test(companyName)) return `Sales-tech vendor: ${brand}`;
  }
  for (const phrase of SALES_TECH_PHRASES) {
    if (fullText.includes(phrase)) return `Sales-tech vendor phrase: "${phrase}"`;
  }
  return null;
}

// Training / EdTech / coaching company indicators in the COMPANY NAME.
// These cos sell courses, certifications, bootcamps, or training programs —
// they are content sellers, not B2B buyers of outbound services. Companies
// whose entire business is to TEACH (vs. ship product) are out of scope for an
// outbound agency. Matched as word-bounded tokens in the company name only —
// not the headline/summary, since plenty of legit B2B SaaS happens to mention
// "training" or "academy" in passing (e.g., "we run a customer academy").
const TRAINING_COMPANY_NAME_TOKENS = [
  'university', 'universidad', 'universidade', 'universite', 'universität',
  'academy', 'academia', 'akademie',
  'institute', 'instituto', 'institut',
  'school', 'escuela', 'escola', 'ecole', 'schule',
  'college', 'colegio',
  'bootcamp', 'boot camp',
  'mastermind',
  'training co', 'training company', 'training group', 'training inc', 'training ltd',
  'coaching co', 'coaching company', 'coaching group', 'coaching inc', 'coaching ltd',
  'edtech academy', 'learning lab'
];

// Phrases that — when in headline OR summary OR company description — strongly
// signal the company's CORE BUSINESS is selling training/education/coaching,
// not a B2B product. We're conservative here to avoid catching B2B SaaS that
// merely mention training as a feature.
const TRAINING_BUSINESS_PHRASES = [
  'we sell courses', 'we sell training', 'we provide training', 'we offer training',
  'corporate training programs', 'corporate training program',
  'executive education', 'executive training',
  'professional certification', 'certification program',
  'online learning platform', 'e-learning platform', 'elearning platform',
  'mba program', 'mba course', 'mba bootcamp',
  'sales bootcamp', 'cold-call bootcamp', 'sales training program',
  'paid community', 'paid mastermind',
  'i help reps', 'i help sellers', 'i help founders close',
  'live training sessions', 'live coaching', 'cohort-based course',
  'sells courses', 'sells training'
];

function checkTrainingVendor(lead) {
  const company = (lead.currentCompany || '').toLowerCase();
  if (company) {
    for (const tok of TRAINING_COMPANY_NAME_TOKENS) {
      // Word-bounded match in company name. "Live University" matches "university";
      // "Lightspeed" does NOT match "school" (no false positive).
      const re = new RegExp(`(^|[^a-z0-9])${tok.replace(/[.+*?^$()[\]{}|\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
      if (re.test(company)) return `Training/EdTech company name: contains "${tok}"`;
    }
  }
  const haystack = [
    lead.headline, lead.summary, lead.companyDescription
  ].filter(Boolean).join(' \n ').toLowerCase();
  for (const phrase of TRAINING_BUSINESS_PHRASES) {
    if (haystack.includes(phrase)) return `Training-business phrase: "${phrase}"`;
  }
  return null;
}

// ─── SELF-DESCRIPTION GUARD ──────────────────────────────────────────────────
// A match only counts if the company is describing ITSELF, not its customers.
// "software FOR venture capital firms" sells TO VCs — the lead-in phrase "for"
// means the following words are the customer, so the match is discarded. Ported
// from the ICP-filtering engine's _self_described() (its most valuable idea).
const CUSTOMER_LEAD_IN = /\b(for|to|into|across|serving|serves|help|helps|helping|support|supports|supporting|built for|designed for|made for|used by|trusted by|chosen by|loved by|works with|work with|partner with|partnering with|sell to|sells to|selling to|cater to|caters to|customers|clients)\s+[\w\s,&/.-]{0,32}$/i;
function selfDescribes(hay, re) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let m;
  while ((m = g.exec(hay)) !== null) {
    const before = hay.slice(Math.max(0, m.index - 48), m.index);
    if (!CUSTOMER_LEAD_IN.test(before)) return m[0];   // a genuine self-description
    if (g.lastIndex === m.index) g.lastIndex++;
  }
  return null;
}

// ─── INVESTOR DETECTION (the hardest exclusion — no exceptions) ──────────────
// Only unambiguous investor self-identifiers, run through the self-description
// guard so "software for VC firms" / "backed by a fund" are kept. A normal B2B
// company never describes ITSELF with these.
const INVESTOR_RE = /(venture capital (firm|fund|partners)|private equity (firm|fund)|\bvc firm\b|\bpe firm\b|growth equity (firm|fund)|\bfamily office\b|\bhedge fund\b|buyout fund|angel (network|syndicate)|\bgeneral partner\b|\bventure partner\b|managing partner at [\w\s]*(capital|ventures?|equity)\b|invest(s|ing)? in (early[- ]stage |seed[- ]stage )?(startups|founders|companies|businesses)|entrepreneur in residence|\bventure fund\b)/i;
function checkInvestor(lead) {
  // Judge what the COMPANY is (name + its own description + the role title) — NOT
  // the person's headline/summary, which carry side-hats ("Angel Investor"),
  // tools they use, and verticals they sold to. That distinction removed 4 of the
  // 6 false positives found on the qualified set.
  const hay = [lead.currentCompany, lead.companyDescription, lead.currentTitle]
    .filter(Boolean).join(' \n ').toLowerCase();
  if (!hay) return null;
  const hit = selfDescribes(hay, INVESTOR_RE);
  return hit ? `Investor (hard exclusion): "${hit.trim().slice(0, 40)}"` : null;
}

// ─── AEO/GEO SELLER DETECTION (direct competitor of Service B) ───────────────
// Surface-aware: match ONLY what the company SELLS (its name + its own
// description). The SAME words in a person's headline/summary/post may be a
// belief or a request — an AI-Visibility BUYER we want to KEEP. See
// the written ICP §4/§7. This is the rule a naive filter gets backwards.
const AEO_GEO_SELLER = /(answer engine optimi[sz]|generative engine optimi[sz]|\baeo\b|ai visibility|llm visibility|llm seo|\bai seo\b|ai search optimi[sz]|citation (building|tracking|monitoring)|(get|gets|getting) (you |your |brands? |clients? )?cited|cited (in|by) (chatgpt|perplexity|claude|gemini|ai|llms?|answer engines?)|prompt (tracking|monitoring)|ai[ -]?mention (tracking|monitoring)|(seo|aeo|llm)\s*[/&+,]\s*geo|geo\s*[/&+,]\s*(seo|aeo|llm))/i;
function checkAeoGeoSeller(lead) {
  const sells = [lead.currentCompany, lead.companyDescription].filter(Boolean).join(' \n ').toLowerCase();
  if (sells && AEO_GEO_SELLER.test(sells)) {
    return `AEO/GEO competitor: company sells AI-visibility work (Service B peer)`;
  }
  return null;
}

function isDisqualified(lead, campaign) {
  if (!campaign) return { disqualified: false, reason: null };

  const rawTitle = lead.currentTitle || lead.headline || '';
  const title    = rawTitle.toLowerCase();
  const company  = (lead.currentCompany || '').toLowerCase();
  const location = (lead.location || '').toLowerCase();
  const fullName = (lead.fullName || '').toLowerCase();

  // Hard-reject individual contributors. Previously this check lived only inside
  // classifyPersonaBracket, where a hit merely produced bracket=null — and a null
  // bracket was passed to an AI prompted to default to YES. That single gap
  // accounted for roughly 300 of the 460 bad leads found in the 2026-07 audit.
  // An AE, SDR, CSM, or solutions engineer cannot authorize buying outbound.
  if (isIndividualContributorTitle(rawTitle) ||
      isIndividualContributorTitle(normalizeTitle(rawTitle))) {
    return { disqualified: true, reason: `Individual contributor title: "${rawTitle}"` };
  }

  // Hard-reject sales-tech / B2B prospecting vendors regardless of campaign config.
  // For an outbound agency, these are peers, not customers. See aiQualifier red flag #4.
  const stHit = checkSalesTechVendor(lead);
  if (stHit) return { disqualified: true, reason: stHit };

  // Hard-reject training / EdTech / coaching companies. They SELL courses
  // and certifications — they are content sellers, not B2B SaaS buying
  // outbound services. Caught Marcelo Marcondes @ Live University which the
  // AI passed because his title looked operator-y.
  const tvHit = checkTrainingVendor(lead);
  if (tvHit) return { disqualified: true, reason: tvHit };

  // Investors — the single hardest exclusion, no exceptions (the written ICP §6.1).
  const invHit = checkInvestor(lead);
  if (invHit) return { disqualified: true, reason: invHit };

  // AEO/GEO sellers — direct competitors of the AI Visibility service. Surface-aware:
  // only fires on what the company SELLS, so AI-visibility BUYERS survive (§4/§7).
  const aeoHit = checkAeoGeoSeller(lead);
  if (aeoHit) return { disqualified: true, reason: aeoHit };

  for (const c of (campaign.existingClients || [])) {
    if (company.includes(c.toLowerCase())) return { disqualified: true, reason: `Existing client: ${c}` };
  }

  for (const b of (campaign.blacklist || [])) {
    const bl = b.toLowerCase();
    if (company.includes(bl) || fullName.includes(bl)) return { disqualified: true, reason: `Blacklisted: ${b}` };
  }

  for (const r of (campaign.roleExclusions || [])) {
    if (title.includes(r.toLowerCase())) return { disqualified: true, reason: `Role excluded: ${r}` };
  }

  for (const comp of (campaign.competitors || [])) {
    if (company.includes(comp.toLowerCase())) return { disqualified: true, reason: `Competitor employee: ${comp}` };
  }

  for (const ind of (campaign.excludedIndustries || [])) {
    const headline = (lead.headline || '').toLowerCase();
    if (headline.includes(ind.toLowerCase())) return { disqualified: true, reason: `Industry excluded: ${ind}` };
  }

  for (const geo of (campaign.excludedGeographies || [])) {
    if (location.includes(geo.toLowerCase())) return { disqualified: true, reason: `Geography excluded: ${geo}` };
  }

  return { disqualified: false, reason: null };
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function checkTitleMatch(title, primaryTitles, secondaryTitles) {
  for (const t of (primaryTitles || [])) {
    if (fuzzyTitleMatch(title, t.toLowerCase())) return { primary: true, secondary: false, matched: t };
  }
  for (const t of (secondaryTitles || [])) {
    if (fuzzyTitleMatch(title, t.toLowerCase())) return { primary: false, secondary: true, matched: t };
  }
  return { primary: false, secondary: false, matched: null };
}

function fuzzyTitleMatch(title, target) {
  // 1. Exact substring match against the full target — handles short tokens
  //    like "vp", "cto", "cro" cleanly (needs word boundary so "vp" doesn't
  //    match inside "developer").
  if (target.length <= 4) {
    const re = new RegExp(`\\b${escapeRegexInline(target)}\\b`, 'i');
    return re.test(title);
  }
  if (title.includes(target)) return true;
  // 2. Multi-word target: require >=60% of long words (>2 chars) to match.
  const targetWords = target.split(/\s+/).filter(w => w.length > 2);
  if (targetWords.length === 0) return false;
  const matchCount = targetWords.filter(w => title.includes(w)).length;
  return matchCount >= Math.ceil(targetWords.length * 0.6);
}

function escapeRegexInline(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function checkSeniorityMatch(title, targetSeniority) {
  if (!targetSeniority) return null;
  const detected = detectSeniority(title);
  if (!detected) return null;
  const levels = ['C-Suite', 'VP', 'Director', 'Manager'];
  const targetIdx = levels.indexOf(targetSeniority);
  const detectedIdx = levels.indexOf(detected);
  if (targetIdx >= 0 && detectedIdx >= 0 && detectedIdx <= targetIdx) return detected;
  if (detected === targetSeniority) return detected;
  return null;
}

function detectSeniority(title) {
  for (const [level, keywords] of Object.entries(SENIORITY_MAP)) {
    if (keywords.some(k => title.includes(k))) return level;
  }
  return null;
}

function checkGeographyMatch(location, geographies) {
  if (!geographies || geographies.length === 0) return true;
  const loc = location.toLowerCase();
  for (const geo of geographies) {
    const geoLower = geo.toLowerCase().trim();
    if (loc.includes(geoLower)) return true;
    for (const [, aliases] of Object.entries(CITY_ALIASES)) {
      if (aliases.includes(geoLower) && aliases.some(a => loc.includes(a))) return true;
    }
  }
  return false;
}

module.exports = {
  matchesICP, isDisqualified, detectSeniority,
  hasPropertyRelevance, isVendorNotOperator, isCompetitorRole,
  hasCompetitorKeywords, classifyPersonaBracket,
  classifyCompanySizeTier, classifyGeographyTier, computePriority,
  applySizeConditionalRules, isIndividualContributorTitle
};
