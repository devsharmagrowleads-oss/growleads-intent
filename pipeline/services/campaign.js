const fs = require('fs');
const path = require('path');

// Campaigns directory location — flexible so it works in:
//   - local dev (pipeline/ is a subfolder of the repo, Campaigns/ at repo root)
//   - Docker deploy (pipeline/ contents copied to /app, Campaigns/ shipped as /app/Campaigns)
//   - env override (CAMPAIGNS_DIR set explicitly)
function findCampaignsDir() {
  if (process.env.CAMPAIGNS_DIR && fs.existsSync(process.env.CAMPAIGNS_DIR)) {
    return process.env.CAMPAIGNS_DIR;
  }
  const candidates = [
    path.resolve(__dirname, '../../Campaigns'),  // local dev: repo root
    path.resolve(__dirname, '../Campaigns'),     // deploy: pipeline/Campaigns
    path.resolve(process.cwd(), 'Campaigns')     // CWD fallback
  ];
  return candidates.find(d => fs.existsSync(d)) || candidates[0];
}
const CAMPAIGNS_DIR = findCampaignsDir();
const STATE_FILE = path.resolve(__dirname, '../.active_campaign');

// Get list of available campaign files
function listCampaigns() {
  if (!fs.existsSync(CAMPAIGNS_DIR)) return [];
  return fs.readdirSync(CAMPAIGNS_DIR)
    .filter(f => f.endsWith('.md') && !f.startsWith('.'))
    .map(f => ({ filename: f, path: path.join(CAMPAIGNS_DIR, f) }));
}

// Get/set active campaign
function getActiveCampaignFile() {
  if (!fs.existsSync(STATE_FILE)) return null;
  const filename = fs.readFileSync(STATE_FILE, 'utf-8').trim();
  const fullPath = path.join(CAMPAIGNS_DIR, filename);
  if (!fs.existsSync(fullPath)) return null;
  return fullPath;
}

function setActiveCampaign(filename) {
  fs.writeFileSync(STATE_FILE, filename, 'utf-8');
}

// Parse a client.md campaign file into structured config
function parseCampaign(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf-8');

  return {
    id: extractField(content, 'Campaign ID') || path.basename(filePath, '.md'),
    clientName: extractField(content, 'Company Name'),
    offering: extractField(content, 'Product/Service Being Campaigned') || extractField(content, 'Product/Service'),
    problemSolved: extractField(content, "Problem Solved (Buyer's Language)") || extractField(content, 'Problem Solved'),
    costOfInaction: extractField(content, 'Cost of Inaction'),

    // ICP
    primaryTitles: splitList(extractField(content, 'Primary Title(s)') || extractField(content, 'Title(s)')),
    secondaryTitles: splitList(extractField(content, 'Secondary Title(s)')),
    seniorityLevel: extractField(content, 'Seniority Level') || extractField(content, 'Seniority'),
    department: extractField(content, 'Department/Function'),
    coreFrustration: extractField(content, 'Core Frustration'),

    // Target company
    targetIndustries: splitList(extractField(content, 'Target Industries') || extractField(content, 'Industries')),
    // Scalar form of the above. personalizer.js falls back to this when a seed
    // has no topic override; without it every message read "content around
    // industry insights" because campaign.industry was always undefined.
    industry: (splitList(extractField(content, 'Target Industries') || extractField(content, 'Industries'))[0]) || null,
    employeeRange: parseRange(extractField(content, 'Employee Range')),
    geographyPrimary: splitList(extractField(content, 'Geography — Primary') || extractField(content, 'Geography')),
    geographySecondary: splitList(extractField(content, 'Geography — Secondary')),
    excludedIndustries: splitList(extractField(content, 'Excluded Industries')),
    excludedGeographies: splitList(extractField(content, 'Excluded Geographies')),
    competitorSignals: parseKeywordList(content, 'Competitor Signals'),

    // Competitors
    competitors: extractCompetitors(content),

    // Disqualification
    roleExclusions: splitList(extractField(content, 'Role Exclusions')),
    minEmployees: parseInt(extractField(content, 'Minimum Employee Count')) || null,
    existingClients: splitList(extractField(content, 'Existing Client List')),
    blacklist: splitList(extractField(content, 'Blacklist')),

    // Personalization
    painKeywords: extractBulletList(content, 'Emotional Pain Points')
      .concat(extractBulletList(content, "Buyer's Language"))
      .concat(extractBulletList(content, 'Buyer\'s Language')),
    acknowledgmentPoints: extractBulletList(content, 'Acknowledgment Points'),
    // extractBulletList returns [] on no match, and [] is truthy — so `||`
    // would never reach the short-header fallback.
    caseStudies: firstNonEmpty(extractBulletList(content, 'Case Studies Available'),
                               extractBulletList(content, 'Case Studies')),

    // Scoring weights
    signalWeights: parseSignalWeights(content),

    // ICP relevance keywords:
    //   Primary  = one match is enough (preferred label)
    //   Secondary = need 2+ matches (preferred label)
    // Falls back to the legacy "Strong / Weak Signals" labels for older campaigns
    // (parseKeywordList returns [] on no match, so check length explicitly).
    icpKeywordsPrimary:   firstNonEmpty(parseKeywordList(content, 'Primary Signals'),
                                         parseKeywordList(content, 'Strong Signals')),
    icpKeywordsSecondary: firstNonEmpty(parseKeywordList(content, 'Secondary Signals'),
                                         parseKeywordList(content, 'Weak Signals')),

    // Outreach
    outreachTone: extractField(content, 'Outreach Tone') || extractField(content, 'Tone'),
    cta: extractField(content, 'CTA (Call to Action)') || extractField(content, 'CTA'),

    // Personalized Messaging (Section 12)
    messaging: parseMessaging(content),

    // Persona brackets + priority signals (Section 13) — used by Gate 2 & 3 in filter.js
    personaConfig: parsePersonaConfig(content),

    raw: content
  };
}

