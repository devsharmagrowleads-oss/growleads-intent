const test = require('node:test');
const assert = require('node:assert');

const {
  cleanCompanyName, getGeoPair, getSeedTopic, buildPersonalizedMessage,
  generatePersonalizationNotes, recommendAngle,
} = require('../services/personalizer');

// ─── cleanCompanyName ────────────────────────────────────────────────────────

test('cleanCompanyName strips common legal suffixes', () => {
  assert.strictEqual(cleanCompanyName('Acme Inc.'), 'Acme');
  assert.strictEqual(cleanCompanyName('Acme Corp'), 'Acme');
  assert.strictEqual(cleanCompanyName('Acme LLC'), 'Acme');
  assert.strictEqual(cleanCompanyName('Acme Ltd'), 'Acme');
  assert.strictEqual(cleanCompanyName('Acme GmbH'), 'Acme');
  assert.strictEqual(cleanCompanyName('Acme Pvt Ltd'), 'Acme');
  assert.strictEqual(cleanCompanyName('Acme Pty Ltd'), 'Acme');
  assert.strictEqual(cleanCompanyName('Acme SE'), 'Acme');
  assert.strictEqual(cleanCompanyName('Acme AB'), 'Acme');
  assert.strictEqual(cleanCompanyName('Acme AG'), 'Acme');
  assert.strictEqual(cleanCompanyName('Acme PLC'), 'Acme');
  assert.strictEqual(cleanCompanyName('Acme SAS'), 'Acme');
  assert.strictEqual(cleanCompanyName('Acme OY'), 'Acme');
  assert.strictEqual(cleanCompanyName('Acme ApS'), 'Acme');
});

test('cleanCompanyName strips suffixes with comma/period separators', () => {
  assert.strictEqual(cleanCompanyName('Acme, Inc.'), 'Acme');
  assert.strictEqual(cleanCompanyName('Acme, LLC'), 'Acme');
  assert.strictEqual(cleanCompanyName('Acme. Ltd.'), 'Acme');
});

test('cleanCompanyName handles stacked suffixes', () => {
  assert.strictEqual(cleanCompanyName('Acme Pty Ltd Inc'), 'Acme');
});

test('cleanCompanyName does not truncate names ending with suffix-like letters', () => {
  assert.strictEqual(cleanCompanyName('Moose'), 'Moose');
  assert.strictEqual(cleanCompanyName('Goose'), 'Goose');
  assert.strictEqual(cleanCompanyName('Grab'), 'Grab');
  assert.strictEqual(cleanCompanyName('REHAB'), 'REHAB');
  assert.strictEqual(cleanCompanyName('JOY'), 'JOY');
  assert.strictEqual(cleanCompanyName('FLAG'), 'FLAG');
});

test('cleanCompanyName returns empty string on falsy input', () => {
  assert.strictEqual(cleanCompanyName(''), '');
  assert.strictEqual(cleanCompanyName(null), '');
  assert.strictEqual(cleanCompanyName(undefined), '');
});

test('cleanCompanyName preserves names without suffixes', () => {
  assert.strictEqual(cleanCompanyName('Acme'), 'Acme');
  assert.strictEqual(cleanCompanyName('Big Red Corp.'), 'Big Red');
});

// ─── getGeoPair ──────────────────────────────────────────────────────────────

test('getGeoPair resolves US locations', () => {
  assert.strictEqual(getGeoPair('San Francisco, California'), 'US/UK');
  assert.strictEqual(getGeoPair('New York, United States'), 'US/UK');
});

test('getGeoPair resolves UK locations', () => {
  assert.strictEqual(getGeoPair('London, England'), 'UK/EU');
  assert.strictEqual(getGeoPair('Manchester, United Kingdom'), 'UK/EU');
});

test('getGeoPair resolves Australian locations', () => {
  assert.strictEqual(getGeoPair('Sydney, Australia'), 'AU/UK');
  assert.strictEqual(getGeoPair('Melbourne, VIC'), 'AU/UK');
});

test('getGeoPair resolves EU locations', () => {
  assert.strictEqual(getGeoPair('Berlin, Germany'), 'EU/UK');
  assert.strictEqual(getGeoPair('Paris, France'), 'EU/UK');
});

