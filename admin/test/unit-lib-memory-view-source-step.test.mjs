// Computes a source step with artefact path, size, hash, and mtime, or greyed-out fields if missing (admin/lib/memory-view.mjs sourceStep).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceStep } from '../lib/memory-view.mjs';
import { mkdtempSync, rmSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns grey step when sourcePath is undefined', () => {
  const result = sourceStep(undefined);
  assert.deepEqual(result, {
    n: 1,
    key: 'source',
    title: 'SOURCE',
    state: 'grey',
    tone: 'grey',
    fields: [
      { label: 'artefact', state: 'grey', value: null, note: null, tone: 'grey', reason: 'no receipt on this box names a source artefact for this record \u2014 memory_receipt has no source column, and no receipts file on disk mentions this identity' },
      { label: 'bytes', state: 'grey', value: null, note: null, tone: 'grey', reason: 'no artefact to measure' },
      { label: 'sha256', state: 'grey', value: null, note: null, tone: 'grey', reason: 'no artefact to hash' },
      { label: 'mtime', state: 'grey', value: null, note: null, tone: 'grey', reason: 'no artefact to stat' }
    ],
    reason: 'nothing in this step was observable from the evidence on this box',
    observedFields: 0,
    totalFields: 4
  });
});

test('returns grey step when sourcePath is empty string', () => {
  const result = sourceStep('');
  assert.deepEqual(result, {
    n: 1,
    key: 'source',
    title: 'SOURCE',
    state: 'grey',
    tone: 'grey',
    fields: [
      { label: 'artefact', state: 'grey', value: null, note: null, tone: 'grey', reason: 'no receipt on this box names a source artefact for this record \u2014 memory_receipt has no source column, and no receipts file on disk mentions this identity' },
      { label: 'bytes', state: 'grey', value: null, note: null, tone: 'grey', reason: 'no artefact to measure' },
      { label: 'sha256', state: 'grey', value: null, note: null, tone: 'grey', reason: 'no artefact to hash' },
      { label: 'mtime', state: 'grey', value: null, note: null, tone: 'grey', reason: 'no artefact to stat' }
    ],
    reason: 'nothing in this step was observable from the evidence on this box',
    observedFields: 0,
    totalFields: 4
  });
});

test('returns grey step with artefact seen when sourcePath does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sourceStep-'));
  try {
    const missing = join(dir, 'missing.txt');
    const result = sourceStep(missing);
    assert.deepEqual(result, {
      n: 1,
      key: 'source',
      title: 'SOURCE',
      state: 'grey',
      tone: 'grey',
      fields: [
        { label: 'artefact', state: 'observed', value: missing, note: null, tone: 'grey', reason: null },
        { label: 'bytes', state: 'grey', value: null, note: null, tone: 'grey', reason: 'ENOENT \u2014 legitimately not there' },
        { label: 'sha256', state: 'grey', value: null, note: null, tone: 'grey', reason: 'ENOENT \u2014 legitimately not there' },
        { label: 'mtime', state: 'grey', value: null, note: null, tone: 'grey', reason: 'ENOENT \u2014 legitimately not there' }
      ],
      reason: 'the receipt names an artefact that is no longer on disk (ENOENT) \u2014 the write is recorded, its source is gone',
      observedFields: 1,
      totalFields: 4
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns grey step with artefact seen and alarm tone when sourcePath stat fails with non-ENOENT error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sourceStep-'));
  const subdir = join(dir, 'sub');
  const file = join(subdir, 'file.txt');
  try {
    mkdirSync(subdir, { recursive: true });
    writeFileSync(file, 'x');
    chmodSync(subdir, 0o000);
    const result = sourceStep(file);
    assert.deepEqual(result, {
      n: 1,
      key: 'source',
      title: 'SOURCE',
      state: 'grey',
      tone: 'grey',
      fields: [
        { label: 'artefact', state: 'observed', value: file, note: null, tone: 'alarm', reason: null },
        { label: 'bytes', state: 'grey', value: null, note: null, tone: 'grey', reason: 'EACCES \u2014 a fault, not an absence' },
        { label: 'sha256', state: 'grey', value: null, note: null, tone: 'grey', reason: 'EACCES \u2014 a fault, not an absence' },
        { label: 'mtime', state: 'grey', value: null, note: null, tone: 'grey', reason: 'EACCES \u2014 a fault, not an absence' }
      ],
      reason: 'the named artefact could not be read: EACCES \u2014 a fault, not an absence',
      observedFields: 1,
      totalFields: 4
    });
  } finally {
    try { chmodSync(subdir, 0o700); } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns observed step with all fields seen when sourcePath is a readable file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sourceStep-'));
  try {
    const file = join(dir, 'readable.txt');
    writeFileSync(file, 'hello');
    const result = sourceStep(file);
    const expectedHash = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
    const shortHash = '2cf24dba5fb0\u20269824';
    assert.deepEqual(result, {
      n: 1,
      key: 'source',
      title: 'SOURCE',
      state: 'observed',
      tone: 'ok',
      fields: [
        { label: 'artefact', state: 'observed', value: file, note: null, tone: 'ok', reason: null },
        { label: 'bytes', state: 'observed', value: 5, note: null, tone: 'ok', reason: null },
        { label: 'sha256', state: 'observed', value: expectedHash, note: shortHash, tone: 'ok', reason: null },
        { label: 'mtime', state: 'observed', value: result.fields[3].value, note: null, tone: 'ok', reason: null }
      ],
      reason: null,
      observedFields: 4,
      totalFields: 4
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns observed step with sha256 unseen when file cannot be read for hashing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sourceStep-'));
  try {
    const file = join(dir, 'unreadable.txt');
    writeFileSync(file, 'secret');
    chmodSync(file, 0o000);
    const result = sourceStep(file);
    assert.deepEqual(result, {
      n: 1,
      key: 'source',
      title: 'SOURCE',
      state: 'observed',
      tone: 'grey',
      fields: [
        { label: 'artefact', state: 'observed', value: file, note: null, tone: 'ok', reason: null },
        { label: 'bytes', state: 'observed', value: 6, note: null, tone: 'ok', reason: null },
        { label: 'sha256', state: 'grey', value: null, note: null, tone: 'grey', reason: 'could not be hashed: EACCES' },
        { label: 'mtime', state: 'observed', value: result.fields[3].value, note: null, tone: 'ok', reason: null }
      ],
      reason: null,
      observedFields: 3,
      totalFields: 4
    });
  } finally {
    try { chmodSync(file, 0o600); } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});
