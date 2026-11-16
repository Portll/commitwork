// flow/dfd-rescan.mjs: the fileset a commit makes worth scanning again (rescanScope) and what the
// rescan says the commit closed (diffCodeFlows). Pure functions; no git, no scanner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDfd } from '../../lib/dfd.mjs';
import { fromCodeFlows } from '../dfd-adapter.mjs';
import { fileOfNode, rescanScope, recordKey, pairsOfRecord, diffCodeFlows, classifyFile, FILE_CLASSES } from '../dfd-rescan.mjs';

const mod = (f) => ({ id: `node:module:${f}`, kind: 'process', label: f });
const flow = (from, to, extra = {}) => ({ from, to, mode: 'sync', ...extra });
/** a.mjs writes store S, b.mjs and c.mjs read it; c.mjs feeds d.mjs; e.mjs feeds a.mjs; env E is read by a.mjs and z.mjs. */
function graph() {
  return {
    v: 1, kind: 'dfd',
    nodes: [mod('a.mjs'), mod('b.mjs'), mod('c.mjs'), mod('d.mjs'), mod('e.mjs'), mod('z.mjs'),
      { id: 'node:store:S', kind: 'store', subtype: 'file', label: 'S' },
      { id: 'node:env:E', kind: 'external', subtype: 'env', label: 'E' }],
    flows: [
      flow('node:module:a.mjs', 'node:store:S'), flow('node:store:S', 'node:module:b.mjs'), flow('node:store:S', 'node:module:c.mjs'),
      flow('node:module:c.mjs', 'node:module:d.mjs'), flow('node:module:e.mjs', 'node:module:a.mjs'),
      flow('node:env:E', 'node:module:a.mjs'), flow('node:env:E', 'node:module:z.mjs'),
    ],
  };
}
const rec = (rule, sf, sl, se, kf, kl, ke) => ({ repo: 'r', rule, file: kf, reachability: 'reachable', path: { steps: 3, flows: 1, source: { file: sf, line: sl, expr: se }, sink: { file: kf, line: kl, expr: ke } } });

test('fileOfNode reads a module and a code element, and gives null for anything that is not a file', () => {
  // arrange
  const nodes = [mod('lib/x.mjs'), { id: 'code:repo:src/y.js', kind: 'process', label: 'src/y.js' }, { id: 'node:store:S', kind: 'store', label: 'S' }, { id: 'group:g', kind: 'process', label: 'g (3 elements)' }];
  // act
  const files = nodes.map(fileOfNode);
  // assert
  assert.deepEqual(files, ['lib/x.mjs', 'src/y.js', null, null]);
});

test('one hop reaches a reader through a store and a direct feeder, and no further', () => {
  // arrange
  const m = graph();
  // act
  const s = rescanScope(m, ['a.mjs'], { hops: 1 });
  // assert
  assert.deepEqual(s.changed, ['a.mjs']);
  assert.deepEqual(s.downstream, ['b.mjs', 'c.mjs']);
  assert.deepEqual(s.upstream, ['e.mjs']);
  assert.deepEqual(s.files, ['a.mjs', 'b.mjs', 'c.mjs', 'e.mjs']);
});

test('two readers of one env name are not neighbours: nothing flows between them', () => {
  // arrange
  const m = graph();
  // act
  const s = rescanScope(m, ['a.mjs'], { hops: 3 });
  // assert
  assert.equal(s.files.includes('z.mjs'), false);
});

test('a second hop adds the file after the reader', () => {
  // arrange
  const m = graph();
  // act
  const s = rescanScope(m, ['a.mjs'], { hops: 2 });
  // assert
  assert.deepEqual(s.downstream, ['b.mjs', 'c.mjs', 'd.mjs']);
});

test('zero hops is the changed files alone', () => {
  // arrange
  const m = graph();
  // act
  const s = rescanScope(m, ['c.mjs', 'a.mjs'], { hops: 0 });
  // assert
  assert.deepEqual(s.files, ['a.mjs', 'c.mjs']);
  assert.deepEqual([s.downstream, s.upstream], [[], []]);
});

