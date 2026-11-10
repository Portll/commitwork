// Parsed toolchain.json contents, null when missing, or an unreadable marker (monitor/vintage.mjs readToolchain).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readToolchain } from '../vintage.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns the parsed object when toolchain.json is valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readToolchain-'));
  try {
    writeFileSync(join(dir, 'toolchain.json'), JSON.stringify({ sha: 'abc', sourceDirtyHash: 'def' }));
    const result = readToolchain(dir);
    assert.deepEqual(result, { sha: 'abc', sourceDirtyHash: 'def' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when toolchain.json is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readToolchain-'));
  try {
    const result = readToolchain(dir);
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the repository directory itself does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readToolchain-'));
  try {
    const result = readToolchain(join(dir, 'absent'));
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an unreadable marker with the generic error label when toolchain.json is not valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readToolchain-'));
  try {
    writeFileSync(join(dir, 'toolchain.json'), 'not json');
    const result = readToolchain(dir);
    assert.deepEqual(result, { sha: null, sourceDirtyHash: null, reason: 'toolchain.json unreadable (error)' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an unreadable marker with the generic error label when toolchain.json is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readToolchain-'));
  try {
    writeFileSync(join(dir, 'toolchain.json'), '');
    const result = readToolchain(dir);
    assert.deepEqual(result, { sha: null, sourceDirtyHash: null, reason: 'toolchain.json unreadable (error)' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an unreadable marker with EISDIR when toolchain.json is a directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readToolchain-'));
  try {
    mkdirSync(join(dir, 'toolchain.json'));
    const result = readToolchain(dir);
    assert.deepEqual(result, { sha: null, sourceDirtyHash: null, reason: 'toolchain.json unreadable (EISDIR)' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an unreadable marker with ENOTDIR when the repository path is a regular file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readToolchain-'));
  try {
    const filePath = join(dir, 'plain');
    writeFileSync(filePath, 'x'.repeat(4));
    const result = readToolchain(filePath);
    assert.deepEqual(result, { sha: null, sourceDirtyHash: null, reason: 'toolchain.json unreadable (ENOTDIR)' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
