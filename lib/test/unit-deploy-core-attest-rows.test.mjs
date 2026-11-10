// attestRows classifies rows with auth probing (lib/deploy-core.mjs attestRows).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attestRows } from '../deploy-core.mjs';

test('returns null when rows argument is null', async () => {
  const result = await attestRows(null);
  assert.equal(result, null);
});

test('skips rows without authAt property', async () => {
  const rows = [{ hostname: 'example.com' }];
  const result = await attestRows(rows);
  assert.deepEqual(result, [{ hostname: "example.com" }]);
});

test('sets UNVERIFIABLE byDesign true when authAt is not origin and no offBox', async () => {
  const rows = [{ authAt: 'front', hostname: 'host1' }];
  const result = await attestRows(rows);
  assert.deepEqual(result, [{ authAt: "front", hostname: "host1", attest: { verdict: "unverifiable", byDesign: true, status: null, why: "authAt:'front' sits in FRONT of the tunnel, so a probe from the origin box bypasses it by construction and a pass would prove nothing" } }]);
});

test('marks UNVERIFIABLE when authAt is origin but service missing', async () => {
  const rows = [{ authAt: 'origin', hostname: 'host2', origin: true }];
  const result = await attestRows(rows);
  assert.deepEqual(result, [{ authAt: "origin", hostname: "host2", origin: true, attest: { verdict: "unverifiable", byDesign: false, status: null, why: "no ingress rule routes this hostname, so there was no origin to ask" }, authAttested: false }]);
});

test('marks UNVERIFIABLE when authAt is origin but origin flag false', async () => {
  const rows = [{ authAt: 'origin', hostname: 'host3', service: 'http://svc', origin: false }];
  const result = await attestRows(rows);
  assert.deepEqual(result, [{ authAt: "origin", hostname: "host3", service: "http://svc", origin: false, attest: { verdict: "unverifiable", byDesign: false, status: null, why: "nothing is listening on the origin, so the claim could not be tested" }, authAttested: false }]);
});

test('classifies protected when probe returns 401 without unusable body', async () => {
  const probe = async () => ({ status: 401, body: 'denied', error: null });
  const rows = [{ authAt: 'origin', hostname: 'host4', service: 'http://svc', origin: true }];
  const result = await attestRows(rows, { probe });
  assert.deepEqual(result, [{ authAt: "origin", hostname: "host4", service: "http://svc", origin: true, attest: { verdict: "protected", why: "the origin refused an unauthenticated request with HTTP 401", status: 401, byDesign: false }, authProbe: 401, authAttested: true }]);
});

test('classifies unprotected when probe returns 200', async () => {
  const probe = async () => ({ status: 200, body: '{}', error: null });
  const rows = [{ authAt: 'origin', hostname: 'host5', service: 'http://svc', origin: true }];
  const result = await attestRows(rows, { probe });
  assert.deepEqual(result, [{ authAt: "origin", hostname: "host5", service: "http://svc", origin: true, attest: { verdict: "unprotected", why: "the origin answered HTTP 200 to an unauthenticated request", status: 200, byDesign: false }, authProbe: 200, authAttested: false }]);
});

test('classifies unusable when probe returns 401 with unusable body text', async () => {
  const probe = async () => ({ status: 401, body: 'no operator account', error: null });
  const rows = [{ authAt: 'origin', hostname: 'host6', service: 'http://svc', origin: true }];
  const result = await attestRows(rows, { probe });
  assert.deepEqual(result, [{ authAt: "origin", hostname: "host6", service: "http://svc", origin: true, attest: { verdict: "unusable", why: "the origin refused with HTTP 401, but its own answer says no operator account exists \u2014 nobody can authenticate, so the refusal is unusability, not protection", status: 401, byDesign: false }, authProbe: 401, authAttested: false }]);
});

test('classifies unverifiable when probe returns an error', async () => {
  const probe = async () => ({ status: null, body: '', error: 'timeout' });
  const rows = [{ authAt: 'origin', hostname: 'host7', service: 'http://svc', origin: true }];
  const result = await attestRows(rows, { probe });
  assert.deepEqual(result, [{ authAt: "origin", hostname: "host7", service: "http://svc", origin: true, attest: { verdict: "unverifiable", why: "the origin gave no usable answer (timeout), so the claim was not tested", status: null, byDesign: false }, authProbe: "timeout", authAttested: false }]);
});

test('classifies unverifiable when probe returns 503 server error', async () => {
  const probe = async () => ({ status: 503, body: 'service down', error: null });
  const rows = [{ authAt: 'origin', hostname: 'host8', service: 'http://svc', origin: true }];
  const result = await attestRows(rows, { probe });
  assert.deepEqual(result, [{ authAt: "origin", hostname: "host8", service: "http://svc", origin: true, attest: { verdict: "unverifiable", why: "the origin answered HTTP 503 \u2014 a server fault, which says nothing either way about whether it authenticates", status: 503, byDesign: false }, authProbe: 503, authAttested: false }]);
});
