// Parses raw git log text into structured commit records (bin/commit-provenance.mjs parseLog).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLog } from '../commit-provenance.mjs';

const F = '\x1f';
const R = '\x1e';

test('returns empty array for empty input', () => {
  assert.deepEqual(parseLog(''), []);
});

test('skips records that are only whitespace', () => {
  assert.deepEqual(parseLog('   ' + R + '  '), []);
});

test('skips records with fewer than seven fields', () => {
  assert.deepEqual(parseLog('a' + F + 'b' + F + 'c' + F + 'd' + F + 'e' + F + 'f'), []);
});

test('parses a record with exactly seven fields and empty parents', () => {
  const rec = 'sha1' + F + 'Alice' + F + 'a@x' + F + 'Bob' + F + 'b@x' + F + '' + F + 'fix bug';
  assert.deepEqual(parseLog(rec), [{ sha: "sha1", authorName: "Alice", authorEmail: "a@x", committerName: "Bob", committerEmail: "b@x", parents: [], subject: "fix bug", body: "" }]);
});

test('parses a record with multiple parents and a body', () => {
  const rec = 'sha2' + F + 'Carol' + F + 'c@x' + F + 'Dave' + F + 'd@x' + F + 'p1 p2' + F + 'merge' + F + 'line1' + F + 'line2';
  assert.deepEqual(parseLog(rec), [{ sha: "sha2", authorName: "Carol", authorEmail: "c@x", committerName: "Dave", committerEmail: "d@x", parents: ["p1", "p2"], subject: "merge", body: "line1\u001fline2" }]);
});

test('parses a record with a leading newline before the first field', () => {
  const rec = '\nsha3' + F + 'Eve' + F + 'e@x' + F + 'Frank' + F + 'f@x' + F + '  ' + F + 'subject3';
  assert.deepEqual(parseLog(rec), [{ sha: "sha3", authorName: "Eve", authorEmail: "e@x", committerName: "Frank", committerEmail: "f@x", parents: [], subject: "subject3", body: "" }]);
});

test('parses multiple records separated by record separator', () => {
  const r1 = 's1' + F + 'n1' + F + 'e1' + F + 'cn1' + F + 'ce1' + F + 'pp' + F + 'sub1';
  const r2 = 's2' + F + 'n2' + F + 'e2' + F + 'cn2' + F + 'ce2' + F + '' + F + 'sub2';
  assert.deepEqual(parseLog(r1 + R + r2), [{ sha: "s1", authorName: "n1", authorEmail: "e1", committerName: "cn1", committerEmail: "ce1", parents: ["pp"], subject: "sub1", body: "" }, { sha: "s2", authorName: "n2", authorEmail: "e2", committerName: "cn2", committerEmail: "ce2", parents: [], subject: "sub2", body: "" }]);
});

test('handles a record with exactly seven fields where parents is whitespace only', () => {
  const rec = 's7' + F + 'n7' + F + 'e7' + F + 'cn7' + F + 'ce7' + F + '   ' + F + 'subj7';
  assert.deepEqual(parseLog(rec), [{ sha: "s7", authorName: "n7", authorEmail: "e7", committerName: "cn7", committerEmail: "ce7", parents: [], subject: "subj7", body: "" }]);
});