// Load the currently active campaign config
function getActiveCampaign() {
  const file = getActiveCampaignFile();
  if (!file) return null;
  return parseCampaign(file);
}

// --- Parsing helpers ---

// Campaign authors wrap example copy in quotes so it reads clearly in the
// markdown ("Worth a quick call?"). Those quotes are presentation, not content
// — left in place they render literally inside every outreach message.
// Handles straight and smart quotes, single and double.
function stripSurroundingQuotes(val) {
  if (!val) return val;
  let out = val.trim();
  const pairs = [['"', '"'], ["'", "'"], ['“', '”'], ['‘', '’']];
  let changed = true;
  while (changed) {
    changed = false;
    for (const [open, close] of pairs) {
      if (out.length >= 2 && out.startsWith(open) && out.endsWith(close)) {
        out = out.slice(1, -1).trim();
        changed = true;
      }
    }
  }
  return out;
}

function extractField(content, fieldName) {
  // Match: - **Field Name**: value  OR  - Field Name: value
  const patterns = [
    new RegExp(`\\*\\*${escapeRegex(fieldName)}\\*\\*:\\s*(.+)`, 'i'),
    new RegExp(`-\\s*${escapeRegex(fieldName)}:\\s*(.+)`, 'i'),
    new RegExp(`${escapeRegex(fieldName)}:\\s*(.+)`, 'i')
  ];
  for (const re of patterns) {
    const match = content.match(re);
    if (match) {
      let val = match[1].trim();
      // Strip markdown artifacts
      val = val.replace(/\[Q\d+[^\]]*\]/g, '').replace(/^\[|\]$/g, '').trim();
      val = stripSurroundingQuotes(val);
      if (val && val !== '...' && val !== '[...]' && !val.startsWith('[Q')) return val;
    }
  }
  return null;
}

function extractBulletList(content, sectionHeader) {
  const re = new RegExp(`\\*\\*${escapeRegex(sectionHeader)}\\*\\*[^\\n]*\\n([\\s\\S]*?)(?=\\n-\\s*\\*\\*|\\n##|\\n>|$)`, 'i');
  const match = content.match(re);
  if (!match) return [];
  return match[1].split('\n')
    .map(line => line.replace(/^\s*-\s*/, '').trim())
    .filter(line => line && line !== '...' && !line.startsWith('[Q') && !line.startsWith('['));
}

function splitList(val) {
  if (!val) return [];
  return val.split(/[,;]/).map(s => s.trim()).filter(s => s && s !== '...');
}

function parseRange(val) {
  if (!val) return [null, null];
  const nums = val.match(/(\d[\d,]*)/g);
  if (!nums) return [null, null];
  return [
    parseInt(nums[0].replace(/,/g, '')) || null,
    nums[1] ? parseInt(nums[1].replace(/,/g, '')) : null
  ];
}

function extractCompetitors(content) {
  // Match by section heading name, not number — works across campaigns
  const section = content.match(/## Section\s+\d+[^\n]*Competitor[^\n]*\n([\s\S]*?)(?=\n##\s)/i);
  if (!section) return [];
  const lines = section[1].split('\n');
  return lines
    .filter(l => /^\s*-\s/.test(l) && !l.includes('Indirect') && !l.includes('Do Nothing'))
    .map(l => l.replace(/^\s*-\s*/, '').replace(/\[Q\d+[^\]]*\]/g, '').trim())
    .filter(l => {
      if (!l || l === '...') return false;
      if (l.endsWith(':')) return false;
      if (/^(Direct|In-house|Fractional|Do\s)/i.test(l)) return false;
      if (/\*\*/.test(l)) return false; // skip markdown bold headers
      return true;
    });
}

