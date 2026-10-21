// Drift lines between records and statements (bin/platform-support.mjs compare).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare } from '../platform-support.mjs';

test('returns empty array when records and statements match exactly', () => {
  const records = [
    { platform: 'windows', node: '22', measuredAt: '2024-01-15T10:00:00Z', headSha: 'abc1234567890', pass: 10, fail: 0, skip: 2 }
  ];
  const statements = [
    { platform: 'Windows', node: '22', date: '2024-01-15', sha: 'abc1234', pass: 10, fail: 0, skip: 2 }
  ];
  const result = compare(records, statements, 'README.md');
  assert.deepEqual(result, []);
});

test('reports record not stated when no matching statement exists', () => {
  const records = [
    { platform: 'linux', node: '20', measuredAt: '2024-02-20T08:30:00Z', headSha: 'def4567890123', pass: 5, fail: 1, skip: 3 }
  ];
  const statements = [];
  const result = compare(records, statements, 'docs.md');
  assert.deepEqual(result, ['docs.md: does not state "Linux CI measured 2024-02-20 at `def45678`, Node 20: 5 pass / 1 fail / 3 skipped"']);
});

test('reports statement with no matching record when platform is covered', () => {
  const records = [
    { platform: 'macos', node: '22', measuredAt: '2024-03-10T12:00:00Z', headSha: 'ghi7890123456', pass: 8, fail: 2, skip: 1 }
  ];
  const statements = [
    { platform: 'macOS', node: '22', date: '2024-03-10', sha: 'ghi7890', pass: 8, fail: 2, skip: 1 },
    { platform: 'macOS', node: '20', date: '2024-03-11', sha: 'xyz9876', pass: 3, fail: 0, skip: 5 }
  ];
  const result = compare(records, statements, 'platform.md');
  assert.deepEqual(result, ['platform.md: states macOS Node 20 2024-03-11 `xyz9876` 3/0/5, which no record holds']);
});

test('reports record not stated when statement platform is uncovered', () => {
  const records = [
    { platform: 'windows', node: '22', measuredAt: '2024-04-05T09:00:00Z', headSha: 'jkl0123456789', pass: 12, fail: 0, skip: 0 }
  ];
  const statements = [
    { platform: 'freebsd', node: '22', date: '2024-04-05', sha: 'jkl0123', pass: 12, fail: 0, skip: 0 }
  ];
  const result = compare(records, statements, 'test.md');
  assert.deepEqual(result, ['test.md: does not state "Windows CI measured 2024-04-05 at `jkl01234`, Node 22: 12 pass / 0 fail / 0 skipped"']);
});

test('handles multiple records with one missing statement', () => {
  const records = [
    { platform: 'windows', node: '22', measuredAt: '2024-05-01T10:00:00Z', headSha: 'aaa1111111111', pass: 1, fail: 0, skip: 0 },
    { platform: 'linux', node: '22', measuredAt: '2024-05-01T10:00:00Z', headSha: 'bbb2222222222', pass: 2, fail: 1, skip: 0 }
  ];
  const statements = [
    { platform: 'Windows', node: '22', date: '2024-05-01', sha: 'aaa1111', pass: 1, fail: 0, skip: 0 }
  ];
  const result = compare(records, statements, 'multi.md');
  assert.deepEqual(result, ['multi.md: does not state "Linux CI measured 2024-05-01 at `bbb22222`, Node 22: 2 pass / 1 fail / 0 skipped"']);
});

test('matches when sha is prefix of headSha', () => {
  const records = [
    { platform: 'linux', node: '18', measuredAt: '2024-06-15T14:30:00Z', headSha: 'ccc3333333333', pass: 7, fail: 3, skip: 1 }
  ];
  const statements = [
    { platform: 'Linux', node: '18', date: '2024-06-15', sha: 'ccc333', pass: 7, fail: 3, skip: 1 }
  ];
  const result = compare(records, statements, 'prefix.md');
  assert.deepEqual(result, []);
});

test('fails match when sha is not prefix of headSha', () => {
  const records = [
    { platform: 'linux', node: '18', measuredAt: '2024-06-15T14:30:00Z', headSha: 'ccc3333333333', pass: 7, fail: 3, skip: 1 }
  ];
  const statements = [
    { platform: 'Linux', node: '18', date: '2024-06-15', sha: 'ddd444', pass: 7, fail: 3, skip: 1 }
  ];
  const result = compare(records, statements, 'nomatch.md');
  assert.deepEqual(result, [
    'nomatch.md: does not state "Linux CI measured 2024-06-15 at `ccc33333`, Node 18: 7 pass / 3 fail / 1 skipped"',
    'nomatch.md: states Linux Node 18 2024-06-15 `ddd444` 7/3/1, which no record holds'
  ]);
});

test('fails match when pass count differs', () => {
  const records = [
    { platform: 'macos', node: '22', measuredAt: '2024-07-20T16:00:00Z', headSha: 'eee5555555555', pass: 10, fail: 0, skip: 0 }
  ];
  const statements = [
    { platform: 'macOS', node: '22', date: '2024-07-20', sha: 'eee5555', pass: 9, fail: 0, skip: 0 }
  ];
  const result = compare(records, statements, 'passdiff.md');
  assert.deepEqual(result, [
    'passdiff.md: does not state "macOS CI measured 2024-07-20 at `eee55555`, Node 22: 10 pass / 0 fail / 0 skipped"',
    'passdiff.md: states macOS Node 22 2024-07-20 `eee5555` 9/0/0, which no record holds'
  ]);
});

test('fails match when date differs from measuredAt date portion', () => {
  const records = [
    { platform: 'windows', node: '20', measuredAt: '2024-08-01T00:00:00Z', headSha: 'fff6666666666', pass: 4, fail: 2, skip: 1 }
  ];
  const statements = [
    { platform: 'Windows', node: '20', date: '2024-08-02', sha: 'fff6666', pass: 4, fail: 2, skip: 1 }
  ];
  const result = compare(records, statements, 'datediff.md');
  assert.deepEqual(result, [
    'datediff.md: does not state "Windows CI measured 2024-08-01 at `fff66666`, Node 20: 4 pass / 2 fail / 1 skipped"',
    'datediff.md: states Windows Node 20 2024-08-02 `fff6666` 4/2/1, which no record holds'
  ]);
});

test('handles empty records and empty statements', () => {
  const result = compare([], [], 'empty.md');
  assert.deepEqual(result, []);
});
