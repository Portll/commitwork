// Classifies a pidfile's claimed pid against observed socket holders (monitor/host-baseline.mjs pidfileWitness).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pidfileWitness } from '../host-baseline.mjs';

test('returns absent when raw is null and holders are empty', () => {
  const r = pidfileWitness([], null);
  assert.deepEqual(r, { state: "absent", claimed: null, holders: [] });
});

test('returns absent when raw is undefined and holders are empty', () => {
  const r = pidfileWitness([], undefined);
  assert.deepEqual(r, { state: "absent", claimed: null, holders: [] });
});

test('returns unreadable when raw is zero', () => {
  const r = pidfileWitness([], 0);
  assert.deepEqual(r, { state: "unreadable", claimed: null, holders: [], reason: "pidfile did not parse as a pid" });
});

test('returns unreadable when raw is negative', () => {
  const r = pidfileWitness([], -1);
  assert.deepEqual(r, { state: "unreadable", claimed: null, holders: [], reason: "pidfile did not parse as a pid" });
});

test('returns confirmed when claimed pid matches a holder', () => {
  const r = pidfileWitness([100, 200], 100);
  assert.deepEqual(r, { state: "confirmed", claimed: 100, holders: [100, 200] });
});

test('returns mismatch when claimed pid is not among holders', () => {
  const r = pidfileWitness([100, 200], 300);
  assert.deepEqual(r, { state: "mismatch", claimed: 300, holders: [100, 200], reason: "pidfile claims 300; socket is held by 100,200" });
});

test('returns mismatch when pid is claimed but no holders observed', () => {
  const r = pidfileWitness([], 50);
  assert.deepEqual(r, { state: "mismatch", claimed: 50, holders: [], reason: "a pid is claimed but no observed holder" });
});

test('returns confirmed when claimed pid matches and holders include non-integers', () => {
  const r = pidfileWitness(['100', 'abc', 200], 100);
  assert.deepEqual(r, { state: "confirmed", claimed: 100, holders: [100, 200] });
});
