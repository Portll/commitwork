// Writes the peer roster as two-space JSON to the env-configured path and returns it (lib/vault-peers.mjs savePeers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { savePeers } from '../vault-peers.mjs';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('saves a roster object to the path from env and returns that path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'savePeers-'));
  try {
    const p = join(dir, 'peers.json');
    const roster = { name: 'alice', key: 'abc' };
    const r = savePeers(roster, { CW_VAULT_PEERS: p });
    assert.equal(r, p);
    assert.equal(readFileSync(p, 'utf8'), '{\n  "name": "alice",\n  "key": "abc"\n}\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('creates the missing nested target directories before writing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'savePeers-'));
  try {
    const p = join(dir, 'nested', 'deep', 'peers.json');
    const roster = { peers: [] };
    const r = savePeers(roster, { CW_VAULT_PEERS: p });
    assert.equal(r, p);
    assert.equal(existsSync(p), true);
    assert.equal(readFileSync(p, 'utf8'), '{\n  "peers": []\n}\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes the roster as two-space pretty-printed JSON with a trailing newline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'savePeers-'));
  try {
    const p = join(dir, 'peers.json');
    savePeers({ a: 1, b: 2 }, { CW_VAULT_PEERS: p });
    assert.equal(readFileSync(p, 'utf8'), '{\n  "a": 1,\n  "b": 2\n}\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('serializes an empty roster object as an empty JSON object line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'savePeers-'));
  try {
    const p = join(dir, 'peers.json');
    savePeers({}, { CW_VAULT_PEERS: p });
    assert.equal(readFileSync(p, 'utf8'), '{}\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('serializes a nested array with four-space indentation for its items', () => {
  const dir = mkdtempSync(join(tmpdir(), 'savePeers-'));
  try {
    const p = join(dir, 'peers.json');
    savePeers({ list: [1, 2, 3] }, { CW_VAULT_PEERS: p });
    assert.equal(readFileSync(p, 'utf8'), '{\n  "list": [\n    1,\n    2,\n    3\n  ]\n}\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('saves into a directory that already exists and returns the exact env path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'savePeers-'));
  try {
    const p = join(dir, 'peers.json');
    const id = 'x'.repeat(10);
    const r = savePeers({ id }, { CW_VAULT_PEERS: p });
    assert.equal(r, p);
    assert.equal(readFileSync(p, 'utf8'), `{\n  "id": "${id}"\n}\n`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('overwrites an existing file with the new roster content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'savePeers-'));
  try {
    const p = join(dir, 'peers.json');
    writeFileSync(p, 'old contents that are much longer than the new roster');
    const r = savePeers({ fresh: 'data' }, { CW_VAULT_PEERS: p });
    assert.equal(r, p);
    assert.equal(readFileSync(p, 'utf8'), '{\n  "fresh": "data"\n}\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('leaves no temporary file behind and sets owner-only permissions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'savePeers-'));
  try {
    const p = join(dir, 'peers.json');
    savePeers({ tmp: 'check' }, { CW_VAULT_PEERS: p });
    assert.equal(existsSync(`${p}.tmp-${process.pid}`), false);
    assert.equal(statSync(p).mode & 0o777, 0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
