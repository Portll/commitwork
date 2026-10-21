// Writes a JSON record atomically to the given path (monitor/envelope-witness.mjs writeWitness).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeWitness } from '../envelope-witness.mjs';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('writes a simple record to a new file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeWitness-'));
  try {
    const path = join(dir, 'witness.json');
    const record = { id: 'abc123', status: 'ok' };
    writeWitness(path, record);
    const content = readFileSync(path, 'utf8');
    assert.equal(content, JSON.stringify(record, null, 2) + '\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('creates nested directories when the path includes them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeWitness-'));
  try {
    const path = join(dir, 'a', 'b', 'c', 'witness.json');
    const record = { nested: true };
    writeWitness(path, record);
    assert.ok(existsSync(path));
    const content = readFileSync(path, 'utf8');
    assert.equal(content, JSON.stringify(record, null, 2) + '\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('overwrites an existing file with the new record', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeWitness-'));
  try {
    const path = join(dir, 'witness.json');
    const record1 = { version: 1 };
    writeWitness(path, record1);
    const record2 = { version: 2 };
    writeWitness(path, record2);
    const content = readFileSync(path, 'utf8');
    assert.equal(content, JSON.stringify(record2, null, 2) + '\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('serializes an empty object record', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeWitness-'));
  try {
    const path = join(dir, 'witness.json');
    const record = {};
    writeWitness(path, record);
    const content = readFileSync(path, 'utf8');
    assert.equal(content, '{}\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('serializes a record with array values', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeWitness-'));
  try {
    const path = join(dir, 'witness.json');
    const record = { items: [1, 2, 3], name: 'test' };
    writeWitness(path, record);
    const content = readFileSync(path, 'utf8');
    assert.equal(content, JSON.stringify(record, null, 2) + '\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('serializes a record with null values', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeWitness-'));
  try {
    const path = join(dir, 'witness.json');
    const record = { a: null, b: 'value' };
    writeWitness(path, record);
    const content = readFileSync(path, 'utf8');
    assert.equal(content, JSON.stringify(record, null, 2) + '\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('serializes a record with boolean values', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeWitness-'));
  try {
    const path = join(dir, 'witness.json');
    const record = { flag: true, other: false };
    writeWitness(path, record);
    const content = readFileSync(path, 'utf8');
    assert.equal(content, JSON.stringify(record, null, 2) + '\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('serializes a record with numeric values', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeWitness-'));
  try {
    const path = join(dir, 'witness.json');
    const record = { count: 42, ratio: 0.5 };
    writeWitness(path, record);
    const content = readFileSync(path, 'utf8');
    assert.equal(content, JSON.stringify(record, null, 2) + '\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
