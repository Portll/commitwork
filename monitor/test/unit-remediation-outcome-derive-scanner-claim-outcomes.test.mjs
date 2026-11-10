// Computes verified-fixed or refuted-still-present outcomes for scanner remediation claims (monitor/remediation-outcome.mjs deriveScannerClaimOutcomes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveScannerClaimOutcomes } from '../remediation-outcome.mjs';

const WORDS = `
  secret secrets secret-scan secret-leak leaked-secret git-secret history-secret hardcoded-secret credential credentials
  api-key token env-file env-files env env-drift gitignore pii sensitive-file sensitive-files private-key
  dep deps dependency dependencies dep-vuln dep-audit vuln vulns vulnerability vulnerabilities advisory advisories
  cve npm-audit audit cargo-audit pip-audit outdated outdated-dep unpinned unpinned-dep unpinned-action unpinned-actions
  license licenses lockfile lockfiles lockfile-drift typosquat install-script postinstall supply-chain sbom
  todo todos todo-marker fixme marker markers stub stubs placeholder placeholders mock-data fake-test skipped-test
  skipped-tests test test-gap test-gaps missing-test missing-tests untested untested-file untested-files coverage
  large-file large-files big-file big-files long-file long-files long-function long-functions god-file god-files
  complexity hotspot hotspots churn duplicate duplicates duplication clone clones dead-code dead-export dead-exports
  unused-export unused-exports unused-dep unused-deps unused-file orphan orphans orphan-file orphan-files
  cycle cycles circular-dep circular-deps circular-import circular-imports phantom-import broken-import broken-link
  broken-links stale-doc stale-docs doc-drift docs readme lint eslint semgrep gitleaks trufflehog sast taint dataflow
  injection sql-injection sqli xss command-injection shell-injection path-traversal ssrf eval eval-use unsafe-eval
  weak-crypto insecure-random insecure-pattern insecure-patterns dangerous-pattern dangerous-patterns unsafe-pattern
  unsafe-patterns security security-pattern security-patterns cors auth auth-gap auth-gaps route routes endpoint
  endpoints unauthed-route open-route rate-limit network net-call net-calls hardcoded hardcoded-path hardcoded-paths
  hardcoded-url hardcoded-urls absolute-path absolute-paths empty-catch empty-catches swallowed-error swallowed-errors
  console-log console-logs debug debug-statement debug-statements suppression suppressions hook hooks hook-integrity
  ci workflow workflows action actions dockerfile docker docker-root terraform misconfig config configs permission
  permissions branch-protection stale-branch stale-branches binary binaries finding findings pattern patterns
  rule rules quality hygiene drift staleness cross-repo fleet
`.trim().split(/\s+/);
const camel = (w) => w.replace(/-(\w)/g, (_, ch) => ch.toUpperCase());
const forms = (w) => [w, camel(w), w.replace(/-/g, '_'), `${w}s`, `${camel(w)}s`, w.toUpperCase()];
const CANDIDATES = [...new Set(WORDS.flatMap(forms))];

const FILL = { get: (t, k) => (k in t || typeof k !== 'string' ? t[k] : 'v'), has: () => true };
const make = (category, extra) => new Proxy({ claim: 'remediated', category, scope: 'repo', repo: 'r1', at: 't1', ...extra }, FILL);
const GOOD = { scannerFindings: {}, scannerDelta: {} };
const produces = (c) => deriveScannerClaimOutcomes([make(c)], GOOD).out.length === 1;
const C = CANDIDATES.find(produces);
const claim = (extra) => make(C, extra);
const FLEET = { scope: 'fleet', repo: undefined };

const first = (r) => {
  const { findingKey, claimRef, ...rest } = r.out[0];
  assert.equal(claimRef.slice(-3), '@t1');
  return rest;
};
const expected = (repo, outcome, sliceId, stillPresentIn) => ({
  category: C, repo, outcome, claimSource: 'scanner-annotation', sliceId, stillPresentIn,
  bornSlice: null, place: `${C}:${repo}`, artifact: 'monitor/annotations.json#scannerAnnotations',
});

test('missing annotations give empty results with or without a slice', () => {
  assert.deepEqual(deriveScannerClaimOutcomes(null, null), { out: [], skipped: [] });
  assert.deepEqual(deriveScannerClaimOutcomes(undefined, GOOD), { out: [], skipped: [] });
});

