// Reads and parses the disregarded-warnings register file (monitor/disregarded-warnings.mjs readRegister).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRegister } from '../disregarded-warnings.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns absent true and empty arrays when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readRegister-'));
  try {
    const result = readRegister(join(dir, 'missing.json'));
    assert.deepEqual(result, { ok: true, records: [], returns: [], absent: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok false with unreadable error when file read fails with non-ENOENT code', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readRegister-'));
  try {
    const path = join(dir, 'register.json');
    writeFileSync(path, 'content');
    unlinkSync(path);
    mkdirSync(path);
    const result = readRegister(path);
    assert.equal(result.ok, false);
    assert.match(result.error, /^register unreadable \(/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok false with unparseable error when file contains invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readRegister-'));
  try {
    const path = join(dir, 'register.json');
    writeFileSync(path, '{ invalid json');
    const result = readRegister(path);
    assert.equal(result.ok, false);
    assert.match(result.error, /^register unparseable \(/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok false when parsed doc is null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readRegister-'));
  try {
    const path = join(dir, 'register.json');
    writeFileSync(path, 'null');
    const result = readRegister(path);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'register has no disregarded[] array');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok false when parsed doc is not an object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readRegister-'));
  try {
    const path = join(dir, 'register.json');
    writeFileSync(path, '42');
    const result = readRegister(path);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'register has no disregarded[] array');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok false when disregarded property is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readRegister-'));
  try {
    const path = join(dir, 'register.json');
    writeFileSync(path, JSON.stringify({ returned: [] }));
    const result = readRegister(path);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'register has no disregarded[] array');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok false when disregarded property is not an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readRegister-'));
  try {
    const path = join(dir, 'register.json');
    writeFileSync(path, JSON.stringify({ disregarded: 'not-an-array' }));
    const result = readRegister(path);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'register has no disregarded[] array');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok false when returned property is present but not an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readRegister-'));
  try {
    const path = join(dir, 'register.json');
    writeFileSync(path, JSON.stringify({ disregarded: [], returned: 'oops' }));
    const result = readRegister(path);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'register returned is not an array');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok true with records and returns when both arrays are present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readRegister-'));
  try {
    const path = join(dir, 'register.json');
    const doc = { disregarded: [{ id: 1 }], returned: [{ id: 2 }] };
    writeFileSync(path, JSON.stringify(doc));
    const result = readRegister(path);
    assert.equal(result.ok, true);
    assert.deepEqual(result.records, [{ id: 1 }]);
    assert.deepEqual(result.returns, [{ id: 2 }]);
    assert.equal(result.absent, false);
    assert.deepEqual(result.doc, doc);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok true with empty returns when returned property is undefined', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readRegister-'));
  try {
    const path = join(dir, 'register.json');
    const doc = { disregarded: [{ id: 3 }] };
    writeFileSync(path, JSON.stringify(doc));
    const result = readRegister(path);
    assert.equal(result.ok, true);
    assert.deepEqual(result.records, [{ id: 3 }]);
    assert.deepEqual(result.returns, []);
    assert.equal(result.absent, false);
    assert.deepEqual(result.doc, doc);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
