// Set of repo names whose depsGo scanner lane has ran true, or null if no lane present (admin/routes/determinations.mjs analyserRanIn).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyserRanIn } from '../routes/determinations.mjs';

test('returns null when rollup is undefined', () => {
  assert.equal(analyserRanIn(undefined), null);
});

test('returns null when rollup has no repos property', () => {
  assert.equal(analyserRanIn({}), null);
});

test('returns null when repos array is empty', () => {
  assert.equal(analyserRanIn({ repos: [] }), null);
});

test('returns null when repo has no scanners property', () => {
  const rollup = { repos: [{ name: 'a' }] };
  assert.equal(analyserRanIn(rollup), null);
});

test('returns null when repo scanners object lacks depsGo lane', () => {
  const rollup = { repos: [{ name: 'a', scanners: { other: { ran: true } } }] };
  assert.equal(analyserRanIn(rollup), null);
});

test('returns empty set when depsGo lane exists but ran is false', () => {
  const rollup = { repos: [{ name: 'a', scanners: { depsGo: { ran: false } } }] };
  const result = analyserRanIn(rollup);
  assert.ok(result instanceof Set);
  assert.equal(result.size, 0);
});

test('returns set with repo name when depsGo lane ran is true', () => {
  const rollup = { repos: [{ name: 'a', scanners: { depsGo: { ran: true } } }] };
  const result = analyserRanIn(rollup);
  assert.ok(result instanceof Set);
  assert.deepEqual([...result], ['a']);
});

test('returns set with multiple repo names when multiple lanes have ran true', () => {
  const rollup = {
    repos: [
      { name: 'a', scanners: { depsGo: { ran: true } } },
      { name: 'b', scanners: { depsGo: { ran: false } } },
      { name: 'c', scanners: { depsGo: { ran: true } } }
    ]
  };
  const result = analyserRanIn(rollup);
  assert.ok(result instanceof Set);
  assert.deepEqual([...result].sort(), ['a', 'c']);
});

test('returns null when all repos lack depsGo lane despite having other scanners', () => {
  const rollup = {
    repos: [
      { name: 'a', scanners: { npm: { ran: true } } },
      { name: 'b', scanners: { pip: { ran: true } } }
    ]
  };
  assert.equal(analyserRanIn(rollup), null);
});
