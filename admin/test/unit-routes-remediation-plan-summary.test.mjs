// Parses a remediation plan markdown string into structured summary counts (admin/routes/remediation.mjs planSummary).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSummary } from '../routes/remediation.mjs';

test('returns parsed false when section headings are missing', () => {
  const md = '## Some other section\n| `pkg` |';
  const r = planSummary(md);
  assert.deepEqual(r, { parsed: false, why: "the plan does not carry the rollup's section headings \u2014 its item count is unknown, not zero" });
});

test('returns parsed false when only one section heading is present', () => {
  const md = '## Critical / High / Medium \u2014 2 packages, 5 findings\n| `a` |';
  const r = planSummary(md);
  assert.equal(r.parsed, false);
});

test('parses a complete plan with all sections and headline', () => {
  const md = [
    '**Headline:** 1 critical \u00b7 2 high \u00b7 3 medium \u00b7 4 low \u00b7 **5 on CISA KEV**',
    'Generated 2024-01-15 from scan',
    '## Critical / High / Medium \u2014 2 packages, 5 findings',
    '| `pkg-a` |',
    '## Low severity \u2014 1 package, 3 findings',
    '| `pkg-b` |',
    '## \ud83d\udea8 KEV',
    '| `pkg-a` |',
    '| `pkg-c` |',
    '## Next',
  ].join('\n');
  const r = planSummary(md);
  assert.equal(r.parsed, true);
  assert.equal(r.generated, '2024-01-15');
  assert.equal(r.packages, 3);
  assert.equal(r.findings, 8);
  assert.deepEqual(r.main, { packages: 2, findings: 5 });
  assert.deepEqual(r.low, { packages: 1, findings: 3 });
  assert.equal(r.kevPackages, 2);
  assert.deepEqual(r.headline, { crit: 1, high: 2, med: 3, low: 4, kev: 5 });
});

test('returns null headline and generated when those lines are absent', () => {
  const md = [
    '## Critical / High / Medium \u2014 1 package, 2 findings',
    '## Low severity \u2014 1 package, 1 finding',
  ].join('\n');
  const r = planSummary(md);
  assert.equal(r.parsed, true);
  assert.equal(r.generated, null);
  assert.equal(r.headline, null);
  assert.equal(r.kevPackages, 0);
  assert.equal(r.packages, 2);
  assert.equal(r.findings, 3);
});

test('counts zero KEV packages when section exists but has no table rows', () => {
  const md = [
    '## Critical / High / Medium \u2014 1 package, 1 finding',
    '## Low severity \u2014 1 package, 1 finding',
    '## \ud83d\udea8 KEV',
    'no rows here',
    '## Next',
  ].join('\n');
  const r = planSummary(md);
  assert.equal(r.kevPackages, 0);
});

test('stops counting KEV rows at the next section heading', () => {
  const md = [
    '## Critical / High / Medium \u2014 1 package, 1 finding',
    '## Low severity \u2014 1 package, 1 finding',
    '## \ud83d\udea8 KEV',
    '| `a` |',
    '| `b` |',
    '## Other',
    '| `c` |',
  ].join('\n');
  const r = planSummary(md);
  assert.equal(r.kevPackages, 2);
});

test('handles singular package and finding words in headings', () => {
  const md = [
    '## Critical / High / Medium \u2014 1 package, 1 finding',
    '## Low severity \u2014 1 package, 1 finding',
  ].join('\n');
  const r = planSummary(md);
  assert.equal(r.parsed, true);
  assert.equal(r.packages, 2);
  assert.equal(r.findings, 2);
});

test('returns parsed false for empty input', () => {
  const r = planSummary('');
  assert.equal(r.parsed, false);
});

test('returns parsed false for null input', () => {
  const r = planSummary(null);
  assert.equal(r.parsed, false);
});
