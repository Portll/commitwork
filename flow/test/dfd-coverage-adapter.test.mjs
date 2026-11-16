// flow/dfd-coverage-adapter.mjs: lcov -> nodes[].coverage, and a test run's observations ->
// flows[].coverage. The rule under every test: absent is not zero.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLcov, relativePath, functionOfNode, applyLcov, applyExercised } from '../dfd-coverage-adapter.mjs';

const LCOV = [
  'TN:',
  'SF:lib/a.mjs',
  'FN:1,outer',
  'FN:5,7,inner',
  'FNDA:3,outer',
  'FNDA:0,inner',
  'FNF:2',
  'FNH:1',
  'BRDA:2,0,0,3',
  'BRDA:2,0,1,-',
  'BRDA:6,1,0,0',
  'DA:1,3',
  'DA:2,3',
  'DA:5,0',
  'DA:6,0',
  'DA:9,1',
  'LF:5',
  'LH:3',
  'end_of_record',
  'SF:lib/b.mjs',
  'DA:1,1',
  'end_of_record',
  '',
].join('\n');

const mod = (f) => ({ id: `node:module:${f}`, kind: 'process', label: f });
const fn = (f, name) => ({ id: `fn:repo:${f}#${name}`, kind: 'process', label: name ? `${name}()` : `${f} (module level)` });
const model = (nodes, flows = []) => ({ v: 1, kind: 'dfd', nodes, flows });
const RANGES = { 'lib/a.mjs': [{ name: 'outer', line: 1, endLine: 7 }, { name: 'inner', line: 5, endLine: 7 }] };
const rangesOf = (file) => RANGES[file] || null;

test('parseLcov reads lines, branch arms and functions of each SF block', () => {
  // arrange
  const text = LCOV;
  // act
  const recs = parseLcov(text);
  // assert
  assert.deepEqual(recs.map((r) => r.file), ['lib/a.mjs', 'lib/b.mjs']);
  assert.deepEqual([...recs[0].lines], [[1, 3], [2, 3], [5, 0], [6, 0], [9, 1]]);
  assert.deepEqual(recs[0].branches, [{ line: 2, taken: 3 }, { line: 2, taken: 0 }, { line: 6, taken: 0 }]);
  assert.deepEqual(recs[0].functions, [{ name: 'outer', line: 1, hits: 3 }, { name: 'inner', line: 5, hits: 0 }]);
  assert.equal(recs.malformed, 0);
});

test('parseLcov counts what it cannot read and keeps the rest', () => {
  // arrange: a stray statement before any SF, a bad DA, a bad BRDA, a bad FN, a bad FNDA, a line with
  // no colon, a lower-case key, an end_of_record with no block, an empty SF, a block cut off by a new SF
  const text = ['DA:1,1', 'end_of_record', 'SF:', 'SF:x.mjs', 'DA:one,1', 'BRDA:1,0,0', 'FN:,f', 'FNDA:x,f', 'no colon here', 'da:1,1', 'DA:4,2', 'SF:y.mjs', 'DA:1,0', 'end_of_record'].join('\n');
  // act
  const recs = parseLcov(text);
  // assert
  assert.deepEqual(recs.map((r) => [r.file, [...r.lines]]), [['x.mjs', [[4, 2]]], ['y.mjs', [[1, 0]]]]);
  assert.equal(recs.malformed, 10);
});

test('parseLcov keeps a block the report was cut off inside, and says the report was cut', () => {
  // arrange
  const text = 'SF:x.mjs\r\nDA:1,1\r\nDA:1,2\r\n';
  // act
  const recs = parseLcov(text);
  // assert
  assert.deepEqual([...recs[0].lines], [[1, 3]]);
  assert.equal(recs.malformed, 1);
});

