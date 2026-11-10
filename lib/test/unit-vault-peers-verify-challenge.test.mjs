// Whether a peer's signed challenge nonce verifies against its registered key (lib/vault-peers.mjs verifyChallenge).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyChallenge } from '../vault-peers.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';

const privateKey = createPrivateKey({
  key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.alloc(32, 7)]),
  format: 'der',
  type: 'pkcs8',
});
const spki = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
const nonce = 'abc123';
const sig = sign(null, Buffer.from(nonce), privateKey).toString('base64');
const wrongSig = sign(null, Buffer.from('other'), privateKey).toString('base64');
const roster = { version: 1, peers: { alice: { mechanism: 'ed25519', publicKey: spki } } };
const sigErr = (() => { try { Buffer.from(undefined, 'base64'); } catch (e) { return e.message; } return null; })();

function withRoster(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'verifyChallenge-'));
  try {
    const path = join(dir, 'peers.json');
    writeFileSync(path, JSON.stringify(roster));
    return fn({ CW_VAULT_PEERS: path });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('a peer missing from the roster is reported as unknown', () => {
  withRoster((env) => {
    const r = verifyChallenge({ peer: 'bob', challenge: { nonce, expiresAt: 1000 }, signature: sig, now: 1 }, env);
    assert.deepEqual(r, { ok: false, reason: 'unknown-peer', detail: 'bob is not registered' });
  });
});

test('a challenge object without a nonce is a bad challenge', () => {
  withRoster((env) => {
    const r = verifyChallenge({ peer: 'alice', challenge: { expiresAt: 1000 }, signature: sig, now: 1 }, env);
    assert.deepEqual(r, { ok: false, reason: 'bad-challenge', detail: 'no nonce' });
  });
});

test('a null challenge is a bad challenge', () => {
  withRoster((env) => {
    const r = verifyChallenge({ peer: 'alice', challenge: null, signature: sig, now: 1 }, env);
    assert.deepEqual(r, { ok: false, reason: 'bad-challenge', detail: 'no nonce' });
  });
});

test('a challenge answered one millisecond after it expires is expired', () => {
  withRoster((env) => {
    const r = verifyChallenge({ peer: 'alice', challenge: { nonce, expiresAt: 100 }, signature: sig, now: 101 }, env);
    assert.deepEqual(r, { ok: false, reason: 'expired', detail: 'the challenge window has closed' });
  });
});

test('a valid signature answered exactly at the expiry time is accepted', () => {
  withRoster((env) => {
    const r = verifyChallenge({ peer: 'alice', challenge: { nonce, expiresAt: 100 }, signature: sig, now: 100 }, env);
    assert.deepEqual(r, { ok: true });
  });
});

test('a nonce answered once is rejected as a replay the second time', () => {
  withRoster((env) => {
    const seen = new Set();
    const first = verifyChallenge({ peer: 'alice', challenge: { nonce, expiresAt: 1000 }, signature: sig, seen, now: 1 }, env);
    assert.deepEqual(first, { ok: true });
    assert.deepEqual([...seen], [nonce]);
    const second = verifyChallenge({ peer: 'alice', challenge: { nonce, expiresAt: 1000 }, signature: sig, seen, now: 1 }, env);
    assert.deepEqual(second, { ok: false, reason: 'replay', detail: 'this nonce has already been answered' });
  });
});

test('a signature over a different message does not verify', () => {
  withRoster((env) => {
    const r = verifyChallenge({ peer: 'alice', challenge: { nonce, expiresAt: 1000 }, signature: wrongSig, now: 1 }, env);
    assert.deepEqual(r, { ok: false, reason: 'bad-signature', detail: 'the signature does not verify against the registered key' });
  });
});

test('a missing signature is reported as a bad signature with the decoding error', () => {
  withRoster((env) => {
    const r = verifyChallenge({ peer: 'alice', challenge: { nonce, expiresAt: 1000 }, signature: undefined, now: 1 }, env);
    assert.deepEqual(r, { ok: false, reason: 'bad-signature', detail: sigErr });
  });
});
