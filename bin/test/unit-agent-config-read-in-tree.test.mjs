// Reads a file within a root tree with size and path-safety checks (bin/agent-config.mjs readInTree).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readInTree } from '../agent-config.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'readInTree-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('returns text for a valid file within the tree', () => {
  const { dir, cleanup } = setup();
  try {
    writeFileSync(join(dir, 'a.txt'), 'hello');
    assert.deepEqual(readInTree(dir, 'a.txt', 100), { text: 'hello' });
  } finally { cleanup(); }
});

test('returns invalid-path when rel is empty', () => {
  const { dir, cleanup } = setup();
  try {
    assert.deepEqual(readInTree(dir, '', 100), { reason: 'invalid-path' });
  } finally { cleanup(); }
});

test('returns invalid-path when rel is absolute', () => {
  const { dir, cleanup } = setup();
  try {
    assert.deepEqual(readInTree(dir, '/etc/passwd', 100), { reason: 'invalid-path' });
  } finally { cleanup(); }
});

test('returns invalid-path when rel contains dot-dot segment', () => {
  const { dir, cleanup } = setup();
  try {
    assert.deepEqual(readInTree(dir, '../secret', 100), { reason: 'invalid-path' });
  } finally { cleanup(); }
});

test('returns invalid-path when rel contains null byte', () => {
  const { dir, cleanup } = setup();
  try {
    assert.deepEqual(readInTree(dir, 'a\0b', 100), { reason: 'invalid-path' });
  } finally { cleanup(); }
});

test('returns invalid-path when rel is a Windows drive path', () => {
  const { dir, cleanup } = setup();
  try {
    assert.deepEqual(readInTree(dir, 'C:\\x', 100), { reason: 'invalid-path' });
  } finally { cleanup(); }
});

test('returns not-a-file when path points to a directory', () => {
  const { dir, cleanup } = setup();
  try {
    mkdirSync(join(dir, 'sub'));
    assert.deepEqual(readInTree(dir, 'sub', 100), { reason: 'not-a-file' });
  } finally { cleanup(); }
});

test('returns oversize when file size exceeds cap', () => {
  const { dir, cleanup } = setup();
  try {
    writeFileSync(join(dir, 'big.bin'), Buffer.alloc(10, 0));
    assert.deepEqual(readInTree(dir, 'big.bin', 5), { reason: 'oversize' });
  } finally { cleanup(); }
});

test('returns text when file size equals cap exactly', () => {
  const { dir, cleanup } = setup();
  try {
    writeFileSync(join(dir, 'exact.bin'), Buffer.alloc(5, 1));
    assert.deepEqual(readInTree(dir, 'exact.bin', 5), { text: '\u0001\u0001\u0001\u0001\u0001' });
  } finally { cleanup(); }
});

test('throws TypeError when root is not a string', () => {
  const { dir, cleanup } = setup();
  try {
    assert.throws(() => readInTree(123, 'a.txt', 100), TypeError);
  } finally { cleanup(); }
});
