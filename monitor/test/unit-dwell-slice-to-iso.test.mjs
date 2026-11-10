// Resolve a slice reference to its ISO timestamp via an index (monitor/dwell.mjs sliceToIso).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sliceToIso } from '../dwell.mjs';

test('returns null when sliceRef is falsy', () => {
  const r = sliceToIso(null, new Map());
  assert.equal(r, null);
});

test('returns the indexed value when sliceRef is directly in the index', () => {
  const idx = new Map([['sweep-20240101120000', '2024-01-01T12:00:00Z']]);
  const r = sliceToIso('sweep-20240101120000', idx);
  assert.equal(r, "2024-01-01T12:00:00Z");
});

test('returns null when sliceRef is not in the index and has no embedded stamp', () => {
  const idx = new Map([['other', '2024-01-01T12:00:00Z']]);
  const r = sliceToIso('no-stamp-here', idx);
  assert.equal(r, null);
});

test('returns the indexed value when the embedded 14-digit stamp is in the index', () => {
  const idx = new Map([['20240101120000', '2024-01-01T12:00:00Z']]);
  const r = sliceToIso('sweep-20240101120000', idx);
  assert.equal(r, "2024-01-01T12:00:00Z");
});

test('returns null when sliceTimeIndex is null and sliceRef has no embedded stamp', () => {
  const r = sliceToIso('plain-name', null);
  assert.equal(r, null);
});

test('returns null when sliceTimeIndex is null and sliceRef has an embedded stamp', () => {
  const r = sliceToIso('sweep-20240101120000', null);
  assert.equal(r, null);
});

test('returns null when sliceTimeIndex is undefined and sliceRef has an embedded stamp', () => {
  const r = sliceToIso('sweep-20240101120000', undefined);
  assert.equal(r, null);
});

test('returns null when sliceTimeIndex is an empty map and sliceRef has an embedded stamp', () => {
  const r = sliceToIso('sweep-20240101120000', new Map());
  assert.equal(r, null);
});

test('returns the indexed value when sliceTimeIndex is an empty map and sliceRef is directly present', () => {
  const idx = new Map([['direct-key', '2024-06-15T08:30:00Z']]);
  const r = sliceToIso('direct-key', idx);
  assert.equal(r, "2024-06-15T08:30:00Z");
});

test('returns null when sliceRef is an empty string', () => {
  const r = sliceToIso('', new Map());
  assert.equal(r, null);
});
