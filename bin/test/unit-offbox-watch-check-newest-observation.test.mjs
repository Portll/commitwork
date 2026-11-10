// Finds the newest observation record from newline-delimited JSON text (bin/offbox-watch-check.mjs newestObservation).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newestObservation } from '../offbox-watch-check.mjs';

test('returns zero records and null newest for empty string', () => {
  const r = newestObservation('');
  assert.deepEqual(r, { records: 0, newest: null, torn: 0 });
});

test('returns zero records and null newest for null input', () => {
  const r = newestObservation(null);
  assert.deepEqual(r, { records: 0, newest: null, torn: 0 });
});

test('returns zero records and null newest for undefined input', () => {
  const r = newestObservation(undefined);
  assert.deepEqual(r, { records: 0, newest: null, torn: 0 });
});

test('returns zero records and null newest for whitespace-only lines', () => {
  const r = newestObservation('\n\n');
  assert.deepEqual(r, { records: 0, newest: null, torn: 0 });
});

test('returns the single record as newest with zero torn', () => {
  const r = newestObservation('{"observedAt":"2024-01-01T00:00:00Z","id":1}');
  assert.deepEqual(r, { records: 1, newest: { observedAt: "2024-01-01T00:00:00Z", id: 1 }, torn: 0 });
});

test('returns the later record as newest when timestamps differ', () => {
  const r = newestObservation('{"observedAt":"2024-01-01T00:00:00Z","id":1}\n{"observedAt":"2024-01-02T00:00:00Z","id":2}');
  assert.deepEqual(r, { records: 2, newest: { observedAt: "2024-01-02T00:00:00Z", id: 2 }, torn: 0 });
});

test('returns the first record as newest when timestamps are equal', () => {
  const r = newestObservation('{"observedAt":"2024-01-01T00:00:00Z","id":1}\n{"observedAt":"2024-01-01T00:00:00Z","id":2}');
  assert.deepEqual(r, { records: 2, newest: { observedAt: "2024-01-01T00:00:00Z", id: 1 }, torn: 0 });
});

test('counts unparseable lines as torn and skips them', () => {
  const r = newestObservation('not-json\n{"observedAt":"2024-01-01T00:00:00Z","id":1}');
  assert.deepEqual(r, { records: 2, newest: { observedAt: "2024-01-01T00:00:00Z", id: 1 }, torn: 1 });
});

test('returns null newest when all lines are unparseable', () => {
  const r = newestObservation('bad1\nbad2');
  assert.deepEqual(r, { records: 2, newest: null, torn: 2 });
});

test('prefers record with later timestamp over earlier one in reverse order', () => {
  const r = newestObservation('{"observedAt":"2024-01-02T00:00:00Z","id":2}\n{"observedAt":"2024-01-01T00:00:00Z","id":1}');
  assert.deepEqual(r, { records: 2, newest: { observedAt: "2024-01-02T00:00:00Z", id: 2 }, torn: 0 });
});
