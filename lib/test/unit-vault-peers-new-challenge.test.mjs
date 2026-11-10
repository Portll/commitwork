// A random 32-byte base64 nonce plus an expiry 30000 ms after now (lib/vault-peers.mjs newChallenge).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { newChallenge } from '../vault-peers.mjs';

function checkNonce(nonce) {
  assert.equal(nonce.length, 44);
  const raw = Buffer.from(nonce, 'base64');
  assert.equal(raw.length, 32);
  assert.equal(raw.toString('base64'), nonce);
  assert.equal(nonce[43], '=');
  assert.equal(nonce[42] === '=', false);
}

test('A now of 1000 gives an expiry of 31000 and a nonce of 32 bytes in base64', () => {
  const r = newChallenge(1000);
  assert.deepEqual(r, { nonce: r.nonce, expiresAt: 31000 });
  checkNonce(r.nonce);
});

test('A now of 0 gives an expiry of exactly 30000', () => {
  const r = newChallenge(0);
  assert.deepEqual(r, { nonce: r.nonce, expiresAt: 30000 });
  checkNonce(r.nonce);
});

test('A now of 29999 gives an expiry of 59999 and a now of 30000 gives 60000', () => {
  const a = newChallenge(29999);
  const b = newChallenge(30000);
  assert.equal(a.expiresAt, 59999);
  assert.equal(b.expiresAt, 60000);
  checkNonce(a.nonce);
  checkNonce(b.nonce);
});

test('A negative now of -30000 gives an expiry of 0', () => {
  const r = newChallenge(-30000);
  assert.deepEqual(r, { nonce: r.nonce, expiresAt: 0 });
  checkNonce(r.nonce);
});

test('A fractional now of 1.5 gives an expiry of 30001.5', () => {
  const r = newChallenge(1.5);
  assert.equal(r.expiresAt, 30001.5);
  checkNonce(r.nonce);
});

test('A now just below the safe integer limit gives an expiry at the limit', () => {
  const r = newChallenge(Number.MAX_SAFE_INTEGER - 30000);
  assert.equal(r.expiresAt, Number.MAX_SAFE_INTEGER);
  checkNonce(r.nonce);
});

test('A string now is concatenated with the ttl rather than added', () => {
  const r = newChallenge('5');
  assert.equal(r.expiresAt, '530000');
  checkNonce(r.nonce);
});

test('The result has exactly the keys nonce and expiresAt in that order', () => {
  const r = newChallenge(1000000);
  assert.deepEqual(Object.keys(r), ['nonce', 'expiresAt']);
  assert.equal(r.expiresAt, 1030000);
});

test('Two calls with the same now share the expiry but get different nonces', () => {
  const a = newChallenge(999999);
  const b = newChallenge(999999);
  assert.equal(a.expiresAt, 1029999);
  assert.equal(b.expiresAt, 1029999);
  assert.notEqual(a.nonce, b.nonce);
});
