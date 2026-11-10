// Gate 0 — Direct Intent Detection
//
// Two-stage detector on Seed-post comment text:
//   1. Comment regex scan (free, runs first on every comment)
//   2. If regex hits, send the comment to GPT-4o-mini to classify as
//      direct_intent | engagement | other
//
// Detection cost: $0 for comments that don't match the regex (most comments).
// ~$0.001 per ambiguous comment that goes to the AI step. See /ICP.md Gate 0.
//
// Returns:
//   {
//     directIntent: boolean,
//     source: 'regex-no-match' | 'ai' | 'regex-fallback' | 'no-ai-key' | null,
//     matchedPhrase: string | null,
//     aiVerdict: 'direct_intent' | 'engagement' | 'other' | null,
//     error: string | null
//   }

const axios = require('axios');

// Patterns that indicate the commenter is asking about / claiming / buying a service.
// Lowercased text is matched. Any single match triggers AI verification.
const INTENT_PATTERNS = [
  /\binterested\b/,
  /\bdm\s+me\b/,
  /\bhow\s+(do\s+i|to)\s+(sign\s*up|buy|get\s+started|book|schedule)/,
  /\b(pricing|cost|how\s+much|quote|rate\s+card)\b/,
  /\b(we|i|our\s+team)\s+(need|want|are\s+looking\s+for)/,
  /\b(hiring|building|need)\s+(an?\s+)?(outbound|sdr|gtm|growth|seo|agency|partner|service)/,
  /\banyone\s+know\s+(a|an|good|reliable)/,
  /\breach\s+out/,
  /\bcan\s+(you|we)\s+(help|chat|talk|connect)/,
  /\blet\s*'?s\s+(talk|chat|connect)/,
  /\bship\s+me\s+(a\s+)?(quote|pricing)/,
  /\bsend\s+me\s+(a\s+)?(quote|pricing|info|details)/,
];

const SYSTEM_PROMPT = `You are classifying LinkedIn comments left on a content creator's post about B2B lead generation, outbound sales, agency services, or growth.

Classify the comment as exactly one of:
- direct_intent: the commenter explicitly wants to buy / inquire about / claim a service. They are looking for an agency, asking for pricing, requesting a DM, hiring for a relevant role, or expressing concrete buying intent.
- engagement: the commenter is responding to the content (compliment, question about the topic, sharing their experience, agreement, debate) but NOT looking to engage commercially.
- other: off-topic, spam, tagging without context, or unclear.

Respond with EXACTLY one word on its own line: direct_intent, engagement, or other.`;

async function classifyWithOpenAI(commentText) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  const { data } = await axios.post('https://api.openai.com/v1/chat/completions', {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `COMMENT:\n${commentText.slice(0, 1500)}` }
    ],
    max_tokens: 6,
    temperature: 0
  }, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    timeout: 12000
  });

  const raw = (data.choices?.[0]?.message?.content || '').trim().toLowerCase();
  if (raw.startsWith('direct')) return 'direct_intent';
  if (raw.startsWith('engagement')) return 'engagement';
  return 'other';
}

async function detectDirectIntent(commentText) {
  if (!commentText || typeof commentText !== 'string') {
    return { directIntent: false, source: null, matchedPhrase: null, aiVerdict: null, error: null };
  }

  const text = commentText.toLowerCase();
  const matched = INTENT_PATTERNS.find(p => p.test(text));
  if (!matched) {
    return { directIntent: false, source: 'regex-no-match', matchedPhrase: null, aiVerdict: null, error: null };
  }
  const matchedPhrase = (text.match(matched) || [])[0] || null;

  // Regex hit → ask AI
  if (!process.env.OPENAI_API_KEY) {
    // No AI key — fall back to regex result. Less accurate but functional.
    return { directIntent: true, source: 'no-ai-key', matchedPhrase, aiVerdict: null, error: null };
  }

  try {
    const verdict = await classifyWithOpenAI(commentText);
    return {
      directIntent: verdict === 'direct_intent',
      source: 'ai',
      matchedPhrase,
      aiVerdict: verdict,
      error: null
    };
  } catch (err) {
    // AI failed — fall back to regex result, log error.
    return {
      directIntent: true,
      source: 'regex-fallback',
      matchedPhrase,
      aiVerdict: null,
      error: err.message
    };
  }
}

module.exports = {
  detectDirectIntent,
  // Exposed for tests and tuning:
  INTENT_PATTERNS,
  SYSTEM_PROMPT
};