test('a changed file the model has no element for is reported and still rescanned', () => {
  // arrange
  const m = graph();
  // act
  const s = rescanScope(m, ['docs/new.md', 'a.mjs', 'a.mjs'], { hops: 0 });
  // assert
  assert.deepEqual(s.unmatched, ['docs/new.md']);
  assert.deepEqual(s.files, ['a.mjs', 'docs/new.md']);
});

test('a flow whose direction was never determined is walked both ways', () => {
  // arrange
  const m = graph();
  m.flows.push(flow('node:module:z.mjs', 'node:module:d.mjs', { directed: false }));
  // act
  const s = rescanScope(m, ['d.mjs'], { hops: 1 });
  // assert
  assert.deepEqual(s.downstream, ['z.mjs']);
  assert.deepEqual(s.upstream, ['c.mjs', 'z.mjs']);
});

test('rescanScope refuses hops that is not a whole number', () => {
  // arrange
  const m = graph();
  // act
  const call = () => rescanScope(m, ['a.mjs'], { hops: -1 });
  // assert
  assert.throws(call, /hops must be a whole number/);
});

test('recordKey ignores line numbers, which move when code above them changes', () => {
  // arrange
  const one = rec('js/command-line-injection', 'a.mjs', 10, 'argv', 'b.mjs', 20, 'cmd');
  const moved = rec('js/command-line-injection', 'a.mjs', 14, 'argv', 'b.mjs', 31, 'cmd');
  const other = rec('js/command-line-injection', 'a.mjs', 10, 'env', 'b.mjs', 20, 'cmd');
  // act
  const keys = [recordKey(one), recordKey(moved), recordKey(other)];
  // assert
  assert.equal(keys[0], keys[1]);
  assert.notEqual(keys[0], keys[2]);
});

test('pairsOfRecord names the same flows fromCodeFlows draws', () => {
  // arrange
  const r = rec('js/command-line-injection', 'a.mjs', 10, 'argv', 'b.mjs', 20, 'cmd');
  const drawn = new Set(fromCodeFlows([r]).flows.map((f) => `${f.from}>${f.to}`));
  // act
  const pairs = pairsOfRecord(r).map((p) => `${p.from}>${p.to}`);
  // assert
  assert.equal(pairs.length, 3);
  assert.deepEqual(pairs.filter((p) => !drawn.has(p)), []);
});

test('a record absent after a rescan that covered both its files is closed, and the patch validates against the before model', () => {
  // arrange
  const fixed = rec('js/command-line-injection', 'a.mjs', 10, 'argv', 'b.mjs', 20, 'cmd');
  const kept = rec('js/path-injection', 'c.mjs', 5, 'req.url', 'c.mjs', 9, 'path');
  const model = fromCodeFlows([fixed, kept]);
  // act
  const d = diffCodeFlows([fixed, kept], [kept], { commit: 'aaaaaaa1bbbb', covered: ['a.mjs', 'b.mjs', 'c.mjs'] });
  model.patches = [d.patch];
  // assert
  assert.deepEqual([d.closed.length, d.persisting.length, d.opened.length, d.carried.length, d.unexpressed.length], [1, 1, 0, 0, 0]);
  assert.deepEqual(d.patch.commits, ['aaaaaaa1bbbb']);
  assert.equal(d.patch.evidence.level, 'rescanned');
  assert.deepEqual(d.patch.closes, [{ from: 'code:r:b.mjs', to: 'sink:r:operating-system command' }]);
  assert.deepEqual(validateDfd(model).errors, []);
});

test('a record whose file the rescan did not cover is carried, never closed', () => {
  // arrange
  const r = rec('js/command-line-injection', 'a.mjs', 10, 'argv', 'b.mjs', 20, 'cmd');
  // act
  const d = diffCodeFlows([r], [], { commit: 'aaaaaaa1', covered: ['a.mjs'] });
  // assert
  assert.deepEqual([d.closed.length, d.carried.length], [0, 1]);
  assert.equal(d.patch, null);
});

