const test = require('node:test');
const assert = require('node:assert');

const { computeScore, getFreshnessMultiplier, getOverlapBonus, getIntentTier } = require('../services/scorer');

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY);

test('computeScore with no signals is score 0 and tier none', () => {
  assert.deepStrictEqual(computeScore([], null, null), { compositeScore: 0, intentTier: 'none' });
  assert.deepStrictEqual(computeScore(undefined), { compositeScore: 0, intentTier: 'none' });
});

test('computeScore with no signals honours custom thresholds', () => {
  const t = { high: 70, moderate: 40, low: 0 };
  assert.strictEqual(computeScore([], null, t).intentTier, 'low');
});

test('computeScore: single fresh S04 signal', () => {
  const r = computeScore([{ type: 'S04', score: 10, detectedAt: new Date() }]);
  // sqrt(10) * 10 = 31.6
  assert.deepStrictEqual(r, { compositeScore: 31.6, intentTier: 'low' });
});

test('computeScore applies overlap bonus and campaign weights', () => {
  const now = new Date();
  const signals = [
    { type: 'S04', score: 10, detectedAt: now },
    { type: 'S08', score: 10, detectedAt: now },
  ];
  // (10 + 10) * 1.3 = 26 -> sqrt * 10 = 51.0
  assert.deepStrictEqual(computeScore(signals), { compositeScore: 51, intentTier: 'moderate' });
  // S08 weighted x2: (10 + 20) * 1.3 = 39 -> 62.4
  assert.strictEqual(computeScore(signals, { S08: 2 }).compositeScore, 62.4);
});

test('computeScore caps at 100', () => {
  const now = new Date();
  const signals = ['S03', 'S04', 'S08', 'S01', 'S02'].map((type) => ({ type, score: 100, detectedAt: now }));
  assert.deepStrictEqual(computeScore(signals), { compositeScore: 100, intentTier: 'high' });
});

test('getFreshnessMultiplier decays per signal type', () => {
  assert.strictEqual(getFreshnessMultiplier(daysAgo(0), 'S08'), 1.0);
  assert.strictEqual(getFreshnessMultiplier(daysAgo(5), 'S08'), 0.4);
  assert.strictEqual(getFreshnessMultiplier(daysAgo(60), 'S08'), 0.1);

  assert.strictEqual(getFreshnessMultiplier(daysAgo(10), 'S04'), 0.5);
  assert.strictEqual(getFreshnessMultiplier(daysAgo(31), 'S04'), 0);

  assert.strictEqual(getFreshnessMultiplier(daysAgo(30), 'S03'), 0.5);
  assert.strictEqual(getFreshnessMultiplier(daysAgo(91), 'S03'), 0);
});

test('getOverlapBonus grows with distinct signal count', () => {
  assert.deepStrictEqual([0, 1, 2, 3, 4, 5, 7].map(getOverlapBonus), [1.0, 1.0, 1.3, 1.7, 2.2, 3.0, 3.0]);
});

test('getIntentTier uses default and custom thresholds', () => {
  assert.strictEqual(getIntentTier(70), 'high');
  assert.strictEqual(getIntentTier(40), 'moderate');
  assert.strictEqual(getIntentTier(15), 'low');
  assert.strictEqual(getIntentTier(14.9), 'none');
  assert.strictEqual(getIntentTier(50, { high: 50, moderate: 30, low: 10 }), 'high');
});
