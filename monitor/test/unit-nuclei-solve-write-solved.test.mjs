// Writes solved nuclei records to a JSONL file (monitor/nuclei-solve.mjs writeSolved).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeSolved } from '../nuclei-solve.mjs';

test('returns null when result is null', () => {
  const out = writeSolved('/tmp/test', null);
  assert.strictEqual(out, null);
});

test('returns null when result is undefined', () => {
  const out = writeSolved('/tmp/test', undefined);
  assert.strictEqual(out, null);
});

test('returns null when result.ok is false', () => {
  const out = writeSolved('/tmp/test', { ok: false, records: [] });
  assert.strictEqual(out, null);
});

test('returns null when result.ok is 1 instead of true', () => {
  const out = writeSolved('/tmp/test', { ok: 1, records: [] });
  assert.strictEqual(out, null);
});

test('returns null when result.ok is "true" string instead of boolean', () => {
  const out = writeSolved('/tmp/test', { ok: 'true', records: [] });
  assert.strictEqual(out, null);
});
