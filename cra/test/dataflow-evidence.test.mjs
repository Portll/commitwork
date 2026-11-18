// node --test cra/test/ — CodeQL codeFlows as reachability evidence, and the limit of that claim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
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
  // In the CodeQL JS results measured, every result without codeFlows came from a syntactic rule
  // (js/incomplete-sanitization, js/bad-tag-filter); every dataflow query carried one.
  const r = D.dataflowFromResult(syntactic(), 'repo-a', NOW);
  assert.equal(r.reachability, 'reachability_unknown');
  assert.notEqual(r.reachability, 'unreachable_static', 'publishing the stronger word claims a search that never ran');
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

test('a missing reports dir yields an empty index, not a throw, and SAYS it is absent', () => {
  const { index, stats, state } = D.buildDataflowIndex({ dir: join(tmpdir(), 'nope-' + process.pid) });
  assert.equal(index.size, 0);
  assert.equal(stats.artifacts, 0);
  assert.equal(state, 'absent', 'an empty index from a directory nobody read is not a clean one');
});

// ── THE LIMIT OF THE CLAIM ──────────────────────────────────────────────────────────────────────
test('CodeQL evidence does NOT reach Semgrep findings — the rule namespaces are disjoint', () => {
  // A CodeQL rule id (js/xss-through-dom) names a different finding from any Semgrep rule id, so
  // sastSemgrep and sastGo rows never join. They are not the same finding seen twice.
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

// ── every route, every engine ───────────────────────────────────────────────────────────────────
const sweepOf = (files) => {
  const T = mkdtempSync(join(tmpdir(), 'df-'));
  mkdirSync(join(T, 'sweep-x', 'repo-a'), { recursive: true });
  for (const [name, doc] of Object.entries(files)) writeFileSync(join(T, 'sweep-x', 'repo-a', name), JSON.stringify(doc));
  return T;
};
const withFlows = (rule, file, flows) => ({
  ruleId: rule,
  locations: [{ physicalLocation: { artifactLocation: { uri: file }, region: { startLine: 9 } } }],
  codeFlows: flows.map((locs) => ({ threadFlows: [{ locations: locs }] })),
});

test('EVERY route is kept: distinct ends by file and expression, the shorter of two equal ends', () => {
  // Measured on a real sweep (2026-10-21): 3 results, 9 code flows, 6 distinct routes; codeFlows[0] kept 3.
  const r = withFlows('js/xss', 'a.js', [
    [step('a.js', 1, 'req.url'), step('a.js', 4, 'x'), step('a.js', 9, 'sink')],
    [step('a.js', 1, 'req.url'), step('a.js', 9, 'sink')],                         // same ends, shorter
    [step('b.js', 2, 'req.body'), step('a.js', 9, 'sink')],                        // a different source
  ]);
  const routes = D.routesOf(r);
  assert.equal(routes.length, 2);
  assert.ok(routes.every((x) => x.steps === 2), 'of two routes with the same ends the shorter is kept');
  const row = D.dataflowFromResult(r, 'repo-a', NOW);
  assert.equal(row.paths.length, 2);
  assert.equal(row.path.flows, 3);
  assert.match(row.evidence.detail, /2 distinct routes/);
  assert.ok(row.paths.every((p) => !p.trace), 'the index keeps ends, not traces');
  // one record per route for the diagram, each with its own trace when asked
  const recs = D.dataflowsFromResult(r, 'repo-a', NOW, { trace: true });
  assert.equal(recs.length, 2);
  assert.ok(recs.every((x) => x.path.trace.length === x.path.steps));
  // and the lead route's trace, not the first threadFlow's, when one record is asked for
  const lead = D.dataflowFromResult(r, 'repo-a', NOW, { trace: true });
  assert.equal(lead.path.trace.length, lead.path.steps);
});

test('a route moved down the file is the SAME route — the line takes no part in its identity', () => {
  const a = D.routesOf(withFlows('js/xss', 'a.js', [[step('a.js', 1, 'req.url'), step('a.js', 9, 'sink')]]))[0];
  const b = D.routesOf(withFlows('js/xss', 'a.js', [[step('a.js', 11, 'req.url'), step('a.js', 19, 'sink')]]))[0];
  assert.equal(D.routeKey(a), D.routeKey(b));
});

test('two results of one rule in one file are MERGED, not the later replacing the earlier', () => {
  const T = sweepOf({ 'codeql.sarif': { runs: [{ tool: { driver: { name: 'CodeQL' } }, results: [
    withFlows('js/xss', 'a.js', [[step('a.js', 1, 'req.url'), step('a.js', 9, 'sinkA')]]),
    withFlows('js/xss', 'a.js', [[step('a.js', 2, 'req.body'), step('a.js', 12, 'sinkB')]]),
  ] }] } });
  try {
    const { index, stats, state } = D.buildDataflowIndex({ dir: T, atIso: NOW });
    assert.equal(state, 'ok');
    const got = D.dataflowFor(index, 'repo-a', 'js/xss', 'a.js');
    assert.equal(got.basis, 'path');
    assert.equal(got.paths.length, 2, 'both sinks survive');
    assert.equal(stats.routes, 2);
  } finally { rmSync(T, { recursive: true, force: true }); }
});

test('Psalm and Semgrep artifacts are read, and the engine is named — never filed as CodeQL', () => {
  const psalm = JSON.parse(readFileSync(join(REPO, 'monitor', 'test', 'fixtures', 'lane-capability', 'sastPhpPsalm', 'psalm.sarif'), 'utf8'));
  const T = sweepOf({
    'psalm.sarif': psalm,
    'semgrep.sarif': { runs: [{ tool: { driver: { name: 'Semgrep OSS' } }, results: [syntactic('manifests.semgrep-taint.cw-req-to-shell')] }] },
    'semgrep-oss.sarif': { runs: [{ tool: { driver: { name: 'Semgrep OSS' } }, results: [taint('control-only')] }] },
  });
  try {
    const { index, stats } = D.buildDataflowIndex({ dir: T, atIso: NOW });
    assert.deepEqual(stats.byEngine, { psalm: 1, semgrep: 1 }, 'the Pro-delta control is not a lane artifact');
    const pr = psalm.runs[0].results[0];
    const got = D.dataflowFor(index, 'repo-a', pr.ruleId, D.findingFileOf(pr.locations[0].physicalLocation.artifactLocation.uri));
    assert.equal(got.reachability, 'reachable');
    assert.equal(got.evidence[0].source, 'psalm');
    assert.match(got.evidence[0].detail, /^Psalm traced/);
    const sg = D.dataflowFor(index, 'repo-a', 'manifests.semgrep-taint.cw-req-to-shell', 'b.js');
    assert.equal(sg.basis, 'no-path');
    assert.match(sg.why, /did not export/, 'a Semgrep taint match may have a trace the engine kept to itself');
  } finally { rmSync(T, { recursive: true, force: true }); }
});

test('a directory that cannot be listed is UNREADABLE, never an empty clean index', () => {
  const T = mkdtempSync(join(tmpdir(), 'df-'));
  const file = join(T, 'f');
  writeFileSync(file, 'x');
  try {
    const { state, reason, index } = D.buildDataflowIndex({ dir: file, atIso: NOW });
    assert.equal(state, 'unreadable');
    assert.match(reason, /ENOTDIR/);
    assert.equal(index.size, 0);
  } finally { rmSync(T, { recursive: true, force: true }); }
});

test('findingFileOf is the file the extractor writes into the rollup — or nothing joins', async () => {
  const { _sarifDetail } = await import(pathToFileURL(join(REPO, 'monitor', 'extractors', 'sarif.mjs')).href);
  const T = mkdtempSync(join(tmpdir(), 'df-'));
  const uris = ['file:///src/a.js', 'file://lib/b.js', 'pkg/c.js'];
  writeFileSync(join(T, 'semgrep.sarif'), JSON.stringify({ runs: [{
    invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }],
    tool: { driver: { name: 'Semgrep OSS', rules: [{ id: 'r1' }] } },
    results: uris.map((uri, i) => ({ ruleId: 'r1', level: 'error', message: { text: 'm' }, locations: [{ physicalLocation: { artifactLocation: { uri }, region: { startLine: i + 1 } } }] })),
  }] }));
  try {
    const out = _sarifDetail(T, 'semgrep.sarif', 'sastSemgrep');
    const rows = [];
    const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') { if (typeof v.rule === 'string' && 'file' in v) rows.push(v); else Object.values(v).forEach(walk); } };
    walk(out);
    assert.equal(rows.length, 3, 'the extractor produced the rows this test compares against');
    assert.deepEqual(rows.map((r) => r.file).sort(), uris.map(D.findingFileOf).sort());
  } finally { rmSync(T, { recursive: true, force: true }); }
});

