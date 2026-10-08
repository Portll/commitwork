// monitor/test/metric-categories.test.mjs — a lane that MEASURES files nothing, at any severity
// (D4). The exclusion used to be incidental (stubs happened to emit `low`; the severity map
// defaults unrecognised values to high); the ruling makes it principled. Both directions asserted:
// a metric lane never files, and a real finding lane still does.
import test from 'node:test';
import assert from 'node:assert/strict';

import { ingestArea } from '../issue-ingest.mjs';
import { METRIC_CATEGORIES, TOTALS_EXCLUDE } from '../extractors.mjs';   // both lists, one line apart, on purpose

const NOW = '2026-08-19T11:00:00.000Z';
const ingestOne = (category, sev) => {
  const doc = { version: 1, nextOrdinal: 0, byKey: {}, events: [], issues: {}, lastIngest: {} };
  const summary = ingestArea(doc, {
    areaSlug: 'a',
    rollup: {
      sliceId: 's1', generated: '2026-08-19T10:00:00.000Z', repos: [],
      scanners: { [category]: { ran: 1 } },
      scannerFindings: { [category]: [{ repo: 'r1', marker: 'TODO', rule: 'r', file: 'a.js', line: 5, sev, message: 'x' }] },
    },
    ledger: null, annotations: [], repoPaths: {}, now: NOW, minSev: 'high', staleHours: 26,
  });
  return { issues: Object.keys(doc.issues).length, summary };
};

test('a metric lane files NOTHING at any severity — including the ones that used to slip through', () => {
  for (const sev of ['low', 'med', 'high', 'crit']) {
    const { issues } = ingestOne('stubs', sev);
    assert.equal(issues, 0, `a stubs row at sev=${sev} must not become an issue — sev=high minted one before the fix`);
  }
});

test('every declared metric lane is covered, not just stubs', () => {
  for (const cat of METRIC_CATEGORIES) {
    assert.equal(ingestOne(cat, 'crit').issues, 0, `${cat} is declared a metric lane and must file nothing`);
  }
});

test('the skip is REPORTED, not silent — a lane that files nothing must say why', () => {
  const { summary } = ingestOne('stubs', 'low');
  assert.deepEqual(summary.metricCategories, ['stubs'],
    'a silent no-op is indistinguishable from a lane that did not run');
});

test('a real finding lane is UNAFFECTED — the guard must not silence security scanners', () => {
  assert.equal(ingestOne('sastCodeql', 'high').issues, 1);
  assert.equal(ingestOne('secrets', 'crit').issues, 1);
});

test('METRIC_CATEGORIES is not TOTALS_EXCLUDE — two lists, two questions', () => {
  // TOTALS_EXCLUDE answers "does this reach the severity sum?"; METRIC_CATEGORIES answers "may an
  // agent be handed this row as work?"
  assert.equal(METRIC_CATEGORIES.has('maliciousPackages'), false,
    'maliciousPackages is a finding lane excluded from totals for de-duplication — it is not a metric');
  assert.equal(TOTALS_EXCLUDE.includes('maliciousPackages'), true, 'precondition: it IS in the other list');
  for (const cat of METRIC_CATEGORIES) {
    assert.equal(TOTALS_EXCLUDE.includes(cat), true,
      `${cat} measures rather than finds, so it must also stay out of the severity sum`);
  }
});
