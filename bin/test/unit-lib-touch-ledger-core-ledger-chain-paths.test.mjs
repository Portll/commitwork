// Computes the ordered list of archive and live ledger paths for a rotated ledger file (bin/lib/touch-ledger-core.mjs ledgerChainPaths).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ledgerChainPaths } from '../lib/touch-ledger-core.mjs';

test('returns generations when no injected readdirSync is provided', () => {
  const r = ledgerChainPaths('/data/ledger.json');
  assert.deepEqual(r, []);
});

test('returns live path only when directory is empty', () => {
  const r = ledgerChainPaths('/data/ledger.json', { readdirSync: () => [] });
  assert.deepEqual(r, ["/data/ledger.json"]);
});

test('returns live path only when directory does not exist', () => {
  const err = new Error('no such file');
  err.code = 'ENOENT';
  const r = ledgerChainPaths('/data/ledger.json', { readdirSync: () => { throw err; } });
  assert.deepEqual(r, ["/data/ledger.json"]);
});

test('rethrows non-ENOENT errors from injected readdirSync', () => {
  const err = new Error('permission denied');
  err.code = 'EACCES';
  assert.throws(() => ledgerChainPaths('/data/ledger.json', { readdirSync: () => { throw err; } }), { name: 'Error', message: 'permission denied' });
});

test('returns archives in descending order followed by live path', () => {
  const r = ledgerChainPaths('/data/ledger.json', { readdirSync: () => ['ledger.json.2', 'ledger.json.1', 'ledger.json', 'other.txt'] });
  assert.deepEqual(r, ["/data/ledger.json.2", "/data/ledger.json.1", "/data/ledger.json"]);
});

test('excludes files that do not match the archive naming pattern', () => {
  const r = ledgerChainPaths('/data/ledger.json', { readdirSync: () => ['ledger.json.1', 'ledger.json.x', 'ledger.json.1.2', 'ledger.json'] });
  assert.deepEqual(r, ["/data/ledger.json.1", "/data/ledger.json"]);
});

test('handles single digit archive numbers correctly', () => {
  const r = ledgerChainPaths('/data/ledger.json', { readdirSync: () => ['ledger.json.9', 'ledger.json.10', 'ledger.json'] });
  assert.deepEqual(r, ["/data/ledger.json.10", "/data/ledger.json.9", "/data/ledger.json"]);
});

test('returns only live path when no valid archives exist', () => {
  const r = ledgerChainPaths('/data/ledger.json', { readdirSync: () => ['ledger.json', 'ledger.json.bak', 'ledger.json.abc'] });
  assert.deepEqual(r, ["/data/ledger.json"]);
});
