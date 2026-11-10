// Classifies an HTTP response as protected, unprotected, unusable, or unverifiable (lib/deploy-core.mjs classifyAttestation).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyAttestation } from '../deploy-core.mjs';

test('returns unverifiable when an error is present', () => {
  const r = classifyAttestation({ status: 200, body: 'ok', error: 'ECONNREFUSED' });
  assert.deepEqual(r, { verdict: "unverifiable", why: "the origin gave no usable answer (ECONNREFUSED), so the claim was not tested" });
});

test('returns unverifiable when status is not a number', () => {
  const r = classifyAttestation({ status: null, body: 'ok' });
  assert.deepEqual(r, { verdict: "unverifiable", why: "no status was observed, so the claim was not tested" });
});

test('returns unusable when body matches unusable pattern regardless of status', () => {
  const r = classifyAttestation({ status: 401, body: 'no operator account exists' });
  assert.deepEqual(r, { verdict: "unusable", why: "the origin refused with HTTP 401, but its own answer says no operator account exists \u2014 nobody can authenticate, so the refusal is unusability, not protection" });
});

test('returns unprotected for status 200', () => {
  const r = classifyAttestation({ status: 200, body: 'ok' });
  assert.deepEqual(r, { verdict: "unprotected", why: "the origin answered HTTP 200 to an unauthenticated request" });
});

test('returns unprotected for status 299', () => {
  const r = classifyAttestation({ status: 299, body: 'ok' });
  assert.deepEqual(r, { verdict: "unprotected", why: "the origin answered HTTP 299 to an unauthenticated request" });
});

test('returns protected for status 401', () => {
  const r = classifyAttestation({ status: 401, body: 'unauthorized' });
  assert.deepEqual(r, { verdict: "protected", why: "the origin refused an unauthenticated request with HTTP 401" });
});

test('returns protected for status 403', () => {
  const r = classifyAttestation({ status: 403, body: 'forbidden' });
  assert.deepEqual(r, { verdict: "protected", why: "the origin refused an unauthenticated request with HTTP 403" });
});

test('returns protected for status 301', () => {
  const r = classifyAttestation({ status: 301, body: 'redirect' });
  assert.deepEqual(r, { verdict: "protected", why: "the origin refused an unauthenticated request with HTTP 301" });
});

test('returns unverifiable for status 500', () => {
  const r = classifyAttestation({ status: 500, body: 'internal error' });
  assert.deepEqual(r, { verdict: "unverifiable", why: "the origin answered HTTP 500 \u2014 a server fault, which says nothing either way about whether it authenticates" });
});

test('returns unprotected for status 418', () => {
  const r = classifyAttestation({ status: 418, body: 'teapot' });
  assert.deepEqual(r, { verdict: "unprotected", why: "the origin answered HTTP 418, which is neither a refusal about identity nor a fault \u2014 the claim is not backed" });
});
