// node --test cra/test/ — the call-graph producer that feeds the Phase-4 evidence gate.
//
// The claim under test is narrow and important: govulncheck can prove REACHABILITY and cannot prove
// its ABSENCE. Everything here exists to stop the second claim being made from the first's silence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const R = await import(pathToFileURL(join(REPO, 'cra', 'reachability-evidence.mjs')).href);
const D = await import(pathToFileURL(join(REPO, 'cra', 'determination.mjs')).href);
const P = await import(pathToFileURL(join(REPO, 'cra', 'determination-projection.mjs')).href);

const NOW = '2026-08-22T00:00:00.000Z';
const goRow = (over = {}) => ({ repo: 'repo-a', id: 'GO-2026-1', package: 'example.com/mod', sev: 'high',
  reachability: 'reachable', prover: 'govulncheck', proofKind: 'compiler-callgraph',
  message: 'REACHABLE — govulncheck traced a call path', ...over });

// THE SHAPE IS THE ROLLUP'S, NOT AN INVENTED ONE. scannerFindings is a ROLLUP-level map of flat
// arrays whose rows each carry `repo`; the first version of this file used a per-repo fixture that
// exists nowhere, and every test passed against a producer that read an always-empty key.
const rollup = (rows, lane = 'depsGo') => ({ repos: [], scannerFindings: { [lane]: rows } });

test('a traced call path yields `reachable` with call_graph evidence', () => {
  const m = R.reachabilityFromGoRow(goRow(), NOW);
  assert.equal(m.reachability, 'reachable');
  assert.equal(m.evidence.method, 'call_graph');
  assert.equal(m.evidence.confidence, 'high');
  assert.equal(D.assertable({ reachability: m.reachability }, m.evidence).ok, true);
});

test('THE CENTRAL CLAIM: an untraced module is `unproven`, never `unreachable_static`', () => {
  const m = R.reachabilityFromGoRow(goRow({ reachability: 'unproven', proofKind: 'none' }), NOW);
  assert.equal(m.reachability, 'reachability_unproven');
  assert.notEqual(m.reachability, 'unreachable_static',
    'govulncheck showed no path; it did not show that none exists. Publishing the stronger word is the dep-scan in_triage defect.');
  // …and it still carries call_graph evidence, because an analyser really did run.
  assert.equal(m.evidence.method, 'call_graph');
  assert.equal(D.assertable({ reachability: 'reachability_unproven' }, m.evidence).ok, true);
});

test('`unproven` is NOT a not-affected verdict and can never become a justification', () => {
  const d = { presence: 'component_present_code_present', reachability: 'reachability_unproven' };
  assert.equal(D.isNotAffected(d), false);
  assert.equal(D.notAffectedReason(d), null);
  assert.equal(P.JUSTIFICATION.reachability_unproven, undefined,
    'a justification row for unproven would let "we looked and found nothing" become "not affected"');
});

test('`unproven` is distinguishable from `unknown` — an analyser ran', () => {
  // The distinction the value exists for. Both are "not proven reachable"; only one had a prover.
  assert.equal(D.assertable({ reachability: 'reachability_unproven' }, []).ok, false,
    'without evidence, unproven collapses into unknown — which is correct');
  assert.equal(D.assertable({ reachability: 'reachability_unknown' }, []).ok, true,
    'unknown requires nothing; it IS the absence');
});

test('dep-scan is admitted but proves nothing — the in_triage lesson, enforced', () => {
  const m = R.reachabilityFromDepScanRow({ id: 'CVE-1', package: 'pkg:npm/x', reachability: 'exploitable' }, NOW);
  assert.equal(m.evidence.method, 'scanner_default');
  assert.equal(m.reachability, 'reachability_unknown');
  // Its evidence satisfies no reachability determination at all.
  for (const claim of ['unreachable_static', 'reachability_unproven']) {
    assert.equal(D.assertable({ reachability: claim }, m.evidence).ok, false,
      `dep-scan evidence must not support '${claim}'`);
  }
});

test('an unknown prover is skipped, never adopted', () => {
  assert.equal(R.reachabilityFromGoRow(goRow({ prover: 'some-new-tool' }), NOW), null);
  assert.equal(R.reachabilityFromGoRow(goRow({ prover: 'govulncheck', reachability: 'exploitable' }), NOW), null,
    'a value outside the typed contract is skipped rather than guessed at');
});

