// Computes a witness object with store heads and remote ledger tip (bin/anchor-witness.mjs buildWitness).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWitness } from '../anchor-witness.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns version 1 and correct producer string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildWitness-'));
  try {
    const w = buildWitness();
    assert.equal(w.v, 1);
    assert.equal(w.producer, 'commitwork bin/anchor-witness.mjs');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null for remoteLedgerTip when not provided', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildWitness-'));
  try {
    const w = buildWitness();
    assert.equal(w.remoteLedgerTip, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns provided remoteLedgerTip value', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildWitness-'));
  try {
    const w = buildWitness({ remoteLedgerTip: 'abc123' });
    assert.equal(w.remoteLedgerTip, 'abc123');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty remoteLedgerTip when explicitly null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildWitness-'));
  try {
    const w = buildWitness({ remoteLedgerTip: null });
    assert.equal(w.remoteLedgerTip, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns stores array with three entries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildWitness-'));
  try {
    const w = buildWitness();
    assert.equal(w.stores.length, 3);
    assert.equal(w.stores[0].name, 'verdict-anchors');
    assert.equal(w.stores[1].name, 'data-anchors');
    assert.equal(w.stores[2].name, 'agent-tags');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('each store entry has present, records, tipHash, generations, chain fields', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildWitness-'));
  try {
    const w = buildWitness();
    for (const s of w.stores) {
      assert.equal(typeof s.present, 'boolean');
      assert.equal(typeof s.records, 'number');
      assert.equal(typeof s.generations, 'number');
      assert.ok('tipHash' in s);
      assert.ok('chain' in s);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tipHash is null when store file is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildWitness-'));
  try {
    const w = buildWitness();
    for (const s of w.stores) {
      if (!s.present) {
        assert.equal(s.tipHash, null);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('generations is zero when store directory does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildWitness-'));
  try {
    const w = buildWitness();
    for (const s of w.stores) {
      if (!s.present) {
        assert.equal(s.generations, 0);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
