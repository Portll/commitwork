// Computes whether a slice file's bytes match its attested sha256 (monitor/history-chain.mjs verifySliceBytes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifySliceBytes } from '../history-chain.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const sha = (s) => createHash('sha256').update(s).digest('hex');

test('returns unchecked when no hash was attested', () => {
  const dir = mkdtempSync(join(tmpdir(), 'verifySliceBytes-'));
  try {
    const r = verifySliceBytes(dir, 'a.bin', null);
    assert.deepEqual(r, { checked: false, match: null, why: "no hash was attested for this state" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unchecked with error code when file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'verifySliceBytes-'));
  try {
    const r = verifySliceBytes(dir, 'missing.bin', sha('x'));
    assert.deepEqual(r, { checked: false, match: null, why: "ENOENT reading missing.bin" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns checked true when slice bytes match the attested hash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'verifySliceBytes-'));
  try {
    const content = 'x'.repeat(64);
    writeFileSync(join(dir, 's.bin'), content);
    const r = verifySliceBytes(dir, 's.bin', sha(content));
    assert.deepEqual(r, { checked: true, match: true, why: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns checked true with mismatch when slice bytes differ from attested hash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'verifySliceBytes-'));
  try {
    const content = 'y'.repeat(64);
    writeFileSync(join(dir, 's.bin'), content);
    const r = verifySliceBytes(dir, 's.bin', sha('z'.repeat(64)));
    assert.deepEqual(r, { checked: true, match: false, why: "slice bytes do not match the attested hash \u2014 the file changed after it was recorded" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unchecked when attested hash is empty string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'verifySliceBytes-'));
  try {
    const r = verifySliceBytes(dir, 'a.bin', '');
    assert.deepEqual(r, { checked: false, match: null, why: "no hash was attested for this state" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns checked true with mismatch when file content is one byte different', () => {
  const dir = mkdtempSync(join(tmpdir(), 'verifySliceBytes-'));
  try {
    const content = 'a'.repeat(32);
    writeFileSync(join(dir, 's.bin'), content);
    const r = verifySliceBytes(dir, 's.bin', sha('b'.repeat(32)));
    assert.deepEqual(r, { checked: true, match: false, why: "slice bytes do not match the attested hash \u2014 the file changed after it was recorded" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
