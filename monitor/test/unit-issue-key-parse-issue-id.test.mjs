// extracts org, class and suffix from an ISS-style identifier (monitor/issue-key.mjs parseIssueId).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIssueId } from '../issue-key.mjs';

test('parses a fully valid identifier', () => {
  const r = parseIssueId('ISS-ORG1-S-ABCDEF');
  assert.deepEqual(r, { org: "ORG1", cls: "S", suffix: "ABCDEF" });
});

test('returns null for a string that does not match the pattern', () => {
  const r = parseIssueId('invalid-format');
  assert.equal(r, null);
});

test('matches when the org part is a single character (tests {1,12} lower bound)', () => {
  const r = parseIssueId('ISS-A-S-ABCDEF');
  assert.deepEqual(r, { org: "A", cls: "S", suffix: "ABCDEF" });
});

test('matches when the org part contains a digit 2 (tests original charset vs [A-Z0-10])', () => {
  const r = parseIssueId('ISS-2A-S-ABCDEF');
  assert.deepEqual(r, { org: "2A", cls: "S", suffix: "ABCDEF" });
});

test('matches when the suffix contains a zero (tests original charset vs [1-9A-Z])', () => {
  const r = parseIssueId('ISS-ORG1-S-0BCDEF');
  assert.deepEqual(r, { org: "ORG1", cls: "S", suffix: "0BCDEF" });
});

test('returns null when the suffix is seven characters long (tests length 6 vs 7)', () => {
  const r = parseIssueId('ISS-ORG1-S-ABCDEFG');
  assert.equal(r, null);
});

test('returns null for a falsy id (undefined)', () => {
  const r = parseIssueId(undefined);
  assert.equal(r, null);
});

test('returns null for a non\u2011string id that becomes a non\u2011matching string', () => {
  const r = parseIssueId(12345);
  assert.equal(r, null);
});
