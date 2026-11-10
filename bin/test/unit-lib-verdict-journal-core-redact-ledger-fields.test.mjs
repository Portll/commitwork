// Redacts free-text fields in ledger records to place, artifact, and sha256 (bin/lib/verdict-journal-core.mjs redactLedgerFields).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactLedgerFields } from '../lib/verdict-journal-core.mjs';
import { createHash } from 'node:crypto';

test('returns null when record is null', () => {
  assert.equal(redactLedgerFields(null), null);
});

test('returns 42 when record is a number', () => {
  assert.equal(redactLedgerFields(42), 42);
});

test('returns the record unchanged when kind is not in LEDGER_FREE_TEXT_FIELDS', () => {
  const rec = { kind: 'other', evidence: 'text', basis: 'reason' };
  assert.deepEqual(redactLedgerFields(rec), { kind: "other", evidence: "text", basis: "reason" });
});

test('replaces non-empty string evidence and basis with place, artifact, and sha256', () => {
  const rec = { kind: 'finding-adjudication', evidence: 'ev', basis: 'ba' };
  const expected = {
    kind: 'finding-adjudication',
    evidence: { place: 'p', artifact: 'a', sha256: createHash('sha256').update('ev').digest('hex') },
    basis: { place: 'p', artifact: 'a', sha256: createHash('sha256').update('ba').digest('hex') },
  };
  assert.deepEqual(redactLedgerFields(rec, { place: 'p', artifact: 'a' }), { kind: "finding-adjudication", evidence: { place: "p", artifact: "a", sha256: "67d35554c1f60638d6d72a0edc045450a841f7efabe0f9843b7e653499094538" }, basis: { place: "p", artifact: "a", sha256: "970f519c2cadbcefb1e81694f904bc6229dd2a8300e98c6d0d4fc4bfca584140" } });
});

test('leaves empty string evidence unchanged', () => {
  const rec = { kind: 'finding-adjudication', evidence: '', basis: 'ba' };
  assert.deepEqual(redactLedgerFields(rec), { kind: "finding-adjudication", evidence: "", basis: { place: null, artifact: null, sha256: "970f519c2cadbcefb1e81694f904bc6229dd2a8300e98c6d0d4fc4bfca584140" } });
});

test('leaves non-string evidence unchanged', () => {
  const rec = { kind: 'finding-adjudication', evidence: 123, basis: 'ba' };
  assert.deepEqual(redactLedgerFields(rec), { kind: "finding-adjudication", evidence: 123, basis: { place: null, artifact: null, sha256: "970f519c2cadbcefb1e81694f904bc6229dd2a8300e98c6d0d4fc4bfca584140" } });
});

test('uses null for place and artifact when not provided', () => {
  const rec = { kind: 'finding-adjudication', evidence: 'x', basis: 'y' };
  assert.deepEqual(redactLedgerFields(rec), { kind: "finding-adjudication", evidence: { place: null, artifact: null, sha256: "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881" }, basis: { place: null, artifact: null, sha256: "a1fce4363854ff888cff4b8e7875d600c2682390412a8cf79b37d0b11148b0fa" } });
});
