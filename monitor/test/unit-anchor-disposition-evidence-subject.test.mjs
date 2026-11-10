// Maps a disposition entry to its evidence subject fields (monitor/anchor-disposition.mjs evidenceSubject).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evidenceSubject } from '../anchor-disposition.mjs';

test('returns nulls when entry is empty', () => {
  const r = evidenceSubject({});
  assert.deepEqual(r, { anchor: null, state: null, baselineHash: null, currentHash: null, removedBy: null });
});

test('returns anchor and state when present', () => {
  const r = evidenceSubject({ anchor: 'a1', state: 'open' });
  assert.deepEqual(r, { anchor: "a1", state: "open", baselineHash: null, currentHash: null, removedBy: null });
});

test('uses baselineHash when anchorHash is absent', () => {
  const r = evidenceSubject({ baselineHash: 'b1' });
  assert.deepEqual(r, { anchor: null, state: null, baselineHash: "b1", currentHash: null, removedBy: null });
});

test('prefers baselineHash over anchorHash', () => {
  const r = evidenceSubject({ baselineHash: 'b1', anchorHash: 'a1' });
  assert.deepEqual(r, { anchor: null, state: null, baselineHash: "b1", currentHash: null, removedBy: null });
});

test('falls back to anchorHash when baselineHash is absent', () => {
  const r = evidenceSubject({ anchorHash: 'a1' });
  assert.deepEqual(r, { anchor: null, state: null, baselineHash: "a1", currentHash: null, removedBy: null });
});

test('returns currentHash when present', () => {
  const r = evidenceSubject({ currentHash: 'c1' });
  assert.deepEqual(r, { anchor: null, state: null, baselineHash: null, currentHash: "c1", removedBy: null });
});

test('returns removedBy when present', () => {
  const r = evidenceSubject({ removedBy: 'user1' });
  assert.deepEqual(r, { anchor: null, state: null, baselineHash: null, currentHash: null, removedBy: "user1" });
});

test('returns all fields when all are present', () => {
  const r = evidenceSubject({ anchor: 'a1', state: 'closed', baselineHash: 'b1', currentHash: 'c1', removedBy: 'user1' });
  assert.deepEqual(r, { anchor: "a1", state: "closed", baselineHash: "b1", currentHash: "c1", removedBy: "user1" });
});
