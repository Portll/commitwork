// Reads and validates .lane-history.json into a normalized commit list (bin/lane-fixture.mjs readHistory).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHistory } from '../lane-fixture.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty array when history file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readHistory-'));
  try {
    assert.deepEqual(readHistory(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns normalized commit with author and committer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readHistory-'));
  try {
    const doc = { commits: [{ message: 'fix bug', date: '2024-01-01T00:00:00Z', files: { 'a.txt': 'hello' }, author: { name: 'Alice', email: 'a@x.com' }, committer: { name: 'Bob', email: 'b@x.com' } }] };
    writeFileSync(join(dir, '.lane-history.json'), JSON.stringify(doc));
    assert.deepEqual(readHistory(dir), [{ message: "fix bug", date: "2024-01-01T00:00:00Z", files: { "a.txt": "hello" }, author: { name: "Alice", email: "a@x.com" }, committer: { name: "Bob", email: "b@x.com" } }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when author is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readHistory-'));
  try {
    const doc = { commits: [{ message: 'fix', date: '2024-01-01T00:00:00Z', files: {}, author: null }] };
    writeFileSync(join(dir, '.lane-history.json'), JSON.stringify(doc));
    assert.throws(() => readHistory(dir), { name: 'Error', message: '.lane-history.json: commit #1 author needs a name and an email' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when author name is empty string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readHistory-'));
  try {
    const doc = { commits: [{ message: 'fix', date: '2024-01-01T00:00:00Z', files: {}, author: { name: '', email: 'a@x.com' } }] };
    writeFileSync(join(dir, '.lane-history.json'), JSON.stringify(doc));
    assert.throws(() => readHistory(dir), { name: 'Error', message: '.lane-history.json: commit #1 author needs a name and an email' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when commits array is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readHistory-'));
  try {
    const doc = { commits: [] };
    writeFileSync(join(dir, '.lane-history.json'), JSON.stringify(doc));
    assert.throws(() => readHistory(dir), { name: 'Error', message: '.lane-history.json: expected {commits:[...]} with at least one commit' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when message is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readHistory-'));
  try {
    const doc = { commits: [{ message: '', date: '2024-01-01T00:00:00Z', files: {}, author: { name: 'A', email: 'a@x.com' } }] };
    writeFileSync(join(dir, '.lane-history.json'), JSON.stringify(doc));
    assert.throws(() => readHistory(dir), { name: 'Error', message: '.lane-history.json: commit #1 needs a message' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when date is invalid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readHistory-'));
  try {
    const doc = { commits: [{ message: 'fix', date: 'not-a-date', files: {}, author: { name: 'A', email: 'a@x.com' } }] };
    writeFileSync(join(dir, '.lane-history.json'), JSON.stringify(doc));
    assert.throws(() => readHistory(dir), { name: 'Error', message: '.lane-history.json: commit #1 needs an ISO date' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when file path escapes repository', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readHistory-'));
  try {
    const doc = { commits: [{ message: 'fix', date: '2024-01-01T00:00:00Z', files: { '../evil.txt': 'x' }, author: { name: 'A', email: 'a@x.com' } }] };
    writeFileSync(join(dir, '.lane-history.json'), JSON.stringify(doc));
    assert.throws(() => readHistory(dir), { name: 'Error', message: '.lane-history.json: commit #1 path ../evil.txt leaves the repository' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when file value is not a string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readHistory-'));
  try {
    const doc = { commits: [{ message: 'fix', date: '2024-01-01T00:00:00Z', files: { 'a.txt': 42 }, author: { name: 'A', email: 'a@x.com' } }] };
    writeFileSync(join(dir, '.lane-history.json'), JSON.stringify(doc));
    assert.throws(() => readHistory(dir), { name: 'Error', message: '.lane-history.json: commit #1 files must map paths to text' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses author as committer when committer is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readHistory-'));
  try {
    const doc = { commits: [{ message: 'feat', date: '2024-06-15T12:00:00Z', files: { 'src/main.js': 'code' }, author: { name: 'Carol', email: 'c@x.com' } }] };
    writeFileSync(join(dir, '.lane-history.json'), JSON.stringify(doc));
    assert.deepEqual(readHistory(dir), [{ message: "feat", date: "2024-06-15T12:00:00Z", files: { "src/main.js": "code" }, author: { name: "Carol", email: "c@x.com" }, committer: { name: "Carol", email: "c@x.com" } }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
