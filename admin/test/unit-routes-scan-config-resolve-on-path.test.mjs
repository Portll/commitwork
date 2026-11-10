// Resolves a tool name to an absolute path or null (admin/routes/scan-config.mjs resolveOnPath).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveOnPath } from '../routes/scan-config.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns the path for an existing absolute tool path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolveOnPath-'));
  try {
    const file = join(dir, 'tool');
    writeFileSync(file, 'x');
    assert.equal(resolveOnPath(file, { env: {} }), file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null for a non-existing absolute tool path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolveOnPath-'));
  try {
    const file = join(dir, 'missing');
    assert.equal(resolveOnPath(file, { env: {} }), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the joined path when the tool exists in the first PATH directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolveOnPath-'));
  try {
    const file = join(dir, 'tool');
    writeFileSync(file, 'x');
    const env = { PATH: dir + ':/other' };
    assert.equal(resolveOnPath('tool', { env }), file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the tool is not found in any PATH directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolveOnPath-'));
  try {
    const env = { PATH: dir + ':/nonexistent' };
    assert.equal(resolveOnPath('missing', { env }), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skips empty PATH segments and finds the tool in a later directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolveOnPath-'));
  try {
    const file = join(dir, 'tool');
    writeFileSync(file, 'x');
    const env = { PATH: ':/empty:' + dir };
    assert.equal(resolveOnPath('tool', { env }), file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when PATH is empty string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolveOnPath-'));
  try {
    const env = { PATH: '' };
    assert.equal(resolveOnPath('tool', { env }), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when PATH is undefined and tool is relative', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolveOnPath-'));
  try {
    const env = {};
    assert.equal(resolveOnPath('tool', { env }), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the tool path is a directory not a file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolveOnPath-'));
  try {
    const sub = join(dir, 'subdir');
    mkdirSync(sub);
    const env = { PATH: dir };
    assert.equal(resolveOnPath('subdir', { env }), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
