// Detects added, grew, shrank, and gone keys between current and baseline (bin/bare-catch-ratchet.mjs compare).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare } from '../bare-catch-ratchet.mjs';

test('returns empty arrays when both current and baseline are empty', () => {
  const result = compare({}, {});
  assert.deepEqual(result, { added: [], grew: [], shrank: [], gone: [] });
});

test('classifies a key present in current but absent from baseline as added', () => {
  const result = compare({ a: 1 }, {});
  assert.deepEqual(result, { added: [{ key: 'a', now: 1 }], grew: [], shrank: [], gone: [] });
});

test('classifies a key present in baseline but absent from current as gone', () => {
  const result = compare({}, { a: 5 });
  assert.deepEqual(result, { added: [], grew: [], shrank: [], gone: [{ key: 'a', was: 5 }] });
});

test('classifies a key whose current value exceeds baseline as grew', () => {
  const result = compare({ a: 10 }, { a: 5 });
  assert.deepEqual(result, { added: [], grew: [{ key: 'a', was: 5, now: 10 }], shrank: [], gone: [] });
});

test('classifies a key whose current value is below baseline as shrank', () => {
  const result = compare({ a: 3 }, { a: 5 });
  assert.deepEqual(result, { added: [], grew: [], shrank: [{ key: 'a', was: 5, now: 3 }], gone: [] });
});

test('leaves a key whose current value equals baseline in no category', () => {
  const result = compare({ a: 5 }, { a: 5 });
  assert.deepEqual(result, { added: [], grew: [], shrank: [], gone: [] });
});

test('sorts added keys alphabetically when multiple keys are added', () => {
  const result = compare({ b: 2, a: 1, c: 3 }, {});
  assert.deepEqual(result, {
    added: [{ key: 'a', now: 1 }, { key: 'b', now: 2 }, { key: 'c', now: 3 }],
    grew: [],
    shrank: [],
    gone: []
  });
});

test('sorts gone keys alphabetically when multiple keys are gone', () => {
  const result = compare({}, { b: 2, a: 1, c: 3 });
  assert.deepEqual(result, {
    added: [],
    grew: [],
    shrank: [],
    gone: [{ key: 'a', was: 1 }, { key: 'b', was: 2 }, { key: 'c', was: 3 }]
  });
});

test('handles mixed categories with correct sorting and values', () => {
  const current = { a: 10, b: 3, c: 5, d: 1 };
  const baseline = { a: 5, b: 5, c: 5, e: 7 };
  const result = compare(current, baseline);
  assert.deepEqual(result, {
    added: [{ key: 'd', now: 1 }],
    grew: [{ key: 'a', was: 5, now: 10 }],
    shrank: [{ key: 'b', was: 5, now: 3 }],
    gone: [{ key: 'e', was: 7 }]
  });
});

test('handles zero and negative values correctly across all branches', () => {
  const current = { a: 0, b: -1, c: 0 };
  const baseline = { a: 0, b: 0, c: 1 };
  const result = compare(current, baseline);
  assert.deepEqual(result, {
    added: [],
    grew: [],
    shrank: [{ key: 'b', was: 0, now: -1 }, { key: 'c', was: 1, now: 0 }],
    gone: []
  });
});
