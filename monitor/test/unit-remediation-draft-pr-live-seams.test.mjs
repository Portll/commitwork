// Live seam bundle for draft PR creation (monitor/remediation-draft-pr.mjs liveSeams).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveSeams } from '../remediation-draft-pr.mjs';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

test('cleanup returns undefined without throwing when the path does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'liveSeams-'));
  try {
    const missing = join(dir, 'never-created');
    assert.equal(liveSeams({}).cleanup(missing), undefined);
    assert.equal(existsSync(missing), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cleanup tolerates a missing path whose parent is also missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'liveSeams-'));
  try {
    const missing = join(dir, 'no-parent', 'no-child');
    assert.equal(liveSeams({}).cleanup(missing), undefined);
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cleanup can be called twice on the same directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'liveSeams-'));
  try {
    const target = join(dir, 'target');
    mkdirSync(target);
    const seams = liveSeams({});
    assert.equal(seams.cleanup(target), undefined);
    assert.equal(seams.cleanup(target), undefined);
    assert.equal(existsSync(target), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cleanup removes a directory holding files and nested directories', () => {
  const dir = mkdtempSync(join(tmpdir(), 'liveSeams-'));
  try {
    const target = join(dir, 'target');
    mkdirSync(join(target, 'deep'), { recursive: true });
    writeFileSync(join(target, 'top.txt'), 'a');
    writeFileSync(join(target, 'deep', 'inner.txt'), 'b');
    assert.equal(liveSeams({}).cleanup(target), undefined);
    assert.equal(existsSync(target), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cleanup removes an empty directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'liveSeams-'));
  try {
    const target = join(dir, 'empty');
    mkdirSync(target);
    assert.equal(liveSeams({}).cleanup(target), undefined);
    assert.equal(existsSync(target), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cleanup leaves siblings of the removed directory in place', () => {
  const dir = mkdtempSync(join(tmpdir(), 'liveSeams-'));
  try {
    const target = join(dir, 'gone');
    mkdirSync(target);
    writeFileSync(join(target, 'f.txt'), 'x');
    writeFileSync(join(dir, 'keep.txt'), 'kept');
    liveSeams({}).cleanup(target);
    assert.deepEqual(readdirSync(dir), ['keep.txt']);
    assert.equal(readFileSync(join(dir, 'keep.txt'), 'utf8'), 'kept');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scratch creates a cw-draft-pr- directory inside the system temp directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'liveSeams-'));
  const saved = process.env.TMPDIR;
  try {
    process.env.TMPDIR = dir;
    const made = liveSeams({}).scratch();
    assert.equal(dirname(made), dir);
    assert.equal(basename(made).slice(0, 12), 'cw-draft-pr-');
    assert.equal(basename(made).length, 18);
    assert.equal(statSync(made).isDirectory(), true);
  } finally {
    if (saved === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the returned object carries createPr, scratch and cleanup as own keys', () => {
  const seams = liveSeams({});
  assert.deepEqual(
    ['createPr', 'scratch', 'cleanup'].map((key) => Object.hasOwn(seams, key)),
    [true, true, true],
  );
});
