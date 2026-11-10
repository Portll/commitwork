// Applies review dispositions to findings and unscanned assets (bin/lib/release-reviews.mjs applyReviews).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyReviews } from '../lib/release-reviews.mjs';

test('non-blocking verdicts are skipped entirely', () => {
  const r = applyReviews({ findings: [{ file: 'a', line: 1, cls: 'REAL-SECRET', verdict: 'synthetic-fixture', fingerprint: 'fp1' }] }, { findings: [], assets: [] });
  assert.deepEqual(r, { reviewed: [], unreviewed: [], assetsReviewed: [], assetsUnreviewed: [], stale: [] });
});

test('blocking finding with no matching review row stays unreviewed without disposition', () => {
  const r = applyReviews({ findings: [{ file: 'a', line: 1, cls: 'REAL-SECRET', verdict: 'REAL-SECRET', fingerprint: 'fp1' }] }, { findings: [], assets: [] });
  assert.deepEqual(r, { reviewed: [], unreviewed: [{ file: "a", line: 1, cls: "REAL-SECRET", verdict: "REAL-SECRET", fingerprint: "fp1" }], assetsReviewed: [], assetsUnreviewed: [], stale: [] });
});

test('blocking finding matched by accepting review within count is reviewed', () => {
  const r = applyReviews(
    { findings: [{ file: 'a', line: 1, cls: 'REAL-SECRET', verdict: 'REAL-SECRET', fingerprint: 'fp1' }] },
    { findings: [{ file: 'a', cls: 'REAL-SECRET', fingerprint: 'fp1', disposition: 'synthetic-fixture', count: 1 }], assets: [] }
  );
  assert.deepEqual(r, { reviewed: [{ file: "a", line: 1, cls: "REAL-SECRET", verdict: "REAL-SECRET", fingerprint: "fp1", disposition: "synthetic-fixture" }], unreviewed: [], assetsReviewed: [], assetsUnreviewed: [], stale: [] });
});

test('blocking finding matched by accepting review beyond count is unreviewed with beyondCount', () => {
  const r = applyReviews(
    { findings: [
      { file: 'a', line: 1, cls: 'REAL-SECRET', verdict: 'REAL-SECRET', fingerprint: 'fp1' },
      { file: 'a', line: 2, cls: 'REAL-SECRET', verdict: 'REAL-SECRET', fingerprint: 'fp1' }
    ] },
    { findings: [{ file: 'a', cls: 'REAL-SECRET', fingerprint: 'fp1', disposition: 'synthetic-fixture', count: 1 }], assets: [] }
  );
  assert.deepEqual(r, { reviewed: [{ file: "a", line: 1, cls: "REAL-SECRET", verdict: "REAL-SECRET", fingerprint: "fp1", disposition: "synthetic-fixture" }], unreviewed: [{ file: "a", line: 2, cls: "REAL-SECRET", verdict: "REAL-SECRET", fingerprint: "fp1", beyondCount: 1 }], assetsReviewed: [], assetsUnreviewed: [], stale: [] });
});

test('blocking finding matched by non-accepting review is unreviewed with disposition', () => {
  const r = applyReviews(
    { findings: [{ file: 'a', line: 1, cls: 'REAL-SECRET', verdict: 'REAL-SECRET', fingerprint: 'fp1' }] },
    { findings: [{ file: 'a', cls: 'REAL-SECRET', fingerprint: 'fp1', disposition: 'REAL-SECRET', count: 5 }], assets: [] }
  );
  assert.deepEqual(r, { reviewed: [], unreviewed: [{ file: "a", line: 1, cls: "REAL-SECRET", verdict: "REAL-SECRET", fingerprint: "fp1", disposition: "REAL-SECRET" }], assetsReviewed: [], assetsUnreviewed: [], stale: [] });
});

test('unscanned asset with no matching review row is unreviewed with null blob', () => {
  const r = applyReviews(
    { findings: [], unscanned: [{ file: 'img.png', reason: 'binary' }] },
    { findings: [], assets: [] },
    new Map()
  );
  assert.deepEqual(r, { reviewed: [], unreviewed: [], assetsReviewed: [], assetsUnreviewed: [{ file: "img.png", reason: "binary", blob: null }], stale: [] });
});

test('unscanned asset matched by accepting review is reviewed', () => {
  const r = applyReviews(
    { findings: [], unscanned: [{ file: 'img.png', reason: 'binary' }] },
    { findings: [], assets: [{ blob: 'abc', path: 'img.png', disposition: 'publish' }] },
    new Map([['img.png', 'abc']])
  );
  assert.deepEqual(r, { reviewed: [], unreviewed: [], assetsReviewed: [{ file: "img.png", blob: "abc", disposition: "publish" }], assetsUnreviewed: [], stale: [] });
});

test('unscanned asset matched by non-accepting review is unreviewed with disposition', () => {
  const r = applyReviews(
    { findings: [], unscanned: [{ file: 'img.png', reason: 'binary' }] },
    { findings: [], assets: [{ blob: 'abc', path: 'img.png', disposition: 'REAL-SECRET' }] },
    new Map([['img.png', 'abc']])
  );
  assert.deepEqual(r, { reviewed: [], unreviewed: [], assetsReviewed: [], assetsUnreviewed: [{ file: "img.png", reason: "binary", blob: "abc", disposition: "REAL-SECRET" }], stale: [] });
});

test('unused review rows and assets appear in stale', () => {
  const r = applyReviews(
    { findings: [], unscanned: [] },
    { findings: [{ file: 'x', cls: 'REAL-SECRET', fingerprint: 'fp9', disposition: 'synthetic-fixture', count: 1 }], assets: [{ blob: 'zzz', path: 'y', disposition: 'publish' }] }
  );
  assert.deepEqual(r, { reviewed: [], unreviewed: [], assetsReviewed: [], assetsUnreviewed: [], stale: [{ file: "x", cls: "REAL-SECRET", fingerprint: "fp9" }, { blob: "zzz", path: "y" }] });
});
