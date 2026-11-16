// What feeding a repository its own scan and its own test run needs (flow/dfd-coverage-adapter.mjs
// traceHops, hopsExercisedByLcov, driftedSteps, splitDrifted; lib/dfd.mjs subgraph; flow/dfd-cli.mjs
// sourceLines, --taint-only, and the refusal to draw a flow the source has moved under).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateDfd, subgraph, taintOnly } from '../../lib/dfd.mjs';
import { traceOf } from '../../cra/dataflow-evidence.mjs';
import { fromCodeFlows } from '../dfd-adapter.mjs';
import { traceHops, hopsExercisedByLcov, applyExercised, driftedSteps, splitDrifted, parseLcov } from '../dfd-coverage-adapter.mjs';
import { sourceLines, prepare, main } from '../dfd-cli.mjs';

const step = (file, line, expr, col, endCol) => ({ file, line, expr, ...(col === undefined ? {} : { col, endCol }) });
const record = (trace, rule = 'js/sql-injection') => ({ repo: 'shop', rule, file: 'api/db.js', reachability: 'reachable',
  path: { steps: trace.length, flows: 1, source: trace[0], sink: trace[trace.length - 1], trace } });
const TRACE = [step('api/routes.js', 4, 'req.query'), step('api/routes.js', 5, 'q'), step('api/routes.js', 20, 'parse(q)'), step('api/db.js', 12, 'sql')];
const FUNCTIONS = { 'api/routes.js': [[1, 10, 'handle'], [18, 25, 'parse']], 'api/db.js': [[10, 14, 'run']] };
const functionOf = (file, line) => {
  if (!FUNCTIONS[file]) return undefined;
  const hit = FUNCTIONS[file].find(([a, b]) => line >= a && line <= b);
  return hit ? { name: hit[2], kind: 'function' } : null;
};
const lcovOf = (files) => parseLcov(Object.entries(files).map(([f, lines]) => [`SF:${f}`, ...Object.entries(lines).map(([l, h]) => `DA:${l},${h}`), 'end_of_record'].join('\n')).join('\n') + '\n');

test('traceHops names the hops fromCodeFlows draws, each with the two steps it joins', () => {
  // arrange
  const rec = record(TRACE);
  // act
  const hops = traceHops(rec, functionOf);
  const drawn = fromCodeFlows([rec], { functionOf }).flows.map((f) => `${f.from}>${f.to}`);
  // assert
  assert.deepEqual(hops.map((h) => `${h.from}>${h.to}`), drawn);
  assert.deepEqual(hops.map((h) => [h.a.line, h.b.line]), [[4, 4], [5, 20], [20, 12], [12, 12]]);
});

test('traceHops places a step in an unreadable file on the file, in module code on the module, and gives nothing without a trace', () => {
  // arrange
  const rec = record([step('api/routes.js', 4, 'req.query'), step('api/routes.js', 14, 'top'), step('lib/blob.bin', 3, 'x')]);
  // act
  const hops = traceHops(rec, functionOf);
  const none = [traceHops(null, functionOf), traceHops({ path: {} }, functionOf), traceHops({ path: { trace: [] } }, functionOf)];
  // assert
  assert.deepEqual(hops.map((h) => h.to), ['fn:shop:api/routes.js#handle', 'fn:shop:api/routes.js#', 'code:shop:lib/blob.bin', hops[3].to]);
  assert.match(hops[3].to, /^sink:shop:/);
  assert.deepEqual(none, [[], [], []]);
});

test('traceHops falls back to the source file for a step that names none', () => {
  // arrange
  const rec = record([step('api/routes.js', 4, 'req.query'), step(null, 9, 'lost')]);
  // act
  const hops = traceHops(rec, functionOf);
  // assert
  assert.equal(hops[1].to, 'code:shop:api/routes.js');
});