test('a new record after the commit is opened', () => {
  // arrange
  const r = rec('js/path-injection', 'c.mjs', 5, 'req.url', 'c.mjs', 9, 'path');
  // act
  const d = diffCodeFlows([], [r], { commit: 'aaaaaaa1', covered: ['c.mjs'] });
  // assert
  assert.deepEqual(d.opened, [r]);
  assert.equal(d.patch, null);
});

test('a closed record that shares every pair with one still present is unexpressed, not written as a patch', () => {
  // arrange: same source location, same file, same sink class; one expression fixed, one not
  const fixed = rec('js/command-line-injection', 'a.mjs', 10, 'argv', 'a.mjs', 20, 'cmd1');
  const kept = rec('js/command-line-injection', 'a.mjs', 10, 'argv', 'a.mjs', 30, 'cmd2');
  // act
  const d = diffCodeFlows([fixed, kept], [kept], { commit: 'aaaaaaa1', covered: ['a.mjs'] });
  // assert
  assert.deepEqual(d.unexpressed, [fixed]);
  assert.equal(d.patch, null);
});

test('a record with no trace takes no part, and a missing commit is refused', () => {
  // arrange
  const untraced = { repo: 'r', rule: 'js/unused', file: 'a.mjs', reachability: 'reachability_unknown', path: null };
  // act
  const d = diffCodeFlows([untraced], [], { commit: 'aaaaaaa1', covered: ['a.mjs'] });
  const call = () => diffCodeFlows([], [], { covered: [] });
  // assert
  assert.deepEqual([d.closed, d.carried, d.patch], [[], [], null]);
  assert.throws(call, /needs the commit/);
});

// ── classes, tests as leaves, data files, the full-scan cap ─────────────────────────────────────

/** lib/a.mjs and lib/b.mjs are both imported by one test; the test also reads data/x.json; lib/a.mjs reads a bare package.json that tool.mjs reads too. */
function classed() {
  const bare = (name) => ({ id: `node:store:${name}`, kind: 'store', subtype: 'file', label: name, note: 'bare filename: a name, not a location' });
  return {
    v: 1, kind: 'dfd',
    nodes: [mod('lib/a.mjs'), mod('lib/b.mjs'), mod('lib/test/a.test.mjs'), mod('bin/tool.mjs'), mod('bin/run.mjs'),
      { id: 'node:store:data/x.json', kind: 'store', subtype: 'file', label: 'data/x.json' }, bare('package.json')],
    flows: [
      flow('node:module:lib/a.mjs', 'node:module:lib/test/a.test.mjs', { label: 'imports' }),
      flow('node:module:lib/b.mjs', 'node:module:lib/test/a.test.mjs', { label: 'imports' }),
      flow('node:store:data/x.json', 'node:module:lib/test/a.test.mjs'), flow('node:store:data/x.json', 'node:module:bin/run.mjs'),
      flow('node:store:package.json', 'node:module:lib/a.mjs'), flow('node:store:package.json', 'node:module:bin/tool.mjs'),
      flow('node:module:lib/a.mjs', 'node:module:bin/run.mjs', { label: 'imports' }),
    ],
  };
}

test('classifyFile puts a JS test under test and a lockfile under deps, before their extensions say otherwise', () => {
  // arrange
  const paths = ['lib/x.mjs', 'lib/test/x.test.mjs', 'flow/test/fixtures/a.json', 'package.json', 'deno.lock', '.github/workflows/ci.yml', 'docs/a.md', 'README.md',
    'manifests/base.json', 'tools/scan.py', 'Makefile'];
  // act
  const got = paths.map(classifyFile);
  // assert
  assert.deepEqual(got, ['source', 'test', 'test', 'deps', 'deps', 'ci', 'docs', 'docs', 'data', 'source-other', 'other']);
  assert.equal(got.every((c) => FILE_CLASSES.includes(c)), true);
});

