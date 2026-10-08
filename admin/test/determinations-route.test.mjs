// node --test admin/test/ — the determination consumer, and the reason-for-unknown classification.
//
// The classification IS the feature. "reachability unknown" is either a fact about the fleet or a
// fact about our tooling, and before this route they rendered identically.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const D = await import(pathToFileURL(join(REPO, 'admin', 'routes', 'determinations.mjs')).href);
const A = await import(pathToFileURL(join(REPO, 'cra', 'advisory-aliases.mjs')).href);
const NOW = '2026-08-23T00:00:00.000Z';

const EMPTY_ALIAS = { forward: new Map(), reverse: new Map(), collisions: [], stats: {} };
const aliasWith = (pairs) => {
  const forward = new Map(); const reverse = new Map();
  for (const [go, cve] of pairs) {
    forward.set(go, new Set([go, cve])); forward.set(cve, new Set([cve, go]));
    reverse.set(cve, new Set([go]));
  }
  return { forward, reverse, collisions: [], stats: {} };
};
const goRow = (o = {}) => ({ repo: 'r', id: 'GO-1', package: 'example.com/m', sev: 'high',
  reachability: 'reachable', prover: 'govulncheck', proofKind: 'compiler-callgraph', ...o });
const rollup = (findings, go = [], extra = {}) => ({
  repos: [{ name: 'r', findings }],
  scannerFindings: { depsGo: go, ...extra },
});

test('an npm finding is `no-analyser-for-ecosystem` — never a finding about the code', () => {
  const v = D.determinationView(rollup([{ repo: 'r', id: 'CVE-2026-1', package: 'left-pad' }]), EMPTY_ALIAS, NOW, { rows: 'all' });
  assert.equal(v.reachability.unknown, 1);
  assert.equal(v.unknownBecause['no-analyser-for-ecosystem'], 1);
  assert.equal(v.rows[0].analyser, null);
});

test('a Go finding in a repo the analyser never touched is `analyser-did-not-run`', () => {
  const v = D.determinationView(rollup([{ repo: 'r', id: 'GO-9', package: 'example.com/x' }], []), EMPTY_ALIAS, NOW);
  assert.equal(v.unknownBecause['analyser-did-not-run'], 1);
  assert.equal(v.unknownBecause['no-analyser-for-ecosystem'], 0, 'an analyser DOES cover Go');
});

test('a Go finding in an analysed repo with no row is `analysed-no-row` — the genuine residual', () => {
  const v = D.determinationView(
    rollup([{ repo: 'r', id: 'GO-9', package: 'example.com/other' }], [goRow()]), EMPTY_ALIAS, NOW);
  assert.equal(v.unknownBecause['analysed-no-row'], 1);
});

test('a CVE resolves through its alias, and the row says which advisory carried the proof', () => {
  const alias = aliasWith([['GO-1', 'CVE-2026-5']]);
  const v = D.determinationView(
    rollup([{ repo: 'r', id: 'CVE-2026-5', package: 'example.com/m' }], [goRow()]), alias, NOW);
  assert.equal(v.reachability.proven, 2, 'the dependency finding AND the depsGo row that proves it — lanes overlap by design');
  assert.equal(v.rows[0].via, 'GO-1');
  assert.equal(v.rows[0].aliased, true);
  assert.equal(v.rows[0].evidence[0].method, 'call_graph');
});

test('EVIDENCED ROWS COME FIRST — a cap must not hide the only informative rows', () => {
  // The defect this pins: taking the first N in iteration order showed twelve `unknown` npm rows
  // and hid every proven one, inverting the tab's purpose.
  const alias = aliasWith([['GO-1', 'CVE-2026-5']]);
  const findings = [];
  for (let i = 0; i < 20; i++) findings.push({ repo: 'r', id: `CVE-2026-90${i}`, package: 'left-pad' });
  findings.push({ repo: 'r', id: 'CVE-2026-5', package: 'example.com/m' });
  const v = D.determinationView(rollup(findings, [goRow()]), alias, NOW, { rows: 'all' });
  assert.equal(v.rows[0].reachability, 'reachable', 'the informative row is the one a reader meets first');
  assert.equal(v.rows.length, 22, 'EVERY row is returned — no arbitrary cap (20 npm + the CVE + the depsGo row)');
});

