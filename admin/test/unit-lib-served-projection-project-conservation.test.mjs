// Projects a rollup conservation object into a sanitized served projection (admin/lib/served-projection.mjs projectConservation).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectConservation } from '../lib/served-projection.mjs';

test('returns never-checked state when input is null', () => {
  assert.deepEqual(projectConservation(null), { state: 'never-checked' });
});

test('returns never-checked state when input is undefined', () => {
  assert.deepEqual(projectConservation(undefined), { state: 'never-checked' });
});

test('returns never-checked state when input is a string', () => {
  assert.deepEqual(projectConservation('not-an-object'), { state: 'never-checked' });
});

test('returns never-checked state when input is a number', () => {
  assert.deepEqual(projectConservation(42), { state: 'never-checked' });
});

test('returns checked state with empty arrays when conservation object has no fields', () => {
  const result = projectConservation({});
  assert.equal(result.state, 'checked');
  assert.deepEqual(result.checked, []);
  assert.deepEqual(result.violations, []);
});

test('truncates checked entries to 80 characters and filters out non-strings', () => {
  const longStr = 'a'.repeat(100);
  const result = projectConservation({ checked: [longStr, 123, null, 'valid'] });
  assert.equal(result.state, 'checked');
  assert.equal(result.checked.length, 2);
  assert.equal(result.checked[0], 'a'.repeat(80));
  assert.equal(result.checked[1], 'valid');
});

test('maps violations with numeric fields preserved and non-numeric fields as null', () => {
  const result = projectConservation({
    violations: [
      { category: 'cat', declared: 10, published: 20, truncated: 30 },
      { category: 'bad', declared: 'x', published: null, truncated: NaN },
    ],
  });
  assert.equal(result.state, 'checked');
  assert.equal(result.violations.length, 2);
  assert.deepEqual(result.violations[0], { category: 'cat', declared: 10, published: 20, truncated: 30 });
  assert.deepEqual(result.violations[1], { category: 'bad', declared: null, published: null, truncated: null });
});

test('truncates violation category to 80 characters', () => {
  const longCat = 'c'.repeat(100);
  const result = projectConservation({ violations: [{ category: longCat, declared: 1, published: 2, truncated: 3 }] });
  assert.equal(result.violations[0].category, 'c'.repeat(80));
});

test('handles violations array with non-object entries', () => {
  const result = projectConservation({ violations: [null, 'string', 42] });
  assert.equal(result.violations.length, 3);
  assert.deepEqual(result.violations[0], { category: null, declared: null, published: null, truncated: null });
  assert.deepEqual(result.violations[1], { category: null, declared: null, published: null, truncated: null });
  assert.deepEqual(result.violations[2], { category: null, declared: null, published: null, truncated: null });
});

test('handles checked array with empty strings filtered out', () => {
  const result = projectConservation({ checked: ['', '  ', 'real'] });
  assert.equal(result.checked.length, 2);
  assert.equal(result.checked[0], '  ');
  assert.equal(result.checked[1], 'real');
});