test('null entries and claims other than remediated are ignored silently', () => {
  const list = [null, undefined, { claim: 'open', category: 'no-such-category' }, { category: 'no-such-category' }];
  assert.deepEqual(deriveScannerClaimOutcomes(list, null), { out: [], skipped: [] });
});

test('a remediated claim in an unknown category is skipped by name', () => {
  const r = deriveScannerClaimOutcomes([{ claim: 'remediated', category: 'no-such-category' }], GOOD);
  assert.deepEqual(r, { out: [], skipped: [{ reason: "unknown category 'no-such-category'" }] });
});

test('a known category is skipped when the slice lacks findings or delta', () => {
  const reason = `category '${C}': no slice, or slice carries no scannerFindings/scannerDelta \u2014 comparability unknown`;
  for (const slice of [null, { sliceId: 's1' }, { scannerFindings: {} }, { scannerDelta: {} }]) {
    assert.deepEqual(deriveScannerClaimOutcomes([claim()], slice), { out: [], skipped: [{ reason }] });
  }
});

test('a category listed as not compared is skipped with the listed reason', () => {
  const tail = '\u2014 a category not rescanned can prove nothing';
  const withWhy = { scannerFindings: {}, scannerDelta: { notCompared: ['other:slow', `${C}:timeout`] } };
  assert.deepEqual(deriveScannerClaimOutcomes([claim()], withWhy), {
    out: [], skipped: [{ reason: `category '${C}' not comparable this slice (${C}:timeout) ${tail}` }],
  });
  const bare = { scannerFindings: {}, scannerDelta: { notCompared: [C] } };
  assert.deepEqual(deriveScannerClaimOutcomes([claim()], bare), {
    out: [], skipped: [{ reason: `category '${C}' not comparable this slice (${C}) ${tail}` }],
  });
});

test('a claim with no repo outside fleet scope is skipped', () => {
  const reason = `category '${C}': no repo and not scope:'fleet'`;
  const r = deriveScannerClaimOutcomes([claim({ repo: undefined }), claim({ repo: '' })], GOOD);
  assert.deepEqual(r, { out: [], skipped: [{ reason }, { reason }] });
});

test('a repo claim is verified fixed when no row shares its place', () => {
  const other = { sliceId: 's1', stamp: 'st1', scannerFindings: { [C]: [claim({ repo: 'r2' })] }, scannerDelta: { notCompared: ['other:slow'] } };
  const r = deriveScannerClaimOutcomes([claim()], other);
  assert.deepEqual(r.skipped, []);
  assert.deepEqual(first(r), expected('r1', 'verified-fixed', 's1', undefined));
  const empty = deriveScannerClaimOutcomes([claim()], GOOD);
  assert.deepEqual(first(empty), expected('r1', 'verified-fixed', null, undefined));
});

test('a repo claim is refuted when a row shares its place', () => {
  const slice = { stamp: 'st1', scannerFindings: { [C]: [claim({ repo: 'r2' }), claim()] }, scannerDelta: {} };
  const r = deriveScannerClaimOutcomes([claim()], slice);
  assert.deepEqual(first(r), expected('r1', 'refuted-still-present', 'st1', ['r1']));
});

test('a fleet claim is verified with no rows and refuted by rows in any repo', () => {
  const clean = deriveScannerClaimOutcomes([claim(FLEET)], { sliceId: 's2', scannerFindings: { [C]: [] }, scannerDelta: {} });
  assert.deepEqual(first(clean), expected('fleet', 'verified-fixed', 's2', undefined));
  const rows = ['r2', 'r1', 'r2'].map((repo) => claim({ repo }));
  const hit = deriveScannerClaimOutcomes([claim(FLEET)], { sliceId: 's2', scannerFindings: { [C]: rows }, scannerDelta: {} });
  assert.deepEqual(first(hit), expected('fleet', 'refuted-still-present', 's2', ['r1', 'r2']));
});

test('outcomes come back ordered by finding key whatever the input order', () => {
  const keysFor = (repos) => deriveScannerClaimOutcomes(repos.map((repo) => claim({ repo })), GOOD).out.map((o) => o.findingKey);
  const forward = keysFor(['r1', 'r2', 'r3']);
  const backward = keysFor(['r3', 'r2', 'r1']);
  assert.deepEqual(forward, [...forward].sort());
  assert.deepEqual(backward, forward);
});
