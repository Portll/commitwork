// Returns a summary string for a retry object showing timeout, file count, and recovered count (monitor/sarif-read.mjs describeRetry).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeRetry } from '../sarif-read.mjs';

test('describes retry with timeoutSec and multiple files and recovered items', () => {
  const input = { timeoutSec: 30, files: ['a', 'b', 'c'], recovered: ['x', 'y'] };
  const result = describeRetry(input);
  assert.equal(result, "a retry at 30s per rule covered 3 file(s) and recovered 2");
});

test('describes retry with timeoutSec zero and empty arrays', () => {
  const input = { timeoutSec: 0, files: [], recovered: [] };
  const result = describeRetry(input);
  assert.equal(result, "a retry at 0s per rule covered 0 file(s) and recovered 0");
});

test('describes retry with missing timeoutSec showing placeholder', () => {
  const input = { files: ['f1'], recovered: ['r1'] };
  const result = describeRetry(input);
  assert.equal(result, "a retry at ?s per rule covered 1 file(s) and recovered 1");
});

test('describes retry with timeoutSec undefined explicitly', () => {
  const input = { timeoutSec: undefined, files: ['f'], recovered: [] };
  const result = describeRetry(input);
  assert.equal(result, "a retry at ?s per rule covered 1 file(s) and recovered 0");
});

test('describes retry with single file and single recovered item', () => {
  const input = { timeoutSec: 5, files: ['only'], recovered: ['one'] };
  const result = describeRetry(input);
  assert.equal(result, "a retry at 5s per rule covered 1 file(s) and recovered 1");
});

test('describes retry with many files and no recovered items', () => {
  const input = { timeoutSec: 10, files: Array.from({ length: 100 }, (_, i) => `f${i}`), recovered: [] };
  const result = describeRetry(input);
  assert.equal(result, "a retry at 10s per rule covered 100 file(s) and recovered 0");
});

test('describes retry with no files and many recovered items', () => {
  const input = { timeoutSec: 1, files: [], recovered: Array.from({ length: 50 }, (_, i) => `r${i}`) };
  const result = describeRetry(input);
  assert.equal(result, "a retry at 1s per rule covered 0 file(s) and recovered 50");
});

test('throws TypeError when retry is null', () => {
  assert.throws(() => describeRetry(null), { name: "TypeError", message: "Cannot read properties of null (reading 'timeoutSec')" });
});

test('throws TypeError when retry is undefined', () => {
  assert.throws(() => describeRetry(undefined), { name: "TypeError", message: "Cannot read properties of undefined (reading 'timeoutSec')" });
});
