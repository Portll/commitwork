// Computes the next picker state or a cancel/done action from a key press (bin/lib/checkbox-tui.mjs pickerReduce).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickerReduce } from '../lib/checkbox-tui.mjs';

test('returns cancel true when key is quit', () => {
  const state = { cursor: 0, types: [], unchecked: new Set() };
  const model = { rows: [] };
  const r = pickerReduce(state, 'quit', model);
  assert.deepEqual(r, { cancel: true });
});

test('moves cursor up to zero when at top', () => {
  const state = { cursor: 0, types: [], unchecked: new Set() };
  const model = { rows: [{ id: 'dep:a', name: 'a', checked: false, pick: null, available: false }] };
  const r = pickerReduce(state, 'up', model);
  assert.deepEqual(r, { cursor: 0, types: [], unchecked: new Set([]) });
});

test('moves cursor up from one to zero', () => {
  const state = { cursor: 1, types: [], unchecked: new Set() };
  const model = { rows: [{ id: 'dep:a', name: 'a', checked: false, pick: null, available: false }, { id: 'dep:b', name: 'b', checked: false, pick: null, available: false }] };
  const r = pickerReduce(state, 'up', model);
  assert.deepEqual(r, { cursor: 0, types: [], unchecked: new Set([]) });
});

test('moves cursor down to last row', () => {
  const state = { cursor: 1, types: [], unchecked: new Set() };
  const model = { rows: [{ id: 'dep:a', name: 'a', checked: false, pick: null, available: false }, { id: 'dep:b', name: 'b', checked: false, pick: null, available: false }] };
  const r = pickerReduce(state, 'down', model);
  assert.deepEqual(r, { cursor: 1, types: [], unchecked: new Set([]) });
});

test('moves cursor down from zero to one', () => {
  const state = { cursor: 0, types: [], unchecked: new Set() };
  const model = { rows: [{ id: 'dep:a', name: 'a', checked: false, pick: null, available: false }, { id: 'dep:b', name: 'b', checked: false, pick: null, available: false }] };
  const r = pickerReduce(state, 'down', model);
  assert.deepEqual(r, { cursor: 1, types: [], unchecked: new Set([]) });
});

test('adds type when not present', () => {
  const state = { cursor: 0, types: ['minor'], unchecked: new Set() };
  const model = { rows: [] };
  const r = pickerReduce(state, 'type:patch', model);
  assert.deepEqual(r, { cursor: 0, types: ["minor", "patch"], unchecked: new Set([]) });
});

test('removes type when present', () => {
  const state = { cursor: 0, types: ['minor', 'patch'], unchecked: new Set() };
  const model = { rows: [] };
  const r = pickerReduce(state, 'type:minor', model);
  assert.deepEqual(r, { cursor: 0, types: ["patch"], unchecked: new Set([]) });
});

test('toggles unchecked set for dependency with pick', () => {
  const state = { cursor: 0, types: [], unchecked: new Set() };
  const model = { rows: [{ id: 'dep:a', name: 'a', checked: false, pick: { version: '1.0.0' }, available: false }] };
  const r = pickerReduce(state, 'toggle', model);
  assert.deepEqual(r, { cursor: 0, types: [], unchecked: new Set(["a"]) });
});

test('toggles checked flag for non-dependency row', () => {
  const state = { cursor: 0, types: [], unchecked: new Set(), lockfile: false };
  const model = { rows: [{ id: 'lockfile', name: 'lockfile', checked: false, pick: null, available: true }] };
  const r = pickerReduce(state, 'toggle', model);
  assert.deepEqual(r, { cursor: 0, types: [], unchecked: new Set([]), lockfile: true });
});

test('returns done with direct and switch values on enter', () => {
  const state = { cursor: 0, types: ['minor'], unchecked: new Set() };
  const model = { rows: [
    { id: 'dep:a', name: 'a', checked: true, pick: { version: '1.0.0' }, available: false },
    { id: 'lockfile', name: 'lockfile', checked: true, pick: null, available: true },
    { id: 'advisories', name: 'advisories', checked: false, pick: null, available: true }
  ] };
  const r = pickerReduce(state, 'enter', model);
  assert.deepEqual(r, { done: { direct: [{ name: "a", version: "1.0.0" }], lockfile: true, advisories: false, merge: undefined, types: ["minor"] } });
});
