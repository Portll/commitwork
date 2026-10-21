// Finds the path of the newest digest-*.json file under the reports digest directory (bin/digest-deliver.mjs newestDigest).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newestDigest, Refused } from '../digest-deliver.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns the lexicographically last digest file when multiple exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'newestDigest-'));
  try {
    const digestDir = join(dir, 'reports', 'digest');
    mkdirSync(digestDir, { recursive: true });
    writeFileSync(join(digestDir, 'digest-20240101T000000Z.json'), '{}');
    writeFileSync(join(digestDir, 'digest-20240102T000000Z.json'), '{}');
    writeFileSync(join(digestDir, 'digest-20240103T000000Z.json'), '{}');
    const result = newestDigest(dir);
    assert.equal(result, join(digestDir, 'digest-20240103T000000Z.json'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the only digest file when exactly one exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'newestDigest-'));
  try {
    const digestDir = join(dir, 'reports', 'digest');
    mkdirSync(digestDir, { recursive: true });
    writeFileSync(join(digestDir, 'digest-20240101T123456Z.json'), '{}');
    const result = newestDigest(dir);
    assert.equal(result, join(digestDir, 'digest-20240101T123456Z.json'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores files that do not match the digest filename pattern', () => {
  const dir = mkdtempSync(join(tmpdir(), 'newestDigest-'));
  try {
    const digestDir = join(dir, 'reports', 'digest');
    mkdirSync(digestDir, { recursive: true });
    writeFileSync(join(digestDir, 'readme.txt'), 'hello');
    writeFileSync(join(digestDir, 'digest-20240101T000000Z.json'), '{}');
    writeFileSync(join(digestDir, 'digest-20240101T000000Z.txt'), '{}');
    writeFileSync(join(digestDir, 'digest-20240101T000000.json'), '{}');
    const result = newestDigest(dir);
    assert.equal(result, join(digestDir, 'digest-20240101T000000Z.json'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws Refused when the digest directory does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'newestDigest-'));
  try {
    assert.throws(() => newestDigest(dir), (err) => {
      return err instanceof Refused && err.message.includes('no digest written');
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws Refused when the digest directory exists but contains no matching files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'newestDigest-'));
  try {
    const digestDir = join(dir, 'reports', 'digest');
    mkdirSync(digestDir, { recursive: true });
    writeFileSync(join(digestDir, 'other.txt'), 'data');
    assert.throws(() => newestDigest(dir), (err) => {
      return err instanceof Refused && err.message.includes('no digest-*.json');
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws Refused when the digest path is a file instead of a directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'newestDigest-'));
  try {
    const reportsDir = join(dir, 'reports');
    mkdirSync(reportsDir, { recursive: true });
    writeFileSync(join(reportsDir, 'digest'), 'not a dir');
    assert.throws(() => newestDigest(dir), (err) => {
      return err instanceof Refused && err.message.includes('unreadable');
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('selects the newest file when timestamps differ in the time portion', () => {
  const dir = mkdtempSync(join(tmpdir(), 'newestDigest-'));
  try {
    const digestDir = join(dir, 'reports', 'digest');
    mkdirSync(digestDir, { recursive: true });
    writeFileSync(join(digestDir, 'digest-20240101T000000Z.json'), '{}');
    writeFileSync(join(digestDir, 'digest-20240101T235959Z.json'), '{}');
    const result = newestDigest(dir);
    assert.equal(result, join(digestDir, 'digest-20240101T235959Z.json'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('selects the newest file when dates differ', () => {
  const dir = mkdtempSync(join(tmpdir(), 'newestDigest-'));
  try {
    const digestDir = join(dir, 'reports', 'digest');
    mkdirSync(digestDir, { recursive: true });
    writeFileSync(join(digestDir, 'digest-20240101T000000Z.json'), '{}');
    writeFileSync(join(digestDir, 'digest-20240102T000000Z.json'), '{}');
    const result = newestDigest(dir);
    assert.equal(result, join(digestDir, 'digest-20240102T000000Z.json'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
