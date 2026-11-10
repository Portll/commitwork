// determines sweep liveness and age from a marker file (monitor/liveness.mjs readInflight).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readInflight, INFLIGHT_FILE, INFLIGHT_MAX_MS_DEFAULT } from '../liveness.mjs';

test('returns verdict none when the inflight file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readInflight-'));
  try {
    const result = readInflight(dir);
    assert.deepEqual(result, { verdict: 'none' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns verdict unreadable with error code when the inflight file cannot be read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readInflight-'));
  try {
    const path = join(dir, INFLIGHT_FILE);
    writeFileSync(path, '{"startedAt":"2024-01-01T00:00:00Z"}');
    chmodSync(path, 0o000);
    let expectedCode = 'error';
    try { readFileSync(path, 'utf8'); } catch (e) { expectedCode = e.code || 'error'; }
    const result = readInflight(dir);
    assert.deepEqual(result, { verdict: 'unreadable', detail: expectedCode });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns verdict unreadable with detail unparseable when JSON cannot be parsed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readInflight-'));
  try {
    writeFileSync(join(dir, INFLIGHT_FILE), '{ not json');
    const result = readInflight(dir);
    assert.deepEqual(result, { verdict: 'unreadable', detail: 'unparseable' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns verdict unreadable with detail no parseable startedAt when JSON is null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readInflight-'));
  try {
    writeFileSync(join(dir, INFLIGHT_FILE), 'null');
    const result = readInflight(dir);
    assert.deepEqual(result, { verdict: 'unreadable', detail: 'no parseable startedAt' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns inflight with pidState unprobeable and sliceId when pid missing and age below max', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readInflight-'));
  try {
    const now = 1_600_000_000_000;
    const started = new Date(now - 1_000).toISOString();
    writeFileSync(join(dir, INFLIGHT_FILE), JSON.stringify({ startedAt: started, sliceId: 'test-slice' }));
    const result = readInflight(dir, { nowMs: now });
    assert.deepEqual(result, {
      verdict: 'inflight',
      ageMin: 0,
      sliceId: 'test-slice',
      startedAt: started,
      pid: null,
      pidState: 'unprobeable'
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns hung with pidState unprobeable when pid missing and age exceeds max', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readInflight-'));
  try {
    const now = 1_600_000_000_000;
    const max = INFLIGHT_MAX_MS_DEFAULT;
    const started = new Date(now - (max + 1_000)).toISOString();
    writeFileSync(join(dir, INFLIGHT_FILE), JSON.stringify({ startedAt: started }));
    const result = readInflight(dir, { nowMs: now });
    const ageMin = Math.round((max + 1_000) / 60000);
    assert.deepEqual(result, {
      verdict: 'hung',
      ageMin,
      sliceId: null,
      startedAt: started,
      pid: null,
      pidState: 'unprobeable'
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns inflight with pidState alive when pid is current process and age is below max', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readInflight-'));
  try {
    const now = 1_600_000_000_000;
    const started = new Date(now - 1_000).toISOString();
    writeFileSync(join(dir, INFLIGHT_FILE), JSON.stringify({ startedAt: started, pid: process.pid }));
    const result = readInflight(dir, { nowMs: now });
    assert.deepEqual(result, {
      verdict: 'inflight',
      ageMin: 0,
      sliceId: null,
      startedAt: started,
      pid: process.pid,
      pidState: 'alive'
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns hung with pidState dead when pid does not exist and age is below max', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readInflight-'));
  try {
    const now = 1_600_000_000_000;
    const started = new Date(now - 1_000).toISOString();
    writeFileSync(join(dir, INFLIGHT_FILE), JSON.stringify({ startedAt: started, pid: 999_999 }));
    const result = readInflight(dir, { nowMs: now });
    assert.deepEqual(result, {
      verdict: 'hung',
      ageMin: 0,
      sliceId: null,
      startedAt: started,
      pid: 999_999,
      pidState: 'dead'
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns overrunning with pidState alive when pid is current process and age exceeds max', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readInflight-'));
  try {
    const now = 1_600_000_000_000;
    const max = INFLIGHT_MAX_MS_DEFAULT;
    const started = new Date(now - (max + 1_000)).toISOString();
    writeFileSync(join(dir, INFLIGHT_FILE), JSON.stringify({ startedAt: started, pid: process.pid }));
    const result = readInflight(dir, { nowMs: now });
    const ageMin = Math.round((max + 1_000) / 60000);
    assert.deepEqual(result, {
      verdict: 'overrunning',
      ageMin,
      sliceId: null,
      startedAt: started,
      pid: process.pid,
      pidState: 'alive'
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('age exactly equal to maxMs yields inflight verdict (boundary test)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readInflight-'));
  try {
    const now = 1_600_000_000_000;
    const max = INFLIGHT_MAX_MS_DEFAULT;
    const started = new Date(now - max).toISOString();
    writeFileSync(join(dir, INFLIGHT_FILE), JSON.stringify({ startedAt: started }));
    const result = readInflight(dir, { nowMs: now });
    const ageMin = Math.round(max / 60000);
    assert.deepEqual(result, {
      verdict: 'inflight',
      ageMin,
      sliceId: null,
      startedAt: started,
      pid: null,
      pidState: 'unprobeable'
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
