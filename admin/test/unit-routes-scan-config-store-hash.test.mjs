// Computes a 16-char hex prefix of the SHA-256 of a config file (admin/routes/scan-config.mjs storeHash).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storeHash } from '../routes/scan-config.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

test('returns 16-char hex prefix of sha256 for existing file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storeHash-'));
  try {
    const file = join(dir, 'config.json');
    const content = '{"key":"value"}';
    writeFileSync(file, content, 'utf8');
    const expected = createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16);
    assert.equal(storeHash({ path: file }), expected);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns absent when file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storeHash-'));
  try {
    const file = join(dir, 'missing.json');
    assert.equal(storeHash({ path: file }), 'absent');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns 16-char hex prefix for empty file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storeHash-'));
  try {
    const file = join(dir, 'empty.json');
    writeFileSync(file, '', 'utf8');
    const expected = createHash('sha256').update('', 'utf8').digest('hex').slice(0, 16);
    assert.equal(storeHash({ path: file }), expected);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns 16-char hex prefix for file with repeated content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storeHash-'));
  try {
    const file = join(dir, 'repeated.json');
    const content = 'x'.repeat(100);
    writeFileSync(file, content, 'utf8');
    const expected = createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16);
    assert.equal(storeHash({ path: file }), expected);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns 16-char hex prefix for file with unicode content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storeHash-'));
  try {
    const file = join(dir, 'unicode.json');
    const content = 'h\u00e9llo w\u00f6rld';
    writeFileSync(file, content, 'utf8');
    const expected = createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16);
    assert.equal(storeHash({ path: file }), expected);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns 16-char hex prefix for file with binary-like content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storeHash-'));
  try {
    const file = join(dir, 'binary.json');
    const content = Buffer.from(Array.from({ length: 50 }, (_, i) => i % 256)).toString('utf8');
    writeFileSync(file, content, 'utf8');
    const expected = createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16);
    assert.equal(storeHash({ path: file }), expected);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns 16-char hex prefix for file with newline content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storeHash-'));
  try {
    const file = join(dir, 'newlines.json');
    const content = 'line1\nline2\nline3\n';
    writeFileSync(file, content, 'utf8');
    const expected = createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16);
    assert.equal(storeHash({ path: file }), expected);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns 16-char hex prefix for file with special characters', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storeHash-'));
  try {
    const file = join(dir, 'special.json');
    const content = 'a"b\\c\td\ne';
    writeFileSync(file, content, 'utf8');
    const expected = createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16);
    assert.equal(storeHash({ path: file }), expected);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
