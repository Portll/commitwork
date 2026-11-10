// maps items to read/snoozed state (monitor/inbox.mjs withState).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withState } from '../inbox.mjs';

test('returns read true and future snoozed when entry has readAt and snoozedUntil after now', () => {
  const items = [{ id: 'a', name: 'item1' }];
  const state = {
    entries: {
      'user\u0000a': { readAt: '2023-01-01T00:00:00Z', snoozedUntil: '2099-01-01T00:00:00Z' },
    },
  };
  const who = 'user';
  const nowIso = '2024-01-01T00:00:00Z';
  assert.deepEqual(withState(items, state, who, nowIso), [{ id: "a", name: "item1", read: true, readAt: "2023-01-01T00:00:00Z", snoozedUntil: "2099-01-01T00:00:00Z" }]);
});

test('returns read false and no snoozed when entry has no readAt and snoozedUntil before now', () => {
  const items = [{ id: 'b', name: 'item2' }];
  const state = {
    entries: {
      'alice\u0000b': { snoozedUntil: '2020-01-01T00:00:00Z' },
    },
  };
  const who = 'alice';
  const nowIso = '2024-01-01T00:00:00Z';
  assert.deepEqual(withState(items, state, who, nowIso), [{ id: "b", name: "item2", read: false, readAt: null, snoozedUntil: null }]);
});

test('returns defaults when entry is missing', () => {
  const items = [{ id: 'c', name: 'item3' }];
  const state = { entries: {} };
  const who = 'bob';
  const nowIso = '2024-01-01T00:00:00Z';
  assert.deepEqual(withState(items, state, who, nowIso), [{ id: "c", name: "item3", read: false, readAt: null, snoozedUntil: null }]);
});

test('snoozedUntil equal to now results in null (strict greater comparison)', () => {
  const items = [{ id: 'd', name: 'item4' }];
  const state = {
    entries: {
      'carol\u0000d': { snoozedUntil: '2024-01-01T00:00:00Z' },
    },
  };
  const who = 'carol';
  const nowIso = '2024-01-01T00:00:00Z';
  assert.deepEqual(withState(items, state, who, nowIso), [{ id: "d", name: "item4", read: false, readAt: null, snoozedUntil: null }]);
});

test('different who leads to missing entry and default values', () => {
  const items = [{ id: 'e', name: 'item5' }];
  const state = {
    entries: {
      'dave\u0000e': { readAt: '2022-01-01T00:00:00Z', snoozedUntil: '2030-01-01T00:00:00Z' },
    },
  };
  const who = 'eve';
  const nowIso = '2024-01-01T00:00:00Z';
  assert.deepEqual(withState(items, state, who, nowIso), [{ id: "e", name: "item5", read: false, readAt: null, snoozedUntil: null }]);
});

test('entry with readAt falsy and snoozedUntil undefined yields read false and null snoozed', () => {
  const items = [{ id: 'f', name: 'item6' }];
  const state = {
    entries: {
      'frank\u0000f': { readAt: null },
    },
  };
  const who = 'frank';
  const nowIso = '2024-01-01T00:00:00Z';
  assert.deepEqual(withState(items, state, who, nowIso), [{ id: "f", name: "item6", read: false, readAt: null, snoozedUntil: null }]);
});

test('multiple items map independently', () => {
  const items = [
    { id: 'g', name: 'item7' },
    { id: 'h', name: 'item8' },
  ];
  const state = {
    entries: {
      'gina\u0000g': { readAt: '2021-01-01T00:00:00Z' },
      'gina\u0000h': { snoozedUntil: '2050-01-01T00:00:00Z' },
    },
  };
  const who = 'gina';
  const nowIso = '2024-01-01T00:00:00Z';
  assert.deepEqual(withState(items, state, who, nowIso), [{ id: "g", name: "item7", read: true, readAt: "2021-01-01T00:00:00Z", snoozedUntil: null }, { id: "h", name: "item8", read: false, readAt: null, snoozedUntil: "2050-01-01T00:00:00Z" }]);
});
