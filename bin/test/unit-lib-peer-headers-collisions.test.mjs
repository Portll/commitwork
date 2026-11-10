// Groups peer bindings by name and reports collision counts with liveness (bin/lib/peer-headers.mjs collisions).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collisions } from '../lib/peer-headers.mjs';

test('returns empty array for empty bindings', () => {
  assert.deepEqual(collisions([]), []);
});

test('omits single holder from results', () => {
  const bindings = [{ name: 'alpha', pid: 1 }];
  assert.deepEqual(collisions(bindings), []);
});

test('includes two holders as collision', () => {
  const bindings = [
    { name: 'beta', pid: 1 },
    { name: 'beta', pid: 2 }
  ];
  assert.deepEqual(collisions(bindings), [{ name: "beta", holders: 2, liveNow: null, pids: [1, 2] }]);
});

test('includes three holders as collision', () => {
  const bindings = [
    { name: 'gamma', pid: 1 },
    { name: 'gamma', pid: 2 },
    { name: 'gamma', pid: 3 }
  ];
  assert.deepEqual(collisions(bindings), [{ name: "gamma", holders: 3, liveNow: null, pids: [1, 2, 3] }]);
});

test('sets liveNow to null when live is null', () => {
  const bindings = [
    { name: 'delta', pid: 1 },
    { name: 'delta', pid: 2 }
  ];
  assert.deepEqual(collisions(bindings, null), [{ name: "delta", holders: 2, liveNow: null, pids: [1, 2] }]);
});

test('counts live pids when live set is provided', () => {
  const bindings = [
    { name: 'epsilon', pid: 1 },
    { name: 'epsilon', pid: 2 },
    { name: 'epsilon', pid: 3 }
  ];
  const live = new Set([1, 3]);
  assert.deepEqual(collisions(bindings, live), [{ name: "epsilon", holders: 3, liveNow: 2, pids: [1, 2, 3] }]);
});

test('sorts by holders descending then name ascending', () => {
  const bindings = [
    { name: 'zeta', pid: 1 },
    { name: 'zeta', pid: 2 },
    { name: 'zeta', pid: 3 },
    { name: 'eta', pid: 1 },
    { name: 'eta', pid: 2 },
    { name: 'theta', pid: 1 },
    { name: 'theta', pid: 2 }
  ];
  assert.deepEqual(collisions(bindings), [{ name: "zeta", holders: 3, liveNow: null, pids: [1, 2, 3] }, { name: "eta", holders: 2, liveNow: null, pids: [1, 2] }, { name: "theta", holders: 2, liveNow: null, pids: [1, 2] }]);
});

test('preserves order of pids within a collision', () => {
  const bindings = [
    { name: 'iota', pid: 10 },
    { name: 'iota', pid: 20 },
    { name: 'iota', pid: 30 }
  ];
  assert.deepEqual(collisions(bindings), [{ name: "iota", holders: 3, liveNow: null, pids: [10, 20, 30] }]);
});
