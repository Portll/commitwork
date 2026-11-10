// Picks the area slug an all-scope sweep runs under (monitor/sweep-scope.mjs allScopeArea).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allScopeArea } from '../sweep-scope.mjs';

test('returns null when every area is paused', () => {
  const reg = { areas: [{ slug: 'a', paused: { since: 1, reason: 'x' } }] };
  const result = allScopeArea(reg);
  assert.equal(result, null);
});

test('returns null when every area is excluded', () => {
  const reg = { areas: [{ slug: 'a' }] };
  const excluded = new Set(['a']);
  const result = allScopeArea(reg, excluded);
  assert.equal(result, null);
});

test('returns null when the registry is undefined', () => {
  const reg = undefined;
  const result = allScopeArea(reg);
  assert.equal(result, null);
});

test('returns the primary slug when it is in the active fleet', () => {
  const reg = { areas: [{ slug: 'a' }, { slug: 'b', primary: true }] };
  const result = allScopeArea(reg);
  assert.equal(result, 'b');
});

test('returns the first area slug when no area is marked primary', () => {
  const reg = { areas: [{ slug: 'a' }, { slug: 'b' }] };
  const result = allScopeArea(reg);
  assert.equal(result, 'a');
});

test('returns the first active slug when the primary is excluded', () => {
  const reg = { areas: [{ slug: 'a' }, { slug: 'b', primary: true }] };
  const excluded = new Set(['b']);
  const result = allScopeArea(reg, excluded);
  assert.equal(result, 'a');
});

test('returns the first active slug when the primary is paused', () => {
  const reg = { areas: [{ slug: 'a' }, { slug: 'b', primary: true, paused: { since: 1, reason: 'x' } }] };
  const result = allScopeArea(reg);
  assert.equal(result, 'a');
});

test('falls back to the first area slug when the primary entry has no slug', () => {
  const reg = { areas: [{ slug: 'a' }, { primary: true }] };
  const result = allScopeArea(reg);
  assert.equal(result, 'a');
});

test('throws a TypeError when an area entry is null', () => {
  const reg = { areas: [{ slug: 'a' }, null, { slug: 'b', primary: true }] };
  assert.throws(() => allScopeArea(reg), {
    name: 'TypeError',
    message: "Cannot read properties of null (reading 'slug')",
  });
});
