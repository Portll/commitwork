// Releases a claimed issue, reverting state to open and clearing the claim (monitor/issue-store.mjs releaseIssue).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseIssue } from '../issue-store.mjs';

test('throws for an unknown issue id', () => {
  const doc = { issues: {}, events: [] };
  assert.throws(() => releaseIssue(doc, 'nope', { at: '2025-01-01T00:00:00Z' }), {
    name: 'Error',
    message: 'unknown issue nope',
  });
});

test('reverts a claimed issue to open and clears the claim', () => {
  const doc = {
    issues: {
      i1: { id: 'i1', state: 'claimed', claim: { by: 'alice', sessionId: 's1', expiresAt: '2025-01-02T00:00:00Z' }, updatedAt: '2025-01-01T00:00:00Z' },
    },
    events: [],
  };
  const r = releaseIssue(doc, 'i1', { at: '2025-01-01T00:00:00Z', sessionId: 's1' });
  assert.deepEqual(r, { id: "i1", state: "open", claim: null, updatedAt: "2025-01-01T00:00:00Z" });
});

test('refuses release when another session holds an unexpired claim', () => {
  const doc = {
    issues: {
      i1: { id: 'i1', state: 'claimed', claim: { by: 'alice', sessionId: 's1', expiresAt: '2025-01-02T00:00:00Z' }, updatedAt: '2025-01-01T00:00:00Z' },
    },
    events: [],
  };
  assert.throws(() => releaseIssue(doc, 'i1', { at: '2025-01-01T00:00:00Z', sessionId: 's2' }), {
    name: 'Error',
    message: 'i1 is claimed by alice (session s1); release refused',
  });
});

test('allows release when the claim has expired even with a different session', () => {
  const doc = {
    issues: {
      i1: { id: 'i1', state: 'claimed', claim: { by: 'alice', sessionId: 's1', expiresAt: '2025-01-01T00:00:00Z' }, updatedAt: '2025-01-01T00:00:00Z' },
    },
    events: [],
  };
  const r = releaseIssue(doc, 'i1', { at: '2025-01-01T00:00:00Z', sessionId: 's2' });
  assert.deepEqual(r, { id: "i1", state: "open", claim: null, updatedAt: "2025-01-01T00:00:00Z" });
});

test('allows release with force even when another session holds an unexpired claim', () => {
  const doc = {
    issues: {
      i1: { id: 'i1', state: 'claimed', claim: { by: 'alice', sessionId: 's1', expiresAt: '2025-01-02T00:00:00Z' }, updatedAt: '2025-01-01T00:00:00Z' },
    },
    events: [],
  };
  const r = releaseIssue(doc, 'i1', { at: '2025-01-01T00:00:00Z', sessionId: 's2', force: true });
  assert.deepEqual(r, { id: "i1", state: "open", claim: null, updatedAt: "2025-01-01T00:00:00Z" });
});

test('leaves state unchanged when the issue is not claimed', () => {
  const doc = {
    issues: {
      i1: { id: 'i1', state: 'open', claim: null, updatedAt: '2025-01-01T00:00:00Z' },
    },
    events: [],
  };
  const r = releaseIssue(doc, 'i1', { at: '2025-01-01T00:00:00Z' });
  assert.deepEqual(r, { id: "i1", state: "open", claim: null, updatedAt: "2025-01-01T00:00:00Z" });
});

test('refuses release when sessionId is set and claim is unexpired with a different session', () => {
  const doc = {
    issues: {
      i1: { id: 'i1', state: 'claimed', claim: { by: 'bob', sessionId: 's9', expiresAt: '2025-01-03T00:00:00Z' }, updatedAt: '2025-01-01T00:00:00Z' },
    },
    events: [],
  };
  assert.throws(() => releaseIssue(doc, 'i1', { at: '2025-01-01T00:00:00Z', sessionId: 's10' }), {
    name: 'Error',
    message: 'i1 is claimed by bob (session s9); release refused',
  });
});

test('allows release when sessionId is null and claim is unexpired', () => {
  const doc = {
    issues: {
      i1: { id: 'i1', state: 'claimed', claim: { by: 'carol', sessionId: 's1', expiresAt: '2025-01-02T00:00:00Z' }, updatedAt: '2025-01-01T00:00:00Z' },
    },
    events: [],
  };
  const r = releaseIssue(doc, 'i1', { at: '2025-01-01T00:00:00Z' });
  assert.deepEqual(r, { id: "i1", state: "open", claim: null, updatedAt: "2025-01-01T00:00:00Z" });
});
