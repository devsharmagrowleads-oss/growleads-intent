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

const {
  isDisqualified, isIndividualContributorTitle,
  classifyCompanySizeTier, computePriority
} = require('../services/filter');

test('isIndividualContributorTitle flags quota-carrying and support ICs', () => {
  for (const t of ['Enterprise Account Executive', 'SDR', 'Customer Success Manager',
                   'Solutions Engineer', 'Marketing Coordinator']) {
    assert.strictEqual(isIndividualContributorTitle(t), true, t);
  }
});

test('isIndividualContributorTitle trusts senior markers and ignores empty input', () => {
  for (const t of ['VP of Sales', 'Founder & CEO', 'Head of Customer Success', 'Director of Sales Development']) {
    assert.strictEqual(isIndividualContributorTitle(t), false, t);
  }
  assert.strictEqual(isIndividualContributorTitle(''), false);
  assert.strictEqual(isIndividualContributorTitle(null), false);
});

const cleanLead = {
  fullName: 'Test Person', currentTitle: 'CEO', headline: 'CEO at Example Corp',
  currentCompany: 'Example Corp', companyDescription: 'B2B software for logistics teams',
  location: 'Example City, Testland'
};

test('isDisqualified passes a clean lead and short-circuits without a campaign', () => {
  assert.deepStrictEqual(isDisqualified(cleanLead, {}), { disqualified: false, reason: null });
  assert.deepStrictEqual(isDisqualified({ currentTitle: 'SDR' }, null), { disqualified: false, reason: null });
});

test('isDisqualified rejects individual contributors', () => {
  const r = isDisqualified({ ...cleanLead, currentTitle: 'Account Executive' }, {});
  assert.strictEqual(r.disqualified, true);
  assert.match(r.reason, /Individual contributor/);
});

test('isDisqualified matches sales-tech brands only in the company name, word-bounded', () => {
  assert.match(isDisqualified({ ...cleanLead, currentCompany: 'Apollo.io' }, {}).reason, /Sales-tech vendor: apollo\.io/);
  // Brand listed as a tool the buyer uses: keep.
  assert.strictEqual(isDisqualified({ ...cleanLead, summary: 'Our stack: Apollo.io, Lusha' }, {}).disqualified, false);
  // Brand as a substring of an unrelated name: keep.
  assert.strictEqual(isDisqualified({ ...cleanLead, currentCompany: 'Apollohealth' }, {}).disqualified, false);
});

test('isDisqualified rejects training companies by word-bounded name token', () => {
  assert.match(isDisqualified({ ...cleanLead, currentCompany: 'Example Academy' }, {}).reason, /Training\/EdTech/);
  assert.strictEqual(isDisqualified({ ...cleanLead, currentCompany: 'Schoolhouse Labs' }, {}).disqualified, false);
});

test('isDisqualified rejects investors but keeps companies that sell to them', () => {
  const inv = isDisqualified({ ...cleanLead, companyDescription: 'We are a venture capital firm backing founders' }, {});
  assert.match(inv.reason, /Investor/);
  const vendor = isDisqualified({ ...cleanLead, companyDescription: 'Reporting software for venture capital firms' }, {});
  assert.strictEqual(vendor.disqualified, false);
});

test('isDisqualified rejects AEO/GEO sellers only on what the company sells', () => {
  assert.match(isDisqualified({ ...cleanLead, companyDescription: 'Answer engine optimization agency' }, {}).reason, /AEO\/GEO/);
  assert.strictEqual(isDisqualified({ ...cleanLead, headline: 'Curious about AI visibility' }, {}).disqualified, false);
});

test('isDisqualified applies campaign lists case-insensitively', () => {
  assert.match(isDisqualified(cleanLead, { existingClients: ['EXAMPLE CORP'] }).reason, /Existing client/);
  assert.match(isDisqualified(cleanLead, { blacklist: ['test person'] }).reason, /Blacklisted/);
  assert.match(isDisqualified(cleanLead, { roleExclusions: ['ceo'] }).reason, /Role excluded/);
  assert.match(isDisqualified(cleanLead, { competitors: ['Example'] }).reason, /Competitor employee/);
  assert.match(isDisqualified(cleanLead, { excludedGeographies: ['Testland'] }).reason, /Geography excluded/);
});

test('classifyCompanySizeTier maps headcount onto campaign tiers', () => {
  const campaign = { personaConfig: { sizeTiers: { sweet_spot: [101, 200], growth: [11, 100], scale: [201, 4999], early: [1, 10] } } };
  assert.strictEqual(classifyCompanySizeTier(150, campaign), 'sweet_spot');
  assert.strictEqual(classifyCompanySizeTier(11, campaign), 'growth');
  assert.strictEqual(classifyCompanySizeTier(4999, campaign), 'scale');
  assert.strictEqual(classifyCompanySizeTier(1, campaign), 'early');
  assert.strictEqual(classifyCompanySizeTier(9000, campaign), 'unknown');
  assert.strictEqual(classifyCompanySizeTier(undefined, campaign), 'unknown');
  assert.strictEqual(classifyCompanySizeTier(150, {}), 'unknown');
});

test('computePriority ranks direct intent and hiring first, then size x geography', () => {
  assert.strictEqual(computePriority({ directIntent: true, sizeTier: 'early', geographyTier: 'unknown' }), 'top');
  assert.strictEqual(computePriority({ hiringTopPriority: true }), 'top');
  assert.strictEqual(computePriority({ sizeTier: 'sweet_spot', geographyTier: 'priority' }), 'top');
  assert.strictEqual(computePriority({ sizeTier: 'growth', geographyTier: 'priority' }), 'high');
  assert.strictEqual(computePriority({ sizeTier: 'scale', geographyTier: 'secondary' }), 'medium');
  assert.strictEqual(computePriority({ sizeTier: 'sweet_spot', geographyTier: 'secondary' }), 'low');
  assert.strictEqual(computePriority({ sizeTier: 'unknown', geographyTier: 'unknown' }), 'low');
});
