// Orphan, widow and hash-mismatch anomalies between a history index and its slice files (monitor/store-consistency.mjs checkHistoryIndex).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkHistoryIndex } from '../store-consistency.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const PAIR = 'history-index\u2192slice';
const F = '20240101000000.json';
const sha = (s) => createHash('sha256').update(s).digest('hex');
const writeIndex = (dir, v) => writeFileSync(join(dir, 'index.json'), JSON.stringify(v));
const okResult = (dir, extra) => ({ pair: PAIR, ok: true, referrer: join(dir, 'index.json'), referrers: 1, referents: 0, prunedLegitimately: 0, legacyUndigested: 0, anomalies: [], ...extra });

test('Reports the index as absent when index.json does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'checkHistoryIndex-'));
  try {
    const indexPath = join(dir, 'index.json');
    const result = checkHistoryIndex(dir);
    assert.deepEqual(result, { pair: PAIR, unknown: true, unknownReason: 'absent', unknownDetail: indexPath, referrer: indexPath });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Reports unstated when the rows key holds something other than an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'checkHistoryIndex-'));
  try {
    const indexPath = join(dir, 'index.json');
    writeIndex(dir, { rows: 'abc' });
    const result = checkHistoryIndex(dir);
    assert.deepEqual(result, { pair: PAIR, unknown: true, unknownReason: 'unstated', unknownDetail: `${indexPath}: no row array`, referrer: indexPath });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Counts a version 0 row with no slice file as pruned legitimately', () => {
  const dir = mkdtempSync(join(tmpdir(), 'checkHistoryIndex-'));
  try {
    writeIndex(dir, [{ file: F, sliceVersion: 0 }]);
    const result = checkHistoryIndex(dir);
    assert.deepEqual(result, okResult(dir, { prunedLegitimately: 1 }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Counts a version 1 row with no digest and no slice file as legacy undigested', () => {
  const dir = mkdtempSync(join(tmpdir(), 'checkHistoryIndex-'));
  try {
    writeIndex(dir, [{ file: F, sliceVersion: 1 }]);
    const result = checkHistoryIndex(dir);
    assert.deepEqual(result, okResult(dir, { legacyUndigested: 1 }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Reports an orphan when a digested version 2 row has no slice file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'checkHistoryIndex-'));
  try {
    writeIndex(dir, [{ file: F, sliceVersion: 2, sliceSha256: 'a'.repeat(64) }]);
    const result = checkHistoryIndex(dir);
    const detail = `index row pinned sliceSha256 ${'a'.repeat(12)}\u2026 and the slice file is not on disk`;
    assert.deepEqual(result, okResult(dir, { anomalies: [{ class: 'orphan', key: F, sliceId: null, detail }] }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Treats a one character digest as digested and reports the missing slice as an orphan', () => {
  const dir = mkdtempSync(join(tmpdir(), 'checkHistoryIndex-'));
  try {
    writeIndex(dir, [{ file: F, sliceVersion: 2, sliceSha256: 'c', sliceId: 'slice-3' }]);
    const result = checkHistoryIndex(dir);
    const detail = 'index row pinned sliceSha256 c\u2026 and the slice file is not on disk';
    assert.deepEqual(result, okResult(dir, { anomalies: [{ class: 'orphan', key: F, sliceId: 'slice-3', detail }] }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Reports a mismatch when the slice file hash differs from the pinned digest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'checkHistoryIndex-'));
  try {
    writeFileSync(join(dir, F), 'hello world');
    writeIndex(dir, [{ file: F, sliceVersion: 2, sliceSha256: 'b'.repeat(64), sliceId: 'slice-7' }]);
    const result = checkHistoryIndex(dir);
    const detail = `sliceSha256 ${'b'.repeat(12)}\u2026 but the file hashes b94d27b9934d\u2026`;
    assert.deepEqual(result, okResult(dir, { referents: 1, anomalies: [{ class: 'mismatch', key: F, sliceId: 'slice-7', detail }] }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Reports no anomaly when the slice file hash equals the pinned digest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'checkHistoryIndex-'));
  try {
    writeFileSync(join(dir, F), 'hello world');
    writeIndex(dir, [{ file: F, sliceVersion: 2, sliceSha256: sha('hello world') }]);
    const result = checkHistoryIndex(dir);
    assert.deepEqual(result, okResult(dir, { referents: 1 }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Reports a widow for a slice file on disk that no index row names', () => {
  const dir = mkdtempSync(join(tmpdir(), 'checkHistoryIndex-'));
  try {
    writeFileSync(join(dir, F), 'payload');
    writeIndex(dir, []);
    const result = checkHistoryIndex(dir);
    const detail = 'slice file on disk that no index row names \u2014 an index trimmed without its payload';
    assert.deepEqual(result, okResult(dir, { referrers: 0, referents: 1, anomalies: [{ class: 'widow', key: F, sliceId: null, detail }] }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Reads rows from the slices key and skips null rows and non-string file names', () => {
  const dir = mkdtempSync(join(tmpdir(), 'checkHistoryIndex-'));
  try {
    writeIndex(dir, { slices: [null, { file: 123 }, { file: F, sliceVersion: 1 }] });
    const result = checkHistoryIndex(dir);
    assert.deepEqual(result, okResult(dir, { referrers: 3, legacyUndigested: 1 }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
