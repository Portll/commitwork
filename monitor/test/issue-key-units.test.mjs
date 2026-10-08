// monitor/test/issue-key-units.test.mjs — case tests for classForQueueEntry, parseIssueId.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classForQueueEntry, parseIssueId } from '../issue-key.mjs';

test('declared valid class returns it with null why', () => {
  const r = classForQueueEntry({ class: 'S' });
  assert.deepEqual(r, { cls: 'S', why: null });
});

test('declared invalid class returns null cls with descriptive why', () => {
  const r = classForQueueEntry({ class: 'X' });
  assert.equal(r.cls, null);
  assert.match(r.why, /'X'/);
});

test('declared class takes precedence over kind', () => {
  const r = classForQueueEntry({ class: 'D', kind: 'missing-feature' });
  assert.deepEqual(r, { cls: 'D', why: null });
});

test('valid kind with no class maps to F', () => {
  const r = classForQueueEntry({ kind: 'missing-feature' });
  assert.deepEqual(r, { cls: 'F', why: null });
});

test('unknown kind with no class returns null cls', () => {
  const r = classForQueueEntry({ kind: 'other' });
  assert.equal(r.cls, null);
  assert.match(r.why, /'other'/);
});

test('no class and no kind returns null cls with (none) in why', () => {
  const r = classForQueueEntry({});
  assert.equal(r.cls, null);
  assert.match(r.why, /'\(none\)'/);
});

test('null entry returns null cls with (none) in why', () => {
  const r = classForQueueEntry(null);
  assert.equal(r.cls, null);
  assert.match(r.why, /'\(none\)'/);
});

test('non-string kind with no class returns null cls', () => {
  const r = classForQueueEntry({ kind: 42 });
  assert.equal(r.cls, null);
  assert.match(r.why, /'42'/);
});

test('parses a valid scoped issue id', () => {
  const result = parseIssueId('ISS-PORTLL-S-000000');
  assert.deepEqual(result, { org: 'PORTLL', cls: 'S', suffix: '000000' });
});

test('parses a scoped id with mixed-case suffix', () => {
  const result = parseIssueId('ISS-ABC-F-AB12CD');
  assert.deepEqual(result, { org: 'ABC', cls: 'F', suffix: 'AB12CD' });
});

test('returns null for legacy flat format', () => {
  const result = parseIssueId('ISS-000000');
  assert.equal(result, null);
});

test('returns null for invalid prefix', () => {
  const result = parseIssueId('XYZ-PORTLL-S-000000');
  assert.equal(result, null);
});

test('returns null for invalid class character', () => {
  const result = parseIssueId('ISS-PORTLL-X-000000');
  assert.equal(result, null);
});

test('returns null for suffix with lowercase letters', () => {
  const result = parseIssueId('ISS-PORTLL-S-abc123');
  assert.equal(result, null);
});

test('returns null for empty string', () => {
  const result = parseIssueId('');
  assert.equal(result, null);
});

test('returns null for null input', () => {
  const result = parseIssueId(null);
  assert.equal(result, null);
});
