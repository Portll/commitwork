// Function-level code flows: every step of a CodeQL trace placed in the function it sits in
// (cra/dataflow-evidence.mjs traceOf, flow/dfd-adapter.mjs fromCodeFlows with functionOf,
// flow/dfd-cli.mjs functionResolver and --functions), and a path search confined to traced flows
// (lib/dfd.mjs pathStates with taintOnly).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDfd, pathStates, taintOnly } from '../../lib/dfd.mjs';
import { traceOf } from '../../cra/dataflow-evidence.mjs';
import { fromCodeFlows, mergeModels } from '../dfd-adapter.mjs';
import { functionResolver, parseArgs } from '../dfd-cli.mjs';
import { resolve } from 'node:path';

const loc = (uri, line, text) => ({ location: { physicalLocation: { artifactLocation: { uri }, region: { startLine: line } }, message: { text } } });
const step = (file, line, expr) => ({ file, line, expr });
/** routes.js handle() -> routes.js parse() -> db.js run(); one step in a file nobody can read. */
function record(trace) {
  return { repo: 'shop', rule: 'js/sql-injection', file: 'api/db.js', reachability: 'reachable',
    path: { steps: trace.length, flows: 1, source: trace[0], sink: trace[trace.length - 1], trace } };
}
const TRACE = [step('api/routes.js', 4, 'req.query'), step('api/routes.js', 5, 'q'), step('api/routes.js', 20, 'parse(q)'), step('api/db.js', 12, 'sql')];
const FUNCTIONS = { 'api/routes.js': [[1, 10, 'handle'], [18, 25, 'parse']], 'api/db.js': [[10, 14, 'run']] };
const functionOf = (file, line) => {
  if (!FUNCTIONS[file]) return undefined;
  const hit = FUNCTIONS[file].find(([a, b]) => line >= a && line <= b);
  return hit ? { name: hit[2], kind: 'function' } : null;
};

test('traceOf keeps every step of the first thread flow, and is null when there is none', () => {
  // arrange
  const result = { codeFlows: [{ threadFlows: [{ locations: [loc('a.js', 1, 'src'), loc('a.js', 7, null), loc('b.js', 3, 'sink')] }] }] };
  // act
  const got = [traceOf(result), traceOf({}), traceOf({ codeFlows: [{ threadFlows: [{ locations: [] }] }] })];
  // assert
  assert.deepEqual(got[0], [{ file: 'a.js', line: 1, expr: 'src' }, { file: 'a.js', line: 7, expr: null }, { file: 'b.js', line: 3, expr: 'sink' }]);
  assert.deepEqual([got[1], got[2]], [null, null]);
});

test('with functionOf a trace is drawn function by function, grouped by file, and validates', () => {
  // arrange
  const records = [record(TRACE)];
  // act
  const d = fromCodeFlows(records, { functionOf });
  // assert
  assert.deepEqual(validateDfd(d).errors, []);
  assert.deepEqual(d.flows.map((f) => `${f.from} > ${f.to}: ${f.label}`), [
    'input:shop:api/routes.js:4 > fn:shop:api/routes.js#handle: req.query',
    'fn:shop:api/routes.js#handle > fn:shop:api/routes.js#parse: parse(q)',
    'fn:shop:api/routes.js#parse > fn:shop:api/db.js#run: sql',
    'fn:shop:api/db.js#run > sink:shop:database query: sql (js/sql-injection)',
  ]);
  assert.deepEqual(d.groups.map((g) => g.id).sort(), ['file:shop:api/db.js', 'file:shop:api/routes.js', 'untrusted']);
  assert.equal(d.nodes.find((n) => n.id === 'fn:shop:api/routes.js#parse').label, 'parse()');
  assert.equal(d.source.omitted.noFunction, 0);
});

test('consecutive steps in one function are one visit, and a return to it is drawn', () => {
  // arrange: handle -> parse -> handle -> run
  const trace = [step('api/routes.js', 4, 'a'), step('api/routes.js', 5, 'b'), step('api/routes.js', 20, 'c'), step('api/routes.js', 6, 'd'), step('api/db.js', 12, 'e')];
  // act
  const d = fromCodeFlows([record(trace)], { functionOf });
  // assert
  assert.deepEqual(d.flows.slice(1, 4).map((f) => `${f.from.split('#')[1]}>${f.to.split('#')[1]}`), ['handle>parse', 'parse>handle', 'handle>run']);
});

