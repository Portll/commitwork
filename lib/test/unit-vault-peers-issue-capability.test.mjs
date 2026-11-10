// Signs a scoped capability for a registered peer (lib/vault-peers.mjs issueCapability).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueCapability } from '../vault-peers.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const brokerKey = privateKey;
const pubSpki = publicKey.export({ type: 'spki', format: 'pem' });

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'issueCapability-'));
  const peersPath = join(dir, 'peers.json');
  const roster = {
    version: 1,
    peers: {
      alice: { mechanism: 'ed25519', publicKey: pubSpki, scope: ['repo:alpha', 'repo:beta'] },
      bob: { mechanism: 'ed25519', publicKey: pubSpki, scope: ['repo:gamma'] }
    }
  };
  writeFileSync(peersPath, JSON.stringify(roster));
  return { dir, peersPath };
}

test('returns ok false with unknown-peer reason for unregistered peer', () => {
  const { dir, peersPath } = setup();
  try {
    const r = issueCapability({ peer: 'ghost', audience: 'repo:alpha', brokerKey }, { CW_VAULT_PEERS: peersPath });
    assert.deepEqual(r, { ok: false, reason: "unknown-peer", detail: "ghost is not registered" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok false with out-of-scope reason when audience is not in peer scope', () => {
  const { dir, peersPath } = setup();
  try {
    const r = issueCapability({ peer: 'alice', audience: 'repo:delta', brokerKey }, { CW_VAULT_PEERS: peersPath });
    assert.deepEqual(r, { ok: false, reason: "out-of-scope", detail: "alice is scoped to [repo:alpha, repo:beta] and asked for repo:delta" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok true with signed capability when peer is registered and audience is in scope', () => {
  const { dir, peersPath } = setup();
  try {
    const r = issueCapability({ peer: 'alice', audience: 'repo:alpha', brokerKey, now: 1000 }, { CW_VAULT_PEERS: peersPath });
    assert.equal(r.ok, true);
    assert.equal(r.capability.peer, "alice");
    assert.equal(r.capability.audience, "repo:alpha");
    assert.equal(r.capability.expiresAt, 61000);
    assert.equal(typeof r.capability.nonce, "string");
    assert.equal(typeof r.capability.signature, "string");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok false with unknown-peer reason when peer key exists but is not in roster', () => {
  const { dir, peersPath } = setup();
  try {
    const r = issueCapability({ peer: 'bob', audience: 'repo:alpha', brokerKey }, { CW_VAULT_PEERS: peersPath });
    assert.deepEqual(r, { ok: false, reason: "out-of-scope", detail: "bob is scoped to [repo:gamma] and asked for repo:alpha" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok true with capability for second peer with different scope', () => {
  const { dir, peersPath } = setup();
  try {
    const r = issueCapability({ peer: 'bob', audience: 'repo:gamma', brokerKey, now: 5000 }, { CW_VAULT_PEERS: peersPath });
    assert.equal(r.ok, true);
    assert.equal(r.capability.peer, "bob");
    assert.equal(r.capability.audience, "repo:gamma");
    assert.equal(r.capability.expiresAt, 65000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
