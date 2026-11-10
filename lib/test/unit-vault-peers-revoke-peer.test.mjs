// removes a named peer from the on-disk roster and reports whether it was present (lib/vault-peers.mjs revokePeer).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { revokePeer } from '../vault-peers.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SPKI = '-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----';
const EMPTY_TEXT = '{\n  "version": 1,\n  "peers": {}\n}\n';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'revokePeer-'));
  const peersFile = join(dir, 'peers.json');
  return { dir, peersFile, env: { CW_VAULT_PEERS: peersFile } };
}

function writeRoster(file, roster) {
  writeFileSync(file, JSON.stringify(roster, null, 2) + '\n');
}

test('revoking an existing peer returns true and leaves an empty roster on disk', () => {
  const { dir, peersFile, env } = setup();
  try {
    writeRoster(peersFile, { version: 1, peers: { alice: { mechanism: 'ed25519', publicKey: SPKI } } });
    assert.equal(revokePeer('alice', env), true);
    assert.equal(readFileSync(peersFile, 'utf8'), EMPTY_TEXT);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('revoking an absent peer returns false and keeps the roster unchanged', () => {
  const { dir, peersFile, env } = setup();
  try {
    const roster = { version: 1, peers: { bob: { mechanism: 'ed25519', publicKey: SPKI } } };
    writeRoster(peersFile, roster);
    assert.equal(revokePeer('alice', env), false);
    assert.deepEqual(JSON.parse(readFileSync(peersFile, 'utf8')), roster);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('revoking one of two peers returns true and keeps the other peer', () => {
  const { dir, peersFile, env } = setup();
  try {
    writeRoster(peersFile, { version: 1, peers: {
      alice: { mechanism: 'ed25519', publicKey: SPKI },
      bob: { mechanism: 'ed25519', publicKey: SPKI },
    } });
    assert.equal(revokePeer('alice', env), true);
    assert.deepEqual(JSON.parse(readFileSync(peersFile, 'utf8')),
      { version: 1, peers: { bob: { mechanism: 'ed25519', publicKey: SPKI } } });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an inherited property name is not counted as a peer and returns false', () => {
  const { dir, peersFile, env } = setup();
  try {
    writeRoster(peersFile, { version: 1, peers: {} });
    assert.equal(revokePeer('toString', env), false);
    assert.equal(readFileSync(peersFile, 'utf8'), EMPTY_TEXT);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a missing roster file in a missing directory returns false and writes an empty roster', () => {
  const dir = mkdtempSync(join(tmpdir(), 'revokePeer-'));
  try {
    const peersFile = join(dir, 'nested', 'deeper', 'peers.json');
    assert.equal(revokePeer('alice', { CW_VAULT_PEERS: peersFile }), false);
    assert.equal(readFileSync(peersFile, 'utf8'), EMPTY_TEXT);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a roster path that is a directory throws an unreadable error', () => {
  const { dir, peersFile, env } = setup();
  try {
    mkdirSync(peersFile);
    assert.throws(() => revokePeer('alice', env), {
      name: 'Error',
      message: `vault-peers: roster at ${peersFile} is unreadable (EISDIR); refusing to treat it as empty`,
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a roster file with invalid JSON throws a parse error', () => {
  const { dir, peersFile, env } = setup();
  try {
    writeFileSync(peersFile, 'not valid json{{{');
    assert.throws(() => revokePeer('alice', env), {
      name: 'Error',
      message: `vault-peers: roster at ${peersFile} is not valid JSON (Unexpected token 'o', "not valid json{{{" is not valid JSON); refusing to treat it as empty`,
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an array or an object without peers is rejected as not a peer roster', () => {
  const { dir, peersFile, env } = setup();
  try {
    const message = `vault-peers: roster at ${peersFile} is not a peer roster`;
    writeFileSync(peersFile, JSON.stringify([1, 2, 3]));
    assert.throws(() => revokePeer('alice', env), { name: 'Error', message });
    writeFileSync(peersFile, JSON.stringify({ version: 1 }));
    assert.throws(() => revokePeer('alice', env), { name: 'Error', message });
    writeFileSync(peersFile, JSON.stringify({ version: 1, peers: 'x' }));
    assert.throws(() => revokePeer('alice', env), { name: 'Error', message });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a peer with an unknown mechanism throws naming the mechanism', () => {
  const { dir, peersFile, env } = setup();
  try {
    writeRoster(peersFile, { version: 1, peers: { eve: { mechanism: 'rsa', publicKey: SPKI } } });
    assert.throws(() => revokePeer('eve', env), {
      name: 'Error',
      message: 'vault-peers: eve declares unknown mechanism "rsa"',
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a peer without an SPKI public key throws', () => {
  const { dir, peersFile, env } = setup();
  try {
    writeRoster(peersFile, { version: 1, peers: { mallory: { mechanism: 'ed25519', publicKey: 'abc' } } });
    assert.throws(() => revokePeer('mallory', env), {
      name: 'Error',
      message: 'vault-peers: mallory has no SPKI public key',
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
