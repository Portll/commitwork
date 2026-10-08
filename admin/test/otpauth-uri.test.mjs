// The otpauth URI is what a phone's camera or authenticator reads: its label, digit count and period
// decide what the operator sees and types.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { otpauthUri } from '../auth.mjs';

test('the authenticator entry is named Commitwork and asks for a 6-digit, 30-second SHA-1 code', () => {
  const u = new URL(otpauthUri('JBSWY3DPEHPK3PXP', 'john@portll.net'));
  assert.equal(u.protocol, 'otpauth:');
  assert.equal(u.host, 'totp');
  assert.equal(decodeURIComponent(u.pathname), '/Commitwork:john@portll.net');
  assert.equal(u.searchParams.get('issuer'), 'Commitwork');
  assert.equal(u.searchParams.get('digits'), '6');
  assert.equal(u.searchParams.get('period'), '30');
  assert.equal(u.searchParams.get('algorithm'), 'SHA1');
  assert.equal(u.searchParams.get('secret'), 'JBSWY3DPEHPK3PXP');
});
