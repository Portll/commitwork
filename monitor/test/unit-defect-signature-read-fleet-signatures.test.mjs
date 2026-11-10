// Parses a JSON file at a path, returning null only when the file is missing (monitor/defect-signature.mjs readFleetSignatures).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFleetSignatures } from '../defect-signature.mjs';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns the parsed object when the file contains valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readFleetSignatures-'));
  try {
    const p = join(dir, 'fleet.json');
    writeFileSync(p, JSON.stringify({ fleet: [1, 2, 3] }));
    assert.deepEqual(readFleetSignatures(p), { fleet: [1, 2, 3] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readFleetSignatures-'));
  try {
    assert.equal(readFleetSignatures(join(dir, 'missing.json')), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when a parent directory of the path does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readFleetSignatures-'));
  try {
    assert.equal(readFleetSignatures(join(dir, 'nope', 'fleet.json')), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rethrows the EISDIR error when the path is a directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readFleetSignatures-'));
  try {
    const sub = join(dir, 'subdir');
    mkdirSync(sub);
    assert.throws(() => readFleetSignatures(sub), { name: 'Error', code: 'EISDIR' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rethrows the ENOTDIR error when a path component is a regular file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readFleetSignatures-'));
  try {
    const f = join(dir, 'plain.json');
    writeFileSync(f, '{}');
    assert.throws(() => readFleetSignatures(join(f, 'inner.json')), { name: 'Error', code: 'ENOTDIR' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rethrows the SyntaxError when the file contains invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readFleetSignatures-'));
  try {
    const p = join(dir, 'bad.json');
    writeFileSync(p, '{ not valid json');
    assert.throws(() => readFleetSignatures(p), {
      name: 'SyntaxError',
      message: "Expected property name or '}' in JSON at position 2 (line 1 column 3)",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rethrows the SyntaxError when the file is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readFleetSignatures-'));
  try {
    const p = join(dir, 'empty.json');
    writeFileSync(p, '');
    assert.throws(() => readFleetSignatures(p), {
      name: 'SyntaxError',
      message: 'Unexpected end of JSON input',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the file contains a JSON null literal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readFleetSignatures-'));
  try {
    const p = join(dir, 'null.json');
    writeFileSync(p, 'null');
    assert.equal(readFleetSignatures(p), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the parsed array when the file contains a JSON array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readFleetSignatures-'));
  try {
    const p = join(dir, 'arr.json');
    writeFileSync(p, JSON.stringify(['a', 'b']));
    assert.deepEqual(readFleetSignatures(p), ['a', 'b']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
