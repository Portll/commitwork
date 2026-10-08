import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planSelection, resolveDeps, turnDecision, freshFailures, runSelector, SELECTOR_INPUTS, RUNNER_TESTS } from '../lib/test-selection.mjs';

const mod = (deps = [], text = '') => ({ deps, text });
const world = (entries) => new Map(Object.entries(entries));

test('a change selects the tests that import it transitively, not only tests beside it', () => {
  const modules = world({
    'monitor/store.mjs': mod(),
    'monitor/rollup.mjs': mod(['monitor/store.mjs']),
    'monitor/test/rollup.test.mjs': mod(['monitor/rollup.mjs']),
    'bin/test/other.test.mjs': mod(),
  });
  const plan = planSelection({ changed: ['monitor/store.mjs'], modules, tests: ['monitor/test/rollup.test.mjs', 'bin/test/other.test.mjs'] });
  assert.equal(plan.mode, 'selective');
  assert.deepEqual(plan.tests, ['monitor/test/rollup.test.mjs']);
});

test('a test that spawns a script by composed path is selected for the script AND for what it imports', () => {
  const modules = world({
    'monitor/store-paths.mjs': mod(),
    'monitor/rollup.mjs': mod(['monitor/store-paths.mjs']),
    'monitor/test/pipeline-canary.test.mjs': mod([], "spawnSync(process.execPath, [join(REPO, 'monitor', 'rollup.mjs')])"),
  });
  const tests = ['monitor/test/pipeline-canary.test.mjs'];
  assert.deepEqual(planSelection({ changed: ['monitor/rollup.mjs'], modules, tests }).tests, tests);
  assert.deepEqual(planSelection({ changed: ['monitor/store-paths.mjs'], modules, tests }).tests, tests);
});

test('a data file selects the tests that reach a module reading it by name', () => {
  const modules = world({
    'bin/taxonomy-web.mjs': mod([], "resolve(REPO, 'monitor', 'failure-taxonomy.json')"),
    'bin/test/taxonomy-web.test.mjs': mod(['bin/taxonomy-web.mjs']),
  });
  const plan = planSelection({ changed: ['monitor/failure-taxonomy.json'], modules, tests: ['bin/test/taxonomy-web.test.mjs'] });
  assert.deepEqual(plan.tests, ['bin/test/taxonomy-web.test.mjs']);
});

test('a fixture change selects the tests in its test directory that name the fixture', () => {
  const modules = world({
    'bin/test/docsite-build.test.mjs': mod([], "const FIXTURE = join(HERE, 'fixtures', 'docsite');"),
    'bin/test/unrelated.test.mjs': mod(),
  });
  const plan = planSelection({ changed: ['bin/test/fixtures/docsite/imported/legacy.html'], modules, tests: ['bin/test/docsite-build.test.mjs', 'bin/test/unrelated.test.mjs'] });
  assert.deepEqual(plan.tests, ['bin/test/docsite-build.test.mjs']);
});

test('a file no test is known to reach runs the FULL suite and names the file', () => {
  const plan = planSelection({ changed: ['docs/orphan.md'], modules: world({ 'bin/test/a.test.mjs': mod() }), tests: ['bin/test/a.test.mjs'] });
  assert.equal(plan.mode, 'full');
  assert.match(plan.reason, /docs\/orphan\.md/);
});

test('an unparseable changed module runs the full suite', () => {
  const plan = planSelection({ changed: ['bin/broken.mjs'], modules: world({ 'bin/broken.mjs': { deps: null, text: '' } }), tests: [] });
  assert.equal(plan.mode, 'full');
  assert.match(plan.reason, /could not be parsed/);
});

test('a change to the selector or the runner runs the full suite', () => {
  for (const f of SELECTOR_INPUTS) {
    assert.equal(planSelection({ changed: [f], modules: world({}), tests: [] }).mode, 'full', f);
  }
});

test('an empty change set selects nothing and says so', () => {
  const plan = planSelection({ changed: [], modules: world({}), tests: ['bin/test/a.test.mjs'] });
  assert.equal(plan.mode, 'none');
});

test('a mention inside a longer filename is not a mention', () => {
  const modules = world({
    'monitor/rollup.mjs': mod(),
    'bin/test/x.test.mjs': mod([], "join(REPO, 'monitor', 'pre-rollup.mjs')"),
    'bin/test/y.test.mjs': mod(['monitor/rollup.mjs']),
  });
  const plan = planSelection({ changed: ['monitor/rollup.mjs'], modules, tests: ['bin/test/x.test.mjs', 'bin/test/y.test.mjs'] });
  assert.deepEqual(plan.tests, ['bin/test/y.test.mjs']);
});

