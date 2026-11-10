// Consent verdict for probing a target origin: ok with its basis, or a void reason (bin/lib/probe-oracle.mjs verifyConsent).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyConsent } from '../lib/probe-oracle.mjs';

process.env.CW_NOW = '2025-06-01T00:00:00.000Z';

const T = 'https://victim.example.com';
const H = 'victim.example.com';
const third = { thirdParty: true };

test('A call with no target is void because there is no origin to bind consent to', () => {
  assert.deepEqual(verifyConsent(), {
    state: 'void', ok: false, code: 'consent-no-target', reason: 'no probe target origin to bind consent to.',
  });
});

test('A fleet-owned area is ok on self-asserted consent with the lowercased target host', () => {
  const r = verifyConsent({ area: { thirdParty: false }, target: 'https://Fleet.Example.COM/x' });
  assert.deepEqual(r, { state: 'ok', ok: true, basis: 'fleet-owned', target: 'fleet.example.com' });
});

test('A non-fleet target with no security.txt is void as unverified', () => {
  const r = verifyConsent({ area: null, target: T, securityTxt: null });
  assert.deepEqual(r, {
    state: 'void', ok: false, code: 'consent-unverified',
    reason: 'target victim.example.com is not a fleet-owned area, so self-asserted consent does NOT authorize probing it. '
      + 'A non-fleet target requires proof of control: a published security.txt/VDP served at the exact origin and '
      + 'authorizing testing in scope, or an operator co-sign. None supplied \u2014 the probe is void.',
    target: H,
  });
});

test('A security.txt served from another host is void as cross-origin', () => {
  const txt = 'Contact: mailto:sec@victim.example.com\nScope: victim.example.com';
  const r = verifyConsent({ area: third, target: T, securityTxt: txt, servedFrom: 'https://evil.example.com' });
  assert.deepEqual(r, {
    state: 'void', ok: false, code: 'consent-cross-origin',
    reason: 'the security.txt was served from evil.example.com but the probe target is victim.example.com \u2014 '
      + 'proof of control must bind to the probe origin (exact host, no cross-origin redirect). '
      + 'Consent for evil.example.com does not authorize probing victim.example.com.',
    target: H, servedFrom: 'evil.example.com',
  });
});

test('A security.txt without a Contact field is void as no contact', () => {
  const r = verifyConsent({ area: third, target: T, securityTxt: 'Scope: victim.example.com', servedFrom: T });
  assert.deepEqual(r, {
    state: 'void', ok: false, code: 'consent-no-contact',
    reason: 'security.txt at victim.example.com has no Contact field \u2014 it is not a vulnerability-disclosure '
      + 'authorization. Absent an explicit invitation, silence is not consent.',
    target: H,
  });
});

test('A security.txt that expired one millisecond before now is void as expired', () => {
  const txt = 'Contact: mailto:sec@victim.example.com\nExpires: 2025-05-31T23:59:59.999Z\nScope: victim.example.com';
  const r = verifyConsent({ area: third, target: T, securityTxt: txt, servedFrom: T });
  assert.deepEqual(r, {
    state: 'void', ok: false, code: 'consent-expired',
    reason: 'the security.txt authorizing victim.example.com expired 2025-05-31T23:59:59.999Z '
      + '(now 2025-06-01T00:00:00.000Z) \u2014 consent carries a TTL and re-verifies; stale standing is void.',
    target: H, expiresRaw: '2025-05-31T23:59:59.999Z',
  });
});

test('A security.txt expiring exactly now is still valid and the in-scope target is ok', () => {
  const txt = 'Contact: mailto:sec@victim.example.com\nExpires: 2025-06-01T00:00:00.000Z\nScope: victim.example.com';
  const r = verifyConsent({ area: third, target: T, securityTxt: txt, servedFrom: T });
  assert.deepEqual(r, { state: 'ok', ok: true, basis: 'verified-vdp', target: H, expiresRaw: '2025-06-01T00:00:00.000Z' });
});

test('A security.txt with no Expires, Scope or Canonical served from the target origin is ok by binding', () => {
  const txt = 'Contact: mailto:sec@victim.example.com';
  const r = verifyConsent({ area: third, target: T, securityTxt: txt, servedFrom: T + '/.well-known/security.txt' });
  assert.deepEqual(r, { state: 'ok', ok: true, basis: 'verified-vdp', target: H, expiresRaw: null });
});

test('A Scope naming only another host leaves the bound target out of scope', () => {
  const txt = 'Contact: mailto:sec@other.example.com\nScope: other.example.com';
  const r = verifyConsent({ area: third, target: T, securityTxt: txt, servedFrom: T });
  assert.deepEqual(r, {
    state: 'void', ok: false, code: 'consent-out-of-scope',
    reason: 'target victim.example.com is not within the scope authorized by its security.txt '
      + '(scope: other.example.com; canonical: (none); served-from binding: yes). '
      + 'An authorization for other hosts does not authorize this one.',
    target: H, scope: ['other.example.com'], canonical: [],
  });
});

test('A Canonical for another host with no served-from origin is out of scope and reports no scope declared', () => {
  const canon = 'https://other.example.com/.well-known/security.txt';
  const txt = 'Contact: mailto:a@b.example\nCanonical: ' + canon;
  const r = verifyConsent({ area: third, target: T, securityTxt: txt });
  assert.deepEqual(r, {
    state: 'void', ok: false, code: 'consent-out-of-scope',
    reason: 'target victim.example.com is not within the scope authorized by its security.txt '
      + '(scope: (none declared); canonical: ' + canon + '; served-from binding: no). '
      + 'An authorization for other hosts does not authorize this one.',
    target: H, scope: [], canonical: [canon],
  });
});