test('reachable beats unproven, and a call graph beats a scanner default', () => {
  const idx = R.buildReachabilityIndex({
    repos: [],
    scannerFindings: {
      depsGo: [goRow({ repo: 'repo-a', reachability: 'unproven', proofKind: 'none' }), goRow({ repo: 'repo-a' })],
      depsReachability: [{ repo: 'repo-a', id: 'GO-2026-1', package: 'example.com/mod', reachability: 'exploitable' }],
    },
  }, NOW);
  const got = R.reachabilityFor(idx, 'repo-a', 'GO-2026-1', 'example.com/mod');
  assert.equal(got.reachability, 'reachable', 'a proven path is not cancelled by a pass that failed to find one');
  assert.equal(got.evidence[0].method, 'call_graph', 'dep-scan must never displace a call-graph row');
});

test('a finding no analyser touched is UNKNOWN with no evidence — explicit uncertainty', () => {
  const idx = R.buildReachabilityIndex(rollup([]), NOW);
  const got = R.reachabilityFor(idx, 'repo-a', 'CVE-2026-9', 'left-pad');
  assert.equal(got.reachability, 'reachability_unknown');
  assert.deepEqual(got.evidence, []);
  assert.match(got.why, /no call-graph analyser/);
  // And the gate refuses to let that become anything stronger.
  assert.equal(D.assertable({ reachability: 'unreachable_static' }, got.evidence).ok, false);
});

test('the identity excludes severity and message — it is repo|advisory|package', () => {
  assert.equal(R.reachKey('r', 'go-2026-1', 'm'), R.reachKey('r', 'GO-2026-1', 'm'));
  assert.notEqual(R.reachKey('r', 'GO-2026-1', 'm'), R.reachKey('r2', 'GO-2026-1', 'm'));
});

test('coverage STATES that nothing here can prove unreachability', () => {
  const idx = R.buildReachabilityIndex(rollup([goRow({ repo: 'a' })]), NOW);
  const cov = R.proverCoverage(idx);
  assert.equal(cov.reachable, 1);
  assert.equal(cov.canAssertUnreachableStatic, false);
  assert.match(cov.note, /unreachable_static has NO producer/);
  assert.equal(cov.byMethod.call_graph, 1);
});

test('every value this module emits is a declared Axis-B value', () => {
  for (const v of R.EMITTED) assert.ok(D.REACHABILITY[v], `'${v}' is not declared in Axis B`);
});

// ── the shape guard: fixtures must match a REAL rollup ──────────────────────────────────────────
// The bug this exists to prevent: the producer read rollup.repos[].scannerFindings, which no rollup
// has, and eleven unit tests agreed with it because they fed a fixture invented to match. Only
// measuring against the live reports caught it. This binds the fixture to the artifact.
test('the producer reads the level a real rollup actually stores rows at', async () => {
  const { readFileSync, readdirSync, existsSync } = await import('node:fs');
  const dir = join(REPO, 'reports');
  if (!existsSync(dir)) return;                        // clean checkout: nothing to bind against
  let checked = 0;
  for (const area of readdirSync(dir)) {
    const p = join(dir, area, 'rollup.json');
    if (!existsSync(p)) continue;
    let doc; try { doc = JSON.parse(readFileSync(p, 'utf8')); } catch { continue; }
    const go = doc.scannerFindings && doc.scannerFindings.depsGo;
    const rows = Array.isArray(go) ? go : (go && go.findings) || [];
    if (!rows.length) continue;
    checked++;
    // Rows carry their own repo — the rollup prepends it on the fleet flatten.
    assert.ok(rows[0].repo, 'a depsGo row must carry `repo`; without it the index cannot attribute a proof');
    assert.ok(rows[0].prover, 'a depsGo row must carry the typed `prover`');
    const idx = R.buildReachabilityIndex(doc, NOW);
    assert.ok(idx.size > 0,
      `${area}: the rollup holds ${rows.length} depsGo rows and the producer indexed NONE — it is reading the wrong level again`);
    // And what it indexed must be attributable and evidenced.
    const [first] = [...idx.values()];
    assert.ok(first.repo && first.id);
    assert.equal(first.evidence.method, 'call_graph');
  }
  if (!checked) return;                                 // no Go rows in this tree's reports; not a failure
  assert.ok(checked > 0);
});
