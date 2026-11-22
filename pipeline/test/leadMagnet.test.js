const test = require('node:test');
const assert = require('node:assert');

const {
  normalize,
  isLeadMagnetPost,
  isLeadMagnetComment,
  checkLeadMagnet,
} = require('../services/leadMagnet');

test('normalize strips emoji and punctuation, lowercases, collapses whitespace', () => {
  assert.strictEqual(normalize('  Send   ME!! 🔥🔥 '), 'send me');
  assert.strictEqual(normalize("Don't-stop"), "don't-stop");
  assert.strictEqual(normalize('👏👏'), '');
});

test('normalize returns empty string for non-string input', () => {
  assert.strictEqual(normalize(null), '');
  assert.strictEqual(normalize(undefined), '');
  assert.strictEqual(normalize(42), '');
});

test('isLeadMagnetComment: single-word comments are magnet grabs', () => {
  assert.strictEqual(isLeadMagnetComment('CODE'), true);
  assert.strictEqual(isLeadMagnetComment('Congrats!'), true);
  assert.strictEqual(isLeadMagnetComment('GTMNORTH'), true);
});

test('isLeadMagnetComment: emoji- or punctuation-only comments are noise', () => {
  assert.strictEqual(isLeadMagnetComment('🔥'), true);
  assert.strictEqual(isLeadMagnetComment('👏👏'), true);
  assert.strictEqual(isLeadMagnetComment('!!!'), true);
});

test('isLeadMagnetComment: pipeline placeholders are treated as noise', () => {
  assert.strictEqual(isLeadMagnetComment('Commented on post'), true);
  assert.strictEqual(isLeadMagnetComment('reacted to post'), true);
});

test('isLeadMagnetComment: short phrases made only of magnet tokens', () => {
  assert.strictEqual(isLeadMagnetComment('Send me'), true);
  assert.strictEqual(isLeadMagnetComment('yes please!'), true);
  assert.strictEqual(isLeadMagnetComment('Interested, send link'), true);
});

test('isLeadMagnetComment: genuine short replies pass through', () => {
  assert.strictEqual(isLeadMagnetComment('so true'), false);
  assert.strictEqual(isLeadMagnetComment('great point here'), false);
  // Four magnet tokens exceeds the three-word limit.
  assert.strictEqual(isLeadMagnetComment('yes please send me'), false);
  assert.strictEqual(
    isLeadMagnetComment('We tried this at our company and the reply rate doubled.'),
    false,
  );
});

test('isLeadMagnetComment: empty or non-string input is not a magnet', () => {
  assert.strictEqual(isLeadMagnetComment(''), false);
  assert.strictEqual(isLeadMagnetComment('   '), false);
  assert.strictEqual(isLeadMagnetComment(null), false);
  assert.strictEqual(isLeadMagnetComment(undefined), false);
});

test('isLeadMagnetPost detects keyword-solicitation posts', () => {
  assert.strictEqual(isLeadMagnetPost('Comment "PLAYBOOK" below and I will send it over.'), true);
  assert.strictEqual(isLeadMagnetPost('Drop a GUIDE in the comments to get it.'), true);
  assert.strictEqual(isLeadMagnetPost('Type CODE below and get access.'), true);
  assert.strictEqual(isLeadMagnetPost('Comment the word "template".'), true);
  assert.strictEqual(isLeadMagnetPost("Like this post and I'll DM you the file."), true);
  assert.strictEqual(isLeadMagnetPost('Want the full checklist? Comment YES.'), true);
});

test('isLeadMagnetPost ignores ordinary posts and bad input', () => {
  assert.strictEqual(isLeadMagnetPost('Three lessons from scaling our sales team last year.'), false);
  assert.strictEqual(isLeadMagnetPost(''), false);
  assert.strictEqual(isLeadMagnetPost(null), false);
  assert.strictEqual(isLeadMagnetPost({ text: 'comment CODE below' }), false);
});

test('checkLeadMagnet never flags reactions', () => {
  assert.strictEqual(
    checkLeadMagnet({ commentText: 'code', postText: 'Comment CODE below', engagementType: 'reaction' }),
    null,
  );
});

test('checkLeadMagnet labels a giveaway grab on a solicitation post', () => {
  const r = checkLeadMagnet({
    commentText: 'CODE 🔥',
    postText: 'Comment CODE below and I will DM you the playbook.',
    engagementType: 'comment',
  });
  assert.strictEqual(r, 'Lead-magnet giveaway: commented "code" on a keyword-solicitation post');
});

test('checkLeadMagnet labels a low-intent comment on an ordinary post', () => {
  const r = checkLeadMagnet({
    commentText: 'Congrats!',
    postText: 'We just closed our seed round.',
    engagementType: 'comment',
  });
  assert.strictEqual(r, 'Low-intent comment: "congrats" carries no buying signal');
});

test('checkLeadMagnet passes substantive comments', () => {
  const r = checkLeadMagnet({
    commentText: 'How did you handle deliverability when volume went up?',
    postText: 'Comment CODE below and I will DM you the playbook.',
    engagementType: 'comment',
  });
  assert.strictEqual(r, null);
});
