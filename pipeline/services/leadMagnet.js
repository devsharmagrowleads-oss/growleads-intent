// ─── LEAD-MAGNET DETECTION (Gate 0.0, deterministic) ─────────────────────────
//
// Seeds routinely post giveaways: "comment CODE and I'll DM you the playbook".
// The engagers are freebie hunters, not buyers. In the 2026-07 audit, 27 of the
// 84 comment-sourced leads had the literal comment "code", 10 said "claude",
// and 6 said "framework". Every one of them was scored 6/10 by the engagement
// classifier ("general comment") and admitted to the pipeline.
//
// This module replaces the GPT-4o-mini post-relevance call for the giveaway
// case: no AI is needed to notice that a post says "comment CODE below".

// Tokens people are asked to type. Not exhaustive by design — the single-word
// heuristic below catches the long tail (custom codes like "GTMNORTH").
const MAGNET_TOKENS = new Set([
  'code', 'claude', 'framework', 'guide', 'playbook', 'template', 'templates',
  'blueprint', 'checklist', 'cheatsheet', 'ebook', 'book', 'list', 'info',
  'interested', 'yes', 'please', 'send', 'me', 'want', 'need', 'link',
  'access', 'copy', 'details', 'more', 'demo', 'free', 'gimme', 'dm',
]);

// Post-side: the seed is soliciting a keyword comment.
const MAGNET_POST_PATTERNS = [
  /comment\s+["“'‘]?[\w-]{2,20}["”'’]?\s*(below|and|,|\.|$)/i,
  /drop\s+(a\s+|the\s+)?["“'‘]?[\w-]{2,20}["”'’]?\s+(below|in\s+the\s+comments)/i,
  /type\s+["“'‘]?[\w-]{2,20}["”'’]?\s+(below|and|in\s+the\s+comments)/i,
  /comment\s+the\s+word/i,
  /(i['’]?ll|will)\s+(dm|send|share)\s+(it|you|the|a)\b/i,
  /leave\s+a\s+comment\s+(below\s+)?and\s+i/i,
  /want\s+(the|my|a)\s+[\w\s-]{2,30}\?\s*(comment|drop|type)/i,
];

// Strip emoji, punctuation, zero-width chars; collapse whitespace.
function normalize(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, ' ')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// True when the post is asking readers to comment a keyword to receive something.
function isLeadMagnetPost(postText) {
  if (!postText || typeof postText !== 'string') return false;
  return MAGNET_POST_PATTERNS.some((re) => re.test(postText));
}

// True when a comment carries no buying signal: a bare keyword drop.
//
// A single-word comment is treated as a magnet grab regardless of the word.
// That intentionally also catches "Congrats!" and "🔥" — neither is a buying
// signal, and both were scoring 6/10 before this existed.
//
// Two- and three-word comments only trip the check when every word is a known
// magnet token ("send me", "yes please", "very interested"), so genuine short
// replies like "so true" or "great point" still pass through to the normal
// engagement classifier, which scores them 5.
// Placeholders the pipeline itself writes when a comment carried no text.
// They are not comments and must never be scored as one.
const PLACEHOLDERS = new Set(['commented on post', 'commented', 'reacted to post']);

function isLeadMagnetComment(commentText) {
  if (!commentText || typeof commentText !== 'string' || !commentText.trim()) return false;

  const t = normalize(commentText);
  if (PLACEHOLDERS.has(t)) return true;
  // Normalizing to nothing means the comment was only emoji or punctuation
  // ("🔥", "👏👏", "+1"). No words, no signal.
  if (!t) return true;

  const words = t.split(' ').filter(Boolean);
  if (words.length === 1) return true;
  if (words.length <= 3 && words.every((w) => MAGNET_TOKENS.has(w))) return true;

  return false;
}

// Combined verdict for one engager on one post. Returns null when the engager
// looks legitimate, or a reason string when they should be dropped.
function checkLeadMagnet({ commentText, postText, engagementType }) {
  // Reactions carry no text, so they cannot be magnet grabs. They are weak
  // signals but they are not noise in the same way.
  if (engagementType === 'reaction') return null;

  if (isLeadMagnetComment(commentText)) {
    const t = normalize(commentText);
    if (isLeadMagnetPost(postText)) {
      return `Lead-magnet giveaway: commented "${t}" on a keyword-solicitation post`;
    }
    return `Low-intent comment: "${t}" carries no buying signal`;
  }
  return null;
}

module.exports = {
  isLeadMagnetPost,
  isLeadMagnetComment,
  checkLeadMagnet,
  normalize,
};
