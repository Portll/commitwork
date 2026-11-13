// Loads persisted sessions, filtering by TTL and account existence (admin/sessions.mjs loadSessions).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSessions } from '../sessions.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const key = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex');
const PERSISTED = ['provider', 'user', 'createdAt', 'lastSeenAt'];

function withStore(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'loadSessions-'));
  const store = join(dir, 'sessions.json');
  const old = process.env.CW_SESSION_STORE;
  process.env.CW_SESSION_STORE = store;
  const notes = [];
  const note = (m) => notes.push(m);
  try {
    return fn({ store, note, notes });
  } finally {
    process.env.CW_SESSION_STORE = old;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('returns empty sessions when store file is missing', () => {
  withStore(({ note }) => {
    const result = loadSessions({ ttlMs: 1000, now: 1000, knownUsers: new Set(), onNote: note });
    assert.deepEqual(result, { sessions: new Map(), restored: 0, dropped: 0 });
  });
});

test('returns empty sessions when store file is invalid JSON', () => {
  withStore(({ store, note }) => {
    writeFileSync(store, 'not json');
    const result = loadSessions({ ttlMs: 1000, now: 1000, knownUsers: new Set(), onNote: note });
    assert.deepEqual(result, { sessions: new Map(), restored: 0, dropped: 0 });
  });
});

test('returns empty sessions when store version is wrong', () => {
  withStore(({ store, note }) => {
    writeFileSync(store, JSON.stringify({ version: 2, sessions: {} }));
    const result = loadSessions({ ttlMs: 1000, now: 1000, knownUsers: new Set(), onNote: note });
    assert.deepEqual(result, { sessions: new Map(), restored: 0, dropped: 0 });
  });
});

test('returns empty sessions when sessions field is missing', () => {
  withStore(({ store, note }) => {
    writeFileSync(store, JSON.stringify({ version: 1 }));
    const result = loadSessions({ ttlMs: 1000, now: 1000, knownUsers: new Set(), onNote: note });
    assert.deepEqual(result, { sessions: new Map(), restored: 0, dropped: 0 });
  });
});

test('drops sessions with invalid keys or non-object values', () => {
  withStore(({ store, note }) => {
    const badKey = 'x'.repeat(64);
    const goodKey = key('s1');
    writeFileSync(store, JSON.stringify({
      version: 1,
      sessions: {
        [badKey]: { provider: 'p', user: 'u', createdAt: 100, lastSeenAt: 100 },
        [goodKey]: 'not-an-object'
      }
    }));
    const result = loadSessions({ ttlMs: 1000, now: 1000, knownUsers: new Set(['u']), onNote: note });
    assert.deepEqual(result, { sessions: new Map(), restored: 0, dropped: 2, orphaned: 0 });
  });
});

test('drops sessions that are expired (now - last > ttlMs)', () => {
  withStore(({ store, note }) => {
    const k = key('s1');
    writeFileSync(store, JSON.stringify({
      version: 1,
      sessions: { [k]: { provider: 'p', user: 'u', createdAt: 0, lastSeenAt: 0 } }
    }));
    const result = loadSessions({ ttlMs: 1000, now: 1001, knownUsers: new Set(['u']), onNote: note });
    assert.deepEqual(result, { sessions: new Map(), restored: 0, dropped: 1, orphaned: 0 });
  });
});

test('restores sessions that are not expired (now - last === ttlMs)', () => {
  withStore(({ store, note }) => {
    const k = key('s1');
    writeFileSync(store, JSON.stringify({
      version: 1,
      sessions: { [k]: { provider: 'p', user: 'u', createdAt: 0, lastSeenAt: 0 } }
    }));
    const result = loadSessions({ ttlMs: 1000, now: 1000, knownUsers: new Set(['u']), onNote: note });
    const expectedSession = { provider: 'p', user: 'u', createdAt: 0, lastSeenAt: 0 };
    const expectedMap = new Map([[k, expectedSession]]);
    assert.deepEqual(result, { sessions: expectedMap, restored: 1, dropped: 0, orphaned: 0 });
  });
});

test('drops sessions whose user is not in knownUsers', () => {
  withStore(({ store, note }) => {
    const k = key('s1');
    writeFileSync(store, JSON.stringify({
      version: 1,
      sessions: { [k]: { provider: 'p', user: 'u', createdAt: 0, lastSeenAt: 0 } }
    }));
    const result = loadSessions({ ttlMs: 1000, now: 1000, knownUsers: new Set(['other']), onNote: note });
    assert.deepEqual(result, { sessions: new Map([]), restored: 0, dropped: 1, orphaned: 1 });
  });
});

test('drops sessions with no user field', () => {
  withStore(({ store, note }) => {
    const k = key('s1');
    writeFileSync(store, JSON.stringify({
      version: 1,
      sessions: { [k]: { provider: 'p', createdAt: 0, lastSeenAt: 0 } }
    }));
    const result = loadSessions({ ttlMs: 1000, now: 1000, knownUsers: new Set(['u']), onNote: note });
    assert.deepEqual(result, { sessions: new Map([]), restored: 0, dropped: 1, orphaned: 1 });
  });
});

test('redacts session records to only persisted fields', () => {
  withStore(({ store, note }) => {
    const k = key('s1');
    writeFileSync(store, JSON.stringify({
      version: 1,
      sessions: { [k]: { provider: 'p', user: 'u', createdAt: 0, lastSeenAt: 0, secret: 'x' } }
    }));
    const result = loadSessions({ ttlMs: 1000, now: 1000, knownUsers: new Set(['u']), onNote: note });
    const expectedSession = { provider: 'p', user: 'u', createdAt: 0, lastSeenAt: 0 };
    const expectedMap = new Map([[k, expectedSession]]);
    assert.deepEqual(result, { sessions: expectedMap, restored: 1, dropped: 0, orphaned: 0 });
  });
});

test('accepts knownUsers as array', () => {
  withStore(({ store, note }) => {
    const k = key('s1');
    writeFileSync(store, JSON.stringify({
      version: 1,
      sessions: { [k]: { provider: 'p', user: 'u', createdAt: 0, lastSeenAt: 0 } }
    }));
    const result = loadSessions({ ttlMs: 1000, now: 1000, knownUsers: ['u'], onNote: note });
    const expectedSession = { provider: 'p', user: 'u', createdAt: 0, lastSeenAt: 0 };
    const expectedMap = new Map([[k, expectedSession]]);
    assert.deepEqual(result, { sessions: expectedMap, restored: 1, dropped: 0, orphaned: 0 });
  });
});

test('treats missing knownUsers as empty set', () => {
  withStore(({ store, note }) => {
    const k = key('s1');
    writeFileSync(store, JSON.stringify({
      version: 1,
      sessions: { [k]: { provider: 'p', user: 'u', createdAt: 0, lastSeenAt: 0 } }
    }));
    const result = loadSessions({ ttlMs: 1000, now: 1000, onNote: note });
    assert.deepEqual(result, { sessions: new Map([]), restored: 0, dropped: 1, orphaned: 1 });
  });
});

test('drops session when now - last equals ttlMs + 1', () => {
  withStore(({ store, note }) => {
    const k = key('s1');
    writeFileSync(store, JSON.stringify({
      version: 1,
      sessions: { [k]: { provider: 'p', user: 'u', createdAt: 0, lastSeenAt: 0 } }
    }));
    const result = loadSessions({ ttlMs: 1000, now: 1001, knownUsers: new Set(['u']), onNote: note });
    assert.deepEqual(result, { sessions: new Map(), restored: 0, dropped: 1, orphaned: 0 });
  });
});

test('valid sha256 hex key passes regex check', () => {
  withStore(({ store, note }) => {
    const k = key('s1');
    writeFileSync(store, JSON.stringify({
      version: 1,
      sessions: { [k]: { provider: 'p', user: 'u', createdAt: 0, lastSeenAt: 0 } }
    }));
    const result = loadSessions({ ttlMs: 1000, now: 1000, knownUsers: new Set(['u']), onNote: note });
    assert.equal(result.restored, 1);
  });
});