test('hopsExercisedByLcov: both lines ran is observed, an instrumented line that never ran is missed, an absent line is unmeasured', () => {
  // arrange
  const lcov = lcovOf({ '/repo/api/routes.js': { 4: 2, 5: 1, 20: 0 }, 'api/db.js': { 1: 1 }, '/elsewhere/x.js': { 1: 1 } });
  // act
  const got = hopsExercisedByLcov([record(TRACE)], lcov, { functionOf, root: '/repo' });
  // assert: input>handle ran (4,4); handle>parse instrumented, line 20 never ran; parse>run and run>sink sit on line 12, not in the report
  assert.deepEqual(got.observed, [{ from: 'input:shop:api/routes.js:4', to: 'fn:shop:api/routes.js#handle' }]);
  assert.deepEqual(got.missed, [{ from: 'fn:shop:api/routes.js#handle', to: 'fn:shop:api/routes.js#parse' }]);
  assert.equal(got.unmeasured, 2);
});

test('hopsExercisedByLcov keeps a hop observed when any record ran it, sums a file reported twice, and takes no records', () => {
  // arrange: the same hop from two traces; one through a line that never ran, one through a line that did
  const cold = record([step('api/routes.js', 4, 'req.query'), step('api/routes.js', 6, 'a'), step('api/routes.js', 21, 'b')]);
  const warm = record([step('api/routes.js', 4, 'req.query'), step('api/routes.js', 5, 'a'), step('api/routes.js', 20, 'b')]);
  const lcov = [...lcovOf({ 'api/routes.js': { 4: 1, 5: 0, 6: 0, 20: 1, 21: 0 } }), ...lcovOf({ 'api/routes.js': { 5: 3 } })];
  // act
  const coldFirst = hopsExercisedByLcov([cold, warm], lcov, { functionOf });
  const warmFirst = hopsExercisedByLcov([warm, cold], lcov, { functionOf });
  const empty = hopsExercisedByLcov(null, lcov, { functionOf });
  // assert
  const hop = { from: 'fn:shop:api/routes.js#handle', to: 'fn:shop:api/routes.js#parse' };
  assert.ok(coldFirst.observed.some((h) => h.from === hop.from && h.to === hop.to));
  assert.ok(warmFirst.observed.some((h) => h.from === hop.from && h.to === hop.to));
  assert.ok(!coldFirst.missed.some((h) => h.from === hop.from && h.to === hop.to));
  assert.deepEqual(empty, { observed: [], missed: [], unmeasured: 0 });
});

test('applyExercised writes a missed pair as not exercised, and never over one that was observed', () => {
  // arrange
  const model = fromCodeFlows([record(TRACE)], { functionOf });
  const [a, b, c] = model.flows;
  // act
  const got = applyExercised(model, [{ from: a.from, to: a.to }], { witness: 'w', missed: [{ from: a.from, to: a.to }, { from: b.from, to: b.to }, { from: 'no', to: 'flow' }] });
  // assert
  const state = (f) => got.model.flows.find((x) => x.from === f.from && x.to === f.to).coverage;
  assert.equal(state(a).exercised, true);
  assert.equal(state(b).exercised, false);
  assert.equal(state(c), undefined);
  assert.equal(validateDfd(got.model).ok, true);
});

test('driftedSteps reports a step whose text is no longer where the scan put it, exact or abbreviated', () => {
  // arrange
  const src = { 'a.mjs': ['const me = process.env.X;', '  try { return fs.realpathSync(\'/etc/resolv.conf\'); } catch {}', 'out.settings = file;'] };
  const lineOf = (file, line) => (src[file] ? src[file][line - 1] ?? null : null);
  const ok = record([step('a.mjs', 1, 'process.env', 12, 23), step('a.mjs', 2, "fs.real ... .conf')", 16, 51), step('a.mjs', 3, '[post update] out [settings]', 1, 4)]);
  const moved = record([step('a.mjs', 3, 'process.env', 12, 23), step('a.mjs', 1, "fs.real ... .conf')", 16, 51), step('gone.mjs', 1, 'x', 1, 2)]);
  // act
  const clean = driftedSteps(ok, lineOf);
  const drift = driftedSteps(moved, lineOf);
  // assert
  assert.deepEqual(clean, []);
  assert.deepEqual(drift.map((d) => `${d.file}:${d.line}`), ['a.mjs:3', 'a.mjs:1', 'gone.mjs:1']);
});

