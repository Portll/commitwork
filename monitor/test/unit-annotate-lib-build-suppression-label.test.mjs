// Builds a suppression-label envelope record (monitor/annotate-lib.mjs buildSuppressionLabel).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSuppressionLabel } from '../annotate-lib.mjs';

test('uses default count of 1 when count is omitted', () => {
  const r = buildSuppressionLabel({ target: 't', action: 'a', who: 'w', at: 1 });
  assert.deepEqual(r, { kind: "suppression-label", target: "t", action: "a", count: 1, who: "w", at: 1 });
});

test('uses provided count when count is given', () => {
  const r = buildSuppressionLabel({ target: 't', action: 'a', count: 5, who: 'w', at: 1 });
  assert.deepEqual(r, { kind: "suppression-label", target: "t", action: "a", count: 5, who: "w", at: 1 });
});

test('includes expires property when expires is truthy', () => {
  const r = buildSuppressionLabel({ target: 't', action: 'a', who: 'w', at: 1, expires: 999 });
  assert.deepEqual(r, { kind: "suppression-label", target: "t", action: "a", count: 1, who: "w", at: 1, expires: 999 });
});

test('omits expires property when expires is falsy', () => {
  const r = buildSuppressionLabel({ target: 't', action: 'a', who: 'w', at: 1, expires: 0 });
  assert.deepEqual(r, { kind: "suppression-label", target: "t", action: "a", count: 1, who: "w", at: 1 });
});

test('sets noExpires to true when noExpires is truthy', () => {
  const r = buildSuppressionLabel({ target: 't', action: 'a', who: 'w', at: 1, noExpires: true });
  assert.deepEqual(r, { kind: "suppression-label", target: "t", action: "a", count: 1, who: "w", at: 1, noExpires: true });
});

test('omits noExpires property when noExpires is falsy', () => {
  const r = buildSuppressionLabel({ target: 't', action: 'a', who: 'w', at: 1, noExpires: false });
  assert.deepEqual(r, { kind: "suppression-label", target: "t", action: "a", count: 1, who: "w", at: 1 });
});

test('includes both expires and noExpires when both are truthy', () => {
  const r = buildSuppressionLabel({ target: 't', action: 'a', who: 'w', at: 1, expires: 100, noExpires: true });
  assert.deepEqual(r, { kind: "suppression-label", target: "t", action: "a", count: 1, who: "w", at: 1, expires: 100, noExpires: true });
});

test('handles undefined who and at values', () => {
  const r = buildSuppressionLabel({ target: 't', action: 'a' });
  assert.deepEqual(r, { kind: "suppression-label", target: "t", action: "a", count: 1, who: undefined, at: undefined });
});