test('parseLcov ignores statements it does not know, and an FNDA whose FN never came still counts', () => {
  // arrange
  const text = ['SF:x.mjs', 'VER:2', 'FNDA:4,late', 'LF:0', 'end_of_record'].join('\n');
  // act
  const recs = parseLcov(text);
  // assert
  assert.deepEqual(recs[0].functions, [{ name: 'late', line: null, hits: 4 }]);
  assert.equal(recs.malformed, 0);
});

test('relativePath strips a root, a leading ./ and backslashes, and refuses an absolute path it cannot place', () => {
  // arrange
  const cases = [['lib/a.mjs', null], ['./lib/a.mjs', null], ['/repo/lib/a.mjs', '/repo/'], ['/repo/lib/a.mjs', null], ['C:\\repo\\lib\\a.mjs', 'C:\\repo'], ['/other/lib/a.mjs', '/repo'], ['D:/x/a.mjs', null]];
  // act
  const got = cases.map(([f, root]) => relativePath(f, root));
  // assert
  assert.deepEqual(got, ['lib/a.mjs', 'lib/a.mjs', 'lib/a.mjs', null, 'lib/a.mjs', null, null]);
});

test('functionOfNode reads a function element and the module level, and nothing else', () => {
  // arrange
  const nodes = [fn('lib/a.mjs', 'Box.open'), fn('lib/a.mjs', ''), mod('lib/a.mjs'), { id: 'fn:broken', kind: 'process', label: 'x' }, { id: 'fn:repo:nohash', kind: 'process', label: 'x' },
    { id: 'fn:repo:lib/a.mjs#f', kind: 'store', label: 'x' }, null];
  // act
  const got = nodes.map(functionOfNode);
  // assert
  assert.deepEqual(got, [{ file: 'lib/a.mjs', name: 'Box.open' }, { file: 'lib/a.mjs', name: '' }, null, null, null, null, null]);
});

test('a file element takes its whole record, with branches, and the input model is not changed', () => {
  // arrange
  const m = model([mod('lib/a.mjs')]);
  // act
  const r = applyLcov(m, parseLcov(LCOV));
  // assert
  assert.deepEqual(r.model.nodes[0].coverage, { lines: { covered: 3, total: 5 }, branches: { covered: 1, total: 3 }, source: 'lcov' });
  assert.equal('coverage' in m.nodes[0], false);
  assert.equal(r.matched, 1);
});

test('a file with no branch record carries no branches field', () => {
  // arrange
  const m = model([mod('lib/b.mjs')]);
  // act
  const r = applyLcov(m, parseLcov(LCOV), { source: 'node --test' });
  // assert
  assert.deepEqual(r.model.nodes[0].coverage, { lines: { covered: 1, total: 1 }, source: 'node --test' });
});

test('an element the report does not hold is unmeasured, never 0%', () => {
  // arrange
  const m = model([mod('lib/c.mjs'), fn('lib/d.mjs', 'f'), { id: 'node:store:S', kind: 'store', label: 'S' }]);
  // act
  const r = applyLcov(m, parseLcov(LCOV), { rangesOf });
  // assert
  assert.equal(r.model.nodes.some((n) => 'coverage' in n), false);
  assert.deepEqual(r.unmeasured, ['lib/c.mjs', 'lib/d.mjs']);
  assert.equal(r.matched, 0);
  assert.deepEqual(r.unmatched, ['lib/a.mjs', 'lib/b.mjs']);
});

test('a function takes the lines whose innermost range is its own, and the module level takes the rest', () => {
  // arrange
  const m = model([fn('lib/a.mjs', 'outer'), fn('lib/a.mjs', 'inner'), fn('lib/a.mjs', '')]);
  // act
  const r = applyLcov(m, parseLcov(LCOV), { rangesOf });
  // assert: outer owns lines 1-2 (5-6 are inner's), inner owns 5-6, line 9 is module level
  assert.deepEqual(r.model.nodes.map((n) => n.coverage), [
    { lines: { covered: 2, total: 2 }, branches: { covered: 1, total: 2 }, source: 'lcov' },
    { lines: { covered: 0, total: 2 }, branches: { covered: 0, total: 1 }, source: 'lcov' },
    { lines: { covered: 1, total: 1 }, source: 'lcov' },
  ]);
  assert.deepEqual([r.matched, r.unranged, r.unmatched], [3, [], ['lib/b.mjs']]);
});

