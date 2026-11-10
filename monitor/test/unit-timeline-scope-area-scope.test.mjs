// Builds an area's slug, label, primary flag and membership test (monitor/timeline-scope.mjs areaScope).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areaScope } from '../timeline-scope.mjs';

test('takes the label from the registry area and marks the only area as primary', () => {
  const reg = { areas: [{ slug: 'a', label: 'Alpha' }] };
  const result = areaScope('a', reg);
  assert.equal(result.slug, 'a');
  assert.equal(result.label, 'Alpha');
  assert.equal(result.isPrimary, true);
});

test('falls back to the slug as label when the area has no label', () => {
  const reg = { areas: [{ slug: 'b' }] };
  const result = areaScope('b', reg);
  assert.equal(result.slug, 'b');
  assert.equal(result.label, 'b');
});

test('uses the slug as label and is not primary when the slug is not in the registry', () => {
  const reg = { areas: [{ slug: 'x', label: 'X' }] };
  const result = areaScope('missing', reg);
  assert.equal(result.slug, 'missing');
  assert.equal(result.label, 'missing');
  assert.equal(result.isPrimary, false);
});

test('inScope accepts the area slug and the area label', () => {
  const reg = { areas: [{ slug: 'a', label: 'Alpha' }] };
  const result = areaScope('a', reg);
  assert.equal(result.inScope('a'), true);
  assert.equal(result.inScope('Alpha'), true);
});

test('inScope rejects a value that is neither the slug nor the label', () => {
  const reg = { areas: [{ slug: 'a', label: 'Alpha' }] };
  const result = areaScope('a', reg);
  assert.equal(result.inScope('Beta'), false);
});

test('inScope accepts the slug itself even when the slug is not in the registry', () => {
  const reg = { areas: [{ slug: 'x', label: 'X' }] };
  const result = areaScope('missing', reg);
  assert.equal(result.inScope('missing'), true);
  assert.equal(result.inScope('x'), false);
});

test('inScope accepts another slug whose registry label matches this area label', () => {
  const reg = { areas: [{ slug: 'a', label: 'Alpha' }, { slug: 'b', label: 'Alpha' }] };
  const result = areaScope('a', reg);
  assert.equal(result.inScope('b'), true);
});
