// Computes a normalized identity record for a listener entry (monitor/host-baseline.mjs listenerIdentity).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listenerIdentity } from '../host-baseline.mjs';

test('returns empty holders when owners is undefined', () => {
  const r = listenerIdentity({ owner: 'o1', external: false, binding: 'b1' });
  assert.deepEqual(r, { owner: "o1", external: false, binding: "b1", holders: [], containers: [], declaredFor: [] });
});

test('returns empty holders when owners is an empty array', () => {
  const r = listenerIdentity({ owner: 'o2', external: true, binding: null, owners: [] });
  assert.deepEqual(r, { owner: "o2", external: true, binding: null, holders: [], containers: [], declaredFor: [] });
});

test('filters out ephemeral owners and deduplicates holders', () => {
  const r = listenerIdentity({
    owner: 'o3',
    external: false,
    binding: 'b3',
    owners: [
      { command: 'cmd1', user: 'u1', ephemeral: false },
      { command: 'cmd1', user: 'u1', ephemeral: false },
      { command: 'cmd2', user: 'u2', ephemeral: true },
    ],
  });
  assert.deepEqual(r, { owner: "o3", external: false, binding: "b3", holders: ["cmd1:u1"], containers: [], declaredFor: [] });
});

test('uses question marks for missing command and user fields', () => {
  const r = listenerIdentity({
    owner: 'o4',
    external: true,
    binding: 'b4',
    owners: [
      { ephemeral: false },
      { command: 'cmd3', ephemeral: false },
      { user: 'u3', ephemeral: false },
    ],
  });
  assert.deepEqual(r, { owner: "o4", external: true, binding: "b4", holders: ["?:?", "?:u3", "cmd3:?"], containers: [], declaredFor: [] });
});

test('returns empty containers when containers is undefined', () => {
  const r = listenerIdentity({ owner: 'o5', external: false, binding: 'b5', containers: undefined });
  assert.deepEqual(r, { owner: "o5", external: false, binding: "b5", holders: [], containers: [], declaredFor: [] });
});

test('returns empty containers when containers is an empty array', () => {
  const r = listenerIdentity({ owner: 'o6', external: true, binding: null, containers: [] });
  assert.deepEqual(r, { owner: "o6", external: true, binding: null, holders: [], containers: [], declaredFor: [] });
});

test('sorts containers and declaredFor arrays', () => {
  const r = listenerIdentity({
    owner: 'o7',
    external: false,
    binding: 'b7',
    containers: ['c3', 'c1', 'c2'],
    declaredFor: ['d2', 'd1', 'd3'],
  });
  assert.deepEqual(r, { owner: "o7", external: false, binding: "b7", holders: [], containers: ["c1", "c2", "c3"], declaredFor: ["d1", "d2", "d3"] });
});

test('returns empty declaredFor when declaredFor is undefined', () => {
  const r = listenerIdentity({ owner: 'o8', external: true, binding: 'b8', declaredFor: undefined });
  assert.deepEqual(r, { owner: "o8", external: true, binding: "b8", holders: [], containers: [], declaredFor: [] });
});

test('returns empty declaredFor when declaredFor is an empty array', () => {
  const r = listenerIdentity({ owner: 'o9', external: false, binding: null, declaredFor: [] });
  assert.deepEqual(r, { owner: "o9", external: false, binding: null, holders: [], containers: [], declaredFor: [] });
});

test('handles all fields present with non-empty arrays', () => {
  const r = listenerIdentity({
    owner: 'o10',
    external: true,
    binding: 'b10',
    owners: [{ command: 'cmd10', user: 'u10', ephemeral: false }],
    containers: ['c10'],
    declaredFor: ['d10'],
  });
  assert.deepEqual(r, { owner: "o10", external: true, binding: "b10", holders: ["cmd10:u10"], containers: ["c10"], declaredFor: ["d10"] });
});
