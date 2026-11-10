// The empty attestations document shape (monitor/a11y-attestations.mjs emptyAttestationsDoc).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyAttestationsDoc } from '../a11y-attestations.mjs';

test('returns an object with a note, version, and entries keys', () => {
  const r = emptyAttestationsDoc();
  assert.deepEqual(Object.keys(r).sort(), ['entries', 'note', 'version']);
});

test('sets version to 1', () => {
  const r = emptyAttestationsDoc();
  assert.equal(r.version, 1);
});

test('sets entries to an empty array', () => {
  const r = emptyAttestationsDoc();
  assert.deepEqual(r.entries, []);
});

test('sets note to the exact attestation header text', () => {
  const r = emptyAttestationsDoc();
  assert.equal(
    r.note,
    'commitwork WCAG ATTESTATIONS \u2014 a person recording that they manually verified a success '
    + 'criterion bin/a11y-scan.mjs cannot decide. APPEND-ONLY: a withdrawal is a new entry, '
    + 'never a deletion. Every entry is bound to the content digest of the pages checked and '
    + 'stops being in force when that digest moves. An attestation is NOT a scanner pass. '
    + 'Written by monitor/a11y-attestations.mjs; never edit by hand.'
  );
});

test('returns a fresh object on each call', () => {
  const a = emptyAttestationsDoc();
  const b = emptyAttestationsDoc();
  assert.notEqual(a, b);
});

test('returns the same shape regardless of call count', () => {
  const r = emptyAttestationsDoc();
  assert.deepEqual(r, {
    note: 'commitwork WCAG ATTESTATIONS \u2014 a person recording that they manually verified a success '
        + 'criterion bin/a11y-scan.mjs cannot decide. APPEND-ONLY: a withdrawal is a new entry, '
        + 'never a deletion. Every entry is bound to the content digest of the pages checked and '
        + 'stops being in force when that digest moves. An attestation is NOT a scanner pass. '
        + 'Written by monitor/a11y-attestations.mjs; never edit by hand.',
    version: 1,
    entries: [],
  });
});
