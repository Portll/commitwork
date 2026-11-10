// Splits raw exclude values into registered area slugs and unresolved entries (monitor/sweep-scope.mjs resolveExcludedAreas).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveExcludedAreas } from '../sweep-scope.mjs';

const reg = { areas: [{ slug: 'alpha' }, { slug: 'beta' }] };

test('null raw values give no areas and nothing unresolved', () => {
  const input = null;
  const result = resolveExcludedAreas(input, reg);
  assert.deepEqual(result, { areas: new Set(), unresolved: [] });
});

test('undefined raw values give no areas and nothing unresolved', () => {
  const input = undefined;
  const result = resolveExcludedAreas(input, reg);
  assert.deepEqual(result, { areas: new Set(), unresolved: [] });
});

test('a registered slug is collected into areas', () => {
  const input = ['alpha'];
  const result = resolveExcludedAreas(input, reg);
  assert.deepEqual(result, { areas: new Set(['alpha']), unresolved: [] });
});

test('an unregistered value is reported as unresolved and not added to areas', () => {
  const input = ['alpha', 'gamma'];
  const result = resolveExcludedAreas(input, reg);
  assert.deepEqual(result, { areas: new Set(['alpha']), unresolved: ['gamma'] });
});

test('comma separated entries are split, trimmed and empty pieces dropped', () => {
  const input = ['alpha, beta ,,gamma'];
  const result = resolveExcludedAreas(input, reg);
  assert.deepEqual(result, { areas: new Set(['alpha', 'beta']), unresolved: ['gamma'] });
});

test('null entries are skipped and numbers are stringified as unresolved', () => {
  const input = [null, 7];
  const result = resolveExcludedAreas(input, reg);
  assert.deepEqual(result, { areas: new Set(), unresolved: ['7'] });
});

test('repeated registered slugs collapse into one area', () => {
  const input = ['alpha', 'alpha'];
  const result = resolveExcludedAreas(input, reg);
  assert.deepEqual(result, { areas: new Set(['alpha']), unresolved: [] });
});

test('a slug is unresolved when the registry has no areas', () => {
  const input = ['alpha'];
  const emptyReg = { areas: [] };
  const result = resolveExcludedAreas(input, emptyReg);
  assert.deepEqual(result, { areas: new Set(), unresolved: ['alpha'] });
});

test('a plain string instead of an array throws a TypeError', () => {
  const input = 'some-string';
  assert.throws(() => resolveExcludedAreas(input, reg), {
    name: 'TypeError',
    message: '(rawValues || []).flatMap is not a function',
  });
});
