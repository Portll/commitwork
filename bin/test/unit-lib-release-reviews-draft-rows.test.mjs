// Groups unreviewed findings and assets into draft review rows (bin/lib/release-reviews.mjs draftRows).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftRows } from '../lib/release-reviews.mjs';

test('returns empty arrays when no findings or assets are unreviewed', () => {
  const r = draftRows({ unreviewed: [], assetsUnreviewed: [] });
  assert.deepEqual(r, { findings: [], assets: [] });
});

test('creates a single finding row with count 1 for one unreviewed finding', () => {
  const r = draftRows({
    unreviewed: [{ file: 'a.js', cls: 'C1', fingerprint: 'fp1', verdict: 'block' }],
    assetsUnreviewed: []
  });
  assert.deepEqual(r, { findings: [{ file: "a.js", cls: "C1", fingerprint: "fp1", verdict: "block", count: 1, disposition: "pending", reason: "", reviewer: "", reviewedAt: null }], assets: [] });
});

test('increments count when two findings share the same key', () => {
  const r = draftRows({
    unreviewed: [
      { file: 'a.js', cls: 'C1', fingerprint: 'fp1', verdict: 'block' },
      { file: 'a.js', cls: 'C1', fingerprint: 'fp1', verdict: 'block' }
    ],
    assetsUnreviewed: []
  });
  assert.deepEqual(r, { findings: [{ file: "a.js", cls: "C1", fingerprint: "fp1", verdict: "block", count: 2, disposition: "pending", reason: "", reviewer: "", reviewedAt: null }], assets: [] });
});

test('creates separate rows for findings with different keys', () => {
  const r = draftRows({
    unreviewed: [
      { file: 'a.js', cls: 'C1', fingerprint: 'fp1', verdict: 'block' },
      { file: 'b.js', cls: 'C1', fingerprint: 'fp1', verdict: 'block' }
    ],
    assetsUnreviewed: []
  });
  assert.deepEqual(r, { findings: [{ file: "a.js", cls: "C1", fingerprint: "fp1", verdict: "block", count: 1, disposition: "pending", reason: "", reviewer: "", reviewedAt: null }, { file: "b.js", cls: "C1", fingerprint: "fp1", verdict: "block", count: 1, disposition: "pending", reason: "", reviewer: "", reviewedAt: null }], assets: [] });
});

test('creates an asset row for an asset with a truthy blob', () => {
  const r = draftRows({
    unreviewed: [],
    assetsUnreviewed: [{ blob: 'abc123', file: 'img.png' }]
  });
  assert.deepEqual(r, { findings: [], assets: [{ blob: "abc123", path: "img.png", disposition: "pending", reason: "", reviewer: "", reviewedAt: null }] });
});

test('skips assets with a falsy blob value', () => {
  const r = draftRows({
    unreviewed: [],
    assetsUnreviewed: [{ blob: '', file: 'img.png' }]
  });
  assert.deepEqual(r, { findings: [], assets: [] });
});

test('deduplicates assets with the same blob keeping the first path', () => {
  const r = draftRows({
    unreviewed: [],
    assetsUnreviewed: [
      { blob: 'abc123', file: 'first.png' },
      { blob: 'abc123', file: 'second.png' }
    ]
  });
  assert.deepEqual(r, { findings: [], assets: [{ blob: "abc123", path: "first.png", disposition: "pending", reason: "", reviewer: "", reviewedAt: null }] });
});

test('handles mixed findings and assets together', () => {
  const r = draftRows({
    unreviewed: [
      { file: 'a.js', cls: 'C1', fingerprint: 'fp1', verdict: 'warn' },
      { file: 'a.js', cls: 'C1', fingerprint: 'fp1', verdict: 'warn' },
      { file: 'b.js', cls: 'C2', fingerprint: 'fp2', verdict: 'block' }
    ],
    assetsUnreviewed: [
      { blob: 'blob1', file: 'x.png' },
      { blob: 'blob1', file: 'y.png' },
      { blob: '', file: 'z.png' }
    ]
  });
  assert.deepEqual(r, { findings: [{ file: "a.js", cls: "C1", fingerprint: "fp1", verdict: "warn", count: 2, disposition: "pending", reason: "", reviewer: "", reviewedAt: null }, { file: "b.js", cls: "C2", fingerprint: "fp2", verdict: "block", count: 1, disposition: "pending", reason: "", reviewer: "", reviewedAt: null }], assets: [{ blob: "blob1", path: "x.png", disposition: "pending", reason: "", reviewer: "", reviewedAt: null }] });
});