test('DATAFLOW_LANES is exactly the lanes whose artifact this module reads', () => {
  // Read from the extractor's own lane table, so a new CodeQL lane cannot arrive without evidence.
  const src = readFileSync(join(REPO, 'monitor', 'extractors.mjs'), 'utf8');
  const lanes = new Map();
  for (const m of src.matchAll(/\['(\w+)',\s*'[\w-]+',\s*\(d\) => _sarifDetail\(d, '([\w.-]+)'/g)) lanes.set(m[1], m[2]);
  assert.ok(lanes.size > 10, 'the lane table was found');
  const read = [...lanes].filter(([, a]) => D.DATAFLOW_SOURCES.some((s) => s.artifact.test(a))).map(([l]) => l).sort();
  assert.deepEqual(read, [...D.DATAFLOW_LANES].sort());
});

// ── agreement between engines ───────────────────────────────────────────────────────────────────
const doc = (driver, results) => ({ runs: [{ tool: { driver: { name: driver } }, results }] });
const at = (rule, uri, line, extra = {}) => ({ ruleId: rule, locations: [{ physicalLocation: { artifactLocation: { uri }, region: { startLine: line } } }], ...extra });

test('a second engine FAMILY at the finding\'s site corroborates it, across separator spellings', () => {
  // Measured on a real sweep (2026-10-21): CodeQL wrote `app/site/a.ts`, Semgrep on Windows `app\site\a.ts`.
  const T = sweepOf({
    'codeql.sarif': doc('CodeQL', [withFlows('js/sql-injection', 'src/db.js', [[step('src/api.js', 3, 'req.query'), step('src/db.js', 9, 'query(..)')]])]),
    'semgrep.sarif': doc('Semgrep OSS', [at('javascript.sqli.raw-query', 'src\\db.js', 9)]),
  });
  try {
    const b = D.buildDataflowIndex({ dir: join(T, 'sweep-x'), atIso: NOW });
    const c = D.corroborationFor(b, 'repo-a', 'js/sql-injection', 'src/db.js');
    assert.equal(c.state, 'corroborated');
    assert.deepEqual(c.witnesses, [{ engine: 'semgrep', kind: 'finding', rules: ['javascript.sqli.raw-query'] }],
      'a bare Semgrep result is a finding at the site, not a second route');
    const back = D.corroborationFor(b, 'repo-a', 'javascript.sqli.raw-query', 'src\\db.js');
    assert.equal(back.state, 'corroborated');
    assert.deepEqual(back.witnesses.map((w) => [w.engine, w.kind]), [['codeql', 'path']], 'the other direction names the traced route');
  } finally { rmSync(T, { recursive: true, force: true }); }
});

test('semgrep.sarif and semgrep-auto.sarif are ONE witness — the same engine run twice never agrees with itself', () => {
  // Measured on a real sweep: all 89 locations two artifacts shared were this pair, same rule, same columns.
  const T = sweepOf({
    'semgrep.sarif': doc('Semgrep OSS', [at('js.fmt', 'a.ts', 4)]),
    'semgrep-auto.sarif': doc('Semgrep OSS', [at('js.fmt', 'a.ts', 4)]),
  });
  try {
    const b = D.buildDataflowIndex({ dir: join(T, 'sweep-x'), atIso: NOW });
    const c = D.corroborationFor(b, 'repo-a', 'js.fmt', 'a.ts');
    assert.equal(c.state, 'single-engine', 'two artifacts of one family are not a second witness');
    assert.deepEqual(c.witnesses, []);
    assert.equal(D.ENGINE_FAMILY.opengrep, 'semgrep', 'a fork running the same rules is the same family');
  } finally { rmSync(T, { recursive: true, force: true }); }
});

test('another engine that ran and was silent at the site is UNCORROBORATED, not a negative; one that never ran is unmeasured', () => {
  const T = sweepOf({
    'codeql.sarif': doc('CodeQL', [withFlows('js/xss', 'a.js', [[step('a.js', 1, 'req.url'), step('a.js', 9, 'sink')]])]),
    'semgrep.sarif': doc('Semgrep OSS', [at('js.other', 'a.js', 40)]),
  });
  const solo = sweepOf({ 'codeql.sarif': doc('CodeQL', [withFlows('js/xss', 'a.js', [[step('a.js', 1, 'req.url'), step('a.js', 9, 'sink')]])]) });
  try {
    const c = D.corroborationFor(D.buildDataflowIndex({ dir: join(T, 'sweep-x'), atIso: NOW }), 'repo-a', 'js/xss', 'a.js');
    assert.equal(c.state, 'uncorroborated');
    assert.deepEqual(c.others, ['semgrep']);
    assert.match(c.why, /not a negative/);
    const s = D.corroborationFor(D.buildDataflowIndex({ dir: join(solo, 'sweep-x'), atIso: NOW }), 'repo-a', 'js/xss', 'a.js');
    assert.equal(s.state, 'single-engine');
    assert.match(s.why, /not measurable/);
  } finally { rmSync(T, { recursive: true, force: true }); rmSync(solo, { recursive: true, force: true }); }
});

test('a route whose sink lies elsewhere places the finding THERE too; a result with no line is unsited', () => {
  const T = sweepOf({
    // primary location a.js:9, but the route ends at lib.js:20, which is where Semgrep reported
    'codeql.sarif': doc('CodeQL', [withFlows('js/cmd', 'a.js', [[step('a.js', 1, 'argv'), step('lib.js', 20, 'exec(..)')]]),
      { ruleId: 'js/noline', locations: [{ physicalLocation: { artifactLocation: { uri: 'c.js' } } }] }]),
    'semgrep.sarif': doc('Semgrep OSS', [at('js.exec', 'lib.js', 20)]),
  });
  try {
    const b = D.buildDataflowIndex({ dir: join(T, 'sweep-x'), atIso: NOW });
    assert.equal(D.corroborationFor(b, 'repo-a', 'js/cmd', 'a.js').state, 'corroborated');
    assert.equal(D.corroborationFor(b, 'repo-a', 'js/noline', 'c.js').state, 'unsited');
    assert.equal(D.corroborationFor(b, 'repo-a', 'js/absent', 'z.js').state, 'no-row');
    assert.equal(D.corroborationFor({ index: new Map() }, 'repo-a', 'js/cmd', 'a.js').state, 'no-row', 'an index never built is no row, not a crash');
  } finally { rmSync(T, { recursive: true, force: true }); }
});

test('siteKey normalises the separator and nothing else', () => {
  assert.equal(D.siteKey('r', 'a\\b\\c.ts', 7), D.siteKey('r', 'a/b/c.ts', 7));
  assert.notEqual(D.siteKey('r', 'a/b.ts', 7), D.siteKey('r', 'a/B.ts', 7), 'case is the engines\' own spelling, kept');
});

test('a Semgrep result without a path says which kind of rule it is, when the rule\'s definition was read', () => {
  // arrange: one taint rule, one pattern rule, one whose fetch failed, one nobody fetched, and CodeQL
  const sg = (rule, file) => ({ ruleId: rule, locations: [{ physicalLocation: { artifactLocation: { uri: file }, region: { startLine: 2 } } }] });
  const T = sweepOf({
    'semgrep.sarif': { runs: [{ tool: { driver: { name: 'Semgrep OSS' } }, results: [sg('r.taint', 'a.js'), sg('r.search', 'b.js'), sg('r.gone', 'c.js'), sg('r.never', 'd.js')] }] },
    'codeql.sarif': { runs: [{ tool: { driver: { name: 'CodeQL' } }, results: [syntactic()] }] },
  });
  const ruleModes = {
    table: { v: 1, rules: { 'r.taint': { mode: 'taint' }, 'r.search': { mode: 'search' } }, unresolved: { 'r.gone': { reason: 'HTTP 404' } } },
    local: { rules: new Map(), errors: [] },
  };
  try {
    // act
    const b = D.buildDataflowIndex({ dir: T, atIso: NOW, ruleModes });
    const at = (rule, file) => D.dataflowFor(b.index, 'repo-a', rule, file);
    const [t, s, g, n, c] = [at('r.taint', 'a.js'), at('r.search', 'b.js'), at('r.gone', 'c.js'), at('r.never', 'd.js'), at('js/incomplete-sanitization', 'b.js')];
    // assert
    assert.deepEqual([t.ruleMode, s.ruleMode, g.ruleMode, n.ruleMode], [
      { mode: 'taint', source: 'registry' }, { mode: 'search', source: 'registry' },
      { mode: null, source: 'unresolved' }, { mode: null, source: 'unrecorded' },
    ]);
    assert.match(t.why, /is a taint rule .*traced data .*did not export the trace/);
    assert.match(s.why, /is a pattern rule \(mode search, per its registry definition\); it matches a code shape and never looks for a flow/);
    assert.match(g.why, /its mode could not be read \(HTTP 404\)$/);
    assert.match(n.why, /its mode is not recorded/);
    assert.equal(c.ruleMode, undefined, 'a CodeQL row carries no Semgrep rule mode');
    assert.equal(t.reachability, 'reachability_unknown', 'a taint match without its trace is still not shown reachable');
    assert.deepEqual(b.stats.semgrepNoPath, { taint: 1, search: 1, unresolved: 1, unrecorded: 1 });
    assert.deepEqual(b.stats.ruleModes, { state: 'ok', reason: null });
  } finally { rmSync(T, { recursive: true, force: true }); }
});

test('the rule-mode table is read at call time, and one that cannot be used leaves every mode unknown', () => {
  // arrange
  const sg = { ruleId: 'r.search', locations: [{ physicalLocation: { artifactLocation: { uri: 'b.js' }, region: { startLine: 2 } } }] };
  const T = sweepOf({ 'semgrep.sarif': { runs: [{ tool: { driver: { name: 'Semgrep OSS' } }, results: [sg] }] } });
  const table = join(T, 'modes.json');
  const was = process.env.CW_SEMGREP_RULE_MODES;
  try {
    writeFileSync(table, JSON.stringify({ v: 1, rules: { 'r.search': { mode: 'search' } }, unresolved: {} }));
    process.env.CW_SEMGREP_RULE_MODES = table;
    // act
    const ok = D.buildDataflowIndex({ dir: T, atIso: NOW });
    writeFileSync(table, '{corrupt');
    const bad = D.buildDataflowIndex({ dir: T, atIso: NOW });
    // assert
    assert.equal(D.dataflowFor(ok.index, 'repo-a', 'r.search', 'b.js').ruleMode.mode, 'search');
    assert.equal(bad.stats.ruleModes.state, 'unparseable');
    assert.deepEqual(D.dataflowFor(bad.index, 'repo-a', 'r.search', 'b.js').ruleMode, { mode: null, source: 'unrecorded' });
  } finally {
    if (was === undefined) delete process.env.CW_SEMGREP_RULE_MODES; else process.env.CW_SEMGREP_RULE_MODES = was;
    rmSync(T, { recursive: true, force: true });
  }
});
