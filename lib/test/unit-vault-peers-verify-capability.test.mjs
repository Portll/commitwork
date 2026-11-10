// Whether a broker-signed peer capability is valid for an audience at a given time (lib/vault-peers.mjs verifyCapability).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyCapability } from '../vault-peers.mjs';
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';

const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');
const keyFromSeed = (byte) => createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, Buffer.alloc(32, byte)]), format: 'der', type: 'pkcs8' });
const priv = keyFromSeed(7);
const otherPriv = keyFromSeed(9);
const pub = createPublicKey(priv).export({ type: 'spki', format: 'pem' });

function makeCap(over = {}, key = priv) {
  const c = { peer: 'p1', audience: 'a1', expiresAt: 100, nonce: 'n1', ...over };
  const body = JSON.stringify({ peer: c.peer, audience: c.audience, expiresAt: c.expiresAt, nonce: c.nonce });
  return { ...c, signature: sign(null, Buffer.from(body), key).toString('base64') };
}

test('a null capability is rejected as not an object', () => {
  const r = verifyCapability({ capability: null, brokerPublicKey: pub, audience: 'a1', now: 50 });
  assert.deepEqual(r, { ok: false, reason: 'bad-capability', detail: 'not an object' });
});

test('a string capability is rejected as not an object', () => {
  const r = verifyCapability({ capability: 'str', brokerPublicKey: pub, audience: 'a1', now: 50 });
  assert.deepEqual(r, { ok: false, reason: 'bad-capability', detail: 'not an object' });
});

test('a correctly signed capability one tick before expiry with matching audience is accepted', () => {
  const r = verifyCapability({ capability: makeCap(), brokerPublicKey: pub, audience: 'a1', now: 99 });
  assert.deepEqual(r, { ok: true, peer: 'p1', audience: 'a1' });
});

test('a capability presented exactly at its expiry time is still accepted', () => {
  const r = verifyCapability({ capability: makeCap(), brokerPublicKey: pub, audience: 'a1', now: 100 });
  assert.deepEqual(r, { ok: true, peer: 'p1', audience: 'a1' });
});

test('a capability presented one tick after its expiry time is rejected as expired', () => {
  const r = verifyCapability({ capability: makeCap(), brokerPublicKey: pub, audience: 'a1', now: 101 });
  assert.deepEqual(r, { ok: false, reason: 'expired', detail: 'the capability has expired' });
});

test('a capability presented for a different audience is rejected with both audiences named', () => {
  const r = verifyCapability({ capability: makeCap(), brokerPublicKey: pub, audience: 'a2', now: 50 });
  assert.deepEqual(r, { ok: false, reason: 'wrong-audience', detail: 'issued for a1, presented for a2' });
});

test('omitting the audience skips the audience check and accepts a valid capability', () => {
  const r = verifyCapability({ capability: makeCap(), brokerPublicKey: pub, now: 50 });
  assert.deepEqual(r, { ok: true, peer: 'p1', audience: 'a1' });
});

test('a capability signed by a different key does not verify against the broker key', () => {
  const r = verifyCapability({ capability: makeCap({}, otherPriv), brokerPublicKey: pub, audience: 'a1', now: 50 });
  assert.deepEqual(r, { ok: false, reason: 'bad-signature', detail: 'does not verify against the broker key' });
});

test('a capability whose peer was changed after signing does not verify', () => {
  const r = verifyCapability({ capability: { ...makeCap(), peer: 'p2' }, brokerPublicKey: pub, audience: 'a1', now: 50 });
  assert.deepEqual(r, { ok: false, reason: 'bad-signature', detail: 'does not verify against the broker key' });
});

test('an unparseable broker key is reported as a bad signature with the key error message', () => {
  let expected;
  try { createPublicKey('not a pem key'); } catch (e) { expected = e.message; }
  const r = verifyCapability({ capability: makeCap(), brokerPublicKey: 'not a pem key', audience: 'a1', now: 50 });
  assert.deepEqual(r, { ok: false, reason: 'bad-signature', detail: expected });
});
