// Computes a 16-char sha256 prefix of the result basis (lib/launchlist.mjs digestEvidence).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digestEvidence } from '../launchlist.mjs';

test('returns null when result is null', () => {
  assert.equal(digestEvidence(null), null);
});

test('returns null when result is undefined', () => {
  assert.equal(digestEvidence(undefined), null);
});

test('returns null when result is false', () => {
  assert.equal(digestEvidence(false), null);
});

test('returns null when result is zero', () => {
  assert.equal(digestEvidence(0), null);
});

test('returns null when result is empty string', () => {
  assert.equal(digestEvidence(''), null);
});

test('returns 16-char hex digest for a result with evidence array', () => {
  const r = digestEvidence({ status: 'ok', summary: 's', evidence: ['a', 'b'] });
  assert.equal(r, "10cbabb6ab6063e5");
});

test('returns 16-char hex digest for a result with evidence null', () => {
  const r = digestEvidence({ status: 'ok', summary: 's', evidence: null });
  assert.equal(r, "59dec31164189b69");
});

test('returns 16-char hex digest for a result with evidence false', () => {
  const r = digestEvidence({ status: 'ok', summary: 's', evidence: false });
  assert.equal(r, "59dec31164189b69");
});

test('returns 16-char hex digest for a result with evidence zero', () => {
  const r = digestEvidence({ status: 'ok', summary: 's', evidence: 0 });
  assert.equal(r, "59dec31164189b69");
});

test('returns 16-char hex digest for a result with evidence empty string', () => {
  const r = digestEvidence({ status: 'ok', summary: 's', evidence: '' });
  assert.equal(r, "59dec31164189b69");
});