function parseSignalWeights(content) {
  const weights = {};
  const weightTable = content.match(/Signal Weights[^\n]*\n[\s\S]*?\|[\s\S]*?(?=\n##|\n---|\n\n\n)/i);
  if (!weightTable) return weights;
  const rows = weightTable[0].split('\n').filter(l => l.includes('|'));
  for (const row of rows) {
    const cells = row.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length >= 2) {
      const signalMatch = cells[0].match(/S(\d{2})|Signal\s*(\d{1,2})/i);
      const weightVal = parseFloat(cells[cells.length - 2]) || parseFloat(cells[cells.length - 1]);
      if (signalMatch && weightVal) {
        const num = signalMatch[1] || signalMatch[2];
        weights[`S${num.padStart(2, '0')}`] = weightVal;
      }
    }
  }
  return weights;
}

function parseMessaging(content) {
  const defaults = {
    intentLine: '',
    statistic: '',
    portfolioNoun: '',
    companyLine: '',
    noCompanyLine: '',
    cta: '',
    seedTopics: {}
  };

  // Look for Section 12 with "Personalized Messaging" in the heading
  const sectionMatch = content.match(
    /## Section 12[^\n]*Personalized Messaging[^\n]*\n([\s\S]*?)(?=\n## Section \d|$)/i
  );
  if (!sectionMatch) return defaults;
  const section = sectionMatch[1];

  // Extract each named field from the section
  const intentLine = extractFieldFromBlock(section, 'Intent Line');
  const statistic = extractFieldFromBlock(section, 'Statistic/Insight') || extractFieldFromBlock(section, 'Statistic');
  const portfolioNoun = extractFieldFromBlock(section, 'Portfolio Noun');
  const companyLine = extractFieldFromBlock(section, 'Company Line Template') || extractFieldFromBlock(section, 'Company Line');
  const noCompanyLine = extractFieldFromBlock(section, 'No Company Fallback') || extractFieldFromBlock(section, 'No Company Line');
  const cta = extractFieldFromBlock(section, 'CTA');

  // Parse seed topic table: look for a markdown table with seed name and topic columns
  const seedTopics = {};
  const tableMatch = section.match(/\|[\s\S]*?\|[\s\S]*?(?=\n\n|\n##|\n---|\n>\s|$)/);
  if (tableMatch) {
    const rows = tableMatch[0].split('\n').filter(l => l.includes('|'));
    // Skip header row and separator row
    let dataStarted = false;
    for (const row of rows) {
      const cells = row.split('|').map(c => c.trim()).filter(Boolean);
      // Skip separator rows (e.g., |---|---|)
      if (cells.every(c => /^[-:]+$/.test(c))) {
        dataStarted = true;
        continue;
      }
      // Skip header row (first row before separator)
      if (!dataStarted) continue;
      if (cells.length >= 2) {
        const seedName = cells[0].trim();
        const topic = cells[1].trim();
        if (seedName && topic && seedName !== '...' && topic !== '...'
            && !seedName.startsWith('[') && !topic.startsWith('[')) {
          seedTopics[seedName.toLowerCase()] = topic;
        }
      }
    }
  }

  return {
    intentLine: intentLine || defaults.intentLine,
    statistic: statistic || defaults.statistic,
    portfolioNoun: portfolioNoun || defaults.portfolioNoun,
    companyLine: companyLine || defaults.companyLine,
    noCompanyLine: noCompanyLine || defaults.noCompanyLine,
    cta: cta || defaults.cta,
    seedTopics
  };
}

// Extract a field value from a block of markdown text (not the full content)
function extractFieldFromBlock(block, fieldName) {
  const escaped = escapeRegex(fieldName);
  const patterns = [
    new RegExp(`\\*\\*${escaped}\\*\\*:\\s*(.+)`, 'i'),
    new RegExp(`-\\s*\\*\\*${escaped}\\*\\*:\\s*(.+)`, 'i'),
    new RegExp(`-\\s*${escaped}:\\s*(.+)`, 'i'),
    new RegExp(`${escaped}:\\s*(.+)`, 'i')
  ];
  for (const re of patterns) {
    const match = block.match(re);
    if (match) {
      let val = match[1].trim();
      val = val.replace(/\[Q\d+[^\]]*\]/g, '').replace(/^\[|\]$/g, '').trim();
      val = stripSurroundingQuotes(val);
      if (val && val !== '...' && val !== '[...]' && !val.startsWith('[Q')) return val;
    }
  }
  return null;
}

function firstNonEmpty(...arrays) {
  for (const a of arrays) {
    if (Array.isArray(a) && a.length > 0) return a;
  }
  return [];
}

function parseKeywordList(content, label) {
  // Match `**Label**:` followed by the keyword list. Use [^:\n] so the gap
  // between label and colon cannot cross lines (prevents a stray mention of
  // the label elsewhere from absorbing a different list).
  const re = new RegExp(`\\*\\*${escapeRegex(label)}\\*\\*[^:\\n]*:\\s*(.+)`, 'i');
  const match = content.match(re);
  if (!match) return [];
  return match[1].split(',').map(s => s.trim().toLowerCase()).filter(s => s && s !== '...');
}

// Parse Section 13: Persona Brackets & Priority Signals
// Returns:
//   {
//     enabled,
//     brackets: { founder: [titles], executive: [titles], operator: [titles] },
//     sizeTiers: { sweet_spot: [101,200], growth: [11,100], scale: [201,4999], early: [1,10] },
//     hiringRegex: string,
//     enterpriseCap: number,        // Gate 1 Row 1.5
//     cacheTtlDays: number
//   }
function parsePersonaConfig(content) {
  const sectionMatch = content.match(
    /## Section 13[^\n]*\n([\s\S]*?)(?=\n## Section \d|$)/i
  );
  if (!sectionMatch) {
    return { enabled: false };
  }
  const section = sectionMatch[1];

  // Persona brackets: "**Bracket Founder**: ..." / "**Bracket Executive**: ..." / "**Bracket Operator**: ..."
  const brackets = { founder: [], executive: [], operator: [] };
  const bracketRe = /\*\*Bracket\s+(Founder|Executive|Operator)\*\*[^:]*:\s*([^\n]+)/gi;
  let m;
  while ((m = bracketRe.exec(section)) !== null) {
    const key = m[1].toLowerCase();
    brackets[key] = m[2].split(',').map(t => t.trim()).filter(Boolean);
  }

  // Size tiers: parse from the markdown lines like "- **sweet_spot**: 101–200 employees"
  // Falls back to defaults if not found.
  const sizeTiers = parseSizeTiers(section);

  // Hiring regex: first /.../i pattern under "Signal B"
  const regexMatch = section.match(/`\/([^`]+)\/i?`/);
  const hiringRegex = regexMatch
    ? regexMatch[1]
    : 'sales|sdr|bdr|account\\s*exec|cro|chief\\s*revenue|vp\\s*sales|head\\s*of\\s*sales|sales\\s*director|revenue\\s*lead|growth|seo|gtm|demand\\s*gen';

  // Enterprise cap: "≥5000 (REJECTED ...)" or "5000" near "enterprise"
  const capMatch = section.match(/[≥>=]+\s*(\d+)\s*\(?\s*REJECTED|enterprise[^:]*:\s*[≥>=]+\s*(\d+)/i);
  const enterpriseCap = capMatch ? parseInt(capMatch[1] || capMatch[2]) : 5000;

  // Cache TTL
  const ttlMatch = section.match(/Cache TTL[^:]*:\s*(\d+)\s*days?/i);
  const cacheTtlDays = ttlMatch ? parseInt(ttlMatch[1]) : 30;

  const enabled =
    brackets.founder.length > 0 ||
    brackets.executive.length > 0 ||
    brackets.operator.length > 0;

  return {
    enabled,
    brackets,
    sizeTiers,
    hiringRegex,
    enterpriseCap,
    cacheTtlDays
  };
}

function parseSizeTiers(section) {
  // Default tiers per ICP.md Gate 3 Signal A
  const defaults = {
    sweet_spot: [101, 200],
    growth: [11, 100],
    scale: [201, 4999],
    early: [1, 10]
  };
  const out = { ...defaults };
  // Match lines like "- **sweet_spot**: 101–200 employees" or "- **growth**: 11-100 employees"
  const re = /\*\*(sweet_spot|growth|scale|early)\*\*:\s*(\d+)\s*[–\-to]+\s*(\d+)/gi;
  let m;
  while ((m = re.exec(section)) !== null) {
    out[m[1].toLowerCase()] = [parseInt(m[2]), parseInt(m[3])];
  }
  return out;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  listCampaigns,
  getActiveCampaign,
  getActiveCampaignFile,
  setActiveCampaign,
  parseCampaign,
  CAMPAIGNS_DIR
};
