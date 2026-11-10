// Sorted alias group for an advisory id, or the uppercased id alone (cra/advisory-aliases.mjs aliasesOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aliasesOf } from '../advisory-aliases.mjs';

test('returns the sorted alias group when the uppercased id is a forward key', () => {
  const index = { forward: new Map([['ABC', new Set(['ZULU', 'ALPHA', 'MID'])]]) };
  const r = aliasesOf(index, 'abc');
  assert.deepEqual(r, ['ALPHA', 'MID', 'ZULU']);
});

test('returns the uppercased id alone when the id is absent from the forward index', () => {
  const index = { forward: new Map([['XYZ', new Set(['A'])]]) };
  const r = aliasesOf(index, 'abc');
  assert.deepEqual(r, ['ABC']);
});

test('returns the uppercased id alone when the forward map is empty', () => {
  const index = { forward: new Map() };
  const r = aliasesOf(index, 'ghsa-xxxx');
  assert.deepEqual(r, ['GHSA-XXXX']);
});

test('does not match a lowercase forward key because the id is uppercased first', () => {
  const index = { forward: new Map([['cve-1', new Set(['GHSA-1'])]]) };
  const r = aliasesOf(index, 'cve-1');
  assert.deepEqual(r, ['CVE-1']);
});

test('treats empty string, null and undefined ids as the empty key', () => {
  const index = { forward: new Map([['', new Set(['X', 'B'])]]) };
  assert.deepEqual(aliasesOf(index, ''), ['B', 'X']);
  assert.deepEqual(aliasesOf(index, null), ['B', 'X']);
  assert.deepEqual(aliasesOf(index, undefined), ['B', 'X']);
});

test('returns the empty string key alone when a null id is not in the index', () => {
  const index = { forward: new Map([['NULL', new Set(['Y'])]]) };
  const r = aliasesOf(index, null);
  assert.deepEqual(r, ['']);
});

test('converts a numeric id to its string form before lookup', () => {
  const index = { forward: new Map([['123', new Set(['A'])]]) };
  assert.deepEqual(aliasesOf(index, 123), ['A']);
  assert.deepEqual(aliasesOf(index, 124), ['124']);
});

test('returns an empty array when the matching alias group is an empty set', () => {
  const index = { forward: new Map([['FOO', new Set()]]) };
  const r = aliasesOf(index, 'foo');
  assert.deepEqual(r, []);
});

test('sorts aliases by code unit order and leaves the stored set unchanged', () => {
  const group = new Set(['b10', 'B2', 'A', '10', '9', '1']);
  const index = { forward: new Map([['K', group]]) };
  const r = aliasesOf(index, 'k');
  assert.deepEqual(r, ['1', '10', '9', 'A', 'B2', 'b10']);
  assert.deepEqual([...group], ['b10', 'B2', 'A', '10', '9', '1']);
});

test('throws a TypeError when the index has no forward map', () => {
  assert.throws(() => aliasesOf({}, 'x'), {
    name: 'TypeError',
    message: "Cannot read properties of undefined (reading 'get')",
  });
});
