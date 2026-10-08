// Determines if a batch covers a given area (monitor/area.mjs batchCoversArea).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batchCoversArea } from '../area.mjs';

test('returns null when batch is undefined', () => {
  const result = batchCoversArea(undefined, { slug: 'a', dir: '/x' });
  assert.equal(result, null);
});

test('returns null when batch has no manifest', () => {
  const result = batchCoversArea({}, { slug: 'a', dir: '/x' });
  assert.equal(result, null);
});

test('returns null when manifest lacks area and areaOut', () => {
  const batch = { manifest: { foo: 'bar' } };
  const result = batchCoversArea(batch, { slug: 'a', dir: '/x' });
  assert.equal(result, null);
});

test('returns true when slug matches manifest area', () => {
  const batch = { manifest: { area: 'backend' } };
  const result = batchCoversArea(batch, { slug: 'backend' });
  assert.equal(result, true);
});

test('returns false when slug does not match manifest area', () => {
  const batch = { manifest: { area: 'backend' } };
  const result = batchCoversArea(batch, { slug: 'frontend' });
  assert.equal(result, false);
});

test('returns true when dir resolves to same path as areaOut', () => {
  const batch = { manifest: { areaOut: 'out/backend' } };
  const result = batchCoversArea(batch, { dir: 'out/backend' });
  assert.equal(result, true);
});

test('returns false when dir resolves to different path than areaOut', () => {
  const batch = { manifest: { areaOut: 'out/backend' } };
  const result = batchCoversArea(batch, { dir: 'out/frontend' });
  assert.equal(result, false);
});

test('returns true when areaOut matches dir even if area slug differs', () => {
  const batch = { manifest: { area: 'backend', areaOut: 'out/backend' } };
  const result = batchCoversArea(batch, { slug: 'frontend', dir: 'out/backend' });
  assert.equal(result, true);
});

test('returns false when neither slug nor dir matches', () => {
  const batch = { manifest: { area: 'backend', areaOut: 'out/backend' } };
  const result = batchCoversArea(batch, { slug: 'frontend', dir: 'out/other' });
  assert.equal(result, false);
});

test('returns null when manifest area is not a string and areaOut is not a string', () => {
  const batch = { manifest: { area: 123, areaOut: 456 } };
  const result = batchCoversArea(batch, { slug: 'a', dir: '/x' });
  assert.equal(result, null);
});