test('a function whose range nobody can give stays unmeasured and is listed', () => {
  // arrange
  const m = model([fn('lib/a.mjs', 'outer'), fn('lib/a.mjs', 'gone'), fn('lib/b.mjs', 'f')]);
  // act
  const none = applyLcov(m, parseLcov(LCOV));
  const some = applyLcov(m, parseLcov(LCOV), { rangesOf });
  // assert
  assert.deepEqual(none.unranged, ['fn:repo:lib/a.mjs#outer', 'fn:repo:lib/a.mjs#gone', 'fn:repo:lib/b.mjs#f']);
  assert.equal(none.model.nodes.some((n) => 'coverage' in n), false);
  assert.deepEqual(some.unranged, ['fn:repo:lib/a.mjs#gone', 'fn:repo:lib/b.mjs#f']);
  // the file was in the report and an element stands for it, so it is not an unmatched report file
  assert.deepEqual(some.unmatched, []);
});

test('a function with no instrumented line is measured, with nothing to cover', () => {
  // arrange
  const m = model([fn('lib/a.mjs', 'empty')]);
  const ranges = () => [{ name: 'empty', line: 20, endLine: 22 }];
  // act
  const r = applyLcov(m, parseLcov(LCOV), { rangesOf: ranges });
  // assert
  assert.deepEqual(r.model.nodes[0].coverage, { lines: { covered: 0, total: 0 }, source: 'lcov' });
});

test('absolute lcov paths need a root; one outside it is listed as written; the same file twice adds its hits', () => {
  // arrange
  const text = ['SF:/repo/lib/a.mjs', 'DA:1,0', 'BRDA:1,0,0,0', 'end_of_record', 'SF:/repo/lib/a.mjs', 'DA:1,2', 'DA:2,0', 'BRDA:1,0,0,1', 'end_of_record', 'SF:/elsewhere/z.mjs', 'DA:1,1', 'end_of_record', 'junk'].join('\n');
  const m = model([mod('lib/a.mjs')]);
  // act
  const rooted = applyLcov(m, parseLcov(text), { root: '/repo' });
  const bare = applyLcov(m, parseLcov(text));
  // assert
  assert.deepEqual(rooted.model.nodes[0].coverage, { lines: { covered: 1, total: 2 }, branches: { covered: 1, total: 2 }, source: 'lcov' });
  assert.deepEqual(rooted.unmatched, ['/elsewhere/z.mjs']);
  assert.equal(rooted.malformed, 1);
  assert.deepEqual([bare.matched, bare.unmeasured], [0, ['lib/a.mjs']]);
});

test('applyLcov with no records measures nothing', () => {
  // arrange
  const m = model([mod('lib/a.mjs')]);
  // act
  const r = applyLcov(m, null);
  // assert
  assert.deepEqual([r.matched, r.unmeasured, r.unmatched, r.malformed], [0, ['lib/a.mjs'], [], 0]);
});

// ── flows ────────────────────────────────────────────────────────────────────────────────────────

const A = 'node:module:lib/a.mjs';
const B = 'node:module:lib/b.mjs';
const S = 'node:store:S';
const flowed = () => model([mod('lib/a.mjs'), mod('lib/b.mjs'), { id: S, kind: 'store', label: 'S' }],
  [{ from: A, to: S, mode: 'sync' }, { from: S, to: B, mode: 'sync' }, { from: B, to: A, mode: 'sync', evidence: { witness: 'both', existence: 'confirmed' } }]);

