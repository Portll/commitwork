// Computes which tests to run for a set of changed files (bin/lib/test-selection.mjs planSelection).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSelection } from '../lib/test-selection.mjs';

test('returns none mode when no files differ from HEAD', () => {
  const r = planSelection({ changed: [], modules: new Map(), tests: [] });
  assert.deepEqual(r, { mode: "none", reason: "nothing differs from HEAD" });
});

test('returns full mode when a selector input file is changed', () => {
  const r = planSelection({ changed: ['package.json'], modules: new Map(), tests: [] });
  assert.deepEqual(r, { mode: "full", reason: "package.json decides selection or runs the suite" });
});

test('returns full mode when a changed file has null deps', () => {
  const r = planSelection({ changed: ['src/a.mjs'], modules: new Map([['src/a.mjs', { deps: null, text: '' }]]), tests: [] });
  assert.deepEqual(r, { mode: "full", reason: "src/a.mjs could not be parsed, so its imports are unknown" });
});

test('returns full mode when no test is known to reach a changed file', () => {
  const r = planSelection({ changed: ['src/lib.mjs'], modules: new Map([['src/lib.mjs', { deps: [], text: '' }]]), tests: ['test/x.test.mjs'] });
  assert.deepEqual(r, { mode: "full", reason: "no test is known to reach src/lib.mjs" });
});

test('returns selective mode with changed test reason when a test file is changed', () => {
  const r = planSelection({ changed: ['test/a.test.mjs'], modules: new Map([['test/a.test.mjs', { deps: [], text: '' }]]), tests: ['test/a.test.mjs'] });
  assert.deepEqual(r, { mode: "selective", tests: ["test/a.test.mjs"], why: new Map([["test/a.test.mjs", "changed"]]) });
});

test('selects importer test when a module it imports is changed', () => {
  const r = planSelection({ changed: ['src/lib.mjs'], modules: new Map([['src/lib.mjs', { deps: [], text: '' }], ['test/a.test.mjs', { deps: ['src/lib.mjs'], text: '' }]]), tests: ['test/a.test.mjs'] });
  assert.deepEqual(r, { mode: "selective", tests: ["test/a.test.mjs"], why: new Map([["test/a.test.mjs", "src/lib.mjs: imports src/lib.mjs"]]) });
});

test('selects test that names a changed file by token mention', () => {
  const r = planSelection({ changed: ['src/rollup.mjs'], modules: new Map([['src/rollup.mjs', { deps: [], text: '' }], ['test/a.test.mjs', { deps: [], text: 'spawn src/rollup.mjs' }]]), tests: ['test/a.test.mjs'] });
  assert.deepEqual(r, { mode: "selective", tests: ["test/a.test.mjs"], why: new Map([["test/a.test.mjs", "src/rollup.mjs: names rollup.mjs"]]) });
});

test('selects test that uses a changed fixture in its directory', () => {
  const r = planSelection({ changed: ['test/fixtures/data.json'], modules: new Map([['test/fixtures/data.json', { deps: [], text: '' }], ['test/a.test.mjs', { deps: [], text: 'data.json' }]]), tests: ['test/a.test.mjs'] });
  assert.deepEqual(r, { mode: "selective", tests: ["test/a.test.mjs"], why: new Map([["test/a.test.mjs", "test/fixtures/data.json: names data.json"]]) });
});

test('selects runner test when a test it runs is reached', () => {
  const r = planSelection({ changed: ['src/lib.mjs'], modules: new Map([['src/lib.mjs', { deps: [], text: '' }], ['test/a.test.mjs', { deps: ['src/lib.mjs'], text: 'gate-spine.mjs' }], ['test/runner.test.mjs', { deps: [], text: '' }]]), tests: ['test/a.test.mjs', 'test/runner.test.mjs'], runners: new Map([['test/runner.test.mjs', /gate-spine\.mjs/]]) });
  assert.deepEqual(r, { mode: "selective", tests: ["test/a.test.mjs", "test/runner.test.mjs"], why: new Map([["test/a.test.mjs", "src/lib.mjs: imports src/lib.mjs"], ["test/runner.test.mjs", "src/lib.mjs: runs test/a.test.mjs"]]) });
});

test('preserves first reason when multiple paths reach the same test', () => {
  const r = planSelection({ changed: ['src/lib.mjs'], modules: new Map([['src/lib.mjs', { deps: [], text: '' }], ['test/a.test.mjs', { deps: ['src/lib.mjs'], text: 'src/lib.mjs' }]]), tests: ['test/a.test.mjs'] });
  assert.deepEqual(r, { mode: "selective", tests: ["test/a.test.mjs"], why: new Map([["test/a.test.mjs", "src/lib.mjs: imports src/lib.mjs"]]) });
});
