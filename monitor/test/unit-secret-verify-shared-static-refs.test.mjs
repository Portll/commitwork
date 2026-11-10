// Returns sorted relative paths of non-test sources containing the key basename (monitor/secret-verify.mjs sharedStaticRefs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sharedStaticRefs } from '../secret-verify.mjs';

test('returns empty array when key basename is empty string', () => {
  const r = sharedStaticRefs('', { 'src/a.js': 'hello' });
  assert.deepEqual(r, []);
});

test('returns empty array when key basename is null', () => {
  const r = sharedStaticRefs(null, { 'src/a.js': 'hello' });
  assert.deepEqual(r, []);
});

test('returns empty array when key basename is undefined', () => {
  const r = sharedStaticRefs(undefined, { 'src/a.js': 'hello' });
  assert.deepEqual(r, []);
});

test('returns empty array when sources is undefined', () => {
  const r = sharedStaticRefs('mykey', undefined);
  assert.deepEqual(r, []);
});

test('returns empty array when sources is null', () => {
  const r = sharedStaticRefs('mykey', null);
  assert.deepEqual(r, []);
});

test('returns matching path when source text contains basename', () => {
  const r = sharedStaticRefs('mykey', { 'src/a.js': 'export const x = mykey;' });
  assert.deepEqual(r, ["src/a.js"]);
});

test('returns empty array when source text does not contain basename', () => {
  const r = sharedStaticRefs('mykey', { 'src/a.js': 'export const x = other;' });
  assert.deepEqual(r, []);
});

test('skips test directory paths even if text contains basename', () => {
  const r = sharedStaticRefs('mykey', { 'test/a.js': 'mykey here' });
  assert.deepEqual(r, []);
});

test('skips __tests__ directory paths even if text contains basename', () => {
  const r = sharedStaticRefs('mykey', { '__tests__/a.js': 'mykey here' });
  assert.deepEqual(r, []);
});

test('returns sorted paths when multiple sources contain basename', () => {
  const r = sharedStaticRefs('mykey', { 'src/z.js': 'mykey', 'src/a.js': 'mykey' });
  assert.deepEqual(r, ["src/a.js", "src/z.js"]);
});
