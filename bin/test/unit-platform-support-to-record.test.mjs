// converts parsed log and meta into a plain record object (bin/platform-support.mjs toRecord).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toRecord, EXIT } from '../platform-support.mjs';

test('throws UNMEASURED when parsed.blocks is missing', () => {
  const parsed = { failing: [], totals: { tests: 0, pass: 0, fail: 0, skipped: 0, cancelled: 0, todo: 0 }, testFiles: [], skippedWithReason: [] };
  const meta = {};
  try {
    toRecord(parsed, meta);
    assert.fail('expected error');
  } catch (e) {
    assert.strictEqual(e.exitCode, EXIT.UNMEASURED);
    assert.match(e.message, /no test totals in the log/);
  }
});

test('produces record with values taken from parsed when meta does not override', () => {
  const parsed = {
    blocks: ['summary'],
    failing: [{ file: 'a.js', name: 'test A' }, { name: 'test B' }],
    totals: { tests: 10, pass: 8, fail: 1, skipped: 1, cancelled: 0, todo: 0 },
    testFiles: ['a.js', 'b.js'],
    skippedWithReason: [{ file: 'c.js', reason: 'flaky' }],
    platform: 'linux',
    nodeVersion: '22.0.0',
    headSha: 'abc123',
    lastTimestamp: '2024-01-01T00:00:00Z',
  };
  const meta = { runId: 42 };
  const rec = toRecord(parsed, meta);
  assert.deepStrictEqual(rec, {
    platform: 'linux',
    node: '22.0.0',
    runId: '42',
    job: null,
    headSha: 'abc123',
    measuredAt: '2024-01-01T00:00:00Z',
    tests: 10,
    pass: 8,
    fail: 1,
    skip: 1,
    cancelled: 0,
    todo: 0,
    skippedWithReason: [{ file: 'c.js', reason: 'flaky' }],
    failing: ['a.js > test A', 'test B'],
    failingByFile: { 'a.js': 1, '(unknown)': 1 },
    testFiles: ['a.js', 'b.js'],
    summaries: ['summary'],
  });
});

test('meta overrides platform, node, headSha and provides optional fields', () => {
  const parsed = {
    blocks: ['b1'],
    failing: [],
    totals: { tests: 5, pass: 5, fail: 0, skipped: 0, cancelled: 0, todo: 0 },
    testFiles: [],
    skippedWithReason: [],
    platform: 'win32',
    nodeVersion: '20.0.0',
    headSha: 'oldsha',
    lastTimestamp: '2023-12-31T23:59:59Z',
  };
  const meta = {
    platform: 'darwin',
    node: '22.5.1',
    headSha: 'newsha',
    measuredAt: '2024-02-02T02:02:02Z',
    runId: 7,
    job: 'ci-job',
  };
  const rec = toRecord(parsed, meta);
  assert.strictEqual(rec.platform, 'darwin');
  assert.strictEqual(rec.node, '22.5.1');
  assert.strictEqual(rec.headSha, 'newsha');
  assert.strictEqual(rec.measuredAt, '2024-02-02T02:02:02Z');
  assert.strictEqual(rec.job, 'ci-job');
});

test('failingByFile is sorted alphabetically regardless of insertion order', () => {
  const parsed = {
    blocks: ['s'],
    failing: [
      { file: 'z.js', name: 'z1' },
      { file: 'a.js', name: 'a1' },
      { file: 'm.js', name: 'm1' },
      { file: 'a.js', name: 'a2' },
    ],
    totals: { tests: 4, pass: 0, fail: 4, skipped: 0, cancelled: 0, todo: 0 },
    testFiles: [],
    skippedWithReason: [],
  };
  const meta = { runId: 1 };
  const rec = toRecord(parsed, meta);
  assert.deepStrictEqual(rec.failingByFile, { 'a.js': 2, 'm.js': 1, 'z.js': 1 });
  const keys = Object.keys(rec.failingByFile);
  assert.deepStrictEqual(keys, ['a.js', 'm.js', 'z.js']);
});

test('handles failing entries without file property correctly', () => {
  const parsed = {
    blocks: ['b'],
    failing: [{ name: 'solo test' }],
    totals: { tests: 1, pass: 0, fail: 1, skipped: 0, cancelled: 0, todo: 0 },
    testFiles: [],
    skippedWithReason: [],
  };
  const meta = { runId: 0 };
  const rec = toRecord(parsed, meta);
  assert.deepStrictEqual(rec.failing, ['solo test']);
  assert.deepStrictEqual(rec.failingByFile, { '(unknown)': 1 });
});

test('uses string conversion for runId and defaults job to null when undefined', () => {
  const parsed = {
    blocks: ['b'],
    failing: [],
    totals: { tests: 0, pass: 0, fail: 0, skipped: 0, cancelled: 0, todo: 0 },
    testFiles: [],
    skippedWithReason: [],
  };
  const meta = { runId: 12345 };
  const rec = toRecord(parsed, meta);
  assert.strictEqual(rec.runId, '12345');
  assert.strictEqual(rec.job, null);
});
