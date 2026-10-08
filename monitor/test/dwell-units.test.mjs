// monitor/test/dwell-units.test.mjs — case tests for buildSliceTimeIndex, sliceToIso.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSliceTimeIndex, sliceToIso } from '../dwell.mjs';

test('returns empty Map for null input', () => {
  const idx = buildSliceTimeIndex(null);
  assert.ok(idx instanceof Map);
  assert.equal(idx.size, 0);
});

test('returns empty Map for empty array', () => {
  const idx = buildSliceTimeIndex([]);
  assert.ok(idx instanceof Map);
  assert.equal(idx.size, 0);
});

test('indexes rows with sliceId and generated', () => {
  const idx = buildSliceTimeIndex([{ sliceId: 's1', generated: '2024-01-01T00:00:00Z' }]);
  assert.equal(idx.get('s1'), '2024-01-01T00:00:00Z');
  assert.equal(idx.size, 1);
});

test('indexes rows with stamp but no sliceId', () => {
  const idx = buildSliceTimeIndex([{ stamp: '20240101000000', generated: '2024-01-01T00:00:00Z' }]);
  assert.equal(idx.get('20240101000000'), '2024-01-01T00:00:00Z');
  assert.equal(idx.size, 1);
});

test('indexes both sliceId and stamp when both present', () => {
  const idx = buildSliceTimeIndex([{ sliceId: 's1', stamp: '20240101000000', generated: '2024-01-01T00:00:00Z' }]);
  assert.equal(idx.get('s1'), '2024-01-01T00:00:00Z');
  assert.equal(idx.get('20240101000000'), '2024-01-01T00:00:00Z');
  assert.equal(idx.size, 2);
});

test('skips rows without generated', () => {
  const idx = buildSliceTimeIndex([{ sliceId: 's1' }, { stamp: '20240101000000' }]);
  assert.equal(idx.size, 0);
});

test('skips rows with undefined generated', () => {
  const idx = buildSliceTimeIndex([{ sliceId: 's1', generated: undefined }]);
  assert.equal(idx.size, 0);
});

test('skips rows with null generated', () => {
  const idx = buildSliceTimeIndex([{ sliceId: 's1', generated: null }]);
  assert.equal(idx.size, 0);
});

test('returns null for falsy sliceRef', () => {
  assert.equal(sliceToIso(null, new Map()), null);
  assert.equal(sliceToIso('', new Map()), null);
  assert.equal(sliceToIso(undefined, new Map()), null);
});

test('returns null when sliceTimeIndex is null or undefined', () => {
  assert.equal(sliceToIso('abc', null), null);
  assert.equal(sliceToIso('abc', undefined), null);
});

test('returns ISO when sliceRef is a direct key in the index', () => {
  const idx = new Map([['s1', '2024-01-01T00:00:00Z']]);
  assert.equal(sliceToIso('s1', idx), '2024-01-01T00:00:00Z');
});

test('returns null when sliceRef is not in the index and has no 14-digit stamp', () => {
  const idx = new Map([['s1', '2024-01-01T00:00:00Z']]);
  assert.equal(sliceToIso('unknown', idx), null);
});

test('extracts 14-digit stamp from sliceRef and looks it up in the index', () => {
  const idx = new Map([['20240101120000', '2024-01-01T12:00:00Z']]);
  assert.equal(sliceToIso('sweep-20240101120000', idx), '2024-01-01T12:00:00Z');
});

test('returns null when extracted stamp is not in the index', () => {
  const idx = new Map([['20240101120000', '2024-01-01T12:00:00Z']]);
  assert.equal(sliceToIso('sweep-19990101000000', idx), null);
});

test('prefers direct key match over embedded stamp extraction', () => {
  const idx = new Map([
    ['sweep-20240101120000', 'direct-iso'],
    ['20240101120000', 'stamp-iso'],
  ]);
  assert.equal(sliceToIso('sweep-20240101120000', idx), 'direct-iso');
});
