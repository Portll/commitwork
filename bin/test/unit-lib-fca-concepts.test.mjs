// Computes the formal concept lattice of a context (bin/lib/fca.mjs concepts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { concepts } from '../lib/fca.mjs';

test('returns the full lattice for a small context', () => {
  const r = concepts({ a: ['x'], b: ['y'], c: ['x', 'y'] });
  assert.deepEqual(r, [{ extent: ["a", "b", "c"], intent: [] }, { extent: ["b", "c"], intent: ["y"] }, { extent: ["a", "c"], intent: ["x"] }, { extent: ["c"], intent: ["x", "y"] }]);
});

test('throws when the concept count exceeds maxConcepts', () => {
  const input = {};
  for (let i = 0; i < 4; i++) input['o' + i] = ['a', 'b', 'c', 'd'].slice(0, i + 1);
  assert.throws(() => concepts(input, { maxConcepts: 1 }), {
    name: 'Error',
    message: 'fca: concept count exceeded 1 \u2014 refusing to report a partial lattice as a whole one',
  });
});

test('handles a context with a single object', () => {
  const r = concepts({ only: ['p', 'q'] });
  assert.deepEqual(r, [{ extent: ["only"], intent: ["p", "q"] }]);
});

test('handles a context with no attributes', () => {
  const r = concepts({ a: [], b: [] });
  assert.deepEqual(r, [{ extent: ["a", "b"], intent: [] }]);
});

test('handles objects with identical attribute sets', () => {
  const r = concepts({ a: ['x', 'y'], b: ['x', 'y'] });
  assert.deepEqual(r, [{ extent: ["a", "b"], intent: ["x", "y"] }]);
});

test('handles a chain of nested attribute sets', () => {
  const r = concepts({ a: ['x'], b: ['x', 'y'], c: ['x', 'y', 'z'] });
  assert.deepEqual(r, [{ extent: ["a", "b", "c"], intent: ["x"] }, { extent: ["b", "c"], intent: ["x", "y"] }, { extent: ["c"], intent: ["x", "y", "z"] }]);
});

test('handles a context with disjoint attribute sets', () => {
  const r = concepts({ a: ['x'], b: ['y'] });
  assert.deepEqual(r, [{ extent: ["a", "b"], intent: [] }, { extent: ["b"], intent: ["y"] }, { extent: ["a"], intent: ["x"] }, { extent: [], intent: ["x", "y"] }]);
});

test('handles a context with one attribute shared by all objects', () => {
  const r = concepts({ a: ['x'], b: ['x'], c: ['x'] });
  assert.deepEqual(r, [{ extent: ["a", "b", "c"], intent: ["x"] }]);
});
