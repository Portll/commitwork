// Resolves a path to ok, missing, unreadable, or dangling (admin/lib/spine-preconditions.mjs resolveTarget).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTarget } from '../lib/spine-preconditions.mjs';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns ok for a regular file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolveTarget-'));
  try {
    const p = join(dir, 'f.txt');
    writeFileSync(p, 'x');
    const result = resolveTarget(p);
    assert.deepEqual(result, { state: 'ok' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns missing for a path that does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolveTarget-'));
  try {
    const p = join(dir, 'nope');
    const result = resolveTarget(p);
    assert.deepEqual(result, { state: 'missing', why: `${p} does not exist` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns missing for a nested path that does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolveTarget-'));
  try {
    const p = join(dir, 'x', 'y', 'z');
    const result = resolveTarget(p);
    assert.deepEqual(result, { state: 'missing', why: `${p} does not exist` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok for a directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolveTarget-'));
  try {
    const sub = join(dir, 'subdir');
    mkdirSync(sub);
    const result = resolveTarget(sub);
    assert.deepEqual(result, { state: 'ok' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok for a symlink that resolves', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolveTarget-'));
  try {
    const target = join(dir, 'real.txt');
    writeFileSync(target, 'data');
    const link = join(dir, 'link.txt');
    symlinkSync(target, link);
    const result = resolveTarget(link);
    assert.deepEqual(result, { state: 'ok' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns dangling for a symlink whose target is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolveTarget-'));
  try {
    const target = join(dir, 'gone.txt');
    const link = join(dir, 'dangling.txt');
    symlinkSync(target, link);
    const result = resolveTarget(link);
    assert.deepEqual(result, { state: 'dangling', why: `${link} \u2192 ${target}, which does not resolve` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable for a path that cannot be stat-ed due to permissions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolveTarget-'));
  try {
    const sub = join(dir, 'sub');
    mkdirSync(sub);
    const p = join(sub, 'file.txt');
    writeFileSync(p, 'x');
    chmodSync(sub, 0o000);
    const result = resolveTarget(p);
    assert.deepEqual(result, { state: 'unreadable', why: `${p}: EACCES` });
  } finally {
    try { chmodSync(join(dir, 'sub'), 0o700); } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});
