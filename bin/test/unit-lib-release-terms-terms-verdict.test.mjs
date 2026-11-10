// termsVerdict returns a verdict object based on scan results (bin/lib/release-terms.mjs termsVerdict).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { termsVerdict } from '../lib/release-terms.mjs';

test('returns cannot-check when examined is false', () => {
  const input = { examined: false, hitCount: 0, withheldCount: 0, grossHitCount: 0, exceptions: [] };
  const result = termsVerdict(input);
  assert.deepEqual(result, { status: "cannot-check", error: "no text file was examined; an empty tree is not a clean one" });
});

test('returns cannot-check when examined is undefined', () => {
  const input = { examined: undefined, hitCount: 0, withheldCount: 0, grossHitCount: 0, exceptions: [] };
  const result = termsVerdict(input);
  assert.deepEqual(result, { status: "cannot-check", error: "no text file was examined; an empty tree is not a clean one" });
});

test('returns fail when hitCount is positive', () => {
  const input = { examined: true, hitCount: 1, withheldCount: 0, grossHitCount: 1, exceptions: [] };
  const result = termsVerdict(input);
  assert.deepEqual(result, { status: "fail" });
});

test('returns pass when hitCount is zero', () => {
  const input = { examined: true, hitCount: 0, withheldCount: 0, grossHitCount: 0, exceptions: [] };
  const result = termsVerdict(input);
  assert.deepEqual(result, { status: "pass" });
});

test('returns cannot-check when withheldCount positive and unbounded exception exists', () => {
  const input = {
    examined: true,
    hitCount: 0,
    withheldCount: 5,
    grossHitCount: 5,
    exceptions: [{ allowed: null, withheld: true, stale: false }]
  };
  const result = termsVerdict(input);
  assert.deepEqual(result, { status: "cannot-check", error: "every denied term in the tree (5) is withheld by an exception, and 1 of them name a whole file with no measured count; an exclusion that removes everything is not a pass" });
});

test('returns cannot-check when withheldCount positive and stale exception exists', () => {
  const input = {
    examined: true,
    hitCount: 0,
    withheldCount: 5,
    grossHitCount: 5,
    exceptions: [{ allowed: 5, withheld: 5, stale: true }]
  };
  const result = termsVerdict(input);
  assert.deepEqual(result, { status: "cannot-check", error: "every denied term in the tree (5) is withheld by an exception, and 1 of them withheld fewer than the measurement that declared them; re-measure the narrowing before reading this as clean" });
});

test('returns pass when withheldCount positive but no unbounded or stale exceptions', () => {
  const input = {
    examined: true,
    hitCount: 0,
    withheldCount: 5,
    grossHitCount: 5,
    exceptions: [{ allowed: 5, withheld: 5, stale: false }]
  };
  const result = termsVerdict(input);
  assert.deepEqual(result, { status: "pass" });
});

test('returns pass when withheldCount positive and exception has allowed not null but withheld false', () => {
  const input = {
    examined: true,
    hitCount: 0,
    withheldCount: 5,
    grossHitCount: 5,
    exceptions: [{ allowed: 5, withheld: false, stale: false }]
  };
  const result = termsVerdict(input);
  assert.deepEqual(result, { status: "pass" });
});

test('returns pass when withheldCount positive and exception has allowed null but withheld false', () => {
  const input = {
    examined: true,
    hitCount: 0,
    withheldCount: 5,
    grossHitCount: 5,
    exceptions: [{ allowed: null, withheld: false, stale: false }]
  };
  const result = termsVerdict(input);
  assert.deepEqual(result, { status: "pass" });
});
