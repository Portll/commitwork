// The kind table replaced two hand-kept lists. This asserts the replacement changed no membership —
// a declaration that quietly re-bases the fleet headline is the thing it exists to prevent.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { LANE_KINDS, LANE_KIND_NAMES, TOTALS_EXCLUDE, METRIC_CATEGORIES, SCANNER_SPECS, kindOf,
  sumTotals } from '../extractors.mjs';

// Verbatim, as they stood at extractors.mjs before derivation (2026-08-26).
const WAS_TOTALS_EXCLUDE = ['maliciousPackages', 'stubs', 'denoLint', 'denoTypes',
  // depsRustAudit joined 2026-08-28: lane(V,'duplicate') — same advisory universe as deps-osv
  // (OSV imports RustSec), wired as the second opinion, so summing it would double every Rust
  // advisory. A deliberate re-base, per this file's rule that the headline never moves silently.
  // lintGo joined 2026-09-01: golangci-lint, lane(H,'not-a-vulnerability') exactly as clippy and
  // hlint are. gosec holds the Go SECURITY axis; summing a linter into the headline would let
  // unchecked-error hygiene move a number that is supposed to mean "attackable". A deliberate
  // re-base, recorded here rather than absorbed silently.
  // lintPython joined 2026-09-01 alongside sastPython (Bandit): ruff, lane(H,'not-a-vulnerability')
  // exactly as lintGo/lintRust/lintHaskell are. Bandit holds the Python SECURITY axis; sastPython
  // itself is lane(V) and is NOT in this list, the same way sastElixir/sastJoern are not — a real
  // vulnerability-counted lane, not a linter.
  // depsBundlerAudit joined 2026-09-01: lane(V,'duplicate') — same advisory universe as deps-osv
  // (OSV imports the Ruby advisory DB too), wired as the second opinion exactly like depsRustAudit
  // above. sastBrakeman is NOT in this list: plain lane(V), a real vulnerability-counted SAST lane.
  // lintJava joined 2026-09-01: PMD, lane(H,'not-a-vulnerability') exactly as lintGo/lintRust/
  // lintHaskell/lintPython are. sastCodeqlJava holds the Java SECURITY axis (and PMD's own 2-rule
  // security.xml is deliberately not scanned by this lane); sastPhp is NOT the precedent here —
  // there is no sastJava at all, so nothing needs to stay out of this list the way sastPhp does.
  // cobolCoverage joined 2026-09-18 with the COBOL lanes. It is the first member excluded for a
  // reason neither of the two existing groups holds: not a duplicate of anything (no other lane
  // reports COBOL coverage) and not a lint. Its rows say what a scan did NOT read — unresolved
  // copybooks, unreadable members, the source formats found — and summing coverage into a severity
  // headline is the confusion the lane exists to prevent. Its sibling sastCobol is additive and
  // is deliberately NOT here, exactly as sastCodeqlJava is not here beside lintJava.
  'depsReachability', 'depsRustAudit', 'depsBundlerAudit', 'lintRust', 'lintHaskell', 'lintGo', 'lintPython', 'lintJava', 'formatRust', 'sastAuto', 'cobolCoverage',
  // 2026-09-30: CI health and hermetic tests are hygiene, counted apart from security totals.
  'actionsHealth', 'testHermetic',
  // secretsBetterleaks joined 2026-10-07: lane(V,'duplicate'), a second engine over gitleaks' scope
  // file and rule format, so summing it would count most working-tree secrets twice.
  'secretsBetterleaks'];
const WAS_METRIC_CATEGORIES = ['stubs', 'denoLint', 'denoTypes', 'lintRust', 'lintHaskell', 'lintGo', 'lintPython', 'lintJava', 'formatRust', 'cobolCoverage', 'actionsHealth', 'testHermetic'];

describe('derivation is inert', () => {
  test('TOTALS_EXCLUDE membership is unchanged', () => {
    assert.deepEqual([...TOTALS_EXCLUDE].sort(), [...WAS_TOTALS_EXCLUDE].sort());
  });

  test('METRIC_CATEGORIES membership is unchanged', () => {
    assert.deepEqual([...METRIC_CATEGORIES].sort(), [...WAS_METRIC_CATEGORIES].sort());
  });

  test('the lists stayed different — METRIC ⊂ TOTALS, strictly', () => {
    const excl = new Set(TOTALS_EXCLUDE);
    for (const c of METRIC_CATEGORIES) assert.ok(excl.has(c), `${c} unlodgeable but still summed`);
    // maliciousPackages is the case that proves the axes are independent. Losing it collapses them.
    assert.ok(excl.has('maliciousPackages') && !METRIC_CATEGORIES.has('maliciousPackages'),
      'non-additive AND actionable is the distinction the two lists carry');
  });
});

describe('the table covers the lanes, both directions', () => {
  const specNames = SCANNER_SPECS.map((s) => s[0]);

  test('no scanner lane is undeclared', () => {
    const missing = specNames.filter((n) => !LANE_KINDS[n]);
    assert.deepEqual(missing, [], 'a lane with no declared kind cannot be partitioned');
  });

  test('no declared lane is a phantom', () => {
    const known = new Set(specNames);
    const phantom = Object.keys(LANE_KINDS).filter((n) => !known.has(n));
    assert.deepEqual(phantom, [], 'declaring a lane that does not exist certifies coverage it lacks');
  });

  test('the fixture is real — SCANNER_SPECS is populated', () => {
    assert.ok(specNames.length > 30, `only ${specNames.length} lanes; the subject is empty`);
  });
});

