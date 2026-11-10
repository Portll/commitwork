// Serializes a directed edge into a JSON array string (flow/graph.mjs edgeKey).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeKey } from '../graph.mjs';

test('serializes a simple edge with string endpoints and kind', () => {
  assert.deepEqual(edgeKey('a', 'b', 'dep'), "[\"a\",\"b\",\"dep\"]");
});

test('serializes an edge with numeric endpoints', () => {
  assert.deepEqual(edgeKey(1, 2, 'ref'), "[1,2,\"ref\"]");
});

test('serializes an edge with boolean endpoints', () => {
  assert.deepEqual(edgeKey(true, false, 'flag'), "[true,false,\"flag\"]");
});

test('serializes an edge with null endpoints', () => {
  assert.deepEqual(edgeKey(null, null, 'void'), "[null,null,\"void\"]");
});

test('serializes an edge with undefined endpoints', () => {
  assert.deepEqual(edgeKey(undefined, undefined, 'ghost'), "[null,null,\"ghost\"]");
});

test('serializes an edge with empty string endpoints', () => {
  assert.deepEqual(edgeKey('', '', 'empty'), "[\"\",\"\",\"empty\"]");
});

test('serializes an edge with long repeated string endpoints', () => {
  const long = 'x'.repeat(100);
  assert.deepEqual(edgeKey(long, long, 'bulk'), "[\"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\",\"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\",\"bulk\"]");
});

test('serializes an edge with special characters in endpoints', () => {
  assert.deepEqual(edgeKey('a"b', 'c\\d', 'esc'), "[\"a\\\"b\",\"c\\\\d\",\"esc\"]");
});

test('serializes an edge with unicode endpoints', () => {
  assert.deepEqual(edgeKey('\u00e9', '\u00fc', 'uni'), "[\"\u00e9\",\"\u00fc\",\"uni\"]");
});

test('serializes an edge with zero and negative numeric endpoints', () => {
  assert.deepEqual(edgeKey(0, -1, 'zero'), "[0,-1,\"zero\"]");
});
