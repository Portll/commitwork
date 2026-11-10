// Rotates a ledger file to a numbered archive when its size exceeds a byte limit (bin/lib/ledger-rotate.mjs rotateIfLarge).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rotateIfLarge } from '../lib/ledger-rotate.mjs';
import { mkdtempSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns false when the ledger file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rotateIfLarge-'));
  try {
    const p = join(dir, 'ledger.json');
    const r = rotateIfLarge(p, 100);
    assert.equal(r, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false when the ledger file size is below the limit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rotateIfLarge-'));
  try {
    const p = join(dir, 'ledger.json');
    writeFileSync(p, 'x'.repeat(50));
    const r = rotateIfLarge(p, 100);
    assert.equal(r, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false when the ledger file size equals the limit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rotateIfLarge-'));
  try {
    const p = join(dir, 'ledger.json');
    writeFileSync(p, 'x'.repeat(100));
    const r = rotateIfLarge(p, 100);
    assert.equal(r, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns true and renames the ledger file to a .1 archive when the size exceeds the limit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rotateIfLarge-'));
  try {
    const p = join(dir, 'ledger.json');
    writeFileSync(p, 'x'.repeat(150));
    const r = rotateIfLarge(p, 100);
    assert.equal(r, true);
    assert.equal(existsSync(p), false);
    assert.equal(existsSync(`${p}.1`), true);
    assert.equal(statSync(`${p}.1`).size, 150);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns true and shifts existing archives when the ledger file size exceeds the limit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rotateIfLarge-'));
  try {
    const p = join(dir, 'ledger.json');
    writeFileSync(p, 'x'.repeat(150));
    writeFileSync(`${p}.1`, 'y'.repeat(10));
    const r = rotateIfLarge(p, 100);
    assert.equal(r, true);
    assert.equal(existsSync(p), false);
    assert.equal(existsSync(`${p}.1`), true);
    assert.equal(existsSync(`${p}.2`), true);
    assert.equal(statSync(`${p}.1`).size, 150);
    assert.equal(statSync(`${p}.2`).size, 10);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
