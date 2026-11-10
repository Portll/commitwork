// Registers a peer into the vault roster file (lib/vault-peers.mjs registerPeer).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerPeer } from '../vault-peers.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';

const key = generateKeyPairSync('ed25519');
const pub = key.publicKey.export({ type: 'spki', format: 'pem' });

test('rejects a name with an uppercase letter', () => {
  const dir = mkdtempSync(join(tmpdir(), 'registerPeer-'));
  try {
    const env = { CW_VAULT_PEERS: join(dir, 'peers.json') };
    assert.throws(() => registerPeer({ name: 'Alice', publicKey: pub, scope: ['x'] }, env), {
      name: 'Error',
      message: 'vault-peers: "Alice" is not a peer name (a-z, 0-9, -)'
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('accepts a valid name and writes the roster', () => {
  const dir = mkdtempSync(join(tmpdir(), 'registerPeer-'));
  try {
    const env = { CW_VAULT_PEERS: join(dir, 'peers.json') };
    const r = registerPeer({ name: 'bob', publicKey: pub, scope: ['x'] }, env);
    assert.deepEqual(r, { name: "bob", mechanism: "ed25519", scope: ["x"] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects a name that is too long', () => {
  const dir = mkdtempSync(join(tmpdir(), 'registerPeer-'));
  try {
    const env = { CW_VAULT_PEERS: join(dir, 'peers.json') };
    const name = 'a' + 'b'.repeat(64);
    assert.throws(() => registerPeer({ name, publicKey: pub, scope: ['x'] }, env), {
      name: 'Error',
      message: `vault-peers: "${name}" is not a peer name (a-z, 0-9, -)`
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects an unknown mechanism', () => {
  const dir = mkdtempSync(join(tmpdir(), 'registerPeer-'));
  try {
    const env = { CW_VAULT_PEERS: join(dir, 'peers.json') };
    assert.throws(() => registerPeer({ name: 'bob', publicKey: pub, mechanism: 'rsa', scope: ['x'] }, env), {
      name: 'Error',
      message: 'vault-peers: unknown mechanism "rsa"'
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects an empty scope array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'registerPeer-'));
  try {
    const env = { CW_VAULT_PEERS: join(dir, 'peers.json') };
    assert.throws(() => registerPeer({ name: 'bob', publicKey: pub, scope: [] }, env), {
      name: 'Error',
      message: 'vault-peers: a peer with no scope could never be issued anything \u2014 declare its audiences'
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects a non-array scope', () => {
  const dir = mkdtempSync(join(tmpdir(), 'registerPeer-'));
  try {
    const env = { CW_VAULT_PEERS: join(dir, 'peers.json') };
    assert.throws(() => registerPeer({ name: 'bob', publicKey: pub, scope: 'x' }, env), {
      name: 'Error',
      message: 'vault-peers: a peer with no scope could never be issued anything \u2014 declare its audiences'
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects a name that is one character', () => {
  const dir = mkdtempSync(join(tmpdir(), 'registerPeer-'));
  try {
    const env = { CW_VAULT_PEERS: join(dir, 'peers.json') };
    assert.throws(() => registerPeer({ name: 'a', publicKey: pub, scope: ['x'] }, env), {
      name: 'Error',
      message: 'vault-peers: "a" is not a peer name (a-z, 0-9, -)'
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('accepts a two-character name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'registerPeer-'));
  try {
    const env = { CW_VAULT_PEERS: join(dir, 'peers.json') };
    const r = registerPeer({ name: 'ab', publicKey: pub, scope: ['x'] }, env);
    assert.deepEqual(r, { name: "ab", mechanism: "ed25519", scope: ["x"] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
