// Human-readable explanation of an attestation verdict (lib/deploy-core.mjs explainAttestation).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainAttestation } from '../deploy-core.mjs';

test('returns the drift explanation when the verdict is unprotected', () => {
  const r = { authAt: 'origin', attest: { verdict: 'unprotected', status: 200, why: 'ok' } };
  assert.equal(explainAttestation(r), "");
});

test('returns the unusability explanation when the verdict is unusable', () => {
  const r = { authAt: 'origin', attest: { verdict: 'unusable', status: 401, why: 'no account' } };
  assert.equal(explainAttestation(r), "declares authAt:'origin' and the origin DID refuse (HTTP 401) \u2014 but its own answer says no operator account exists, so nobody can authenticate and the refusal is unusability, not protection. An attestation must never be satisfied by the failure state it exists to detect: bootstrap an operator (loopback only) and re-run, or drop the authAt claim until one exists.");
});

test('returns the unverified explanation when the verdict is protected', () => {
  const r = { authAt: 'edge', attest: { verdict: 'protected', status: 403, why: 'identity check' } };
  assert.equal(explainAttestation(r), "declares authAt:'edge' and the claim was NOT verified \u2014 identity check. An unverified attestation is not an attestation; it must not pass a gate.");
});

test('returns the unverified explanation when the verdict is unverifiable', () => {
  const r = { authAt: 'edge', attest: { verdict: 'unverifiable', status: 0, why: 'no answer' } };
  assert.equal(explainAttestation(r), "declares authAt:'edge' and the claim was NOT verified \u2014 no answer. An unverified attestation is not an attestation; it must not pass a gate.");
});

test('returns the unverified explanation when the attest object is missing', () => {
  const r = { authAt: 'origin' };
  assert.equal(explainAttestation(r), "declares authAt:'origin' and the claim was NOT verified \u2014 undefined. An unverified attestation is not an attestation; it must not pass a gate.");
});

test('returns the unverified explanation when the verdict is an unknown string', () => {
  const r = { authAt: 'origin', attest: { verdict: 'weird', status: 500, why: 'boom' } };
  assert.equal(explainAttestation(r), "declares authAt:'origin' and the claim was NOT verified \u2014 boom. An unverified attestation is not an attestation; it must not pass a gate.");
});