test('a step outside any function is the module level of its file', () => {
  // arrange
  const trace = [step('api/routes.js', 14, 'top'), step('api/db.js', 12, 'sql')];
  // act
  const d = fromCodeFlows([record(trace)], { functionOf });
  // assert
  const top = d.nodes.find((n) => n.id === 'fn:shop:api/routes.js#');
  assert.equal(top.label, 'api/routes.js (module level)');
});

test('a step whose file cannot be read falls back to the file element and is counted', () => {
  // arrange
  const trace = [step('vendor/x.py', 3, 'arg'), step('api/db.js', 12, 'sql')];
  // act
  const d = fromCodeFlows([record(trace)], { functionOf });
  // assert
  assert.equal(d.source.omitted.noFunction, 1);
  assert.equal(d.nodes.some((n) => n.id === 'code:shop:vendor/x.py'), true);
  assert.deepEqual(validateDfd(d).errors, []);
});

test('without functionOf, or without a trace, the drawing is the file-level one', () => {
  // arrange
  const withTrace = record(TRACE);
  const noTrace = record(TRACE);
  delete noTrace.path.trace;
  // act
  const a = fromCodeFlows([withTrace]);
  const b = fromCodeFlows([noTrace], { functionOf });
  // assert
  assert.deepEqual(a.nodes.map((n) => n.id), b.nodes.map((n) => n.id));
  assert.equal(a.nodes.some((n) => n.id.startsWith('fn:')), false);
  assert.equal('noFunction' in a.source.omitted, false);
});

test('every code flow is marked as a traced value', () => {
  // arrange
  const d = fromCodeFlows([record(TRACE)], { functionOf });
  // act
  const methods = new Set(d.flows.map((f) => f.evidence.method));
  // assert
  assert.deepEqual([...methods], ['taint']);
});

test('taintOnly stops a module-level call site standing in for a trace', () => {
  // arrange: an env name feeds the module that holds the sink; CodeQL traced a different source into it
  const code = fromCodeFlows([{ repo: 'shop', rule: 'js/command-line-injection', file: 'lib/run.mjs', reachability: 'reachable',
    path: { steps: 2, flows: 1, source: step('lib/run.mjs', 3, 'argv'), sink: step('lib/run.mjs', 9, 'cmd') } }]);
  const stat = { v: 1, kind: 'dfd', nodes: [{ id: 'node:module:lib/run.mjs', kind: 'process', label: 'lib/run.mjs' }, { id: 'node:env:HOME', kind: 'external', subtype: 'env', label: 'HOME' }],
    flows: [{ from: 'node:env:HOME', to: 'node:module:lib/run.mjs', mode: 'sync', label: 'reads' }] };
  const merged = mergeModels(stat, code);
  // act
  const loose = pathStates(merged);
  const strict = pathStates(merged, { via: taintOnly });
  // assert
  assert.equal(loose.sources.includes('node:env:HOME'), true);
  assert.deepEqual(strict.sources, ['input:shop:lib/run.mjs:3']);
  assert.deepEqual(strict.impacts.map((i) => [i.impact, i.state, i.witness.nodes[0]]), [['critical', 'open', 'input:shop:lib/run.mjs:3']]);
  assert.equal(strict.byFlow[0], null);
});

test('functionResolver places a line, caches the file, and refuses what it cannot read', () => {
  // arrange
  const reads = [];
  const read = (p) => { reads.push(p); if (p.endsWith('gone.mjs')) throw new Error('ENOENT'); return 'export function f() {\n  return 1;\n}\nconst top = 2;\n'; };
  const at = functionResolver('/repo', read);
  // act
  const got = [at('lib/a.mjs', 2), at('lib/a.mjs', 4), at('lib/gone.mjs', 1), at('tools/x.py', 1), at('../outside.mjs', 1)];
  // assert
  assert.deepEqual(got, [{ name: 'f', kind: 'function' }, null, undefined, undefined, undefined]);
  // native absolute paths, as the resolver reads them: `C:\repo\lib\a.mjs` on Windows
  assert.deepEqual(reads, [resolve('/repo', 'lib/a.mjs'), resolve('/repo', 'lib/gone.mjs')]);
});

test('--functions needs both the sources and the traces', () => {
  // arrange
  const argv = [['--codeql', 'x.sarif', '--functions'], ['--repo', '.', '--functions'], ['--repo', '.', '--codeql', 'x.sarif', '--functions']];
  // act
  const parsed = argv.map((a) => parseArgs(a));
  // assert
  assert.match(parsed[0].error, /--functions places each CodeQL step/);
  assert.match(parsed[1].error, /--functions places each CodeQL step/);
  assert.equal(parsed[2].error, undefined);
});
