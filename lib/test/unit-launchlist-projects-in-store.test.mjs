// Sorted, de-duplicated union of project names from config.projects, state.items and state.ticks (lib/launchlist.mjs projectsInStore).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectsInStore } from '../launchlist.mjs';

test('returns an empty array when config and state have no project keys', () => {
  const r = projectsInStore({}, {});
  assert.deepEqual(r, []);
});

test('returns the config project names sorted when state is empty', () => {
  const r = projectsInStore({ projects: { b: {}, a: {} } }, {});
  assert.deepEqual(r, ['a', 'b']);
});

test('returns the state item names sorted when config has no projects', () => {
  const r = projectsInStore({}, { items: { z: {}, y: {} } });
  assert.deepEqual(r, ['y', 'z']);
});

test('returns the state tick names sorted when config has no projects', () => {
  const r = projectsInStore({}, { ticks: { m: {}, l: {} } });
  assert.deepEqual(r, ['l', 'm']);
});

test('merges names from all three sources and lists a shared name once', () => {
  const r = projectsInStore(
    { projects: { c: {}, dup: {} } },
    { items: { a: {}, dup: {} }, ticks: { b: {}, dup: {} } }
  );
  assert.deepEqual(r, ['a', 'b', 'c', 'dup']);
});

test('treats null projects, items and ticks as empty', () => {
  const r = projectsInStore({ projects: null }, { items: null, ticks: null });
  assert.deepEqual(r, []);
});

test('sorts names by string code units rather than numerically or case-insensitively', () => {
  const r = projectsInStore({ projects: { '10': {}, '9': {}, B: {}, a: {} } }, {});
  assert.deepEqual(r, ['10', '9', 'B', 'a']);
});

test('collects every generated item name in sorted order', () => {
  const items = Object.fromEntries(Array.from({ length: 5 }, (_, i) => ['p' + (4 - i), {}]));
  const r = projectsInStore({}, { items });
  assert.deepEqual(r, ['p0', 'p1', 'p2', 'p3', 'p4']);
});

test('throws a TypeError when config is null', () => {
  assert.throws(() => projectsInStore(null, {}), {
    name: 'TypeError',
    message: "Cannot read properties of null (reading 'projects')",
  });
});

test('throws a TypeError when state is null', () => {
  assert.throws(() => projectsInStore({}, null), {
    name: 'TypeError',
    message: "Cannot read properties of null (reading 'items')",
  });
});
