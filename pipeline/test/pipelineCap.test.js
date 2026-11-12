const test = require('node:test');
const assert = require('node:assert');

const { decideCapAction, normalizeCompanyKey, scoreForCap } = require('../services/pipelineCap');

function lead(id, personaBracket, priority, createdAt) {
  return { _id: id, fullName: `Fake Lead ${id}`, personaBracket, priority, createdAt };
}

test('normalizeCompanyKey strips legal suffixes and punctuation', () => {
  assert.strictEqual(normalizeCompanyKey('Acme Inc.'), 'acme');
  assert.strictEqual(normalizeCompanyKey('ACME Pvt Ltd'), 'acme');
  assert.strictEqual(normalizeCompanyKey('Acme'), 'acme');
  assert.strictEqual(normalizeCompanyKey(''), '');
  assert.strictEqual(normalizeCompanyKey(null), '');
});

test('scoreForCap ranks bracket above priority above recency', () => {
  const founderLow = scoreForCap(lead(1, 'founder', 'low', '2020-01-01T00:00:00Z'));
  const execTop = scoreForCap(lead(2, 'executive', 'top', '2026-01-01T00:00:00Z'));
  const execHighNew = scoreForCap(lead(3, 'executive', 'high', '2026-01-01T00:00:00Z'));
  const execTopOld = scoreForCap(lead(4, 'executive', 'top', '2020-01-01T00:00:00Z'));
  assert.ok(founderLow > execTop);
  assert.ok(execTopOld > execHighNew);
});

test('scoreForCap uses recency as a tiebreaker (newest wins)', () => {
  const older = scoreForCap(lead(1, 'founder', 'high', '2026-01-01T00:00:00Z'));
  const newer = scoreForCap(lead(2, 'founder', 'high', '2026-01-01T00:01:00Z'));
  assert.ok(newer > older);
});

test('scoreForCap tolerates an unparseable createdAt', () => {
  const score = scoreForCap(lead(1, 'founder', 'high', 'not-a-date'));
  assert.strictEqual(score, 3030);
});

test('decideCapAction allows while under the cap', () => {
  const decision = decideCapAction(lead(9, 'operator', 'low'), [lead(1, 'founder', 'top')], 2);
  assert.strictEqual(decision.action, 'allow');
  assert.strictEqual(decision.displaceId, null);
});

test('decideCapAction displaces the worst existing lead for a better one', () => {
  const existing = [
    lead(1, 'founder', 'top', '2026-01-01T00:00:00Z'),
    lead(2, 'operator', 'low', '2026-01-02T00:00:00Z'),
  ];
  const decision = decideCapAction(lead(9, 'executive', 'high', '2026-01-03T00:00:00Z'), existing, 2);
  assert.strictEqual(decision.action, 'displace');
  assert.strictEqual(decision.displaceId, 2);
});

test('decideCapAction rejects a new lead that ranks below both existing', () => {
  const existing = [
    lead(1, 'founder', 'top', '2026-01-01T00:00:00Z'),
    lead(2, 'executive', 'high', '2026-01-02T00:00:00Z'),
  ];
  const decision = decideCapAction(lead(9, 'operator', 'top', '2026-01-03T00:00:00Z'), existing, 2);
  assert.strictEqual(decision.action, 'reject');
  assert.strictEqual(decision.displaceId, null);
});

test('decideCapAction breaks a bracket/priority tie by recency', () => {
  const existing = [
    lead(1, 'founder', 'high', '2026-01-05T00:00:00Z'),
    lead(2, 'founder', 'high', '2026-01-01T00:00:00Z'),
  ];
  const newer = decideCapAction(lead(9, 'founder', 'high', '2026-01-10T00:00:00Z'), existing, 2);
  assert.strictEqual(newer.action, 'displace');
  assert.strictEqual(newer.displaceId, 2);

  const older = decideCapAction(lead(9, 'founder', 'high', '2025-12-01T00:00:00Z'), existing, 2);
  assert.strictEqual(older.action, 'reject');
});
