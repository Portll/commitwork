// <what describePartial computes, in a few words> (monitor/sarif-read.mjs describePartial)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describePartial } from '../sarif-read.mjs';
import { describeRetry } from '../sarif-read.mjs';

test('returns a string with file count, reasons, and named files when show is 0', () => {
  const rows = [
    { uri: 'a.txt', reasons: ['error1'] },
    { uri: 'b.txt', reasons: ['error2'] },
  ];
  const result = describePartial(rows, null, { show: 0 });
  assert.deepEqual(result, "2 file(s) were read only in part (1 error1, 1 error2), so this count is silent about them rather than clean");
});

test('returns a string with file count, reasons, and named files when show is positive', () => {
  const rows = [
    { uri: 'a.txt', reasons: ['error1'] },
    { uri: 'b.txt', reasons: ['error2'] },
  ];
  const result = describePartial(rows, null, { show: 1 });
  assert.deepEqual(result, "2 file(s) were read only in part (1 error1, 1 error2), so this count is silent about them rather than clean \u2014 a.txt, +1 more");
});

test('returns a string with retry info when retry is provided', () => {
  const rows = [{ uri: 'a.txt', reasons: ['error1'] }];
  const retry = { timeoutSec: 5, files: ['a.txt'], recovered: ['a.txt'] };
  const result = describePartial(rows, retry, { show: 0 });
  assert.deepEqual(result, "1 file(s) were read only in part (1 error1), so this count is silent about them rather than clean; a retry at 5s per rule covered 1 file(s) and recovered 1");
});

test('returns a string without retry info when retry is null', () => {
  const rows = [{ uri: 'a.txt', reasons: ['error1'] }];
  const result = describePartial(rows, null, { show: 0 });
  assert.deepEqual(result, "1 file(s) were read only in part (1 error1), so this count is silent about them rather than clean");
});

test('handles empty rows array', () => {
  const rows = [];
  const result = describePartial(rows, null, { show: 0 });
  assert.deepEqual(result, "0 file(s) were read only in part (), so this count is silent about them rather than clean");
});

test('handles rows with multiple reasons per file', () => {
  const rows = [
    { uri: 'a.txt', reasons: ['error1', 'error2'] },
    { uri: 'b.txt', reasons: ['error1'] },
  ];
  const result = describePartial(rows, null, { show: 0 });
  assert.deepEqual(result, "2 file(s) were read only in part (2 error1, 1 error2), so this count is silent about them rather than clean");
});

test('handles rows with show exceeding row count', () => {
  const rows = [
    { uri: 'a.txt', reasons: ['error1'] },
  ];
  const result = describePartial(rows, null, { show: 5 });
  assert.deepEqual(result, "1 file(s) were read only in part (1 error1), so this count is silent about them rather than clean \u2014 a.txt");
});

test('handles rows with show exactly equal to row count', () => {
  const rows = [
    { uri: 'a.txt', reasons: ['error1'] },
    { uri: 'b.txt', reasons: ['error2'] },
  ];
  const result = describePartial(rows, null, { show: 2 });
  assert.deepEqual(result, "2 file(s) were read only in part (1 error1, 1 error2), so this count is silent about them rather than clean \u2014 a.txt, b.txt");
});
