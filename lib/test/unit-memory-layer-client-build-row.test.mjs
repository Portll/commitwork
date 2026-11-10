// Constructs a row object from a source by copying declared non-credential fields (lib/memory-layer-client.mjs buildRow).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRow } from '../memory-layer-client.mjs';

test('throws when fields argument is not an array', () => {
  assert.throws(() => buildRow({ a: 1 }, null), {
    name: 'Error',
    message: 'buildRow: a declared field list is required (an empty list would silently emit nothing)'
  });
});

test('throws when fields array is empty', () => {
  assert.throws(() => buildRow({ a: 1 }, []), {
    name: 'Error',
    message: 'buildRow: a declared field list is required (an empty list would silently emit nothing)'
  });
});

test('throws when a declared field is a credential field', () => {
  assert.throws(() => buildRow({ password: 'secret' }, ['password']), {
    name: 'Error',
    message: 'buildRow: refusing to serialise credential-bearing field(s): password'
  });
});

test('returns empty object when source is null and fields are valid non\u2011credential names', () => {
  const result = buildRow(null, ['foo', 'bar']);
  assert.deepEqual(result, {});
});

test('returns empty object when source lacks the declared fields', () => {
  const result = buildRow({ other: 42 }, ['foo', 'bar']);
  assert.deepEqual(result, {});
});

test('copies defined, non\u2011null fields from source', () => {
  const src = { foo: 1, bar: 'x', baz: null };
  const result = buildRow(src, ['foo', 'bar', 'baz']);
  assert.deepEqual(result, { foo: 1, bar: "x" });
});

test('ignores undefined field values', () => {
  const src = { foo: undefined, bar: 2 };
  const result = buildRow(src, ['foo', 'bar']);
  assert.deepEqual(result, { bar: 2 });
});

test('ignores null field values', () => {
  const src = { foo: null, bar: 3 };
  const result = buildRow(src, ['foo', 'bar']);
  assert.deepEqual(result, { bar: 3 });
});
