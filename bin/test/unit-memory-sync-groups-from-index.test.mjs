// Maps MEMORY.md file references to their enclosing ## heading (bin/memory-sync.mjs groupsFromIndex).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupsFromIndex } from '../memory-sync.mjs';

test('returns an empty map when the input is empty', () => {
  assert.deepEqual(groupsFromIndex(''), new Map([]));
});

test('returns an empty map when there are no headings', () => {
  assert.deepEqual(groupsFromIndex('no headings here'), new Map([]));
});

test('returns an empty map when a heading has no file references', () => {
  assert.deepEqual(groupsFromIndex('## Alpha\njust text'), new Map([]));
});

test('maps a file reference to its enclosing heading', () => {
  assert.deepEqual(groupsFromIndex('## Alpha\nsee (a.md) here'), new Map([["a", "Alpha"]]));
});

test('keeps the first heading when a file appears under multiple headings', () => {
  assert.deepEqual(groupsFromIndex('## Alpha\n(a.md)\n## Beta\n(a.md)'), new Map([["a", "Alpha"]]));
});

test('ignores file references that appear before any heading', () => {
  assert.deepEqual(groupsFromIndex('(a.md)\n## Alpha\n(b.md)'), new Map([["b", "Alpha"]]));
});

test('maps multiple distinct files to the same heading', () => {
  assert.deepEqual(groupsFromIndex('## Alpha\n(a.md) and (b.md)'), new Map([["a", "Alpha"], ["b", "Alpha"]]));
});

test('maps files with dots and hyphens in their names', () => {
  assert.deepEqual(groupsFromIndex('## Alpha\n(a.b-c.md)'), new Map([["a.b-c", "Alpha"]]));
});
