// Computes the evidence staleness threshold in hours from env or default (cra/evidence-status.mjs evidenceStaleHours).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evidenceStaleHours } from '../evidence-status.mjs';

test('returns default 36 when env var is undefined', () => {
  assert.equal(evidenceStaleHours({}), 36);
});

test('returns default 36 when env var is empty string', () => {
  assert.equal(evidenceStaleHours({ CW_CRA_EVIDENCE_STALE_HOURS: '' }), 36);
});

test('returns 24 when env var is "24"', () => {
  assert.equal(evidenceStaleHours({ CW_CRA_EVIDENCE_STALE_HOURS: '24' }), 24);
});

test('returns 1 when env var is "1"', () => {
  assert.equal(evidenceStaleHours({ CW_CRA_EVIDENCE_STALE_HOURS: '1' }), 1);
});

test('returns 0.5 when env var is "0.5"', () => {
  assert.equal(evidenceStaleHours({ CW_CRA_EVIDENCE_STALE_HOURS: '0.5' }), 0.5);
});

test('throws when env var is "0"', () => {
  assert.throws(() => evidenceStaleHours({ CW_CRA_EVIDENCE_STALE_HOURS: '0' }), /CW_CRA_EVIDENCE_STALE_HOURS must be a number of hours > 0/);
});

test('throws when env var is "-5"', () => {
  assert.throws(() => evidenceStaleHours({ CW_CRA_EVIDENCE_STALE_HOURS: '-5' }), /CW_CRA_EVIDENCE_STALE_HOURS must be a number of hours > 0/);
});

test('throws when env var is "abc"', () => {
  assert.throws(() => evidenceStaleHours({ CW_CRA_EVIDENCE_STALE_HOURS: 'abc' }), /CW_CRA_EVIDENCE_STALE_HOURS must be a number of hours > 0/);
});

test('throws when env var is "NaN"', () => {
  assert.throws(() => evidenceStaleHours({ CW_CRA_EVIDENCE_STALE_HOURS: 'NaN' }), /CW_CRA_EVIDENCE_STALE_HOURS must be a number of hours > 0/);
});

test('throws when env var is "Infinity"', () => {
  assert.throws(() => evidenceStaleHours({ CW_CRA_EVIDENCE_STALE_HOURS: 'Infinity' }), /CW_CRA_EVIDENCE_STALE_HOURS must be a number of hours > 0/);
});