test('the POPULATION is every lane, not just the dependency-CVE one', () => {
  // openFindings() reads rollup.repos[].findings alone. Measured on the corpus area: 10,350 there
  // against 98,953 scanner rows across 27 lanes, so a view built on it describes 9.5% of the fleet
  // while looking complete — the same defect the POA&M carries.
  const v = D.determinationView(rollup(
    [{ repo: 'r', id: 'CVE-2026-1', package: 'left-pad' }],
    [],
    { sastSemgrep: [{ repo: 'r', rule: 'js/xss', file: 'a.js', line: 12, sev: 'high' }],
      secrets: [{ repo: 'r', rule: 'aws-key', file: 'b.env', line: 3, sev: 'crit' }] },
  ), EMPTY_ALIAS, NOW, { rows: 'all' });
  assert.equal(v.total, 3, 'one dependency finding plus two scanner rows');
  assert.deepEqual(Object.keys(v.byLane).sort(), ['deps', 'sastSemgrep', 'secrets']);
  const sast = v.rows.find((r) => r.lane === 'sastSemgrep');
  assert.equal(sast.kind, 'scanner');
  assert.equal(sast.rule, 'js/xss');
  assert.equal(sast.file, 'a.js');
  assert.equal(sast.line, undefined, 'identity and payload exclude the line, per the house rule');
});

test('a scanner finding is `no-analyser-for-lane`, distinct from an unanalysed ecosystem', () => {
  // Collapsing the two would hide that ~90% of the fleet is a different, larger gap.
  const v = D.determinationView(rollup(
    [{ repo: 'r', id: 'CVE-2026-1', package: 'left-pad' }], [],
    { sastSemgrep: [{ repo: 'r', rule: 'js/xss', file: 'a.js', sev: 'high' }] },
  ), EMPTY_ALIAS, NOW);
  assert.equal(v.unknownBecause['no-analyser-for-lane'], 1);
  assert.equal(v.unknownBecause['no-analyser-for-ecosystem'], 1);
});

test('a scanner row with no repo is SKIPPED, never attributed to a guess', () => {
  const v = D.determinationView(rollup([], [], { secrets: [{ rule: 'k', file: 'f' }] }), EMPTY_ALIAS, NOW);
  assert.equal(v.total, 0);
});

test('ROW SCOPE is stated, and counts are always over the whole population', () => {
  const findings = [];
  for (let i = 0; i < 40; i++) findings.push({ repo: 'r', id: `CVE-2026-8${i}`, package: 'left-pad' });
  const v = D.determinationView(rollup(findings), EMPTY_ALIAS, NOW);          // default: evidenced
  assert.equal(v.total, 40, 'the count is over everything');
  assert.equal(v.rows.length, 0, 'none of these carry evidence');
  assert.equal(v.rowScope.mode, 'evidenced');
  assert.equal(v.rowScope.of, 40, 'the scope states what it is a scope OF');
  assert.match(v.rowScope.note, /widen with/);
  const all = D.determinationView(rollup(findings), EMPTY_ALIAS, NOW, { rows: 'all' });
  assert.equal(all.rows.length, 40, 'explicitly widened returns everything');
});

test('there is NO cap — measured, not assumed: the median view is 7 KB', () => {
  // An unrequired cap is a silent truncation. Across all 34 areas the median determination view is
  // 7 KB and the second-largest 127 KB; only the third-party benchmark corpus is large, and it is
  // an outlier by construction rather than a reason to hide 9,850 rows from everyone.
  const findings = [];
  for (let i = 0; i < 50; i++) findings.push({ repo: 'r', id: `CVE-2026-8${i}`, package: 'left-pad' });
  const v = D.determinationView(rollup(findings), EMPTY_ALIAS, NOW, { rows: 'all' });
  assert.equal(v.total, 50);
  assert.equal(v.rows.length, 50, 'every finding is returned');
  assert.equal(v.truncated, undefined, 'no truncation field, because nothing truncates');
});