test('a changed source names the tests to run, and a test is never walked through', () => {
  // arrange
  const m = classed();
  // act
  const s = rescanScope(m, ['lib/a.mjs'], { hops: 2 });
  // assert: the test imports lib/b.mjs too, which does not make b a neighbour of a
  assert.deepEqual(s.tests, ['lib/test/a.test.mjs']);
  assert.deepEqual(s.downstream, ['bin/run.mjs']);
  assert.equal(s.files.includes('lib/b.mjs'), false);
  assert.equal(s.files.includes('lib/test/a.test.mjs'), false);
});

test('a changed test is rescanned itself and names what it is evidence for, without rescanning it', () => {
  // arrange
  const m = classed();
  // act
  const s = rescanScope(m, ['lib/test/a.test.mjs']);
  // assert
  assert.deepEqual(s.tests, ['lib/test/a.test.mjs']);
  assert.deepEqual(s.evidenceFor, ['lib/a.mjs', 'lib/b.mjs']);
  assert.deepEqual(s.files, ['lib/test/a.test.mjs']);
});

test('a changed data file matched by path brings in its readers, and the tests that read it', () => {
  // arrange
  const m = classed();
  // act
  const s = rescanScope(m, ['data/x.json']);
  // assert
  assert.deepEqual(s.data, [{ file: 'data/x.json', elements: ['node:store:data/x.json'], ambiguous: false }]);
  assert.deepEqual(s.downstream, ['bin/run.mjs']);
  assert.deepEqual(s.tests, ['lib/test/a.test.mjs']);
  assert.deepEqual(s.unmatched, []);
});

test('a file matched only by bare filename is marked ambiguous, and a bare filename is not walked through from elsewhere', () => {
  // arrange
  const m = classed();
  // act
  m.nodes.push({ id: 'node:store:rollup.json', kind: 'store', subtype: 'file', label: 'rollup.json', note: 'bare filename: a name, not a location' });
  m.flows.push(flow('node:store:rollup.json', 'node:module:lib/a.mjs'), flow('node:store:rollup.json', 'node:module:bin/tool.mjs'));
  const byName = rescanScope(m, ['reports/rollup.json']);
  const fromSource = rescanScope(m, ['bin/tool.mjs'], { hops: 2 });
  // assert
  assert.deepEqual(byName.data, [{ file: 'reports/rollup.json', elements: ['node:store:rollup.json'], ambiguous: true }]);
  assert.deepEqual(byName.downstream, ['bin/tool.mjs', 'lib/a.mjs']);
  assert.equal(fromSource.files.includes('lib/a.mjs'), false);
});

test('classes are reported for every changed file, matched or not', () => {
  // arrange
  const m = classed();
  // act
  const s = rescanScope(m, ['docs/guide.md', 'lib/a.mjs', 'tools/x.py']);
  // assert
  assert.deepEqual(s.classes, { 'docs/guide.md': 'docs', 'lib/a.mjs': 'source', 'tools/x.py': 'source-other' });
  assert.deepEqual(s.unmatched, ['docs/guide.md', 'tools/x.py']);
});

test('full is set when the scope passes the share of non-test files the caller allows', () => {
  // arrange: four non-test file elements
  const m = classed();
  // act
  const small = rescanScope(m, ['lib/b.mjs'], { fullOver: 0.25 });
  const large = rescanScope(m, ['lib/a.mjs'], { fullOver: 0.25 });
  // assert
  assert.deepEqual([small.fileElements, small.files.length, small.full], [4, 1, false]);
  assert.deepEqual([large.files.length, large.full], [2, true]);
});

test('a changed manifest is rescanned and seeds no walk: a version bump does not touch every reader of a package.json', () => {
  // arrange
  const m = classed();
  // act
  const s = rescanScope(m, ['package.json']);
  // assert
  assert.deepEqual(s.deps, ['package.json']);
  assert.deepEqual([s.data, s.unmatched, s.downstream, s.upstream], [[], [], [], []]);
  assert.deepEqual(s.files, ['package.json']);
});
