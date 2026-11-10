// Redacts content fields in a node tree when showContent is false (bin/memory-query.mjs withhold).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withhold } from '../memory-query.mjs';

test('returns the node unchanged when showContent is true', () => {
  const node = { content: 'secret', name: 'file.txt' };
  const r = withhold(node, true);
  assert.deepEqual(r, { content: "secret", name: "file.txt" });
});

test('maps array elements with showContent forced to false', () => {
  const node = [{ content: 'a' }, { content: 'b' }];
  const r = withhold(node, true);
  assert.deepEqual(r, [{ content: "a" }, { content: "b" }]);
});

test('replaces content key with content_withheld true for plain objects', () => {
  const node = { content: 'data', type: 'file' };
  const r = withhold(node, false);
  assert.deepEqual(r, { content_withheld: true, type: "file" });
});

test('returns null unchanged when node is null', () => {
  const r = withhold(null, false);
  assert.equal(r, null);
});

test('returns a string unchanged when node is a primitive', () => {
  const r = withhold('hello', false);
  assert.equal(r, "hello");
});

test('returns a number unchanged when node is a primitive', () => {
  const r = withhold(42, false);
  assert.equal(r, 42);
});

test('returns a boolean unchanged when node is a primitive', () => {
  const r = withhold(false, false);
  assert.equal(r, false);
});

test('recursively processes nested objects and arrays', () => {
  const node = { content: 'top', nested: { content: 'inner', list: [{ content: 'x' }] } };
  const r = withhold(node, false);
  assert.deepEqual(r, { content_withheld: true, nested: { content_withheld: true, list: [{ content_withheld: true }] } });
});

test('preserves non-content keys while withholding content in objects', () => {
  const node = { name: 'readme', content: 'body', size: 100 };
  const r = withhold(node, false);
  assert.deepEqual(r, { name: "readme", content_withheld: true, size: 100 });
});

test('returns empty array unchanged when node is an empty array', () => {
  const r = withhold([], false);
  assert.deepEqual(r, []);
});
