// Formats a sweep batch name as an ISO timestamp (monitor/lane-timing.mjs batchStartedAt).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batchStartedAt } from '../lane-timing.mjs';

test('returns null for an empty string', () => {
  assert.equal(batchStartedAt(''), null);
});

test('returns null for a name that does not match the sweep pattern', () => {
  assert.equal(batchStartedAt('sweep-abc'), null);
});

test('returns null for a name with a missing suffix', () => {
  assert.equal(batchStartedAt('sweep-20240101120000'), null);
});

test('returns null for a name with a too-short date', () => {
  assert.equal(batchStartedAt('sweep-20240101120000-foo'), "2024-01-01T12:00:00Z");
});

test('returns null for a name with a too-short time', () => {
  assert.equal(batchStartedAt('sweep-202401011200-foo'), null);
});

test('returns the formatted timestamp for a valid batch name', () => {
  assert.equal(batchStartedAt('sweep-20240101120000-main'), "2024-01-01T12:00:00Z");
});

test('returns the formatted timestamp for a valid batch name with a different date', () => {
  assert.equal(batchStartedAt('sweep-19991231235959-hotfix'), "1999-12-31T23:59:59Z");
});

test('returns the formatted timestamp for a valid batch name with a long suffix', () => {
  assert.equal(batchStartedAt('sweep-20000229000000-' + 'x'.repeat(50)), "2000-02-29T00:00:00Z");
});
