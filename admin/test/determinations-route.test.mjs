// node --test admin/test/ — the determination consumer, and the reason-for-unknown classification.
//
// The classification IS the feature. "reachability unknown" is either a fact about the fleet or a
// fact about our tooling, and before this route they rendered identically.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
  // Collapsing the two would hide that ~90% of the fleet is a different, larger gap. sastGo (gosec)
  // traces nothing, so no engine in the fleet answers for it; a taint lane's reasons are below.
  const v = D.determinationView(rollup(
    [{ repo: 'r', id: 'CVE-2026-1', package: 'left-pad' }], [],
    { sastGo: [{ repo: 'r', rule: 'G204', file: 'a.go', sev: 'high' }] },
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

// ── an excluded lane must stay excluded for a consumer that reads records ──────────────────────
// `stubs` is a metric (METRIC_CATEGORIES, lane-kinds.mjs) and is published as rollup.metrics, but
// scannerFindings.stubs is a bare array carrying no marker, so enumerating records the obvious way
// would readmit every row into the "needs an analyser" figure.
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

// ── taint paths answer for OUR OWN code ────────────────────────────────────────────────────────
// A taint engine's codeFlow proves untrusted data reaches the sink; joined on the finding's own
// identity from the sweep the rollup names. Each way of NOT having one keeps its own reason.
const loc = (uri, line, text) => ({ location: { physicalLocation: { artifactLocation: { uri }, region: { startLine: line } }, message: { text } } });
const traced = (rule, file, flows) => ({
  ruleId: rule,
  locations: [{ physicalLocation: { artifactLocation: { uri: file }, region: { startLine: 9 } } }],
  codeFlows: flows.map((locs) => ({ threadFlows: [{ locations: locs }] })),
});
function sweep(perRepo) {
  const T = mkdtempSync(join(tmpdir(), 'det-df-'));
  for (const [repo, files] of Object.entries(perRepo)) {
    mkdirSync(join(T, repo), { recursive: true });
    for (const [name, doc] of Object.entries(files)) writeFileSync(join(T, repo, name), JSON.stringify(doc));
  }
  return T;
}
const sarif = (driver, results) => ({ runs: [{ tool: { driver: { name: driver, rules: [] } }, results }] });

test('a CodeQL taint path makes a scanner finding REACHABLE, cited from the rollup\'s own sweep', () => {
  const T = sweep({ r: { 'codeql.sarif': sarif('CodeQL', [
    traced('js/command-line-injection', 'src/a.js', [
      [loc('src/a.js', 3, 'req.query.dir'), loc('src/a.js', 6, "'ls ' + req.query.dir")],
      [loc('src/a.js', 4, 'req.query.x'), loc('src/b.js', 2, 'x'), loc('src/a.js', 6, "'ls ' + req.query.dir")],
    ]),
    { ruleId: 'js/missing-rate-limiting', locations: [{ physicalLocation: { artifactLocation: { uri: 'src/a.js' }, region: { startLine: 5 } } }] },
  ]) } });
  try {
    const roll = { ...rollup([], [], { sastCodeql: [
      { repo: 'r', rule: 'js/command-line-injection', file: 'src/a.js', sev: 'high' },
      { repo: 'r', rule: 'js/missing-rate-limiting', file: 'src/a.js', sev: 'med' },
      { repo: 'r', rule: 'js/sql-injection', file: 'src/z.js', sev: 'high' },
    ] }), source: T };
    const v = D.determinationView(roll, EMPTY_ALIAS, NOW, { rows: 'all', dataflow: D.dataflowForRollup(roll, NOW) });
    assert.equal(v.reachability.proven, 1);
    assert.equal(v.unknownBecause['rule-traces-no-path'], 1, 'a syntactic rule never looked');
    assert.equal(v.unknownBecause['dataflow-no-row'], 1, 'the sweep holds nothing for this finding');
    assert.equal(v.unknownBecause['no-analyser-for-lane'], 0, 'a taint lane HAS an analyser');
    const row = v.rows.find((x) => x.rule === 'js/command-line-injection');
    assert.equal(row.reachability, 'reachable');
    assert.equal(row.evidence[0].method, 'dataflow');
    assert.equal(row.evidence[0].source, 'codeql');
    assert.equal(row.routes, 2, 'both distinct routes are counted, not the first');
    assert.equal(row.route.steps, 2, 'the shortest route leads');
    assert.equal(row.determination.reachability, 'reachable');
    assert.equal(v.dataflow.state, 'ok');
    assert.deepEqual([v.dataflow.findings, v.dataflow.proven, v.dataflow.routes], [3, 1, 2]);
  } finally { rmSync(T, { recursive: true, force: true }); }
});

test('Psalm taint paths count too, attributed to Psalm', () => {
  const T = sweep({ p: { 'psalm.sarif': sarif('Psalm', [traced('TaintedShell', 'inc/x.php', [[loc('inc/x.php', 2, '$_GET'), loc('inc/x.php', 8, 'shell_exec')]])]) } });
  try {
    const roll = { repos: [], scannerFindings: { sastPhpPsalm: [{ repo: 'p', rule: 'TaintedShell', file: 'inc/x.php', sev: 'high' }] }, source: T };
    const v = D.determinationView(roll, EMPTY_ALIAS, NOW, { rows: 'all', dataflow: D.dataflowForRollup(roll, NOW) });
    assert.equal(v.reachability.proven, 1);
    assert.equal(v.rows[0].evidence[0].source, 'psalm');
  } finally { rmSync(T, { recursive: true, force: true }); }
});

test('a rollup that names no sweep makes taint evidence UNAVAILABLE — never "no analyser"', () => {
  const roll = rollup([], [], { sastCodeql: [{ repo: 'r', rule: 'js/xss', file: 'a.js', sev: 'high' }] });
  const dataflow = D.dataflowForRollup(roll, NOW);
  assert.equal(dataflow.state, 'absent');
  const v = D.determinationView(roll, EMPTY_ALIAS, NOW, { dataflow });
  assert.equal(v.unknownBecause['dataflow-evidence-unavailable'], 1);
  assert.equal(v.unknownBecause['no-analyser-for-lane'], 0);
  assert.equal(v.dataflow.state, 'absent');
  assert.match(v.dataflow.reason, /names no sweep/);
});

test('a sweep directory that is gone is ABSENT, and one that cannot be listed is UNREADABLE', () => {
  const gone = D.dataflowForRollup({ source: join(tmpdir(), `det-df-gone-${process.pid}`) }, NOW);
  assert.equal(gone.state, 'absent');
  const T = mkdtempSync(join(tmpdir(), 'det-df-file-'));
  const file = join(T, 'not-a-dir');
  writeFileSync(file, 'x');
  try {
    const bad = D.dataflowForRollup({ source: file }, NOW);
    assert.equal(bad.state, 'unreadable', 'ENOTDIR is not "legitimately absent"');
    const v = D.determinationView({ repos: [], scannerFindings: { sastCodeql: [{ repo: 'r', rule: 'js/xss', file: 'a.js' }] } }, EMPTY_ALIAS, NOW, { dataflow: bad });
    assert.equal(v.unknownBecause['dataflow-evidence-unavailable'], 1);
  } finally { rmSync(T, { recursive: true, force: true }); }
});

test('the frontier of the rollup\'s own sweep travels beside the determinations, never inside them', () => {
  const plain = join(REPO, 'cra', 'test', 'fixtures', 'taint-frontier', 'plain');
  const models = mkdtempSync(join(tmpdir(), 'det-models-'));   // never the operator's private store
  try {
    const f = D.frontierFor({ source: plain }, { modelsDir: models });
    assert.equal(f.state, 'ok');
    assert.deepEqual([f.totals.calls, f.totals.unclaimed], [1, 1]);
    assert.deepEqual([f.totals.open, f.totals.neutral, f.totals.sinkOpen], [1, 0, 0], 'no worksheet: every unclaimed call is still open');
    assert.equal(f.apis[0].api, 'weird-db-client.raw()');
    assert.equal(f.byRepo.fx.languages['javascript-typescript'].state, 'ran');
    assert.equal(f.apisCut, null);
    mkdirSync(join(models, 'fx'));
    writeFileSync(join(models, 'fx', 'frontier-review.json'), JSON.stringify({ v: 1, repo: 'fx', entries: [
      { language: 'javascript-typescript', api: 'weird-db-client.raw()', param: 'param 0', decision: { as: 'neutral', why: 'fixture: plumbing' } }] }));
    const reviewed = D.frontierFor({ source: plain }, { modelsDir: models });
    assert.deepEqual([reviewed.totals.unclaimed, reviewed.totals.open, reviewed.totals.neutral], [1, 0, 1], 'a reviewed call stays unclaimed but is no longer open');
    const none = D.frontierFor({});
    assert.equal(none.state, 'absent', 'no sweep named is not an empty frontier');
  } finally { rmSync(models, { recursive: true, force: true }); }
});

test('agreement travels beside the determination: counted per state, on the row, and never changes reachability', () => {
  const T = sweep({
    r: {
      'codeql.sarif': sarif('CodeQL', [traced('js/command-line-injection', 'src/a.js', [[loc('src/a.js', 3, 'req.query.dir'), loc('src/a.js', 6, 'exec(..)')]])]),
      // Semgrep on Windows spells the same file with backslashes, at the route's sink
      'semgrep.sarif': sarif('Semgrep OSS', [{ ruleId: 'javascript.exec.non-literal', locations: [{ physicalLocation: { artifactLocation: { uri: 'src\\a.js' }, region: { startLine: 6 } } }] }]),
    },
    solo: { 'codeql.sarif': sarif('CodeQL', [traced('js/xss', 'b.js', [[loc('b.js', 1, 'location'), loc('b.js', 9, 'innerHTML')]])]) },
  });
  try {
    const roll = { ...rollup([], [], {
      sastCodeql: [{ repo: 'r', rule: 'js/command-line-injection', file: 'src/a.js', sev: 'high' }, { repo: 'solo', rule: 'js/xss', file: 'b.js', sev: 'high' }],
      sastSemgrep: [{ repo: 'r', rule: 'javascript.exec.non-literal', file: 'src\\a.js', sev: 'med' }],
    }), source: T };
    const v = D.determinationView(roll, EMPTY_ALIAS, NOW, { rows: 'all', dataflow: D.dataflowForRollup(roll, NOW) });
    const a = v.dataflow.agreement;
    assert.deepEqual([a.corroborated, a['single-engine'], a.uncorroborated], [2, 1, 0]);
    assert.deepEqual([a.witnessPath, a.witnessFinding], [1, 1], 'the Semgrep finding is witnessed by a CodeQL route; the CodeQL finding only by a Semgrep finding');
    const cq = v.rows.find((x) => x.rule === 'js/command-line-injection');
    assert.equal(cq.corroboration.state, 'corroborated');
    assert.deepEqual(cq.corroboration.witnesses.map((w) => w.engine), ['semgrep']);
    const sg = v.rows.find((x) => x.lane === 'sastSemgrep');
    assert.equal(sg.reachability, 'reachability_unknown', 'a CodeQL route at the same site is a witness, never the Semgrep finding\'s own path');
    assert.equal(sg.why, 'rule-traces-no-path');
    assert.equal(v.rows.find((x) => x.repo === 'solo').corroboration.state, 'single-engine');
  } finally { rmSync(T, { recursive: true, force: true }); }
});

test('a reports-root-relative `source` is read under the reports root, never the panel\'s cwd', () => {
  // The real rollup of the 2026-10-21 sweep carries a bare batch name as `source`.
  const root = sweep({ 'batch-1/r': { 'codeql.sarif': sarif('CodeQL', [traced('js/xss', 'a.js', [[loc('a.js', 1, 'location'), loc('a.js', 9, 'innerHTML')]])]) } });
  try {
    const roll = { ...rollup([], [], { sastCodeql: [{ repo: 'r', rule: 'js/xss', file: 'a.js', sev: 'high' }] }), source: 'batch-1' };
    assert.equal(D.sweepDirOf(roll, root).dir, join(root, 'batch-1'));
    const df = D.dataflowForRollup(roll, NOW, { root });
    assert.equal(df.state, 'ok');
    const v = D.determinationView(roll, EMPTY_ALIAS, NOW, { rows: 'all', dataflow: df });
    assert.equal(v.reachability.proven, 1, 'resolved against the cwd the batch is absent and the finding reads unavailable');
    assert.equal(D.frontierFor(roll, { root, modelsDir: join(root, 'no-models') }).byRepo.r.languages['javascript-typescript'].state, 'not-run');
    assert.equal(D.sweepDirOf({ source: root }).dir, root, 'an older rollup\'s absolute source is taken as written');
    assert.equal(D.sweepDirOf({}).state, 'absent');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a duplicate lane (the sast-auto comparison arm) is named and left out of the population, as the rollup totals leave it', () => {
  // Measured on a real batch (2026-10-21): sastAuto's 87 rows sat beside sastSemgrep's 88, the same rule packs run twice.
  const roll = rollup([], [], {
    sastSemgrep: [{ repo: 'r', rule: 'js.fmt', file: 'a.ts', sev: 'med' }],
    sastAuto: [{ repo: 'r', rule: 'js.fmt', file: 'a.ts', sev: 'med' }],
  });
  const v = D.determinationView(roll, EMPTY_ALIAS, NOW, { rows: 'all' });
  assert.equal(v.total, 1, 'one finding, not the same finding twice');
  assert.deepEqual(v.rows.map((r) => r.lane), ['sastSemgrep']);
  assert.ok(v.duplicateLanes.lanes.includes('sastAuto'));
  assert.match(v.duplicateLanes.why, /count each finding twice/);
  assert.equal(v.excludedLanes.lanes.includes('sastAuto'), false, 'a duplicate is a finding, not a non-finding: named apart');
  assert.ok(D.duplicateLanes().has('sastAuto'));
});
