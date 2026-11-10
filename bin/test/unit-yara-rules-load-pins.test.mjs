// Loads pins JSON file and validates its structure (bin/yara-rules.mjs loadPins).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPins } from '../yara-rules.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('returns the parsed document for a valid pins file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadPins-'));
  try {
    const path = join(dir, 'pins.json');
    const doc = {
      sets: {
        myset: {
          commit: 'a'.repeat(40),
          files: { 'foo/bar.txt': 'b'.repeat(64) }
        }
      }
    };
    writeFileSync(path, JSON.stringify(doc), 'utf8');
    const result = loadPins(path);
    assert.deepStrictEqual(result, doc);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the JSON does not contain a "sets" object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadPins-'));
  try {
    const path = join(dir, 'pins.json');
    writeFileSync(path, JSON.stringify({}), 'utf8');
    assert.throws(() => loadPins(path), {
      name: 'Error',
      message: `${path}: no "sets" object`
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when a set has a missing or invalid 40-hex commit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadPins-'));
  try {
    const path = join(dir, 'pins.json');
    const doc = {
      sets: {
        badcommit: {
          files: {}
        }
      }
    };
    writeFileSync(path, JSON.stringify(doc), 'utf8');
    assert.throws(() => loadPins(path), {
      name: 'Error',
      message: `${path}: set badcommit has no 40-hex commit`
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when a file path is unsafe because it contains ".."', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadPins-'));
  try {
    const path = join(dir, 'pins.json');
    const doc = {
      sets: {
        unsafe: {
          commit: 'c'.repeat(40),
          files: { 'bad/../evil.txt': 'd'.repeat(64) }
        }
      }
    };
    writeFileSync(path, JSON.stringify(doc), 'utf8');
    assert.throws(() => loadPins(path), {
      name: 'Error',
      message: `${path}: set unsafe names an unsafe path bad/../evil.txt`
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when a file sha is not a 64-hex string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadPins-'));
  try {
    const path = join(dir, 'pins.json');
    const doc = {
      sets: {
        badsha: {
          commit: 'e'.repeat(40),
          files: { 'good.txt': 'deadbeef' }
        }
      }
    };
    writeFileSync(path, JSON.stringify(doc), 'utf8');
    assert.throws(() => loadPins(path), {
      name: 'Error',
      message: `${path}: set badsha file good.txt has no sha256`
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('accepts a safe relative path with allowed characters', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadPins-'));
  try {
    const path = join(dir, 'pins.json');
    const doc = {
      sets: {
        safe: {
          commit: 'f'.repeat(40),
          files: { 'valid_path-123/another.file': '1'.repeat(64) }
        }
      }
    };
    writeFileSync(path, JSON.stringify(doc), 'utf8');
    const result = loadPins(path);
    assert.deepStrictEqual(result, doc);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
