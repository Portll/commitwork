// Decides whether a hook message should be emitted or silenced based on fingerprint and streak (bin/hook-once.mjs shouldEmit).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldEmit } from '../hook-once.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('emits changed true for a new message with no prior record', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shouldEmit-'));
  process.env.CW_HOOK_STATE = dir;
  process.env.CW_NOW = '2024-01-01T00:00:00.000Z';
  try {
    const r = shouldEmit('test-key', 'hello world');
    assert.deepEqual(r, { changed: true, silenced: 0, at: "2024-01-01T00:00:00.000Z" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_HOOK_STATE;
    delete process.env.CW_NOW;
  }
});

test('silences a repeated message with the same fingerprint', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shouldEmit-'));
  process.env.CW_HOOK_STATE = dir;
  process.env.CW_NOW = '2024-01-01T00:00:00.000Z';
  try {
    shouldEmit('test-key', 'hello world');
    const r = shouldEmit('test-key', 'hello world');
    assert.deepEqual(r, { changed: false, silenced: 1, at: "2024-01-01T00:00:00.000Z" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_HOOK_STATE;
    delete process.env.CW_NOW;
  }
});

test('returns changed true with silenced 0 when lock acquisition fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shouldEmit-'));
  process.env.CW_HOOK_STATE = dir;
  process.env.CW_NOW = '2024-01-01T00:00:00.000Z';
  try {
    const lockPath = join(dir, 'test-key.json.lock');
    mkdirSync(dir, { recursive: true });
    writeFileSync(lockPath, JSON.stringify({ pid: 99999, label: 'hook-once', at: new Date().toISOString() }));
    const r = shouldEmit('test-key', 'some message');
    assert.deepEqual(r, { changed: true, silenced: 0, at: "2024-01-01T00:00:00.000Z" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_HOOK_STATE;
    delete process.env.CW_NOW;
  }
});

test('returns changed true with silenced 0 when lock is not ok', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shouldEmit-'));
  process.env.CW_HOOK_STATE = dir;
  process.env.CW_NOW = '2024-01-01T00:00:00.000Z';
  try {
    const lockPath = join(dir, 'test-key.json.lock');
    mkdirSync(dir, { recursive: true });
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, label: 'hook-once', at: new Date().toISOString() }));
    const r = shouldEmit('test-key', 'some message');
    assert.deepEqual(r, { changed: true, silenced: 0, at: "2024-01-01T00:00:00.000Z" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_HOOK_STATE;
    delete process.env.CW_NOW;
  }
});

test('resets silenced count when message changes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shouldEmit-'));
  process.env.CW_HOOK_STATE = dir;
  process.env.CW_NOW = '2024-01-01T00:00:00.000Z';
  try {
    shouldEmit('test-key', 'first message');
    shouldEmit('test-key', 'first message');
    const r = shouldEmit('test-key', 'second message');
    assert.deepEqual(r, { changed: true, silenced: 1, at: "2024-01-01T00:00:00.000Z" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_HOOK_STATE;
    delete process.env.CW_NOW;
  }
});

test('increments silenced count on each repeat of same message', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shouldEmit-'));
  process.env.CW_HOOK_STATE = dir;
  process.env.CW_NOW = '2024-01-01T00:00:00.000Z';
  try {
    shouldEmit('test-key', 'repeat me');
    shouldEmit('test-key', 'repeat me');
    const r = shouldEmit('test-key', 'repeat me');
    assert.deepEqual(r, { changed: false, silenced: 2, at: "2024-01-01T00:00:00.000Z" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_HOOK_STATE;
    delete process.env.CW_NOW;
  }
});

test('preserves original at timestamp when silencing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shouldEmit-'));
  process.env.CW_HOOK_STATE = dir;
  process.env.CW_NOW = '2024-01-01T00:00:00.000Z';
  try {
    shouldEmit('test-key', 'stable message');
    process.env.CW_NOW = '2024-01-02T00:00:00.000Z';
    const r = shouldEmit('test-key', 'stable message');
    assert.deepEqual(r, { changed: false, silenced: 1, at: "2024-01-01T00:00:00.000Z" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_HOOK_STATE;
    delete process.env.CW_NOW;
  }
});

test('uses CW_NOW for at field when emitting new message', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shouldEmit-'));
  process.env.CW_HOOK_STATE = dir;
  process.env.CW_NOW = '2024-06-15T12:00:00.000Z';
  try {
    const r = shouldEmit('new-key', 'brand new');
    assert.deepEqual(r, { changed: true, silenced: 0, at: "2024-06-15T12:00:00.000Z" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_HOOK_STATE;
    delete process.env.CW_NOW;
  }
});
