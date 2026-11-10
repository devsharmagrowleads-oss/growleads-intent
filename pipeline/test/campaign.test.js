const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseCampaign } = require('../services/campaign');

// Writes a throwaway campaign file and returns its parsed config.
function parse(markdown) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'growleads-campaign-'));
  const file = path.join(dir, 'fake_campaign.md');
  fs.writeFileSync(file, markdown, 'utf-8');
  try {
    return parseCampaign(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('parseCampaign returns null for a missing file', () => {
  assert.strictEqual(parseCampaign(null), null);
  assert.strictEqual(parseCampaign(path.join(os.tmpdir(), 'no-such-campaign.md')), null);
});

test('parseCampaign reads scalar fields, lists and ranges', () => {
  const c = parse([
    '- **Company Name**: Example Co',
    '- **Target Industries**: SaaS, Fintech; Logistics',
    '- **Employee Range**: 11-1,000',
    '- **Minimum Employee Count**: 5',
    '- **CTA**: "Worth a quick call?"',
    ''
  ].join('\n'));

  assert.strictEqual(c.id, 'fake_campaign'); // falls back to the filename
  assert.strictEqual(c.clientName, 'Example Co');
  assert.deepStrictEqual(c.targetIndustries, ['SaaS', 'Fintech', 'Logistics']);
  assert.strictEqual(c.industry, 'SaaS');
  assert.deepStrictEqual(c.employeeRange, [11, 1000]);
  assert.strictEqual(c.minEmployees, 5);
  assert.strictEqual(c.cta, 'Worth a quick call?'); // surrounding quotes stripped
  assert.deepStrictEqual(c.personaConfig, { enabled: false });
});

test('parseCampaign reads case studies under the "Case Studies Available" header', () => {
  const c = parse([
    '- **Case Studies Available**',
    '  - Example Co grew pipeline 3x',
    '  - Sample Inc cut ramp time in half',
    '',
    '## Next Section',
    ''
  ].join('\n'));

  assert.deepStrictEqual(c.caseStudies, [
    'Example Co grew pipeline 3x',
    'Sample Inc cut ramp time in half'
  ]);
});

test('parseCampaign falls back to the short "Case Studies" header', () => {
  const c = parse([
    '- **Case Studies**',
    '  - Example Co grew pipeline 3x',
    '',
    '## Next Section',
    ''
  ].join('\n'));

  assert.deepStrictEqual(c.caseStudies, ['Example Co grew pipeline 3x']);
});
