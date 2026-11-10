// Annotates files with rewritten commit tokens (bin/cite-reach.mjs annotate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annotate } from '../cite-reach.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty array when rewritten is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'annotate-'));
  try {
    const result = annotate({ dir, rewritten: [] });
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty array when token does not appear in file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'annotate-'));
  try {
    writeFileSync(join(dir, 'a.txt'), 'hello world\n');
    const result = annotate({ dir, rewritten: [{ token: 'abc', now: '2024-01-15T10:00:00Z', files: ['a.txt'] }] });
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('annotates single token occurrence with month prefix', () => {
  const dir = mkdtempSync(join(tmpdir(), 'annotate-'));
  try {
    writeFileSync(join(dir, 'a.txt'), 'abc def\n');
    const result = annotate({ dir, rewritten: [{ token: 'abc', now: '2024-01-15T10:00:00Z', files: ['a.txt'] }] });
    assert.deepEqual(result, [{ file: 'a.txt', count: 1 }]);
    assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), 'abc (rewritten; now 2024-01) def\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('annotates multiple occurrences of same token', () => {
  const dir = mkdtempSync(join(tmpdir(), 'annotate-'));
  try {
    writeFileSync(join(dir, 'a.txt'), 'abc abc abc\n');
    const result = annotate({ dir, rewritten: [{ token: 'abc', now: '2024-02-20T08:30:00Z', files: ['a.txt'] }] });
    assert.deepEqual(result, [{ file: 'a.txt', count: 3 }]);
    assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), 'abc (rewritten; now 2024-02) abc (rewritten; now 2024-02) abc (rewritten; now 2024-02)\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('aggregates multiple rewrites for same file into one edit entry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'annotate-'));
  try {
    writeFileSync(join(dir, 'a.txt'), 'abc def\n');
    const result = annotate({ dir, rewritten: [
      { token: 'abc', now: '2024-01-15T10:00:00Z', files: ['a.txt'] },
      { token: 'def', now: '2024-03-25T12:00:00Z', files: ['a.txt'] }
    ]});
    assert.deepEqual(result, [{ file: 'a.txt', count: 2 }]);
    assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), 'abc (rewritten; now 2024-01) def (rewritten; now 2024-03)\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles multiple files independently', () => {
  const dir = mkdtempSync(join(tmpdir(), 'annotate-'));
  try {
    writeFileSync(join(dir, 'a.txt'), 'abc\n');
    writeFileSync(join(dir, 'b.txt'), 'abc\n');
    const result = annotate({ dir, rewritten: [
      { token: 'abc', now: '2024-05-10T09:00:00Z', files: ['a.txt', 'b.txt'] }
    ]});
    assert.deepEqual(result, [{ file: 'a.txt', count: 1 }, { file: 'b.txt', count: 1 }]);
    assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), 'abc (rewritten; now 2024-05)\n');
    assert.equal(readFileSync(join(dir, 'b.txt'), 'utf8'), 'abc (rewritten; now 2024-05)\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('does not re-annotate already rewritten tokens', () => {
  const dir = mkdtempSync(join(tmpdir(), 'annotate-'));
  try {
    writeFileSync(join(dir, 'a.txt'), 'abc (rewritten; now 2024-01) abc\n');
    const result = annotate({ dir, rewritten: [{ token: 'abc', now: '2024-06-01T00:00:00Z', files: ['a.txt'] }] });
    assert.deepEqual(result, [{ file: 'a.txt', count: 1 }]);
    assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), 'abc (rewritten; now 2024-01) abc (rewritten; now 2024-06)\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skips file when no changes occur after replacement', () => {
  const dir = mkdtempSync(join(tmpdir(), 'annotate-'));
  try {
    writeFileSync(join(dir, 'a.txt'), 'xyz\n');
    const result = annotate({ dir, rewritten: [{ token: 'abc', now: '2024-01-15T10:00:00Z', files: ['a.txt'] }] });
    assert.deepEqual(result, []);
    assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), 'xyz\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
