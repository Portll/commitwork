// Per-manifest lane accounting with a running declared total (monitor/lane-roster.mjs accountBundled).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountBundled } from '../lane-roster.mjs';

test('empty input yields zero declared and empty buckets', () => {
  const r = accountBundled({});
  assert.deepEqual(r, { declared: 0, manifests: {}, lanes: {}, notLanes: {}, unaccounted: [] });
});

test('single manifest with one unaccounted check', () => {
  const r = accountBundled({ m: [{ id: 'zzz' }] });
  assert.deepEqual(r, { declared: 1, manifests: { m: { declared: 1, inLanes: 0, notLanes: 0, unaccounted: 1 } }, lanes: { m: {} }, notLanes: { m: {} }, unaccounted: [{ manifest: "m", check: "zzz", why: "no lane reads it and it is not marked notALane" }] });
});

test('two manifests sorted alphabetically accumulate declared', () => {
  const r = accountBundled({ b: [{ id: 'a' }], a: [{ id: 'b' }] });
  assert.deepEqual(r, { declared: 2, manifests: { a: { declared: 1, inLanes: 0, notLanes: 0, unaccounted: 1 }, b: { declared: 1, inLanes: 0, notLanes: 0, unaccounted: 1 } }, lanes: { a: {}, b: {} }, notLanes: { a: {}, b: {} }, unaccounted: [{ manifest: "a", check: "b", why: "no lane reads it and it is not marked notALane" }, { manifest: "b", check: "a", why: "no lane reads it and it is not marked notALane" }] });
});

test('manifest with a check that has a notALane reason', () => {
  const r = accountBundled({ m: [{ id: 'x', notALane: '  reason here  ' }] });
  assert.deepEqual(r, { declared: 1, manifests: { m: { declared: 1, inLanes: 0, notLanes: 1, unaccounted: 0 } }, lanes: { m: {} }, notLanes: { m: { x: { reason: "reason here" } } }, unaccounted: [] });
});

test('manifest with a check marked notALane but no reason string', () => {
  const r = accountBundled({ m: [{ id: 'x', notALane: true }] });
  assert.deepEqual(r, { declared: 1, manifests: { m: { declared: 1, inLanes: 0, notLanes: 0, unaccounted: 1 } }, lanes: { m: {} }, notLanes: { m: {} }, unaccounted: [{ manifest: "m", check: "x", why: "notALane carries no reason" }] });
});

test('manifest with a check that has both a lane and notALane', () => {
  const roster = [['L', 'chk', null, null]];
  const r = accountBundled({ m: [{ id: 'chk', notALane: 'yes' }] }, roster);
  assert.deepEqual(r, { declared: 1, manifests: { m: { declared: 1, inLanes: 0, notLanes: 0, unaccounted: 1 } }, lanes: { m: {} }, notLanes: { m: {} }, unaccounted: [{ manifest: "m", check: "chk", why: "feeds lane L and is also marked notALane" }] });
});

test('three manifests with mixed check states', () => {
  const r = accountBundled({
    c: [{ id: 'p' }, { id: 'q', notALane: 'r' }],
    a: [{ id: 's', notALane: '' }],
    b: [{ id: 't' }],
  });
  assert.deepEqual(r, { declared: 4, manifests: { a: { declared: 1, inLanes: 0, notLanes: 0, unaccounted: 1 }, b: { declared: 1, inLanes: 0, notLanes: 0, unaccounted: 1 }, c: { declared: 2, inLanes: 0, notLanes: 1, unaccounted: 1 } }, lanes: { a: {}, b: {}, c: {} }, notLanes: { a: {}, b: {}, c: { q: { reason: "r" } } }, unaccounted: [{ manifest: "a", check: "s", why: "notALane carries no reason" }, { manifest: "b", check: "t", why: "no lane reads it and it is not marked notALane" }, { manifest: "c", check: "p", why: "no lane reads it and it is not marked notALane" }] });
});

test('single manifest with two unaccounted checks sorted by id', () => {
  const r = accountBundled({ m: [{ id: 'b' }, { id: 'a' }] });
  assert.deepEqual(r, { declared: 2, manifests: { m: { declared: 2, inLanes: 0, notLanes: 0, unaccounted: 2 } }, lanes: { m: {} }, notLanes: { m: {} }, unaccounted: [{ manifest: "m", check: "a", why: "no lane reads it and it is not marked notALane" }, { manifest: "m", check: "b", why: "no lane reads it and it is not marked notALane" }] });
});
