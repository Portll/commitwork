// Maps dimension encodings to sorted attribute lists, skipping unconstrained values (bin/taxonomy-lattice.mjs toObjects).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toObjects } from '../taxonomy-lattice.mjs';

test('returns an empty object for an empty encodings object', () => {
  assert.deepEqual(toObjects({}), {});
});

test('returns an empty attribute list for an object with no dimensions', () => {
  assert.deepEqual(toObjects({ obj1: {} }), { obj1: [] });
});

test('includes a concrete value as a dimension-prefixed attribute', () => {
  assert.deepEqual(toObjects({ obj1: { lang: ['js'] } }), { obj1: ["lang:js"] });
});

test('omits the unconstrained wildcard from the attribute list', () => {
  assert.deepEqual(toObjects({ obj1: { lang: ['*'] } }), { obj1: [] });
});

test('includes only the concrete value when mixed with the wildcard', () => {
  assert.deepEqual(toObjects({ obj1: { lang: ['*', 'js'] } }), { obj1: ["lang:js"] });
});

test('sorts multiple attributes alphabetically within a dimension', () => {
  assert.deepEqual(toObjects({ obj1: { lang: ['z', 'a', 'm'] } }), { obj1: ["lang:a", "lang:m", "lang:z"] });
});

test('collects attributes from multiple dimensions in sorted order', () => {
  assert.deepEqual(toObjects({ obj1: { b: ['y'], a: ['x'] } }), { obj1: ["a:x", "b:y"] });
});

test('returns separate attribute lists for multiple objects', () => {
  assert.deepEqual(toObjects({ o1: { d: ['v1'] }, o2: { d: ['v2'] } }), { o1: ["d:v1"], o2: ["d:v2"] });
});