test('THREE DENOMINATORS are published together, and the meaningful one is not the smallest', () => {
  const alias = aliasWith([['GO-1', 'CVE-2026-5']]);
  const findings = [{ repo: 'r', id: 'CVE-2026-5', package: 'example.com/m' }];
  for (let i = 0; i < 99; i++) findings.push({ repo: 'r', id: `CVE-2026-7${i}`, package: 'left-pad' });
  const v = D.determinationView(rollup(findings, [goRow()]), alias, NOW);
  assert.equal(v.denominators.allFindings.of, 101, 'the depsGo row is itself a finding in the population');
  assert.ok(v.denominators.allFindings.pct < 5, 'the misleading figure is still published, not hidden');
  assert.equal(v.denominators.analyserRan.pct, 100, 'coverage where the analyser actually ran');
  assert.ok(v.denominators.analyserRan.note.includes('means something'));
});

test('the analyser registry is a map, so "no analyser" stays true by construction', () => {
  assert.equal(D.REACHABILITY_ANALYSERS.GO, 'govulncheck');
  assert.equal(D.analyserFor(EMPTY_ALIAS, 'GO-2026-1').analyser, 'govulncheck');
  assert.equal(D.analyserFor(EMPTY_ALIAS, 'CVE-2026-1'), null);
  assert.equal(D.analyserFor(EMPTY_ALIAS, 'RUSTSEC-2026-1'), null, 'no Rust reachability analyser exists here');
});

test('the route refuses without a session and is reachable on the operator port', () => {
  const r = D.routes.find((x) => x.path === '/api/cra/determinations');
  let out;
  const call = (ctx) => { out = undefined; r.handle({ req: {}, adminSession: () => null, query: new Map(), send: (c, b) => { out = { c, b }; }, ...ctx }); return out; };
  assert.equal(call({}).c, 401);
  assert.notEqual(call({ isLoopbackReq: true }).c, 401);
});

test('an analyser is NOT measured against its own output — the circular denominator', () => {
  // When the population widened to every lane, coverage jumped 89% -> 94.5% because every depsGo
  // row carries evidence BY CONSTRUCTION: the rows are the proof, not findings the proof covers.
  // They stay in the population (they are real findings) and leave the coverage denominator.
  const alias = aliasWith([['GO-1', 'CVE-2026-5']]);
  const v = D.determinationView(
    rollup([{ repo: 'r', id: 'CVE-2026-5', package: 'example.com/m' }], [goRow()]), alias, NOW);
  assert.equal(v.total, 2, 'the depsGo row is still counted as a finding');
  assert.equal(v.denominators.analyserRan.of, 1, 'but only the independent finding is in the coverage denominator');
  assert.equal(v.denominators.analyserRan.pct, 100);
  assert.ok(D.ANALYSER_OUTPUT_LANES.has('depsGo'));
  assert.match(v.denominators.analyserRan.note, /circular/);
});

// ── the SECOND circularity: inferring "the analyser ran" from "the analyser found something" ─────
const withStatus = (findings, go, ran) => ({
  repos: [{ name: 'r', findings, scanners: ran === undefined ? undefined : { depsGo: { ran } } }],
  scannerFindings: { depsGo: go },
});

test('"the analyser ran" comes from the CHECK STATUS, not from row presence', () => {
  // A repo where govulncheck ran and found nothing is PERFECTLY covered. Inferring `ran` from rows
  // made it invisible — neither numerator nor denominator — which flattered coverage.
  // Measured live: ran on 29 repos, 26 produced a row, the row-derived denominator saw 19.
  const v = D.determinationView(withStatus([{ repo: 'r', id: 'GO-9', package: 'example.com/x' }], [], true), EMPTY_ALIAS, NOW);
  assert.equal(v.analyserRan.basis, 'check-status');
  assert.equal(v.analyserRan.repos, 1, 'the repo counts as analysed even though it produced no row');
  assert.equal(v.unknownBecause['analysed-no-row'], 1);
  assert.equal(v.unknownBecause['analyser-did-not-run'], 0, 'it DID run — saying otherwise excuses a real gap');
});

