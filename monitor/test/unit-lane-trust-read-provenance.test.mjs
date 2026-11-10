// Reads PROVENANCE.json lanes from a fixtures directory (monitor/lane-trust.mjs readProvenance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readProvenance } from '../lane-trust.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns lanes object when PROVENANCE.json has lanes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readProvenance-'));
  try {
    writeFileSync(join(dir, 'PROVENANCE.json'), JSON.stringify({ lanes: { a: 1 } }));
    assert.deepEqual(readProvenance(dir), { a: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty object when lanes is null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readProvenance-'));
  try {
    writeFileSync(join(dir, 'PROVENANCE.json'), JSON.stringify({ lanes: null }));
    assert.deepEqual(readProvenance(dir), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty object when lanes is undefined', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readProvenance-'));
  try {
    writeFileSync(join(dir, 'PROVENANCE.json'), JSON.stringify({}));
    assert.deepEqual(readProvenance(dir), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when PROVENANCE.json is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readProvenance-'));
  try {
    assert.equal(readProvenance(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws on invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readProvenance-'));
  try {
    writeFileSync(join(dir, 'PROVENANCE.json'), 'not json');
    assert.throws(() => readProvenance(dir), { name: "SyntaxError", message: "Unexpected token 'o', \"not json\" is not valid JSON" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns lanes when lanes is a non-null object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readProvenance-'));
  try {
    writeFileSync(join(dir, 'PROVENANCE.json'), JSON.stringify({ lanes: { x: 'y' } }));
    assert.deepEqual(readProvenance(dir), { x: "y" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
