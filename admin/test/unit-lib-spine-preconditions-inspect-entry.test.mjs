// Resolves a path's symlink target and classifies its link home (admin/lib/spine-preconditions.mjs inspectEntry).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectEntry } from '../lib/spine-preconditions.mjs';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns missing state with why when the path does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'inspectEntry-'));
  try {
    const p = join(dir, 'nope');
    const r = inspectEntry(p);
    assert.equal(r.state, 'missing');
    assert.equal(r.why, `${p} does not exist`);
    assert.equal(r.target, null);
    assert.equal(r.home, 'unlinked');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok state with null target for a regular file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'inspectEntry-'));
  try {
    const p = join(dir, 'f.txt');
    writeFileSync(p, 'x'.repeat(8));
    const r = inspectEntry(p);
    assert.equal(r.state, 'ok');
    assert.equal(r.target, null);
    assert.equal(r.home, 'unlinked');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok state with resolved target for a symlink to an existing file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'inspectEntry-'));
  try {
    const real = join(dir, 'real.txt');
    writeFileSync(real, 'y'.repeat(4));
    const link = join(dir, 'lnk');
    symlinkSync(real, link);
    const r = inspectEntry(link);
    assert.equal(r.state, 'ok');
    assert.equal(r.target, realpathSync(link));
    assert.equal(r.home, 'other');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok state with target classified as spine when link points into spine dir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'inspectEntry-'));
  try {
    const spineDir = join(dir, 'spine');
    mkdirSync(spineDir);
    const real = join(spineDir, 's.txt');
    writeFileSync(real, 'z'.repeat(2));
    const link = join(dir, 'lnk');
    symlinkSync(real, link);
    const r = inspectEntry(link);
    assert.equal(r.state, 'ok');
    assert.equal(r.target, realpathSync(link));
    assert.equal(r.home, 'spine');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok state with target classified as sleight when link points into sleight dir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'inspectEntry-'));
  try {
    const sleightDir = join(dir, 'sleight');
    mkdirSync(sleightDir);
    const real = join(sleightDir, 'sl.txt');
    writeFileSync(real, 'w'.repeat(2));
    const link = join(dir, 'lnk');
    symlinkSync(real, link);
    const r = inspectEntry(link);
    assert.equal(r.state, 'ok');
    assert.equal(r.target, realpathSync(link));
    assert.equal(r.home, 'sleight');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns dangling state with why when the symlink target does not resolve', () => {
  const dir = mkdtempSync(join(tmpdir(), 'inspectEntry-'));
  try {
    const missing = join(dir, 'gone.txt');
    const link = join(dir, 'lnk');
    symlinkSync(missing, link);
    const r = inspectEntry(link);
    assert.equal(r.state, 'dangling');
    assert.equal(r.why, `${link} \u2192 ${missing}, which does not resolve`);
    assert.equal(r.target, missing);
    assert.equal(r.home, 'other');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok state with target classified as other when link points to a plain path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'inspectEntry-'));
  try {
    const real = join(dir, 'plain.txt');
    writeFileSync(real, 'a'.repeat(1));
    const link = join(dir, 'lnk');
    symlinkSync(real, link);
    const r = inspectEntry(link);
    assert.equal(r.state, 'ok');
    assert.equal(r.target, realpathSync(link));
    assert.equal(r.home, 'other');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
