// Extracts re-measurement evidence from structured, prose, or basis fields (bin/rate-llm.mjs peerEvidence).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peerEvidence } from '../rate-llm.mjs';

test('returns null when input is undefined', () => {
  assert.equal(peerEvidence(undefined), null);
});

test('returns null when measurement is missing and evidence is empty string', () => {
  assert.equal(peerEvidence({ evidence: '' }), null);
});

test('returns null when basis does not match the RE-MEASURED pattern', () => {
  assert.equal(peerEvidence({ basis: 'NO MATCH HERE' }), null);
});

test('returns null when basis matches but the captured prose is empty', () => {
  assert.equal(peerEvidence({ basis: 'RE-MEASURED at abc1234:   Method: x' }), null);
});

test('returns null when basis has no RE-MEASURED prefix', () => {
  assert.equal(peerEvidence({ basis: 'SOMETHING ELSE' }), null);
});

test('returns rendered measurement from structured input with docsVerdict', () => {
  assert.equal(peerEvidence({ measurement: { docsVerdict: 'green' } }), "docs-doctor, re-derived from the tree at that same commit, returned: green");
});

test('returns rendered measurement from structured input with fail and floor', () => {
  assert.equal(peerEvidence({ measurement: { fail: 3, floor: 5, pass: 10 } }), "the suite, re-run at that same commit, measured 3 failing / 10 passing, against the stored floor of 5 failing.");
});

test('returns rendered measurement extracted from prose evidence', () => {
  assert.equal(peerEvidence({ evidence: 're-ran the suite at abc1234 twice: 3 failing, 10 passing against the floor of 5' }), "the suite, re-run at that same commit, measured 3 failing / 10 passing, against the stored floor of 5 failing.");
});

test('returns rendered measurement extracted from basis when evidence is absent', () => {
  assert.equal(peerEvidence({ basis: 'RE-MEASURED at abc1234: re-ran the suite at abc1234 twice: 3 failing, 10 passing against the floor of 5. Method: x' }), "the suite, re-run at that same commit, measured 3 failing / 10 passing, against the stored floor of 5 failing.");
});

test('returns null when prose has no floor to compare against', () => {
  assert.equal(peerEvidence({ evidence: 're-ran the suite at abc1234 twice: 3 failing, 10 passing' }), null);
});
