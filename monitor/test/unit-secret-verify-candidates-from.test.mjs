// Extracts secret candidates from a report (monitor/secret-verify.mjs candidatesFrom).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidatesFrom } from '../secret-verify.mjs';

test('returns empty array when report is null', () => {
  assert.deepEqual(candidatesFrom(null), []);
});

test('returns empty array when report is undefined', () => {
  assert.deepEqual(candidatesFrom(undefined), []);
});

test('returns empty array when report is empty object', () => {
  assert.deepEqual(candidatesFrom({}), []);
});

test('returns empty array when report has empty findings array', () => {
  assert.deepEqual(candidatesFrom({ findings: [] }), []);
});

test('returns empty array when finding has empty secret', () => {
  assert.deepEqual(candidatesFrom([{ Secret: '', RuleID: 'r1', File: 'f1', StartLine: 1 }]), []);
});

test('returns empty array when finding has REDACTED secret', () => {
  assert.deepEqual(candidatesFrom([{ Secret: 'REDACTED', RuleID: 'r1', File: 'f1', StartLine: 1 }]), []);
});

test('returns empty array when finding has non-string secret', () => {
  assert.deepEqual(candidatesFrom([{ Secret: 123, RuleID: 'r1', File: 'f1', StartLine: 1 }]), []);
});

test('returns empty array when finding is null', () => {
  assert.deepEqual(candidatesFrom([null]), []);
});

test('returns mapped candidate for valid finding', () => {
  assert.deepEqual(candidatesFrom([{ Secret: 'abc123', RuleID: 'rule1', File: 'test.js', StartLine: 42 }]), [{ secret: "abc123", rule: "rule1", file: "test.js", line: 42 }]);
});

test('returns empty array when report is empty array', () => {
  assert.deepEqual(candidatesFrom([]), []);
});
