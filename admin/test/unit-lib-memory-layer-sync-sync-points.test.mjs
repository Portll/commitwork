// Declares the sync points from the memory-layer contract (admin/lib/memory-layer-sync.mjs syncPoints).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncPoints } from '../lib/memory-layer-sync.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'syncPoints-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('returns points, verdicts, and key when contract declares them', () => {
  withDir((dir) => {
    const p = join(dir, 'contract.json');
    const contract = { syncPoints: { points: [1, 2, 3], verdicts: ['ok', 'ok', 'fail'], key: 'k1' } };
    writeFileSync(p, JSON.stringify(contract));
    const r = syncPoints({ path: p });
    assert.deepEqual(r, { points: [1, 2, 3], verdicts: ['ok', 'ok', 'fail'], key: 'k1' });
  });
});

test('returns null verdicts and key when they are absent', () => {
  withDir((dir) => {
    const p = join(dir, 'contract.json');
    const contract = { syncPoints: { points: [10, 20] } };
    writeFileSync(p, JSON.stringify(contract));
    const r = syncPoints({ path: p });
    assert.deepEqual(r, { points: [10, 20], verdicts: null, key: null });
  });
});

test('throws when syncPoints is missing from contract', () => {
  withDir((dir) => {
    const p = join(dir, 'contract.json');
    writeFileSync(p, JSON.stringify({ other: true }));
    assert.throws(() => syncPoints({ path: p }), /declares no syncPoints/);
  });
});

test('throws when syncPoints is null', () => {
  withDir((dir) => {
    const p = join(dir, 'contract.json');
    writeFileSync(p, JSON.stringify({ syncPoints: null }));
    assert.throws(() => syncPoints({ path: p }), /declares no syncPoints/);
  });
});

test('throws when syncPoints.points is not an array', () => {
  withDir((dir) => {
    const p = join(dir, 'contract.json');
    writeFileSync(p, JSON.stringify({ syncPoints: { points: 'not-array' } }));
    assert.throws(() => syncPoints({ path: p }), /declares no syncPoints/);
  });
});

test('throws when contract is null', () => {
  withDir((dir) => {
    const p = join(dir, 'contract.json');
    writeFileSync(p, 'null');
    assert.throws(() => syncPoints({ path: p }), /declares no syncPoints/);
  });
});

test('throws when contract is invalid JSON', () => {
  withDir((dir) => {
    const p = join(dir, 'contract.json');
    writeFileSync(p, 'undefined');
    assert.throws(() => syncPoints({ path: p }), SyntaxError);
  });
});

test('handles empty points array with verdicts and key', () => {
  withDir((dir) => {
    const p = join(dir, 'contract.json');
    const contract = { syncPoints: { points: [], verdicts: [], key: 'empty' } };
    writeFileSync(p, JSON.stringify(contract));
    const r = syncPoints({ path: p });
    assert.deepEqual(r, { points: [], verdicts: [], key: 'empty' });
  });
});
