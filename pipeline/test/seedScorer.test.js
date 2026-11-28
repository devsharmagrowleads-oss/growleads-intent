const test = require('node:test');
const assert = require('node:assert');

const { scoreSeedRelevance } = require('../services/seedScorer');

const campaign = {
  targetIndustries: ['Dental Clinics'],
  painKeywords: ['patient acquisition'],
  competitors: ['Example Rival Co']
};

test('seed with no company is not treated as a competitor', () => {
  for (const currentCompany of [undefined, '', '   ']) {
    const r = scoreSeedRelevance({ headline: 'Gardener', currentCompany }, [], campaign);
    assert.strictEqual(r.scores.industryFit, 0);
    assert.ok(!r.details.includes('competitor'), r.details);
  }
});

test('seed at a competitor company gets max industry fit', () => {
  const r = scoreSeedRelevance({ headline: 'Gardener', currentCompany: 'Example Rival Co' }, [], campaign);
  assert.strictEqual(r.scores.industryFit, 35);
  assert.match(r.details, /competitor: Example Rival Co/);
});

test('very short company name does not match inside competitor names', () => {
  const r = scoreSeedRelevance({ headline: 'Gardener', currentCompany: 'Co' }, [], campaign);
  assert.strictEqual(r.scores.industryFit, 0);
});

test('content fit counts only own on-topic posts', () => {
  const posts = [
    { postText: 'How dental clinics win patients' },
    { postText: 'Weekend hiking photos' },
    { postText: 'Dental clinics repost', is_repost: true }
  ];
  const r = scoreSeedRelevance({ headline: 'Gardener' }, posts, campaign);
  assert.strictEqual(r.scores.contentFit, Math.round(0.5 * 35));
});

test('empty profile and posts score irrelevant', () => {
  const r = scoreSeedRelevance({}, [], {});
  assert.strictEqual(r.relevanceScore, 0);
  assert.strictEqual(r.tier, 'irrelevant');
  assert.strictEqual(r.details, 'no posts');
});
