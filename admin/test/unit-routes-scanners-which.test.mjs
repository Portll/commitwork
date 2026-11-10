// Resolve the absolute path of an executable on PATH (admin/routes/scanners.mjs which).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { which } from '../routes/scanners.mjs';
import { mkdtempSync, rmSync, writeFileSync, chmodSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';

test('returns the path of an executable file found in the first matching directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'which-'));
  try {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const target = join(bin, 'tool');
    writeFileSync(target, '#!/bin/sh\n');
    chmodSync(target, 0o755);
    const result = which('tool', { path: bin });
    assert.equal(result, target);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the file exists but is not executable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'which-'));
  try {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const target = join(bin, 'tool');
    writeFileSync(target, 'data');
    chmodSync(target, 0o644);
    const result = which('tool', { path: bin });
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'which-'));
  try {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const result = which('missing', { path: bin });
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the path entry is a directory not a file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'which-'));
  try {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const target = join(bin, 'tool');
    mkdirSync(target);
    const result = which('tool', { path: bin });
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skips empty path entries and finds the executable in a later directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'which-'));
  try {
    const bin1 = join(dir, 'bin1');
    const bin2 = join(dir, 'bin2');
    mkdirSync(bin1);
    mkdirSync(bin2);
    const target = join(bin2, 'tool');
    writeFileSync(target, '#!/bin/sh\n');
    chmodSync(target, 0o755);
    const pathStr = `${bin1}${delimiter}${delimiter}${bin2}`;
    const result = which('tool', { path: pathStr });
    assert.equal(result, target);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the first executable found when multiple directories contain it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'which-'));
  try {
    const bin1 = join(dir, 'bin1');
    const bin2 = join(dir, 'bin2');
    mkdirSync(bin1);
    mkdirSync(bin2);
    const t1 = join(bin1, 'tool');
    const t2 = join(bin2, 'tool');
    writeFileSync(t1, '#!/bin/sh\n');
    writeFileSync(t2, '#!/bin/sh\n');
    chmodSync(t1, 0o755);
    chmodSync(t2, 0o755);
    const pathStr = `${bin1}${delimiter}${bin2}`;
    const result = which('tool', { path: pathStr });
    assert.equal(result, t1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when path is an empty string', () => {
  const result = which('tool', { path: '' });
  assert.equal(result, null);
});

test('returns null when no directory in path contains the executable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'which-'));
  try {
    const bin1 = join(dir, 'bin1');
    const bin2 = join(dir, 'bin2');
    mkdirSync(bin1);
    mkdirSync(bin2);
    const pathStr = `${bin1}${delimiter}${bin2}`;
    const result = which('nonexistent', { path: pathStr });
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