test('a pair a test took is exercised, with the tests that took it; the rest is unmeasured', () => {
  // arrange
  const m = flowed();
  // act
  const r = applyExercised(m, [{ from: A, to: S, tests: ['t2', 't1'] }, { from: A, to: S, tests: ['t1'] }], { witness: 'node --test lib' });
  // assert
  assert.deepEqual(r.model.flows[0].coverage, { exercised: true, tests: ['t1', 't2'], witness: 'node --test lib' });
  assert.equal('coverage' in r.model.flows[1], false);
  assert.deepEqual([r.exercised, r.notExercised, r.unmeasured, r.unmatched], [1, 0, 2, 0]);
  assert.equal('coverage' in m.flows[0], false);
});

test('a flow the model already calls runtime-confirmed is not exercised on that account', () => {
  // arrange: flows[2] carries evidence witness both, existence confirmed
  const m = flowed();
  // act
  const r = applyExercised(m, []);
  // assert
  assert.equal('coverage' in r.model.flows[2], false);
  assert.equal(r.unmeasured, 3);
});

test('with the elements the run entered, a flow leaving one and not taken is not exercised', () => {
  // arrange
  const m = flowed();
  // act
  const r = applyExercised(m, [{ from: A, to: S }], { entered: [A, B] });
  // assert
  assert.deepEqual(r.model.flows.map((f) => f.coverage), [{ exercised: true }, undefined, { exercised: false }]);
  assert.deepEqual([r.exercised, r.notExercised, r.unmeasured], [1, 1, 1]);
});

test('a pair that names no flow, or is not a pair, is counted and marks nothing', () => {
  // arrange
  const m = flowed();
  // act
  const r = applyExercised(m, [{ from: A, to: B }, { from: A }, null]);
  // assert
  assert.deepEqual([r.unmatched, r.exercised], [3, 0]);
});

test('a reconcile report marks visited-confirmed exercised, visited-unconfirmed not, and leaves unvisited and unfalsifiable unmeasured', () => {
  // arrange
  const m = flowed();
  const report = { edges: [
    { from: A, to: S, kind: 'writes', runtimeCoverage: 'visited', existence: 'confirmed' },
    { from: S, to: B, kind: 'reads', runtimeCoverage: 'visited', existence: 'unknown' },
    { from: B, to: A, kind: 'reads', runtimeCoverage: 'unvisited', existence: 'unknown' },
    { from: 'node:module:x.mjs', to: S, kind: 'reads', runtimeCoverage: 'visited', existence: 'confirmed' },
    { from: B, to: A, kind: 'connects', runtimeCoverage: 'visited', existence: 'unknown', unfalsifiable: true },
  ] };
  // act
  const r = applyExercised(m, report, { testRun: true, witness: 'flow-reconcile.json' });
  // assert
  assert.deepEqual(r.model.flows.map((f) => f.coverage), [{ exercised: true, witness: 'flow-reconcile.json' }, { exercised: false, witness: 'flow-reconcile.json' }, undefined]);
  assert.deepEqual([r.exercised, r.notExercised, r.unmeasured, r.unmatched], [1, 1, 1, 1]);
});

test('two reconcile edges on one pair: confirmed wins in either order', () => {
  // arrange
  const m = flowed();
  const yes = { from: A, to: S, runtimeCoverage: 'visited', existence: 'confirmed' };
  const no = { from: A, to: S, runtimeCoverage: 'visited', existence: 'unknown' };
  // act
  const first = applyExercised(m, { edges: [yes, no] }, { testRun: true });
  const last = applyExercised(m, { edges: [no, yes] }, { testRun: true });
  // assert
  assert.deepEqual([first.model.flows[0].coverage, last.model.flows[0].coverage], [{ exercised: true }, { exercised: true }]);
  assert.deepEqual([first.notExercised, last.notExercised], [0, 0]);
});

test('a reconcile report is refused unless the caller states it is of a test run', () => {
  // arrange
  const m = flowed();
  // act
  const call = () => applyExercised(m, { edges: [] });
  // assert
  assert.throws(call, /does not say what was run/);
});

