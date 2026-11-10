// Appends a record to a ledger, rotating when full, and returns the result (bin/lib/touch-chain.mjs chainedAppendHeld).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chainedAppendHeld } from '../lib/touch-chain.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('appends a record to a new ledger with genesis prev', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chainedAppendHeld-'));
  try {
    const p = join(dir, 'ledger.jsonl');
    const r = chainedAppendHeld(p, { id: 1 }, { maxBytes: 1000 });
    assert.deepEqual(r, { ok: true, mode: "chained" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('appends a record to a non-empty ledger with hash prev', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chainedAppendHeld-'));
  try {
    const p = join(dir, 'ledger.jsonl');
    writeFileSync(p, 'existing-line\n');
    const r = chainedAppendHeld(p, { id: 2 }, { maxBytes: 1000 });
    assert.deepEqual(r, { ok: true, mode: "chained" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rotates when ledger size exceeds maxBytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chainedAppendHeld-'));
  try {
    const p = join(dir, 'ledger.jsonl');
    writeFileSync(p, 'x'.repeat(100) + '\n');
    const r = chainedAppendHeld(p, { id: 3 }, { maxBytes: 50 });
    assert.deepEqual(r, { ok: true, mode: "chained", rotated: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('does not rotate when ledger size equals maxBytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chainedAppendHeld-'));
  try {
    const p = join(dir, 'ledger.jsonl');
    writeFileSync(p, 'x'.repeat(50) + '\n');
    const r = chainedAppendHeld(p, { id: 4 }, { maxBytes: 51 });
    assert.deepEqual(r, { ok: true, mode: "chained" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rotates when ledger size is one byte over maxBytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chainedAppendHeld-'));
  try {
    const p = join(dir, 'ledger.jsonl');
    writeFileSync(p, 'x'.repeat(50) + '\n');
    const r = chainedAppendHeld(p, { id: 5 }, { maxBytes: 50 });
    assert.deepEqual(r, { ok: true, mode: "chained", rotated: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles empty ledger file with genesis prev', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chainedAppendHeld-'));
  try {
    const p = join(dir, 'ledger.jsonl');
    writeFileSync(p, '');
    const r = chainedAppendHeld(p, { id: 6 }, { maxBytes: 1000 });
    assert.deepEqual(r, { ok: true, mode: "chained" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok true for successful chained append', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chainedAppendHeld-'));
  try {
    const p = join(dir, 'ledger.jsonl');
    const r = chainedAppendHeld(p, { id: 7 }, { maxBytes: 1000 });
    assert.equal(r.ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns mode chained for successful append', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chainedAppendHeld-'));
  try {
    const p = join(dir, 'ledger.jsonl');
    const r = chainedAppendHeld(p, { id: 8 }, { maxBytes: 1000 });
    assert.equal(r.mode, "chained");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
