// Computes the publish verdict, publish flag, and exit code from scan results and reviews (bin/pre-publish.mjs verdictFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdictFor } from '../pre-publish.mjs';

test('returns cannot-check when error is present and result is null', () => {
  const r = verdictFor({ result: null, error: new Error('boom'), review: null });
  assert.deepEqual(r, { verdict: "cannot-check", publish: false, exit: 2 });
});

test('returns cannot-check when result is null and error is null', () => {
  const r = verdictFor({ result: null, error: null, review: null });
  assert.deepEqual(r, { verdict: "cannot-check", publish: false, exit: 2 });
});

test('returns cannot-check when result has failures', () => {
  const r = verdictFor({ result: { failures: ['f1'], summary: {}, unscanned: [] }, error: null, review: null });
  assert.deepEqual(r, { verdict: "cannot-check", publish: false, exit: 2 });
});

test('returns blocked-secret when summary has one REAL-SECRET', () => {
  const r = verdictFor({ result: { failures: [], summary: { 'REAL-SECRET': 1, 'SENSITIVE-CONTEXT': 0 }, unscanned: [] }, error: null, review: null });
  assert.deepEqual(r, { verdict: "blocked-secret", publish: false, exit: 1 });
});

test('returns blocked-secret when review has one unreviewed REAL-SECRET', () => {
  const r = verdictFor({ result: { failures: [], summary: {}, unscanned: [] }, error: null, review: { unreviewed: [{ verdict: 'REAL-SECRET' }], assetsUnreviewed: [], reviewed: [], assetsReviewed: [] } });
  assert.deepEqual(r, { verdict: "blocked-secret", publish: false, exit: 1 });
});

test('returns blocked-context when summary has one SENSITIVE-CONTEXT', () => {
  const r = verdictFor({ result: { failures: [], summary: { 'REAL-SECRET': 0, 'SENSITIVE-CONTEXT': 1 }, unscanned: [] }, error: null, review: null });
  assert.deepEqual(r, { verdict: "blocked-context", publish: false, exit: 1 });
});

test('returns blocked-context when review has one unreviewed SENSITIVE-CONTEXT', () => {
  const r = verdictFor({ result: { failures: [], summary: {}, unscanned: [] }, error: null, review: { unreviewed: [{ verdict: 'SENSITIVE-CONTEXT' }], assetsUnreviewed: [], reviewed: [], assetsReviewed: [] } });
  assert.deepEqual(r, { verdict: "blocked-context", publish: false, exit: 1 });
});

test('returns unreviewed-unscanned when result has unscanned assets', () => {
  const r = verdictFor({ result: { failures: [], summary: { 'REAL-SECRET': 0, 'SENSITIVE-CONTEXT': 0 }, unscanned: ['a1'] }, error: null, review: null });
  assert.deepEqual(r, { verdict: "unreviewed-unscanned", publish: false, exit: 2 });
});

test('returns unreviewed-unscanned when review has assetsUnreviewed', () => {
  const r = verdictFor({ result: { failures: [], summary: {}, unscanned: [] }, error: null, review: { unreviewed: [], assetsUnreviewed: ['a1'], reviewed: [], assetsReviewed: [] } });
  assert.deepEqual(r, { verdict: "unreviewed-unscanned", publish: false, exit: 2 });
});

test('returns clean-reviewed when review has reviewed items', () => {
  const r = verdictFor({ result: { failures: [], summary: {}, unscanned: [] }, error: null, review: { unreviewed: [], assetsUnreviewed: [], reviewed: [{ verdict: 'OK' }], assetsReviewed: [] } });
  assert.deepEqual(r, { verdict: "clean-reviewed", publish: true, exit: 0 });
});

test('returns clean when no issues and no review', () => {
  const r = verdictFor({ result: { failures: [], summary: { 'REAL-SECRET': 0, 'SENSITIVE-CONTEXT': 0 }, unscanned: [] }, error: null, review: null });
  assert.deepEqual(r, { verdict: "clean", publish: true, exit: 0 });
});
