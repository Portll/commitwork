// lib/test/vault-peers.test.mjs — the broker's security core.
//
// The load-bearing assertion is 'A CAPABILITY CARRIES NO CREDENTIAL'. Everything else here is
// ordinary crypto plumbing; that one is the property the design exists for, and it is asserted
// structurally (the exact field set) rather than by searching for a secret substring — a search
// passes for any secret the test did not think to plant.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as edSign } from 'node:crypto';
import { writeFileSync, mkdtempSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadPeers, registerPeer, revokePeer, newChallenge, verifyChallenge,
  issueCapability, verifyCapability, peersPath, peerDigest, CAPABILITY_TTL_MS,
} from '../vault-peers.mjs';

const scratch = () => ({ CW_VAULT_PEERS: join(mkdtempSync(join(tmpdir(), 'cw-peers-')), 'peers.json') });
const pem = (k) => k.export({ type: 'spki', format: 'pem' });
const pair = () => generateKeyPairSync('ed25519');

test('an absent roster is a legitimate empty', () => {
  assert.deepEqual(loadPeers(scratch()).peers, {});
});

test('a malformed roster FAILS CLOSED — an empty roster would read as "no check needed"', () => {
  const env = scratch();
  writeFileSync(env.CW_VAULT_PEERS, '{ not json');
  assert.throws(() => loadPeers(env), /not valid JSON/);
});

test('registration refuses a peer with no scope — it could never be issued anything', () => {
  const env = scratch(); const { publicKey } = pair();
  assert.throws(() => registerPeer({ name: 'mcp', publicKey: pem(publicKey), scope: [] }, env), /declare its audiences/);
});

test('registration refuses something that is not a key, before it reaches the roster', () => {
  const env = scratch();
  assert.throws(() => registerPeer({ name: 'mcp', publicKey: 'hello', scope: ['x'] }, env));
  assert.deepEqual(loadPeers(env).peers, {}, 'a refused registration must leave no trace');
});

test('the roster is written 0600', () => {
  const env = scratch(); const { publicKey } = pair();
  registerPeer({ name: 'mcp', publicKey: pem(publicKey), scope: ['resolve'] }, env);
  assert.equal(statSync(peersPath(env)).mode & 0o777, 0o600);
});

test('a correctly signed challenge verifies', () => {
  const env = scratch(); const { publicKey, privateKey } = pair();
  registerPeer({ name: 'mcp', publicKey: pem(publicKey), scope: ['resolve'] }, env);
  const c = newChallenge();
  const sig = edSign(null, Buffer.from(c.nonce), privateKey).toString('base64');
  assert.equal(verifyChallenge({ peer: 'mcp', challenge: c, signature: sig }, env).ok, true);
});

test('another key does not answer the challenge', () => {
  const env = scratch(); const { publicKey } = pair(); const other = pair();
  registerPeer({ name: 'mcp', publicKey: pem(publicKey), scope: ['resolve'] }, env);
  const c = newChallenge();
  const sig = edSign(null, Buffer.from(c.nonce), other.privateKey).toString('base64');
  assert.equal(verifyChallenge({ peer: 'mcp', challenge: c, signature: sig }, env).reason, 'bad-signature');
});

test('an expired challenge is refused, and says so distinctly from a bad signature', () => {
  const env = scratch(); const { publicKey, privateKey } = pair();
  registerPeer({ name: 'mcp', publicKey: pem(publicKey), scope: ['resolve'] }, env);
  const c = newChallenge(0);
  const sig = edSign(null, Buffer.from(c.nonce), privateKey).toString('base64');
  assert.equal(verifyChallenge({ peer: 'mcp', challenge: c, signature: sig, now: 1e9 }, env).reason, 'expired');
});

test('a nonce answered once is never answerable again, even inside its window', () => {
  const env = scratch(); const { publicKey, privateKey } = pair();
  registerPeer({ name: 'mcp', publicKey: pem(publicKey), scope: ['resolve'] }, env);
  const c = newChallenge(); const seen = new Set();
  const sig = edSign(null, Buffer.from(c.nonce), privateKey).toString('base64');
  assert.equal(verifyChallenge({ peer: 'mcp', challenge: c, signature: sig, seen }, env).ok, true);
  assert.equal(verifyChallenge({ peer: 'mcp', challenge: c, signature: sig, seen }, env).reason, 'replay');
});

