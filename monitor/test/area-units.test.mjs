// monitor/test/area-units.test.mjs — case tests for batchCoversArea.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { batchCoversArea } from '../area.mjs';

test('returns null when batch is null', () => {
  assert.equal(batchCoversArea(null, { slug: 'a' }), null);
});

test('returns null when manifest is missing', () => {
  assert.equal(batchCoversArea({ name: 'sweep-1' }, { slug: 'a' }), null);
});

test('returns null when manifest has no area or areaOut', () => {
  assert.equal(batchCoversArea({ manifest: { foo: 'bar' } }, { slug: 'a' }), null);
});

test('returns true when slug matches manifest.area', () => {
  const batch = { manifest: { area: 'alpha' } };
  assert.equal(batchCoversArea(batch, { slug: 'alpha' }), true);
});

test('returns false when slug does not match manifest.area', () => {
  const batch = { manifest: { area: 'alpha' } };
  assert.equal(batchCoversArea(batch, { slug: 'beta' }), false);
});

test('returns false when slug is null and areaOut does not match dir', () => {
  const batch = { manifest: { areaOut: 'reports/alpha' } };
  assert.equal(batchCoversArea(batch, { dir: '/some/other/path' }), false);
});

test('returns true when dir matches resolved areaOut', () => {
  const dir = join(tmpdir(), 'reports', 'alpha');
  const batch = { manifest: { areaOut: dir } };
  assert.equal(batchCoversArea(batch, { dir }), true);
});