test('getGeoPair resolves APAC locations', () => {
  assert.strictEqual(getGeoPair('Mumbai, India'), 'APAC/UK');
  assert.strictEqual(getGeoPair('Singapore'), 'APAC/UK');
});

test('getGeoPair defaults to US/UK for unknown or empty location', () => {
  assert.strictEqual(getGeoPair('Unknown Place'), 'US/UK');
  assert.strictEqual(getGeoPair(''), 'US/UK');
  assert.strictEqual(getGeoPair(null), 'US/UK');
});

// ─── getSeedTopic ────────────────────────────────────────────────────────────

test('getSeedTopic returns campaign industry as default', () => {
  assert.strictEqual(getSeedTopic('Unknown Person', { industry: 'B2B SaaS' }), 'B2B SaaS');
});

test('getSeedTopic returns fallback string when no campaign', () => {
  assert.strictEqual(getSeedTopic('', null), 'industry insights');
  assert.strictEqual(getSeedTopic(null, null), 'industry insights');
});

test('getSeedTopic matches seed topic from campaign config (case-insensitive)', () => {
  const campaign = {
    messaging: { seedTopics: { 'john doe': 'outbound sales strategies' } }
  };
  assert.strictEqual(getSeedTopic('John Doe', campaign), 'outbound sales strategies');
});

test('getSeedTopic matches by first name when full name is a key', () => {
  const campaign = {
    messaging: { seedTopics: { 'Jane Smith': 'demand gen tactics' } }
  };
  assert.strictEqual(getSeedTopic('Jane', campaign), 'demand gen tactics');
});

// ─── buildPersonalizedMessage ────────────────────────────────────────────────

test('buildPersonalizedMessage returns null for missing lead or campaign', () => {
  assert.strictEqual(buildPersonalizedMessage(null, { messaging: {} }), null);
  assert.strictEqual(buildPersonalizedMessage({}, null), null);
});

test('buildPersonalizedMessage returns null when lead has no name', () => {
  assert.strictEqual(buildPersonalizedMessage({ currentCompany: 'Test' }, { messaging: {} }), null);
});

test('buildPersonalizedMessage includes lead name, seed, company, and geo', () => {
  const lead = {
    firstName: 'Jane',
    seedSourceName: 'Bob Smith',
    currentCompany: 'Acme Inc.',
    location: 'London, UK',
  };
  const campaign = {
    industry: 'B2B SaaS',
    messaging: {
      intentLine: 'Most teams miss this.',
      statistic: '70% of teams miss quota.',
      portfolioNoun: 'agencies',
      companyLine: 'I can show {company} how.',
      noCompanyLine: 'I can show you how.',
      cta: 'Worth a quick chat?',
      seedTopics: {},
    },
  };
  const msg = buildPersonalizedMessage(lead, campaign);
  assert.ok(msg.includes('Hey Jane,'));
  assert.ok(msg.includes("Bob's content"));
  assert.ok(msg.includes('Acme'));
  assert.ok(!msg.includes('Inc'), 'company suffix should be stripped');
  assert.ok(msg.includes('UK/EU'));
  assert.ok(msg.includes('Worth a quick chat?'));
});

test('buildPersonalizedMessage omits seed name when absent', () => {
  const lead = { firstName: 'Jane', currentCompany: 'Test Co', location: 'NYC' };
  const campaign = { messaging: { cta: 'Chat?' } };
  const msg = buildPersonalizedMessage(lead, campaign);
  assert.ok(msg.includes('Saw you engaging with content around'));
  assert.ok(!msg.includes("'s content"));
});

// ─── recommendAngle ──────────────────────────────────────────────────────────

test('recommendAngle returns direct value when no signals', () => {
  assert.ok(recommendAngle([], null).includes('Direct Value'));
  assert.ok(recommendAngle(null, null).includes('Direct Value'));
});

test('recommendAngle picks pain angle for S08 signal', () => {
  assert.ok(recommendAngle([{ type: 'S08' }], null).includes('Pain'));
});

test('recommendAngle picks thought leadership for S03 signal', () => {
  assert.ok(recommendAngle([{ type: 'S03' }], null).includes('Thought Leadership'));
});
