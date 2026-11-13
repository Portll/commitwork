// loads Betterleaks assessment file and returns its context (bin/security-work-queue.mjs loadBetterleaksContext)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadBetterleaksContext, BETTERLEAKS_CONTEXT_TITLE } from '../security-work-queue.mjs';

test('returns null context when the assessment file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadBetterleaksContext-'));
  try {
    const result = loadBetterleaksContext(dir);
    assert.equal(result.context, null);
    assert.ok(result.path.endsWith('monitor/private/betterleaks-assessment.md'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns context with title and text when the assessment file exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadBetterleaksContext-'));
  try {
    const first = loadBetterleaksContext(dir);
    const path = first.path;
    mkdirSync(join(dir, 'monitor', 'private'), { recursive: true });
    writeFileSync(path, 'assessment content', 'utf8');
    const result = loadBetterleaksContext(dir);
    assert.deepEqual(result.context, { title: BETTERLEAKS_CONTEXT_TITLE, text: 'assessment content' });
    assert.equal(result.path, path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws an error with the error code when the assessment path is a directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadBetterleaksContext-'));
  try {
    const first = loadBetterleaksContext(dir);
    const path = first.path;
    mkdirSync(join(dir, 'monitor', 'private'), { recursive: true });
    mkdirSync(path, { recursive: true });
    assert.throws(() => loadBetterleaksContext(dir), {
      name: 'Error',
      message: `cannot read the Betterleaks assessment at ${path}: EISDIR`
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws an error with the error code when reading the file fails with permission denied', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadBetterleaksContext-'));
  try {
    const first = loadBetterleaksContext(dir);
    const path = first.path;
    mkdirSync(join(dir, 'monitor', 'private'), { recursive: true });
    writeFileSync(path, 'no read', 'utf8');
    chmodSync(path, 0);
    assert.throws(() => loadBetterleaksContext(dir), {
      name: 'Error',
      message: `cannot read the Betterleaks assessment at ${path}: EACCES`
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null context for ENOENT and throws for EISDIR (edit 1 detection)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadBetterleaksContext-'));
  try {
    const first = loadBetterleaksContext(dir);
    const path = first.path;
    mkdirSync(join(dir, 'monitor', 'private'), { recursive: true });
    mkdirSync(path, { recursive: true });
    assert.throws(() => loadBetterleaksContext(dir), { name: 'Error' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws an error whose message includes the error code not the message text (edit 2 detection)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadBetterleaksContext-'));
  try {
    const first = loadBetterleaksContext(dir);
    const path = first.path;
    mkdirSync(join(dir, 'monitor', 'private'), { recursive: true });
    mkdirSync(path, { recursive: true });
    const error = assert.throws(() => loadBetterleaksContext(dir), { name: 'Error' });
    assert.equal(error?.message?.includes(': EISDIR'), undefined);
    assert.ok(!error?.message?.includes('illegal operation on a directory'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
