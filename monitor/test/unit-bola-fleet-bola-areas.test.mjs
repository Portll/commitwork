// Extracts areas that declare a bola block with manifest and base (monitor/bola-fleet.mjs bolaAreas).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bolaAreas } from '../bola-fleet.mjs';

test('returns empty array when registry has no areas', () => {
  const reg = { areas: [] };
  const result = bolaAreas(reg);
  assert.deepEqual(result, []);
});

test('filters out areas without bola property', () => {
  const reg = { areas: [{ slug: 'a', label: 'A' }] };
  const result = bolaAreas(reg);
  assert.deepEqual(result, []);
});

test('filters out areas where bola is null', () => {
  const reg = { areas: [{ slug: 'a', label: 'A', bola: null }] };
  const result = bolaAreas(reg);
  assert.deepEqual(result, []);
});

test('filters out areas where bola.manifest is missing', () => {
  const reg = { areas: [{ slug: 'a', label: 'A', bola: { base: '/base' } }] };
  const result = bolaAreas(reg);
  assert.deepEqual(result, []);
});

test('filters out areas where bola.base is missing', () => {
  const reg = { areas: [{ slug: 'a', label: 'A', bola: { manifest: 'm.yaml' } }] };
  const result = bolaAreas(reg);
  assert.deepEqual(result, []);
});

test('filters out areas where bola.manifest is empty string', () => {
  const reg = { areas: [{ slug: 'a', label: 'A', bola: { manifest: '', base: '/base' } }] };
  const result = bolaAreas(reg);
  assert.deepEqual(result, []);
});

test('filters out areas where bola.base is empty string', () => {
  const reg = { areas: [{ slug: 'a', label: 'A', bola: { manifest: 'm.yaml', base: '' } }] };
  const result = bolaAreas(reg);
  assert.deepEqual(result, []);
});

test('includes area with bola manifest and base, using label and out defaults', () => {
  const reg = { areas: [{ slug: 'a', label: 'A', bola: { manifest: 'm.yaml', base: '/base' } }] };
  const result = bolaAreas(reg);
  assert.deepEqual(result, [{ slug: 'a', label: 'A', out: 'a', manifest: 'm.yaml', base: '/base', note: null }]);
});

test('uses slug as label when label is missing', () => {
  const reg = { areas: [{ slug: 'a', bola: { manifest: 'm.yaml', base: '/base' } }] };
  const result = bolaAreas(reg);
  assert.deepEqual(result, [{ slug: 'a', label: 'a', out: 'a', manifest: 'm.yaml', base: '/base', note: null }]);
});

test('uses out field when provided, and note when provided', () => {
  const reg = { areas: [{ slug: 'a', label: 'A', out: 'custom-out', bola: { manifest: 'm.yaml', base: '/base', note: 'my note' } }] };
  const result = bolaAreas(reg);
  assert.deepEqual(result, [{ slug: 'a', label: 'A', out: 'custom-out', manifest: 'm.yaml', base: '/base', note: 'my note' }]);
});
