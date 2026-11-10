// Maps a category/provenance/present triple to a fixture source descriptor (monitor/lane-trust.mjs fixtureColumn).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureColumn } from '../lane-trust.mjs';

test('returns no-fixture when present is false', () => {
  assert.deepEqual(fixtureColumn('alpha', { alpha: { source: 'real' } }, false), { source: "no-fixture" });
});

test('returns no-fixture when present is true', () => {
  assert.deepEqual(fixtureColumn('alpha', { alpha: { source: 'real' } }, true), { source: "real" });
});

test('returns unrecorded with predates reason when provenance exists but category missing', () => {
  assert.deepEqual(fixtureColumn('beta', { alpha: { source: 'real' } }, true), { source: "unrecorded", why: "fixture predates provenance records" });
});

test('returns unrecorded with absent reason when provenance is null', () => {
  assert.deepEqual(fixtureColumn('beta', null, true), { source: "unrecorded", why: "PROVENANCE.json is absent" });
});

test('returns unrecorded with recorded source when source is unrecognised', () => {
  assert.deepEqual(fixtureColumn('gamma', { gamma: { source: 'bogus' } }, true), { source: "unrecorded", recorded: "bogus", why: "provenance names no recognised source" });
});

test('returns real source with check and accepted fields', () => {
  assert.deepEqual(fixtureColumn('delta', { delta: { source: 'real', check: 'c1', accepted: true } }, true), { source: "real", check: "c1", accepted: true });
});

test('returns synthetic source with reason from why field', () => {
  assert.deepEqual(fixtureColumn('epsilon', { epsilon: { source: 'synthetic', why: 'generated' } }, true), { source: "synthetic", reason: "generated" });
});

test('returns synthetic source with null reason when why is absent', () => {
  assert.deepEqual(fixtureColumn('zeta', { zeta: { source: 'synthetic' } }, true), { source: "synthetic", reason: null });
});