test('driftedSteps does not count a step it cannot check', () => {
  // arrange: no columns, no file, no text, a multi-line expression
  const rec = record([step('a.mjs', 1, 'x'), step(null, 1, 'x', 1, 2), step('a.mjs', 1, null, 1, 2), step('a.mjs', 1, '{\n  a }', 1, 2)]);
  // act
  const got = [driftedSteps(rec, () => 'unrelated'), driftedSteps(null, () => ''), driftedSteps({ path: {} }, () => '')];
  // assert
  assert.deepEqual(got, [[], [], []]);
});

test('splitDrifted keeps the current records and names the drifted ones with their steps', () => {
  // arrange
  const lineOf = () => 'const q = req.query;';
  const current = record([step('a.mjs', 1, 'req.query', 11, 20)]);
  const stale = record([step('a.mjs', 1, 'req.body', 11, 19)]);
  const bare = { repo: 'shop', rule: 'r', reachability: 'unknown' };
  // act
  const got = splitDrifted([current, stale, bare], lineOf);
  const none = splitDrifted(undefined, lineOf);
  // assert
  assert.deepEqual(got.current, [current, bare]);
  assert.deepEqual(got.drifted.map((d) => [d.record, d.steps.length]), [[stale, 1]]);
  assert.deepEqual(none, { current: [], drifted: [] });
});

test('traceOf carries a step\'s columns only when its region sits on one line', () => {
  // arrange
  const loc = (region) => ({ location: { physicalLocation: { artifactLocation: { uri: 'a.mjs' }, region }, message: { text: 'x' } } });
  const result = { codeFlows: [{ threadFlows: [{ locations: [loc({ startLine: 3, startColumn: 5, endColumn: 9 }), loc({ startLine: 3, startColumn: 5, endLine: 4, endColumn: 2 }), loc({ startLine: 3, endLine: 3, startColumn: 1, endColumn: 2 }), loc({ startLine: 7 })] }] }] };
  // act
  const got = traceOf(result);
  // assert
  assert.deepEqual(got, [{ file: 'a.mjs', line: 3, expr: 'x', col: 5, endCol: 9 }, { file: 'a.mjs', line: 3, expr: 'x' }, { file: 'a.mjs', line: 3, expr: 'x', col: 1, endCol: 2 }, { file: 'a.mjs', line: 7, expr: 'x' }]);
});

test('sourceLines reads each file once, and answers null outside the file, the root, or a file it cannot read', () => {
  // arrange
  let reads = 0;
  const read = (p) => { reads++; if (p.endsWith('missing.mjs')) throw new Error('ENOENT'); return 'one\r\ntwo\n'; };
  const lineOf = sourceLines('/repo', read);
  // act
  const got = [lineOf('a.mjs', 1), lineOf('a.mjs', 2), lineOf('a.mjs', 0), lineOf('a.mjs', 9), lineOf('missing.mjs', 1), lineOf('../out.mjs', 1)];
  // assert
  assert.deepEqual(got, ['one', 'two', null, null, null, null]);
  assert.equal(reads, 2);
});

