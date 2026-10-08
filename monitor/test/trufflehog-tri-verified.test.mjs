// `verified` on the history lane was typed bool, so COERCE mapped every non-true value to the word
// `false` — and the panel published "the issuing service refused this credential" for rows where
// nobody had asked it anything.
//
// Measured over the fleet's own artifacts on 2026-09-02: 488 rows in 60 trufflehog.json files, 49
// verified true and 439 false — and ALL 439 carried a VerificationError, every one a DNS failure
// against a placeholder host. Not one was a refusal. The false label was wrong on the whole
// population, not at the margin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowsFor } from '../detail-schema.mjs';

const row = (over = {}) => ({ detector: 'Postgres', file: 'a.ts', line: 3, commit: 'abc', ...over });

test('the harness is live — a declared field survives and an undeclared one does not', () => {
  const [r] = rowsFor('secretsHistory', [row({ verified: true, Raw: 'postgres://u:LIVE@h/db' })]);
  assert.equal(r.verified, true);
  assert.equal(JSON.stringify(r).includes('LIVE'), false, 'the raw value must never reach a row');
});

test('THE FIX: an errored verification is NULL, not false', () => {
  const [r] = rowsFor('secretsHistory', [row({ verified: null, verificationError: 'lookup gw: no such host' })]);
  assert.equal(r.verified, null, 'no verifier could be asked — that is not a refusal');
  assert.notEqual(r.verified, false);
});

test('a genuine refusal stays false, so the two remain distinguishable', () => {
  const [r] = rowsFor('secretsHistory', [row({ verified: false, verificationError: '' })]);
  assert.equal(r.verified, false);
});

test('true survives untouched', () => {
  const [r] = rowsFor('secretsHistory', [row({ verified: true })]);
  assert.equal(r.verified, true);
});

test('the reason travels, so "unverified" is not a bare assertion', () => {
  const [r] = rowsFor('secretsHistory', [row({ verified: null, verificationError: 'lookup db.x.supabase.co: no such host' })]);
  assert.match(r.verificationError, /no such host/, 'a null with no reason is an unexplained shrug');
});

test('an absent verified is null, never coerced to false', () => {
  // The bug in one line: bool made `undefined` into `false`. tri must leave it unknown.
  const [r] = rowsFor('secretsHistory', [row({})]);
  assert.equal(r.verified, null);
  assert.equal(r.verificationError, '', 'a declared field the source lacks is the type empty, never undefined');
});

test('the three states are three distinct values, not two', () => {
  const rows = rowsFor('secretsHistory', [
    row({ verified: true }),
    row({ verified: false }),
    row({ verified: null, verificationError: 'lookup host: no such host' }),
  ]);
  assert.deepEqual(rows.map((r) => r.verified), [true, false, null]);
  assert.equal(new Set(rows.map((r) => r.verified)).size, 3, 'collapsing any pair is the defect this replaces');
});
