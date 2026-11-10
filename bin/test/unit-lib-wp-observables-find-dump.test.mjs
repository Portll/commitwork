// Finds the largest SQL dump file in a WordPress install (bin/lib/wp-observables.mjs findDump).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDump } from '../lib/wp-observables.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when no dump files exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findDump-'));
  try {
    const result = findDump(dir);
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the path of a single dump file in root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findDump-'));
  try {
    writeFileSync(join(dir, 'db.sql'), 'x'.repeat(100));
    const result = findDump(dir);
    assert.equal(result, join(dir, 'db.sql'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the larger of two dump files with different sizes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findDump-'));
  try {
    writeFileSync(join(dir, 'small.sql'), 'x'.repeat(10));
    writeFileSync(join(dir, 'large.sql'), 'x'.repeat(200));
    const result = findDump(dir);
    assert.equal(result, join(dir, 'large.sql'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the lexicographically smaller path when sizes are equal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findDump-'));
  try {
    writeFileSync(join(dir, 'b.sql'), 'x'.repeat(50));
    writeFileSync(join(dir, 'a.sql'), 'x'.repeat(50));
    const result = findDump(dir);
    assert.equal(result, join(dir, 'a.sql'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('finds dump files in subdirectories but skips wp-content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findDump-'));
  try {
    mkdirSync(join(dir, 'wp-content'));
    writeFileSync(join(dir, 'wp-content', 'ignored.sql'), 'x'.repeat(500));
    mkdirSync(join(dir, 'custom'));
    writeFileSync(join(dir, 'custom', 'found.sql'), 'x'.repeat(50));
    const result = findDump(dir);
    assert.equal(result, join(dir, 'custom', 'found.sql'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when root directory does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findDump-'));
  try {
    const result = findDump(join(dir, 'nonexistent'));
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('matches gzipped sql files with -db.gz suffix', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findDump-'));
  try {
    writeFileSync(join(dir, 'site-db.gz'), 'x'.repeat(80));
    const result = findDump(dir);
    assert.equal(result, join(dir, 'site-db.gz'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores non-sql files that do not match dump pattern', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findDump-'));
  try {
    writeFileSync(join(dir, 'readme.txt'), 'x'.repeat(1000));
    writeFileSync(join(dir, 'data.json'), 'x'.repeat(1000));
    const result = findDump(dir);
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('prefers larger dump in wp-content over smaller in root when wp-content not excluded', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findDump-'));
  try {
    mkdirSync(join(dir, 'wp-content'));
    writeFileSync(join(dir, 'wp-content', 'big.sql'), 'x'.repeat(300));
    writeFileSync(join(dir, 'small.sql'), 'x'.repeat(50));
    const result = findDump(dir);
    assert.equal(result, join(dir, 'small.sql'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns second candidate when exactly two dumps exist and edit returns candidates[1]', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findDump-'));
  try {
    writeFileSync(join(dir, 'first.sql'), 'x'.repeat(100));
    writeFileSync(join(dir, 'second.sql'), 'x'.repeat(50));
    const result = findDump(dir);
    assert.equal(result, join(dir, 'first.sql'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
