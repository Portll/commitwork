// monitor/exposure-verdict.mjs — the honesty rules of the exposure view. The question every test
// asks: can a green be produced by data that never measured anything. The client-d row (noscan:1,
// worst:'na', empty findings) once rendered a confident green for two public hostnames.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exposureVerdict, repoDidNotScan, NOT_A_CLEAN_RESULT, isConfidentClean } from '../exposure-verdict.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = join(HERE, '..', '..');

const scanned = (over = {}) => ({ name: 'r', findings: [], worst: 'none', ...over });
const unscanned = (over = {}) => ({ name: 'r', findings: [], worst: 'na', noscan: 1, ...over });
const none = { crit: 0, high: 0, med: 0, low: 0, kev: 0 };

// ── rule 3: silence is only clean if something looked ────────────────────────────────────────

test('THE REGRESSION: a rollup whose only repo did not scan is never "none"', () => {
  // This is the client-d row, reduced to its essentials. Before rules 3 and 4 this returned 'none'.
  const v = exposureVerdict({ findings: none, repos: [unscanned({ name: 'client-d' })], ageHours: 2 });
  assert.notEqual(v.worst, 'none', 'an unscanned repo must never produce a clean verdict');
  assert.equal(v.worst, 'not-scanned');
  assert.equal(v.scannedRepos, 0);
  assert.match(v.verdictBasis, /no repo in this area was scanned/);
});

test('both noscan signals count — `noscan` and `worst:"na"` independently', () => {
  // the rollup writers disagree about which field records "did not run"
  assert.equal(repoDidNotScan({ noscan: 1 }), true);
  assert.equal(repoDidNotScan({ worst: 'na' }), true);
  assert.equal(repoDidNotScan({ noscan: 0, worst: 'none' }), false);
  for (const repo of [{ noscan: 1, findings: [] }, { worst: 'na', findings: [] }]) {
    assert.notEqual(exposureVerdict({ findings: none, repos: [repo], ageHours: 1 }).worst, 'none');
  }
});

test('a partially-scanned area is "partial", not clean and not not-scanned', () => {
  const v = exposureVerdict({ findings: none, repos: [scanned(), scanned(), unscanned()], ageHours: 1 });
  assert.equal(v.worst, 'partial');
  assert.equal(v.noscanRepos, 1);
  assert.equal(v.scannedRepos, 2);
  assert.match(v.verdictBasis, /1 of 3/);
});

test('an empty repo list is not-scanned, never clean', () => {
  assert.equal(exposureVerdict({ findings: none, repos: [], ageHours: 1 }).worst, 'not-scanned');
});

// ── rule 4: age invalidates an absence, never a finding ──────────────────────────────────────

test('a stale scan with no findings is "stale" — absence decays', () => {
  const v = exposureVerdict({ findings: none, repos: [scanned()], ageHours: 96 });
  assert.equal(v.worst, 'stale');
  assert.match(v.verdictBasis, /96h old/);
});

test('a stale scan WITH findings still reports the findings — a vulnerability does not decay', () => {
  // the asymmetry is the point — downgrading findings to "stale" would HIDE them
  const v = exposureVerdict({ findings: { ...none, high: 3 }, repos: [scanned()], ageHours: 96 });
  assert.equal(v.worst, 'high');
  assert.match(v.verdictBasis, /3 high/);
  assert.match(v.verdictBasis, /96h old/, 'the age must still qualify the number');
});

test('an undateable rollup is stale, not fresh — unknown age is not recency', () => {
  const v = exposureVerdict({ findings: none, repos: [scanned()], ageHours: null });
  assert.equal(v.worst, 'stale');
  assert.match(v.verdictBasis, /no timestamp/);
});

test('the ONLY path to "none" is: every repo scanned, recently', () => {
  const v = exposureVerdict({ findings: none, repos: [scanned(), scanned()], ageHours: 2 });
  assert.equal(v.worst, 'none');
  assert.equal(isConfidentClean(v.worst), true);
  assert.match(v.verdictBasis, /every repo scanned \(2\), 2h ago/);
});

// ── the exhaustive property: no green without measurement ────────────────────────────────────

test('PROPERTY: across every combination, "none" implies zero noscan AND a fresh scan', () => {
  // enumerated, not sampled — a fifth path to 'none' fails here instead of shipping
  let greens = 0;
  for (const nRepos of [0, 1, 2, 3]) {
    for (const nNoscan of [0, 1, 2, 3]) {
      if (nNoscan > nRepos) continue;
      for (const ageHours of [null, 0, 1, 23, 24, 25, 96, 1000]) {
        for (const findings of [none, { ...none, low: 1 }, { ...none, crit: 2 }]) {
          const repos = [
            ...Array.from({ length: nRepos - nNoscan }, scanned),
            ...Array.from({ length: nNoscan }, unscanned),
          ];
          const v = exposureVerdict({ findings, repos, ageHours });
          if (v.worst === 'none') {
            greens++;
            assert.equal(nNoscan, 0, 'a green with an unscanned repo');
            assert.ok(nRepos > 0, 'a green with no repos at all');
            assert.ok(ageHours !== null && ageHours <= 24, `a green from a ${ageHours}h-old scan`);
            assert.equal(findings.crit + findings.high + findings.med + findings.low, 0);
          }
          assert.ok(typeof v.verdictBasis === 'string' && v.verdictBasis.length > 0,
            'every verdict must say why — a colour with no stated basis is the thing being fixed');
        }
      }
    }
  }
  assert.ok(greens > 0, 'the property would be vacuous if nothing ever went green');
});

test('NOT_A_CLEAN_RESULT covers every non-severity verdict the function can return', () => {
  // pins the set — a hand-written filter forgets a case when a fifth verdict appears
  const produced = new Set();
  for (const repos of [[], [unscanned()], [scanned(), unscanned()], [scanned()]]) {
    for (const ageHours of [null, 1, 96]) produced.add(exposureVerdict({ findings: none, repos, ageHours }).worst);
  }
  for (const w of produced) {
    if (w === 'none') continue;
    assert.ok(NOT_A_CLEAN_RESULT.has(w), `${w} is produced but is not listed as un-clean`);
  }
});

// ── against the real rollup that produced the finding ────────────────────────────────────────

test('the real reports/client-d/rollup.json does not yield a clean verdict', { skip: !existsSync(join(CW, 'reports', 'client-d', 'rollup.json')) }, () => {
  // data-dependent, skips when absent — while on disk it is the actual artifact caught rendering green
  const rollup = JSON.parse(readFileSync(join(CW, 'reports', 'client-d', 'rollup.json'), 'utf8'));
  const findings = { ...none };
  for (const repo of rollup.repos || []) for (const f of repo.findings || []) {
    if (findings[f.severity] != null) findings[f.severity]++;
  }
  const ageHours = rollup.generated
    ? Math.round((Date.now() - new Date(rollup.generated).getTime()) / 36e5) : null;
  const v = exposureVerdict({ findings, repos: rollup.repos || [], ageHours });
  assert.notEqual(v.worst, 'none',
    `client-d is published on the public internet and its rollup records noscan; it must not render clean (got ${v.worst}: ${v.verdictBasis})`);
});
