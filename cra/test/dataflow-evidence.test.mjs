// node --test cra/test/ — CodeQL codeFlows as reachability evidence, and the limit of that claim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const D = await import(pathToFileURL(join(REPO, 'cra', 'dataflow-evidence.mjs')).href);
const M = await import(pathToFileURL(join(REPO, 'cra', 'determination.mjs')).href);
const NOW = '2026-08-23T00:00:00.000Z';

const step = (uri, line, text) => ({ location: { physicalLocation: { artifactLocation: { uri }, region: { startLine: line } }, message: { text } } });
const taint = (rule = 'js/xss-through-dom') => ({
  ruleId: rule,
  locations: [{ physicalLocation: { artifactLocation: { uri: 'a.js' }, region: { startLine: 9 } } }],
  codeFlows: [{ threadFlows: [{ locations: [step('a.js', 1, 'req.url'), step('a.js', 5, 'x'), step('a.js', 9, 'sink')] }] }],
});
const syntactic = (rule = 'js/incomplete-sanitization') => ({
  ruleId: rule,
  locations: [{ physicalLocation: { artifactLocation: { uri: 'b.js' }, region: { startLine: 3 } } }],
});
function scratch(results) {
  const T = mkdtempSync(join(tmpdir(), 'df-'));
  mkdirSync(join(T, 'sweep-x', 'repo-a'), { recursive: true });
  writeFileSync(join(T, 'sweep-x', 'repo-a', 'codeql.sarif'), JSON.stringify({ runs: [{ results }] }));
  return T;
}

test('a taint path is REACHABLE, with the method `dataflow` — not call_graph', () => {
  const r = D.dataflowFromResult(taint(), 'repo-a', NOW);
  assert.equal(r.reachability, 'reachable');
  assert.equal(r.evidence.method, 'dataflow');
  assert.notEqual(r.evidence.method, 'call_graph',
    'a taint path proves data ARRIVES at a sink; a call graph proves a function is invoked — different proofs');
  assert.ok(M.METHOD.dataflow, 'the method must be declared in the vocabulary');
  assert.equal(r.path.steps, 3);
  assert.equal(r.path.source.expr, 'req.url');
  assert.match(r.evidence.detail, /traced 3 steps/);
});

test('a SYNTACTIC rule yields UNKNOWN — the query never looked, so it proves nothing either way', () => {
  // Measured: every result without codeFlows is a syntactic rule (js/incomplete-sanitization,
  // js/bad-tag-filter); every dataflow query carries one. Absence is the query kind, not a residue.
  const r = D.dataflowFromResult(syntactic(), 'repo-a', NOW);
  assert.equal(r.reachability, 'reachability_unknown');
  assert.notEqual(r.reachability, 'unreachable_static', 'publishing the stronger word is the dep-scan in_triage defect');
  assert.notEqual(r.reachability, 'reachability_unproven', 'unlike govulncheck, nothing here searched and failed');
  assert.match(r.why, /not a dataflow query/);
  assert.deepEqual(r.evidence, []);
});

test('identity is repo|rule|file and excludes the line', () => {
  assert.equal(D.dataflowKey('r', 'js/xss', 'a.js'), D.dataflowKey('r', 'js/xss', 'a.js'));
  assert.notEqual(D.dataflowKey('r', 'js/xss', 'a.js'), D.dataflowKey('r2', 'js/xss', 'a.js'));
});

test('a proven path is never cancelled by a syntactic result for the same key', () => {
  const T = scratch([syntactic('js/xss-through-dom'), taint('js/xss-through-dom')]);
  const { index } = D.buildDataflowIndex({ dir: T, atIso: NOW });
  // Both rows key on repo-a|js/xss-through-dom|<file>; the taint one has a path.
  const reachable = [...index.values()].filter((r) => r.reachability === 'reachable');
  assert.equal(reachable.length, 1);
  rmSync(T, { recursive: true, force: true });
});

test('a finding no CodeQL result covers is UNKNOWN with no evidence and a stated reason', () => {
  const T = scratch([taint()]);
  const { index } = D.buildDataflowIndex({ dir: T, atIso: NOW });
  const got = D.dataflowFor(index, 'repo-a', 'some/other-rule', 'z.js');
  assert.equal(got.reachability, 'reachability_unknown');
  assert.deepEqual(got.evidence, []);
  assert.match(got.why, /may not have run here/);
  rmSync(T, { recursive: true, force: true });
});

test('a missing reports dir yields an empty index, not a throw', () => {
  const { index, stats } = D.buildDataflowIndex({ dir: join(tmpdir(), 'nope-' + process.pid) });
  assert.equal(index.size, 0);
  assert.equal(stats.artifacts, 0);
});

// ── THE LIMIT OF THE CLAIM ──────────────────────────────────────────────────────────────────────
test('CodeQL evidence does NOT reach Semgrep findings — the rule namespaces are disjoint', () => {
  // Measured fleet-wide: sastSemgrep joins 0 of 15,613 and sastGo 0 of 10,249, because a CodeQL
  // rule id (js/xss-through-dom) names a different finding from any Semgrep rule id. They are not
  // the same finding seen twice. I claimed otherwise before measuring; this pins the correction so
  // nobody re-derives the optimistic version.
  const T = scratch([taint('js/xss-through-dom')]);
  const { index } = D.buildDataflowIndex({ dir: T, atIso: NOW });
  const semgrepish = D.dataflowFor(index, 'repo-a', 'javascript.browser.security.dom-based-xss', 'a.js');
  assert.equal(semgrepish.evidence.length, 0, 'a Semgrep rule id must not pick up a CodeQL path in the same file');
  assert.equal(semgrepish.reachability, 'reachability_unknown');
  rmSync(T, { recursive: true, force: true });
});

test('the index built from THIS tree carries real paths', () => {
  if (!existsSync(join(REPO, 'reports'))) return;
  const { index, stats } = D.buildDataflowIndex({ atIso: NOW });
  if (!stats.artifacts) return;
  assert.ok(stats.results > 0, 'artifacts found but no results parsed — the SARIF shape moved');
  assert.ok(stats.withPath > 0, 'no codeFlows found in any artifact');
  const one = [...index.values()].find((r) => r.reachability === 'reachable');
  assert.ok(one.path.source.file && one.path.sink.file, 'a path must name both ends');
  assert.ok(one.path.steps >= 2);
});