describe('every declaration is well-formed', () => {
  test('kind is drawn from the closed vocabulary', () => {
    for (const [name, d] of Object.entries(LANE_KINDS)) {
      assert.ok(LANE_KIND_NAMES.includes(d.kind), `${name}: kind ${JSON.stringify(d.kind)}`);
    }
  });

  test('a non-additive lane states which of the two unrelated reasons', () => {
    const reasons = new Set(['duplicate', 'not-a-vulnerability']);
    for (const [name, d] of Object.entries(LANE_KINDS)) {
      if (d.additive) assert.equal(d.why, '', `${name}: additive but carries a reason`);
      else assert.ok(reasons.has(d.why), `${name}: excluded from the sum with no stated reason`);
    }
    // Non-vacuity: both reasons must be in use, or the distinction is decorative.
    const used = new Set(Object.values(LANE_KINDS).filter((d) => !d.additive).map((d) => d.why));
    assert.deepEqual([...used].sort(), ['duplicate', 'not-a-vulnerability']);
  });

  test('only not-a-vulnerability suppresses lodging — a duplicate is still real work', () => {
    for (const [name, d] of Object.entries(LANE_KINDS)) {
      if (d.why === 'duplicate') assert.ok(d.actionable, `${name}: deduped out of existence`);
    }
  });

  test('kindOf answers for a real lane and stays blank for an unknown one', () => {
    assert.equal(kindOf('secrets'), 'vulnerability');
    assert.equal(kindOf('stubs'), 'hygiene');
    assert.equal(kindOf('nope'), '', 'an unknown lane must not be defaulted into a kind');
  });
});

test('every kind is populated — an empty partition is a vocabulary nobody checked', () => {
  const seen = new Set(Object.values(LANE_KINDS).map((d) => d.kind));
  for (const k of LANE_KIND_NAMES) assert.ok(seen.has(k), `kind "${k}" claims no lane`);
});

// ── the partition conserves ──────────────────────────────────────────────────────────────────────
// The headline keeps its flat number and gains a partition of it. If the two ever disagree, one of
// them is lying to a reader who has no way to tell which.
const SEVS = ['crit', 'high', 'med', 'low', 'undetermined'];
const cve = (o = {}) => ({ crit: 0, high: 0, med: 0, low: 0, undetermined: 0, cves: 0, kev: 0, ...o });
const acrossKinds = (byKind, s) => Object.values(byKind).reduce((n, b) => n + b[s], 0);

describe('byKind partitions the same counts, and nothing else', () => {
  test('a mixed fleet shape conserves in every bucket', () => {
    const t = sumTotals(cve({ crit: 3, high: 5, undetermined: 1 }), {
      secrets: { crit: 2, high: 4 },              // vulnerability
      cspm: { high: 9, med: 100 },                // posture
      supplyChain: { high: 107 },                 // policy — the D15 number
      minifiedCode: { med: 12, low: 3 },          // integrity
      shellLint: { low: 40 },                     // hygiene
      stubs: { high: 4019 },                      // excluded: reaches neither
      maliciousPackages: { crit: 8 },             // excluded: duplicate
    });
    for (const s of SEVS) {
      assert.equal(acrossKinds(t.byKind, s), t[s], `${s}: partition ${acrossKinds(t.byKind, s)} vs flat ${t[s]}`);
    }
    assert.equal(t.byKind.policy.high, 107, 'the licence alerts must be visible AS policy, not erased');
    assert.equal(t.byKind.vulnerability.crit, 5, 'CVE feed + secrets, and nothing from the excluded lanes');
    assert.equal(t.byKind.hygiene.low, 40);
    assert.equal(t.byKind.unclassified.high, 0);
  });

  test('an excluded lane reaches no kind — the two filters agree', () => {
    const t = sumTotals(cve(), { stubs: { high: 4019 }, depsReachability: { crit: 6 } });
    assert.equal(t.high, 0);
    assert.equal(acrossKinds(t.byKind, 'high'), 0);
    assert.equal(acrossKinds(t.byKind, 'crit'), 0, 'a duplicate lane must not re-enter through the partition');
  });

  test('an undeclared lane lands in unclassified, never in vulnerability', () => {
    const t = sumTotals(cve(), { somethingNewLandedTonight: { crit: 4 } });
    assert.equal(t.crit, 4, 'the flat sum is unchanged — the partition adds visibility, not filtering');
    assert.equal(t.byKind.unclassified.crit, 4);
    assert.equal(t.byKind.vulnerability.crit, 0, 'an unknown lane defaulted into vulnerability is a fabricated claim');
  });

  test('the CVE feed is a vulnerability claim, not unclassified', () => {
    const t = sumTotals(cve({ crit: 7 }), {});
    assert.equal(t.byKind.vulnerability.crit, 7);
    assert.equal(t.byKind.unclassified.crit, 0);
  });

  test('non-vacuity: the fixture really exercises more than one kind', () => {
    const t = sumTotals(cve({ high: 1 }), { cspm: { high: 1 }, shellLint: { high: 1 } });
    const live = Object.entries(t.byKind).filter(([, b]) => SEVS.some((s) => b[s] > 0)).map(([k]) => k);
    assert.deepEqual(live.sort(), ['hygiene', 'posture', 'vulnerability']);
  });
});