const MODEL = {
  v: 1, kind: 'dfd', title: 't',
  source: { producer: 'authored', omitted: { tests: 2 } },
  groups: [{ id: 'g', label: 'G', boundary: 'trust' }, { id: 'inner', label: 'I', boundary: 'system', parent: 'g' }, { id: 'unused', label: 'U', boundary: 'trust' }],
  nodes: [
    { id: 'in', kind: 'external', label: 'in' }, { id: 'p', kind: 'process', label: 'p', group: 'inner' },
    { id: 'out', kind: 'external', label: 'out' }, { id: 'side', kind: 'store', label: 'side', group: 'unused' },
  ],
  flows: [
    { from: 'in', to: 'p', mode: 'sync', label: 'a', evidence: { existence: 'confirmed', method: 'taint' } },
    { from: 'p', to: 'out', mode: 'sync', label: 'b', evidence: { existence: 'confirmed', method: 'taint' } },
    { from: 'p', to: 'side', mode: 'async', label: 'c' },
  ],
  findings: [{ id: 'F1', at: { flow: { from: 'p', to: 'out' } } }, { id: 'F2', at: { node: 'side' } }, { id: 'F3', at: { flow: { from: 'p', to: 'side' } } }, { id: 'F4', at: { node: 'p' } }],
  patches: [
    { id: 'K1', closes: [{ from: 'p', to: 'out' }, { from: 'p', to: 'side' }], guard: { from: 'p', to: 'side' }, rejects: [{ from: 'p', to: 'side' }], findings: ['F1', 'F2'] },
    { id: 'K2', closes: [{ from: 'p', to: 'side' }] },
    { id: 'K3', closes: [{ from: 'in', to: 'p' }], guard: { from: 'in', to: 'p' } },
  ],
};

test('subgraph keeps the chosen flows and what they join, drops what names nothing left, and counts what it left out', () => {
  // arrange
  assert.equal(validateDfd(MODEL).ok, true, JSON.stringify(validateDfd(MODEL).errors));
  // act
  const got = subgraph(MODEL, taintOnly);
  // assert
  assert.equal(validateDfd(got).ok, true, JSON.stringify(validateDfd(got).errors));
  assert.deepEqual(got.nodes.map((n) => n.id), ['in', 'p', 'out']);
  assert.deepEqual(got.flows.map((f) => f.label), ['a', 'b']);
  assert.deepEqual(got.groups.map((g) => g.id), ['g', 'inner']);
  assert.deepEqual(got.findings.map((f) => f.id), ['F1', 'F4']);
  assert.deepEqual(got.patches, [{ id: 'K1', closes: [{ from: 'p', to: 'out' }], rejects: [], findings: ['F1'] }, { id: 'K3', closes: [{ from: 'in', to: 'p' }], guard: { from: 'in', to: 'p' } }]);
  assert.deepEqual(got.source.omitted, { tests: 2, 'flows outside the subset': 1, 'elements outside the subset': 1 });
});

test('subgraph of a bare document adds nothing it did not have', () => {
  // arrange
  const bare = { v: 1, kind: 'dfd', nodes: MODEL.nodes.map(({ group, ...n }) => n), flows: MODEL.flows };
  // act
  const got = subgraph(bare, () => true);
  // assert
  assert.equal(validateDfd(got).ok, true, JSON.stringify(validateDfd(got).errors));
  assert.deepEqual(Object.keys(got).sort(), ['flows', 'kind', 'nodes', 'source', 'v']);
  assert.deepEqual(got.source, { producer: 'authored', omitted: { 'flows outside the subset': 0, 'elements outside the subset': 0 } });
});