test('dependency specifiers resolve by the loader\'s candidate order', () => {
  const present = new Set(['lib/a.mjs', 'lib/b/index.mjs']);
  assert.deepEqual(resolveDeps('bin/x.mjs', ['../lib/a', '../lib/b', '../lib/missing'], (p) => present.has(p)), ['lib/a.mjs', 'lib/b/index.mjs']);
});

test('a turn runs selectively only against a recent full run, and says why otherwise', () => {
  const now = Date.parse('2026-09-15T12:00:00Z');
  const recent = { at: '2026-09-15T10:00:00Z', names: [] };
  const selective = { mode: 'selective', tests: ['a.test.mjs'] };
  assert.equal(turnDecision(selective, recent, { now }).run, 'selective');
  assert.match(turnDecision(selective, null, { now }).reason, /no full run is on record/);
  assert.match(turnDecision(selective, { at: '2026-09-15T01:00:00Z', names: [] }, { now }).reason, /full run is due/);
  assert.match(turnDecision(selective, { at: '2026-09-16T01:00:00Z', names: [] }, { now }).reason, /full run is due/, 'a record from the future is not recent');
  assert.equal(turnDecision(null, recent, { now }).run, 'full');
  assert.equal(turnDecision({ mode: 'full', reason: 'x' }, recent, { now }).reason, 'x');
  assert.equal(turnDecision({ mode: 'none', reason: 'nothing differs from HEAD' }, recent, { now }).run, 'skip');
});

test('only failures the last full run did not record are fresh', () => {
  assert.deepEqual(freshFailures(['a', 'b', 'b'], ['a']), ['b']);
  assert.deepEqual(freshFailures(['a'], ['a', 'c']), []);
});

test('a plan of the wrong shape runs the full suite instead of reaching the selective path', () => {
  const recent = { at: new Date().toISOString(), names: [] };
  for (const plan of ['not json at all', {}, { mode: 'selective' }, { mode: 'selective', tests: [] }, { mode: 'selective', tests: [1] }]) {
    assert.deepEqual(turnDecision(plan, recent), { run: 'full', reason: 'the selection could not be computed' }, JSON.stringify(plan));
  }
});

test('a runner test is selected when a test it would run is selected, and not otherwise', () => {
  const runners = new Map([['bin/test/runner.test.mjs', /gate-x\.mjs/]]);
  const modules = world({
    'bin/lib/core.mjs': mod(),
    'bin/lib/other.mjs': mod(),
    'bin/test/gate-x.test.mjs': mod(['bin/lib/core.mjs'], ''),
    'bin/test/other.test.mjs': mod(['bin/lib/other.mjs']),
    'bin/test/runner.test.mjs': mod(),
  });
  modules.get('bin/test/gate-x.test.mjs').raw = "// covers bin/gate-x.mjs";
  const tests = ['bin/test/gate-x.test.mjs', 'bin/test/other.test.mjs', 'bin/test/runner.test.mjs'];
  assert.deepEqual(planSelection({ changed: ['bin/lib/core.mjs'], modules, tests, runners }).tests, ['bin/test/gate-x.test.mjs', 'bin/test/runner.test.mjs'],
    'the pattern is read from raw source, so a match inside a comment still counts');
  assert.deepEqual(planSelection({ changed: ['bin/lib/other.mjs'], modules, tests, runners }).tests, ['bin/test/other.test.mjs']);
});

test('each declared runner pattern is the one its runner test actually uses', async () => {
  const { readFileSync } = await import('node:fs');
  const { join, resolve, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  for (const [runner, pattern] of RUNNER_TESTS) {
    assert.ok(readFileSync(join(repo, runner), 'utf8').includes(`/${pattern.source}/`), `${runner} no longer carries /${pattern.source}/ — update RUNNER_TESTS to the pattern it now uses`);
  }
});

test('the default selector runs from a checkout whose path a shell would expand', () => {
  const repo = mkdtempSync(join(tmpdir(), 'cw-sel-$HOME-`x`-'));
  try {
    mkdirSync(join(repo, 'bin'));
    writeFileSync(join(repo, 'bin', 'test-select.mjs'), 'process.stdout.write(JSON.stringify({ tests: [process.argv[2]] }));\n');
    const r = runSelector(repo, { env: {} });
    assert.equal(r.measured.ok, true, r.measured.detail);
    assert.deepEqual(JSON.parse(r.out), { tests: ['--json'] });
  } finally { rmSync(repo, { recursive: true, force: true }); }
});
