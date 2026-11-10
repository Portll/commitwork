// Maps a probe record to an attestation verdict or null (lib/offbox-evidence.mjs verdictFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdictFor } from '../offbox-evidence.mjs';

test('returns null when the record is missing', () => {
  assert.deepEqual(verdictFor(null), null);
});

test('returns null when the outcome is no-information', () => {
  assert.deepEqual(verdictFor({ kind: 'protected', verdict: 'UNREACHABLE', vantage: 'v1', why: 'w1' }), null);
});

test('returns attested true when the outcome is pass', () => {
  assert.deepEqual(verdictFor({ kind: 'protected', verdict: 'EDGE_AUTH', vantage: 'v1', why: 'w1' }), { attested: true, why: "off-box probe from v1 confirmed the 'protected' expectation: w1" });
});

test('returns attested false when the outcome is fail', () => {
  assert.deepEqual(verdictFor({ kind: 'protected', verdict: 'UNPROTECTED', vantage: 'v1', why: 'w1' }), { attested: false, why: "off-box probe from v1 contradicted the 'protected' expectation: w1" });
});

test('returns attested true when the outcome is pass for available-and-protected', () => {
  assert.deepEqual(verdictFor({ kind: 'available-and-protected', verdict: 'EDGE_AUTH', vantage: 'v2', why: 'w2' }), { attested: true, why: "off-box probe from v2 confirmed the 'available-and-protected' expectation: w2" });
});

test('returns attested false when the outcome is fail for available-and-protected', () => {
  assert.deepEqual(verdictFor({ kind: 'available-and-protected', verdict: 'UNREACHABLE', vantage: 'v2', why: 'w2' }), { attested: false, why: "off-box probe from v2 contradicted the 'available-and-protected' expectation: w2" });
});

test('returns attested false when the outcome is fail for unreachable', () => {
  assert.deepEqual(verdictFor({ kind: 'unreachable', verdict: 'EDGE_AUTH', vantage: 'v3', why: 'w3' }), { attested: false, why: "off-box probe from v3 contradicted the 'unreachable' expectation: w3" });
});

test('returns attested true when the outcome is pass for unreachable', () => {
  assert.deepEqual(verdictFor({ kind: 'unreachable', verdict: 'UNREACHABLE', vantage: 'v3', why: 'w3' }), { attested: true, why: "off-box probe from v3 confirmed the 'unreachable' expectation: w3" });
});
