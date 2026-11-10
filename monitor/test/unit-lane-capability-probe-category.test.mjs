// Classifies a fixture directory and extractor result into a capability witness (monitor/lane-capability.mjs probeCategory).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeCategory } from '../lane-capability.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns no-fixture when the directory does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'probeCategory-'));
  try {
    const r = probeCategory('cat', () => ({}), join(dir, 'missing'));
    assert.deepEqual(r, { witness: "no-fixture", fixture: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns no-fixture when the directory is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'probeCategory-'));
  try {
    const r = probeCategory('cat', () => ({}), dir);
    assert.deepEqual(r, { witness: "no-fixture", fixture: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns extractor-threw when the extractor throws an error with a message', () => {
  const dir = mkdtempSync(join(tmpdir(), 'probeCategory-'));
  try {
    writeFileSync(join(dir, 'a.txt'), 'x');
    const r = probeCategory('cat', () => { throw new Error('boom'); }, dir);
    assert.deepEqual(r, { witness: "extractor-threw", fixture: "a.txt", note: "boom" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns no-fixture when the extractor returns null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'probeCategory-'));
  try {
    writeFileSync(join(dir, 'a.txt'), 'x');
    const r = probeCategory('cat', () => null, dir);
    assert.deepEqual(r, { witness: "no-fixture", fixture: "a.txt", note: "fixture dir holds no artifact under the filename this extractor reads" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns shape-only when the result has unparseable true', () => {
  const dir = mkdtempSync(join(tmpdir(), 'probeCategory-'));
  try {
    writeFileSync(join(dir, 'a.txt'), 'x');
    const r = probeCategory('cat', () => ({ unparseable: true }), dir);
    assert.deepEqual(r, { witness: "shape-only", fixture: "a.txt" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns counting when total is positive', () => {
  const dir = mkdtempSync(join(tmpdir(), 'probeCategory-'));
  try {
    writeFileSync(join(dir, 'a.txt'), 'x');
    const r = probeCategory('cat', () => ({ total: 5 }), dir);
    assert.deepEqual(r, { witness: "counting", fixture: "a.txt" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns counting when undetermined is positive', () => {
  const dir = mkdtempSync(join(tmpdir(), 'probeCategory-'));
  try {
    writeFileSync(join(dir, 'a.txt'), 'x');
    const r = probeCategory('cat', () => ({ undetermined: 3 }), dir);
    assert.deepEqual(r, { witness: "counting", fixture: "a.txt" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns counting when findings is a non-empty array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'probeCategory-'));
  try {
    writeFileSync(join(dir, 'a.txt'), 'x');
    const r = probeCategory('cat', () => ({ findings: [1] }), dir);
    assert.deepEqual(r, { witness: "counting", fixture: "a.txt" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns zero-on-golden when all derived signals are zero', () => {
  const dir = mkdtempSync(join(tmpdir(), 'probeCategory-'));
  try {
    writeFileSync(join(dir, 'a.txt'), 'x');
    const r = probeCategory('cat', () => ({ total: 0, undetermined: 0, findings: [] }), dir);
    assert.deepEqual(r, { witness: "zero-on-golden", fixture: "a.txt", note: "a clean zero from a non-empty golden artifact \u2014 the F8 silent-green shape; fix the fixture or the parser before trusting this lane's zeros" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
