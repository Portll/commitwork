// Formats recent publish records into human-readable status lines (bin/docsite-publish-scheduled.mjs statusLines).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusLines } from '../docsite-publish-scheduled.mjs';

test('formats a successful record with sha and deploymentId', () => {
  const records = [{ at: '2024-01-01T00:00:00Z', sha: 'abcdef1234567890', ok: true, result: 'published', deploymentId: 'dep-1' }];
  assert.deepEqual(statusLines(records, 10), ["2024-01-01T00:00:00Z  abcdef123456  published  dep-1"]);
});

test('formats a failed record with error and stage', () => {
  const records = [{ at: '2024-01-02T00:00:00Z', sha: '1234567890ab', ok: false, result: 'failed', stage: 'build', error: 'build error' }];
  assert.deepEqual(statusLines(records, 10), ["2024-01-02T00:00:00Z  1234567890ab  failed at build  build error"]);
});

test('handles missing sha by using empty string', () => {
  const records = [{ at: '2024-01-03T00:00:00Z', ok: true, result: 'published', deploymentId: 'dep-2' }];
  assert.deepEqual(statusLines(records, 10), ["2024-01-03T00:00:00Z  published  dep-2"]);
});

test('handles missing deploymentId and error for successful record', () => {
  const records = [{ at: '2024-01-04T00:00:00Z', sha: 'fedcba0987654321', ok: true, result: 'ok' }];
  assert.deepEqual(statusLines(records, 10), ["2024-01-04T00:00:00Z  fedcba098765  ok"]);
});

test('slices records to limit when more records exist', () => {
  const records = Array.from({ length: 15 }, (_, i) => ({ at: `2024-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`, sha: 'a'.repeat(20), ok: true, result: 'done', deploymentId: `d${i}` }));
  assert.deepEqual(statusLines(records, 5), ["2024-01-11T00:00:00Z  aaaaaaaaaaaa  done  d10", "2024-01-12T00:00:00Z  aaaaaaaaaaaa  done  d11", "2024-01-13T00:00:00Z  aaaaaaaaaaaa  done  d12", "2024-01-14T00:00:00Z  aaaaaaaaaaaa  done  d13", "2024-01-15T00:00:00Z  aaaaaaaaaaaa  done  d14"]);
});

test('returns empty array for empty records', () => {
  assert.deepEqual(statusLines([], 10), []);
});

test('uses default limit of 10 when not specified', () => {
  const records = Array.from({ length: 12 }, (_, i) => ({ at: `t${i}`, sha: 'b'.repeat(15), ok: false, result: 'err', stage: 's', error: 'e' }));
  assert.deepEqual(statusLines(records), ["t2  bbbbbbbbbbbb  err at s  e", "t3  bbbbbbbbbbbb  err at s  e", "t4  bbbbbbbbbbbb  err at s  e", "t5  bbbbbbbbbbbb  err at s  e", "t6  bbbbbbbbbbbb  err at s  e", "t7  bbbbbbbbbbbb  err at s  e", "t8  bbbbbbbbbbbb  err at s  e", "t9  bbbbbbbbbbbb  err at s  e", "t10  bbbbbbbbbbbb  err at s  e", "t11  bbbbbbbbbbbb  err at s  e"]);
});

test('filters out empty strings from joined output', () => {
  const records = [{ at: '2024-01-05T00:00:00Z', sha: '', ok: true, result: 'success' }];
  assert.deepEqual(statusLines(records, 10), ["2024-01-05T00:00:00Z  success"]);
});
