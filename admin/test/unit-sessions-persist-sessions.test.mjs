// persists sessions to disk with throttling (admin/sessions.mjs persistSessions).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { persistSessions } from '../sessions.mjs';
import { mkdtempSync, rmSync, readFileSync, statSync, chmodSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns false when not forced and within flush interval', () => {
  const dir = mkdtempSync(join(tmpdir(), 'persistSessions-'));
  const originalSessionStore = process.env.CW_SESSION_STORE;
  process.env.CW_SESSION_STORE = join(dir, 'sessions.json');
  try {
    const sessions = new Map([['s1', { provider: 'github', user: 'u', createdAt: 1, lastSeenAt: 2 }]]);
    const result = persistSessions(sessions, { now: 1000 });
    assert.equal(result, false);
  } finally {
    if (originalSessionStore === undefined) delete process.env.CW_SESSION_STORE;
    else process.env.CW_SESSION_STORE = originalSessionStore;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns true when forced even within flush interval', () => {
  const dir = mkdtempSync(join(tmpdir(), 'persistSessions-'));
  const originalSessionStore = process.env.CW_SESSION_STORE;
  process.env.CW_SESSION_STORE = join(dir, 'sessions.json');
  try {
    const sessions = new Map([['s1', { provider: 'github', user: 'u', createdAt: 1, lastSeenAt: 2 }]]);
    const result = persistSessions(sessions, { force: true, now: 1000 });
    assert.equal(result, true);
    const content = readFileSync(join(dir, 'sessions.json'), 'utf8');
    const expected = JSON.stringify({ version: 1, sessions: { s1: { provider: 'github', user: 'u', createdAt: 1, lastSeenAt: 2 } } }, null, 2);
    assert.equal(content, expected);
    const stats = statSync(join(dir, 'sessions.json'));
    assert.equal(stats.mode & 0o777, 0o600);
  } finally {
    if (originalSessionStore === undefined) delete process.env.CW_SESSION_STORE;
    else process.env.CW_SESSION_STORE = originalSessionStore;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns true when not forced and past flush interval', () => {
  const dir = mkdtempSync(join(tmpdir(), 'persistSessions-'));
  const originalSessionStore = process.env.CW_SESSION_STORE;
  process.env.CW_SESSION_STORE = join(dir, 'sessions.json');
  try {
    const sessions = new Map([['s2', { provider: 'gitlab', user: 'v', createdAt: 3, lastSeenAt: 4 }]]);
    const result = persistSessions(sessions, { force: false, now: 71000 });
    assert.equal(result, true);
    const content = readFileSync(join(dir, 'sessions.json'), 'utf8');
    const expected = JSON.stringify({ version: 1, sessions: { s2: { provider: 'gitlab', user: 'v', createdAt: 3, lastSeenAt: 4 } } }, null, 2);
    assert.equal(content, expected);
  } finally {
    if (originalSessionStore === undefined) delete process.env.CW_SESSION_STORE;
    else process.env.CW_SESSION_STORE = originalSessionStore;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns true when not forced at exact flush interval boundary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'persistSessions-'));
  const originalSessionStore = process.env.CW_SESSION_STORE;
  process.env.CW_SESSION_STORE = join(dir, 'sessions.json');
  try {
    const sessions = new Map([['s3', { provider: 'bitbucket', user: 'w', createdAt: 5, lastSeenAt: 6 }]]);
    const result = persistSessions(sessions, { force: false, now: 131000 });
    assert.equal(result, true);
  } finally {
    if (originalSessionStore === undefined) delete process.env.CW_SESSION_STORE;
    else process.env.CW_SESSION_STORE = originalSessionStore;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false and calls onNote when write fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'persistSessions-'));
  const originalSessionStore = process.env.CW_SESSION_STORE;
  const readonlyDir = join(dir, 'readonly');
  mkdirSync(readonlyDir);
  chmodSync(readonlyDir, 0o400);
  process.env.CW_SESSION_STORE = join(readonlyDir, 'sessions.json');
  try {
    const sessions = new Map([['s4', { provider: 'github', user: 'u', createdAt: 1, lastSeenAt: 2 }]]);
    let note = '';
    const result = persistSessions(sessions, { force: true, now: 200000, onNote: (msg) => { note = msg; } });
    assert.equal(result, false);
    assert.ok(note.includes('could not persist sessions'));
    assert.ok(note.includes('sessions will not survive the next restart'));
  } finally {
    try { chmodSync(readonlyDir, 0o700); } catch {}
    if (originalSessionStore === undefined) delete process.env.CW_SESSION_STORE;
    else process.env.CW_SESSION_STORE = originalSessionStore;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('creates parent directories recursively', () => {
  const dir = mkdtempSync(join(tmpdir(), 'persistSessions-'));
  const originalSessionStore = process.env.CW_SESSION_STORE;
  const nestedPath = join(dir, 'a', 'b', 'c', 'sessions.json');
  process.env.CW_SESSION_STORE = nestedPath;
  try {
    const sessions = new Map([['s5', { provider: 'github', user: 'u', createdAt: 1, lastSeenAt: 2 }]]);
    const result = persistSessions(sessions, { force: true, now: 300000 });
    assert.equal(result, true);
    const content = readFileSync(nestedPath, 'utf8');
    const expected = JSON.stringify({ version: 1, sessions: { s5: { provider: 'github', user: 'u', createdAt: 1, lastSeenAt: 2 } } }, null, 2);
    assert.equal(content, expected);
  } finally {
    if (originalSessionStore === undefined) delete process.env.CW_SESSION_STORE;
    else process.env.CW_SESSION_STORE = originalSessionStore;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('redacts sessions to only persisted fields', () => {
  const dir = mkdtempSync(join(tmpdir(), 'persistSessions-'));
  const originalSessionStore = process.env.CW_SESSION_STORE;
  process.env.CW_SESSION_STORE = join(dir, 'sessions.json');
  try {
    const sessions = new Map([['s6', { provider: 'github', user: 'u', createdAt: 1, lastSeenAt: 2, secret: 'token', extra: 'field' }]]);
    const result = persistSessions(sessions, { force: true, now: 400000 });
    assert.equal(result, true);
    const content = readFileSync(join(dir, 'sessions.json'), 'utf8');
    const parsed = JSON.parse(content);
    assert.deepEqual(parsed.sessions.s6, { provider: 'github', user: 'u', createdAt: 1, lastSeenAt: 2 });
    assert.equal(parsed.sessions.s6.secret, undefined);
    assert.equal(parsed.sessions.s6.extra, undefined);
  } finally {
    if (originalSessionStore === undefined) delete process.env.CW_SESSION_STORE;
    else process.env.CW_SESSION_STORE = originalSessionStore;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses atomic write with tmp file and rename', () => {
  const dir = mkdtempSync(join(tmpdir(), 'persistSessions-'));
  const originalSessionStore = process.env.CW_SESSION_STORE;
  const filePath = join(dir, 'sessions.json');
  process.env.CW_SESSION_STORE = filePath;
  try {
    const sessions = new Map([['s7', { provider: 'github', user: 'u', createdAt: 1, lastSeenAt: 2 }]]);
    const result = persistSessions(sessions, { force: true, now: 500000 });
    assert.equal(result, true);
    const files = readdirSync(dir);
    const tmpFiles = files.filter(f => f.startsWith('sessions.json.tmp-'));
    assert.deepEqual(tmpFiles, []);
    assert.ok(files.includes('sessions.json'));
  } finally {
    if (originalSessionStore === undefined) delete process.env.CW_SESSION_STORE;
    else process.env.CW_SESSION_STORE = originalSessionStore;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes file with 0600 permissions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'persistSessions-'));
  const originalSessionStore = process.env.CW_SESSION_STORE;
  process.env.CW_SESSION_STORE = join(dir, 'sessions.json');
  try {
    const sessions = new Map([['s8', { provider: 'github', user: 'u', createdAt: 1, lastSeenAt: 2 }]]);
    const result = persistSessions(sessions, { force: true, now: 600000 });
    assert.equal(result, true);
    const stats = statSync(join(dir, 'sessions.json'));
    assert.equal(stats.mode & 0o777, 0o600);
  } finally {
    if (originalSessionStore === undefined) delete process.env.CW_SESSION_STORE;
    else process.env.CW_SESSION_STORE = originalSessionStore;
    rmSync(dir, { recursive: true, force: true });
  }
});
