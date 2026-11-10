// Expands output patterns to matching file names in a directory (bin/lib/lane-reuse.mjs expandOutputs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandOutputs } from '../lib/lane-reuse.mjs';
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty array when directory does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'expandOutputs-'));
  try {
    const missing = join(dir, 'no-such-dir');
    assert.deepEqual(expandOutputs(['a.log'], missing), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty array when no patterns match', () => {
  const dir = mkdtempSync(join(tmpdir(), 'expandOutputs-'));
  try {
    writeFileSync(join(dir, 'real.log'), 'x');
    assert.deepEqual(expandOutputs(['missing.log'], dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns exact name when pattern has no star and file exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'expandOutputs-'));
  try {
    writeFileSync(join(dir, 'exact.log'), 'x');
    assert.deepEqual(expandOutputs(['exact.log'], dir), ["exact.log"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty array when pattern has no star and file is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'expandOutputs-'));
  try {
    writeFileSync(join(dir, 'other.log'), 'x');
    assert.deepEqual(expandOutputs(['absent.log'], dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('expands star pattern to all matching files sorted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'expandOutputs-'));
  try {
    writeFileSync(join(dir, 'joern-b.log'), 'x');
    writeFileSync(join(dir, 'joern-a.log'), 'x');
    writeFileSync(join(dir, 'joern-c.log'), 'x');
    writeFileSync(join(dir, 'other.log'), 'x');
    assert.deepEqual(expandOutputs(['joern-*.log'], dir), ["joern-a.log", "joern-b.log", "joern-c.log"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deduplicates when same file matches multiple patterns', () => {
  const dir = mkdtempSync(join(tmpdir(), 'expandOutputs-'));
  try {
    writeFileSync(join(dir, 'joern-a.log'), 'x');
    writeFileSync(join(dir, 'joern-b.log'), 'x');
    assert.deepEqual(expandOutputs(['joern-*.log', 'joern-a.log'], dir), ["joern-a.log", "joern-b.log"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty array when star pattern matches nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'expandOutputs-'));
  try {
    writeFileSync(join(dir, 'unrelated.txt'), 'x');
    assert.deepEqual(expandOutputs(['joern-*.log'], dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles multiple patterns with mixed star and exact', () => {
  const dir = mkdtempSync(join(tmpdir(), 'expandOutputs-'));
  try {
    writeFileSync(join(dir, 'a.log'), 'x');
    writeFileSync(join(dir, 'b.log'), 'x');
    writeFileSync(join(dir, 'c.log'), 'x');
    writeFileSync(join(dir, 'd.log'), 'x');
    assert.deepEqual(expandOutputs(['a.log', 'b*.log', 'zzz.log'], dir), ["a.log", "b.log"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
