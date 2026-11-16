const test = require('node:test');
const assert = require('node:assert');

const { detectSeniority, matchesICP } = require('../services/filter');

test('detectSeniority does not read "cto" inside "director"', () => {
  assert.strictEqual(detectSeniority('director of marketing'), 'Director');
  assert.strictEqual(detectSeniority('Sales Director'), 'Director');
});

test('detectSeniority matches whole-word keywords per level', () => {
  assert.strictEqual(detectSeniority('ceo & co-founder'), 'C-Suite');
  assert.strictEqual(detectSeniority('cto'), 'C-Suite');
  assert.strictEqual(detectSeniority('vp, growth'), 'VP');
  assert.strictEqual(detectSeniority('head of sales'), 'Director');
  assert.strictEqual(detectSeniority('team leader'), 'Manager');
  assert.strictEqual(detectSeniority('marketing manager'), 'Manager');
  assert.strictEqual(detectSeniority('developer'), null);
  assert.strictEqual(detectSeniority(''), null);
});

test('matchesICP gives no seniority bonus to a Director when targeting VP', () => {
  const campaign = { icpKeywordsPrimary: ['saas'], seniorityLevel: 'VP' };
  const lead = { currentTitle: 'Director of Marketing', headline: 'SaaS marketing', location: 'Example City' };
  const r = matchesICP(lead, campaign);
  assert.strictEqual(r.seniorityMatch, false);
});