test('anything that is neither pairs nor a reconcile report is refused', () => {
  // arrange
  const m = flowed();
  // act
  const calls = [() => applyExercised(m, null), () => applyExercised(m, { confirmed: [] })];
  // assert
  for (const c of calls) assert.throws(c, /array of \{ from, to \} pairs or a reconcile report/);
});

// ── the command: --coverage ──────────────────────────────────────────────────────────────────────

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, parseArgs, prepare, readCoverage, rangeResolver, EXIT, HELP, USAGE } from '../dfd-cli.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'flow-dfd-cov-'));
function run(argv) {
  const out = [];
  const err = [];
  const code = main(argv, { env: {}, stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) } });
  return { code, out: out.join(''), err: err.join('') };
}
const SRC = 'export function outer(a) {\n  return a;\n}\n\nexport function inner() {\n  return 1;\n}\n\nconst top = 1;\n';
const docFile = (dir) => {
  const path = join(dir, 'doc.json');
  writeFileSync(path, JSON.stringify(model([mod('lib/a.mjs'), mod('lib/c.mjs'), { id: 'node:store:S', kind: 'store', subtype: 'file', label: 'S' }],
    [{ from: 'node:module:lib/a.mjs', to: 'node:store:S', mode: 'sync' }, { from: 'node:store:S', to: 'node:module:lib/c.mjs', mode: 'sync' }])));
  return path;
};

test('parseArgs takes --coverage with a value, and the usage and help name it', () => {
  // arrange
  const argv = ['--from', 'x.json', '--coverage', 'cov.lcov'];
  // act
  const got = parseArgs(argv);
  const bare = parseArgs(['--from', 'x.json', '--coverage']);
  // assert
  assert.equal(got.opts.coverage, 'cov.lcov');
  assert.match(bare.error, /--coverage needs a value/);
  assert.match(USAGE, /\[--coverage lcov\]/);
  assert.match(HELP, /--coverage <file>/);
});

test('rangeResolver gives a file its functions, and null for what it cannot read', () => {
  // arrange
  const read = (p) => { if (p.endsWith('gone.mjs')) throw new Error('ENOENT'); if (p.endsWith('bad.mjs')) return 'export function f() { return `${'; return SRC; };
  const rangesIn = rangeResolver('/repo', read);
  // act
  const got = [rangesIn('lib/a.mjs'), rangesIn('lib/gone.mjs'), rangesIn('lib/bad.mjs'), rangesIn('tools/x.py'), rangesIn('../out.mjs')];
  // assert
  assert.deepEqual(got[0].map((f) => [f.name, f.line, f.endLine]), [['outer', 1, 3], ['inner', 5, 7]]);
  assert.deepEqual(got.slice(1), [null, null, null, null]);
});

test('readCoverage measures file elements, and function elements when the checkout is given', () => {
  // arrange
  const files = { '/r/cov.lcov': 'SF:lib/a.mjs\nDA:1,2\nDA:2,2\nDA:5,0\nDA:6,0\nDA:9,1\nend_of_record\n', '/r/lib/a.mjs': SRC };
  const read = (p) => { if (!(p in files)) throw Object.assign(new Error('no such file'), { code: 'ENOENT' }); return files[p]; };
  const m = model([mod('lib/a.mjs'), fn('lib/a.mjs', 'inner'), fn('lib/a.mjs', '')]);
  // act
  const bare = readCoverage('/r/cov.lcov', m, undefined, read);
  const rooted = readCoverage('/r/cov.lcov', m, '/r', read);
  // assert
  assert.deepEqual(bare.coverage, { measured: 1, unmeasured: 0, unmatched: 0, unranged: 2, malformed: 0 });
  assert.deepEqual(rooted.coverage, { measured: 3, unmeasured: 0, unmatched: 0, unranged: 0, malformed: 0 });
  assert.deepEqual(rooted.model.nodes.map((n) => n.coverage.lines), [{ covered: 3, total: 5 }, { covered: 0, total: 2 }, { covered: 1, total: 1 }]);
  assert.equal(rooted.model.nodes[0].coverage.source, 'lcov cov.lcov');
});

