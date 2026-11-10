// Computes the checks column state from bundled manifests (monitor/lane-trust.mjs checksColumn).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checksColumn } from '../lane-trust.mjs';

test('returns not-measured when byManifest is null', () => {
  const r = checksColumn(null, []);
  assert.deepEqual(r, { state: "not-measured", why: "the bundled manifests are absent or were not supplied" });
});

test('returns not-measured when byManifest is undefined', () => {
  const r = checksColumn(undefined, []);
  assert.deepEqual(r, { state: "not-measured", why: "the bundled manifests are absent or were not supplied" });
});

test('returns not-measured when byManifest is false', () => {
  const r = checksColumn(false, []);
  assert.deepEqual(r, { state: "not-measured", why: "the bundled manifests are absent or were not supplied" });
});

test('returns not-measured when byManifest is 0', () => {
  const r = checksColumn(0, []);
  assert.deepEqual(r, { state: "not-measured", why: "the bundled manifests are absent or were not supplied" });
});

test('returns not-measured when byManifest is empty string', () => {
  const r = checksColumn('', []);
  assert.deepEqual(r, { state: "not-measured", why: "the bundled manifests are absent or were not supplied" });
});

test('returns read state with accountBundled result when byManifest is truthy object', () => {
  const r = checksColumn({}, []);
  assert.deepEqual(r, { state: "read", declared: 0, manifests: {}, lanes: {}, notLanes: {}, unaccounted: [] });
});

test('returns read state with accountBundled result when byManifest is non-empty string', () => {
  const r = checksColumn('x', []);
  assert.deepEqual(r, { state: "read", declared: 1, manifests: { "0": { declared: 1, inLanes: 0, notLanes: 0, unaccounted: 1 } }, lanes: { "0": {} }, notLanes: { "0": {} }, unaccounted: [{ manifest: "0", check: undefined, why: "no lane reads it and it is not marked notALane" }] });
});

test('returns read state with accountBundled result when byManifest is 1', () => {
  const r = checksColumn(1, []);
  assert.deepEqual(r, { state: "read", declared: 0, manifests: {}, lanes: {}, notLanes: {}, unaccounted: [] });
});