test('a repo the analyser cleared is counted as cleared, not as unvisited', () => {
  const v = D.determinationView(withStatus([], [], true), EMPTY_ALIAS, NOW);
  assert.equal(v.analyserRan.clearedNoFindings, 1, 'ran, found nothing — the best possible outcome, previously invisible');
});

test('ran:false is not "ran" — the flag is read, not merely present', () => {
  const v = D.determinationView(withStatus([{ repo: 'r', id: 'GO-9', package: 'example.com/x' }], [], false), EMPTY_ALIAS, NOW);
  assert.equal(v.analyserRan.repos, 0);
  assert.equal(v.unknownBecause['analyser-did-not-run'], 1);
});

test('with NO per-repo status the fallback is DEGRADED and says so', () => {
  // Fail loud rather than silently reverting to the circular signal.
  const v = D.determinationView(withStatus([{ repo: 'r', id: 'GO-9', package: 'example.com/x' }], [], undefined), EMPTY_ALIAS, NOW);
  assert.match(v.analyserRan.basis, /^row-presence \(DEGRADED/);
  assert.match(v.analyserRan.basis, /indistinguishable from one it never visited/);
  assert.equal(v.analyserRan.clearedNoFindings, null, 'unknowable without the status');
});

// ── a prior ruling must reach a consumer that reads records, not the ruling ──────────────────────
// D4 ruled `stubs` a metric (METRIC_CATEGORIES, extractors.mjs:1334) and the ruling IS published as
// rollup.metrics — but scannerFindings.stubs is a bare array of 33,001 rows carrying no marker, so
// enumerating records the obvious way readmits every one. It did: stubs was 47,104 of a 119,118
// "needs an analyser" figure, 40% of a gap reported as work needing tooling. Filed as 1.28.
test('lanes a ruling already excluded do not re-enter the population', () => {
  const v = D.determinationView({
    repos: [{ name: 'r', findings: [] }],
    scannerFindings: {
      stubs: [{ repo: 'r', rule: 'todo', file: 'a.js' }, { repo: 'r', rule: 'todo', file: 'b.js' }],
      shellLint: [{ repo: 'r', rule: 'SC2086', file: 's.sh' }],
      sastSemgrep: [{ repo: 'r', rule: 'js/xss', file: 'a.js', sev: 'high' }],
    },
  }, EMPTY_ALIAS, NOW, { rows: 'all' });
  assert.equal(v.total, 1, 'only the SAST finding is a finding');
  assert.equal(v.byLane.stubs, undefined, 'a metric lane contributes nothing');
  assert.equal(v.byLane.shellLint, undefined, 'a correctness linter is not asked a reachability question');
  assert.ok(v.byLane.sastSemgrep);
});

test('the exclusion is NAMED in the payload — an unseen exclusion is the defect, not a tidier number', () => {
  const v = D.determinationView({ repos: [], scannerFindings: {} }, EMPTY_ALIAS, NOW);
  assert.ok(v.excludedLanes.lanes.includes('stubs'));
  assert.ok(v.excludedLanes.lanes.includes('shellLint'));
  assert.match(v.excludedLanes.why, /ruled not findings/);
});

test('the ruling is READ FROM THE ARTIFACT when the rollup declares it', () => {
  // rollup.metrics is where D4's ruling is published. A lane declared there is excluded even if it
  // is not in this module's literal, so the two cannot drift apart.
  const v = D.determinationView({
    repos: [], metrics: { someNewMetricLane: { ran: true, total: 5 } },
    scannerFindings: { someNewMetricLane: [{ repo: 'r', rule: 'x', file: 'y' }] },
  }, EMPTY_ALIAS, NOW, { rows: 'all' });
  assert.equal(v.total, 0, 'a lane the artifact declares a metric is excluded without a code change');
  assert.ok(v.excludedLanes.lanes.includes('someNewMetricLane'));
});