test('readCoverage refuses a file it cannot read and a report with no record', () => {
  // arrange
  const read = (p) => { if (p === '/r/empty.lcov') return 'not lcov\n'; if (p === '/r/blank.lcov') return ''; throw Object.assign(new Error('nope'), { code: 'ENOENT' }); };
  const m = model([mod('lib/a.mjs')]);
  // act
  const gone = readCoverage('/r/gone.lcov', m, undefined, read);
  const empty = readCoverage('/r/empty.lcov', m, undefined, read);
  const blank = readCoverage('/r/blank.lcov', m, undefined, read);
  const noCode = readCoverage('/r/x.lcov', m, undefined, () => { throw new Error('plain message'); });
  // assert
  assert.equal(gone.error, '--coverage /r/gone.lcov: ENOENT');
  assert.equal(empty.error, '--coverage /r/empty.lcov holds no lcov record (no SF block); 1 line(s) could not be read');
  assert.equal(blank.error, '--coverage /r/blank.lcov holds no lcov record (no SF block)');
  assert.equal(noCode.error, '--coverage /r/x.lcov: plain message');
});

test('prepare carries the coverage counts only when --coverage was given', () => {
  // arrange
  const dir = tmp();
  const doc = docFile(dir);
  const lcov = join(dir, 'cov.lcov');
  writeFileSync(lcov, 'SF:lib/a.mjs\nDA:1,1\nDA:2,0\nend_of_record\nSF:lib/z.mjs\nDA:1,1\nend_of_record\n');
  // act
  const withCov = prepare({ from: doc, coverage: lcov });
  const without = prepare({ from: doc });
  // assert
  assert.deepEqual(withCov.coverage, { measured: 1, unmeasured: 1, unmatched: 1, unranged: 0, malformed: 0 });
  assert.deepEqual(withCov.model.nodes[0].coverage.lines, { covered: 1, total: 2 });
  assert.equal('coverage' in without, false);
});

test('the command writes the measured model and says what it measured, on one line', () => {
  // arrange
  const dir = tmp();
  const doc = docFile(dir);
  const lcov = join(dir, 'cov.lcov');
  const out = join(dir, 'out.json');
  writeFileSync(lcov, 'SF:lib/a.mjs\nDA:1,1\nend_of_record\nstray\n');
  // act
  const r = run(['--from', doc, '--coverage', lcov, '--emit', 'model', '--out', out]);
  // assert
  assert.equal(r.code, EXIT.OK);
  assert.match(r.out, /; coverage: 1 element\(s\) measured, 1 file\(s\) not in the report, 0 report file\(s\) with no element, 0 function\(s\) without a range, 1 report line\(s\) unreadable\n$/);
  assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')).nodes[0].coverage, { lines: { covered: 1, total: 1 }, source: 'lcov cov.lcov' });
  assert.equal(r.err, '');
});

test('an unreadable --coverage file is exit 21 with nothing on stdout', () => {
  // arrange
  const dir = tmp();
  const doc = docFile(dir);
  // act
  const r = run(['--from', doc, '--coverage', join(dir, 'absent.lcov'), '--emit', 'model']);
  // assert
  assert.equal(r.code, EXIT.INPUT);
  assert.equal(r.out, '');
  assert.match(r.err, /--coverage .*absent\.lcov: ENOENT/);
});

test('without --coverage the summary line says nothing about coverage', () => {
  // arrange
  const dir = tmp();
  const doc = docFile(dir);
  // act
  const r = run(['--from', doc, '--emit', 'model', '--out', join(dir, 'o.json')]);
  // assert
  assert.equal(r.code, EXIT.OK);
  assert.doesNotMatch(r.out, /coverage/);
});