/** A git checkout holding one traced flow, its scan as SARIF, and an lcov report of a run over it. */
function checkout({ moved = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'flow-dfd-self-'));
  mkdirSync(join(dir, 'api'));
  const src = ['import { run } from "./db.js";', 'export function handle(req) {', '  const q = req.query;', '  return run(q);', '}', ''];
  writeFileSync(join(dir, 'api/routes.js'), (moved ? ['// a line added since the scan', ...src] : src).join('\n'));
  writeFileSync(join(dir, 'api/db.js'), ['export function run(sql) {', '  return exec(sql);', '}', ''].join('\n'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
  git('init', '-q'); git('add', '.');
  const loc = (uri, startLine, startColumn, endColumn, text) => ({ location: { physicalLocation: { artifactLocation: { uri }, region: { startLine, startColumn, endColumn } }, message: { text } } });
  const sarif = { version: '2.1.0', runs: [{ tool: { driver: { name: 'CodeQL', rules: [] } }, results: [{
    ruleId: 'js/sql-injection', message: { text: 'm' }, locations: [loc('api/db.js', 2, 15, 18, 'sql').location],
    codeFlows: [{ threadFlows: [{ locations: [loc('api/routes.js', 3, 13, 22, 'req.query'), loc('api/routes.js', 4, 14, 15, 'q'), loc('api/db.js', 2, 15, 18, 'sql')] }] }],
  }] }] };
  const sarifPath = join(dir, 'scan.sarif');
  writeFileSync(sarifPath, JSON.stringify(sarif));
  const lcov = join(dir, 'lcov.info');
  writeFileSync(lcov, ['SF:api/routes.js', 'DA:3,1', 'DA:4,1', 'end_of_record', 'SF:api/db.js', 'DA:1,1', 'DA:2,0', 'end_of_record', ''].join('\n'));
  return { dir, sarifPath, lcov };
}
const io = () => { const out = []; const err = []; return { out, err, stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) } }; };

test('dfd --functions --coverage --taint-only draws the traced flows alone and says which hops the tests ran', async () => {
  // arrange
  const { dir, sarifPath, lcov } = checkout();
  const out = join(dir, 'model.json');
  const { stdout, stderr, out: said } = io();
  // act
  const code = await main(['--repo', dir, '--codeql', sarifPath, '--functions', '--coverage', lcov, '--taint-only', '--emit', 'model', '--out', out], { stdout, stderr });
  // assert
  assert.equal(code, 0, said.join(''));
  const model = JSON.parse(readFileSync(out, 'utf8'));
  assert.ok(model.flows.every(taintOnly));
  assert.deepEqual(model.flows.map((f) => [f.to.replace(/^.*[:#]/, ''), f.coverage && f.coverage.exercised]), [['handle', true], ['run', false], [model.flows[2].to.replace(/^.*[:#]/, ''), false]]);
  assert.ok(model.source.omitted['flows outside the subset'] >= 0);
  assert.match(said.join(''), /traced hops: 1 run by the tests, 2 not, 0 on lines the report does not hold/);
  assert.doesNotMatch(said.join(''), /NOT DRAWN/);
});

test('dfd --functions leaves out a code flow the source has moved under, and says so in the summary and the model', async () => {
  // arrange
  const { dir, sarifPath } = checkout({ moved: true });
  const out = join(dir, 'model.json');
  const { stdout, stderr, out: said, err: shown } = io();
  // act
  const code = await main(['--repo', dir, '--codeql', sarifPath, '--functions', '--imports', '--emit', 'model', '--out', out], { stdout, stderr });
  // assert
  assert.equal(code, 0, said.join('') + shown.join(''));
  assert.match(said.join(''), /NOT DRAWN: 1 code flow\(s\) whose source has moved since the scan/);
  const model = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(model.source.omitted['code flows the source has moved under since the scan'], 1);
  assert.ok(!model.flows.some(taintOnly));
});

test('dfd --taint-only refuses a model with no traced flow', () => {
  // arrange
  const { dir } = checkout();
  const doc = join(dir, 'm.dfd.json');
  writeFileSync(doc, JSON.stringify({ v: 1, kind: 'dfd', nodes: MODEL.nodes.map(({ group, ...n }) => n), flows: [{ from: 'in', to: 'p', mode: 'sync', label: 'a' }] }));
  // act
  const got = prepare({ from: doc, 'taint-only': true });
  // assert
  assert.match(got.error, /--taint-only: the model holds no traced flow/);
  assert.ok(got.code > 0);
});