test('an audience outside the peer\'s declared scope is refused at ISSUE time', () => {
  const env = scratch(); const { publicKey } = pair(); const broker = pair();
  registerPeer({ name: 'mcp', publicKey: pem(publicKey), scope: ['resolve'] }, env);
  const r = issueCapability({ peer: 'mcp', audience: 'purge-cache', brokerKey: broker.privateKey }, env);
  assert.equal(r.reason, 'out-of-scope');
});

// ─── THE PROPERTY THE DESIGN EXISTS FOR ────────────────────────────────────────────────────────
// A capability that embedded the token would MOVE the plaintext hop rather than remove it. The
// field set is asserted exactly, so a later edit that adds a `value` or `token` field fails here
// rather than shipping. A substring search for a planted secret would pass for every secret the
// test did not plant.
test('A CAPABILITY CARRIES NO CREDENTIAL', () => {
  const env = scratch(); const { publicKey } = pair(); const broker = pair();
  registerPeer({ name: 'mcp', publicKey: pem(publicKey), scope: ['resolve'] }, env);
  const { capability } = issueCapability({ peer: 'mcp', audience: 'resolve', brokerKey: broker.privateKey }, env);
  assert.deepEqual(Object.keys(capability).sort(), ['audience', 'expiresAt', 'nonce', 'peer', 'signature'],
    'the capability names an act and an expiry; a field beyond these is a credential in transit');
});

test('a capability verifies for its audience and refuses another', () => {
  const env = scratch(); const { publicKey } = pair(); const broker = pair();
  registerPeer({ name: 'mcp', publicKey: pem(publicKey), scope: ['resolve', 'reverse'] }, env);
  const { capability } = issueCapability({ peer: 'mcp', audience: 'resolve', brokerKey: broker.privateKey }, env);
  const pub = pem(broker.publicKey);
  assert.equal(verifyCapability({ capability, brokerPublicKey: pub, audience: 'resolve' }).ok, true);
  assert.equal(verifyCapability({ capability, brokerPublicKey: pub, audience: 'reverse' }).reason, 'wrong-audience');
});

test('a tampered capability does not verify', () => {
  const env = scratch(); const { publicKey } = pair(); const broker = pair();
  registerPeer({ name: 'mcp', publicKey: pem(publicKey), scope: ['resolve'] }, env);
  const { capability } = issueCapability({ peer: 'mcp', audience: 'resolve', brokerKey: broker.privateKey }, env);
  const forged = { ...capability, peer: 'someone-else' };
  assert.equal(verifyCapability({ capability: forged, brokerPublicKey: pem(broker.publicKey) }).reason, 'bad-signature');
});

test('an expired capability is refused', () => {
  const env = scratch(); const { publicKey } = pair(); const broker = pair();
  registerPeer({ name: 'mcp', publicKey: pem(publicKey), scope: ['resolve'] }, env);
  const { capability } = issueCapability({ peer: 'mcp', audience: 'resolve', brokerKey: broker.privateKey, now: 0 }, env);
  assert.equal(verifyCapability({ capability, brokerPublicKey: pem(broker.publicKey), now: CAPABILITY_TTL_MS + 1 }).reason, 'expired');
});

// Revocation without re-sealing — the limitation a sealed-file map carries and this does not.
test('revoking a peer ends its access with no re-sealing', () => {
  const env = scratch(); const { publicKey } = pair(); const broker = pair();
  registerPeer({ name: 'mcp', publicKey: pem(publicKey), scope: ['resolve'] }, env);
  assert.equal(revokePeer('mcp', env), true);
  assert.equal(issueCapability({ peer: 'mcp', audience: 'resolve', brokerKey: broker.privateKey }, env).reason, 'unknown-peer');
});

test('the remote-visible peer digest is a digest, not a key', () => {
  const env = scratch(); const { publicKey } = pair();
  registerPeer({ name: 'mcp', publicKey: pem(publicKey), scope: ['resolve'] }, env);
  const d = peerDigest('mcp', env);
  assert.match(d, /^[0-9a-f]{32}$/);
  assert.ok(!pem(publicKey).includes(d), 'the digest must not be a slice of the key');
});
