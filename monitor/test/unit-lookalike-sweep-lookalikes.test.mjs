// Deduplicated, sorted lookalike findings and name counts for observed names (monitor/lookalike.mjs sweepLookalikes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sweepLookalikes } from '../lookalike.mjs';

const lodashOnly = new Set(['lodash']);
const body = ({ coverage, ...rest }) => rest;
const pairs = (r) => r.findings.map((f) => [f.candidate, f.distance]);

test('declared and unrelated names are counted apart and yield no findings', () => {
  const r = sweepLookalikes(['lodash', 'zzzzzzzzzz', 'lodash', 'qqqqqqqqqq'], lodashOnly);
  assert.deepEqual(body(r), {
    observed: 4,
    declaredLegitimate: 2,
    noDeclaredNeighbour: 2,
    findings: [],
    findingCount: 0,
    truncated: 0,
  });
});

test('an empty declared set counts each name as having no declared neighbour', () => {
  const r = sweepLookalikes(['foo'], new Set());
  assert.deepEqual(body(r), {
    observed: 1,
    declaredLegitimate: 0,
    noDeclaredNeighbour: 1,
    findings: [],
    findingCount: 0,
    truncated: 0,
  });
});

test('a declared set that is not a Set is rejected', () => {
  assert.throws(() => sweepLookalikes(['x'], new Map()), {
    name: 'Error',
    message: 'lookalike: `legit` must be a Set of DECLARED names, not an inferred one',
  });
  assert.throws(() => sweepLookalikes(['x'], []), {
    name: 'TypeError',
    message: 'legit.has is not a function',
  });
});

test('a repeated squat is one finding that counts occurrences and skips missing locations', () => {
  const r = sweepLookalikes([
    { name: 'lo-dash', where: null },
    'lo-dash',
    { name: 'lo-dash', where: 'b.lock' },
    { name: 'lo-dash', where: 0 },
    { name: 'lodash', where: 'a.lock' },
  ], lodashOnly);
  assert.deepEqual(body(r), {
    observed: 5,
    declaredLegitimate: 1,
    noDeclaredNeighbour: 0,
    findings: [{
      candidate: 'lo-dash',
      legitimate: 'lodash',
      class: 'separator',
      distance: 1,
      occurrences: 4,
      where: ['b.lock', 0],
    }],
    findingCount: 1,
    truncated: 0,
  });
});

test('a repeated squat keeps twenty locations but counts every occurrence', () => {
  const sites = Array.from({ length: 22 }, (_, i) => ({ name: 'lo-dash', where: `w${i}` }));
  const r = sweepLookalikes(['lodash', ...sites], lodashOnly);
  assert.deepEqual(r.findings, [{
    candidate: 'lo-dash',
    legitimate: 'lodash',
    class: 'separator',
    distance: 1,
    occurrences: 22,
    where: sites.slice(0, 20).map((s) => s.where),
  }]);
});

test('findings at equal distance are ordered by candidate name', () => {
  const r = sweepLookalikes(['lod-ash', 'lo-dash', 'lodash', 'lodash'], lodashOnly);
  assert.deepEqual(pairs(r), [['lo-dash', 1], ['lod-ash', 1]]);
});

test('a nearer finding sorts ahead of a farther one whatever the candidate name', () => {
  const r = sweepLookalikes(['lo-da-sh', 'lod-ash', 'lodash', 'lodash'], lodashOnly);
  assert.deepEqual(pairs(r), [['lod-ash', 1], ['lo-da-sh', 2]]);
});

test('findings tied on candidate and distance keep the order classify gave them', () => {
  const r = sweepLookalikes(
    ['lo-dash', 'lo-dash', 'lodash', 'lo_dash'],
    new Set(['lodash', 'lo_dash']),
  );
  assert.deepEqual(
    r.findings.map((f) => [f.legitimate, f.distance, f.occurrences]),
    [['lo_dash', 1, 2], ['lodash', 1, 2]],
  );
  assert.equal(r.declaredLegitimate, 2);
  assert.equal(r.findingCount, 2);
});

test('cap limits the returned findings while the totals still report all of them', () => {
  const observed = ['loda-sh', 'lod-ash', 'lo-dash', 'lodash', 'lodash', 'lodash'];
  const all = [['lo-dash', 1], ['lod-ash', 1], ['loda-sh', 1]];
  const cases = [[0, 0, 3], [2, 2, 1], [3, 3, 0], [4, 3, 0]];
  for (const [cap, shown, truncated] of cases) {
    const r = sweepLookalikes(observed, lodashOnly, { cap });
    assert.deepEqual(pairs(r), all.slice(0, shown));
    assert.equal(r.findingCount, 3);
    assert.equal(r.truncated, truncated);
  }
});

test('the default cap returns the nearest two hundred findings', () => {
  const squats = Array.from({ length: 201 }, (_, i) => `${'-'.repeat(i + 1)}lodash`);
  const r = sweepLookalikes([...squats, ...squats.map(() => 'lodash')], lodashOnly);
  assert.deepEqual(
    r.findings.map((f) => f.distance),
    Array.from({ length: 200 }, (_, i) => i + 1),
  );
  assert.equal(r.findingCount, 201);
  assert.equal(r.truncated, 1);
});
