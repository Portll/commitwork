// Maps a raw verdict and optional expiry to a client-facing status string (monitor/defence-vector.mjs verdictForClient).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdictForClient } from '../defence-vector.mjs';

test('inexploitable with expiry returns accepted+contained with recheck month', () => {
  const r = verdictForClient('inexploitable', '2025-06-15T00:00:00Z');
  assert.equal(r, "accepted+contained (recheck 2025-06)");
});

test('contained with expiry returns accepted+contained with recheck month', () => {
  const r = verdictForClient('contained', '2025-06-15T00:00:00Z');
  assert.equal(r, "accepted+contained (recheck 2025-06)");
});

test('inexploitable without expiry returns accepted+contained without suffix', () => {
  const r = verdictForClient('inexploitable', undefined);
  assert.equal(r, "accepted+contained");
});

test('contained without expiry returns accepted+contained without suffix', () => {
  const r = verdictForClient('contained', undefined);
  assert.equal(r, "accepted+contained");
});

test('undetermined returns defences not assessed', () => {
  const r = verdictForClient('undetermined', '2025-06-15T00:00:00Z');
  assert.equal(r, "defences not assessed");
});

test('other verdict passes through unchanged', () => {
  const r = verdictForClient('exploitable', '2025-06-15T00:00:00Z');
  assert.equal(r, "exploitable");
});

test('inexploitable with empty string expiry returns accepted+contained without suffix', () => {
  const r = verdictForClient('inexploitable', '');
  assert.equal(r, "accepted+contained");
});

test('contained with empty string expiry returns accepted+contained without suffix', () => {
  const r = verdictForClient('contained', '');
  assert.equal(r, "accepted+contained");
});
