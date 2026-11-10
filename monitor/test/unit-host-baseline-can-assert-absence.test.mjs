// Whether the host baseline inventory is complete enough to assert absence of unexpected sockets (monitor/host-baseline.mjs canAssertAbsence).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canAssertAbsence } from '../host-baseline.mjs';

test('returns true when inventory and socketTable are both ok', () => {
  const inventory = { ok: true, socketTable: { ok: true } };
  assert.equal(canAssertAbsence(inventory), true);
});

test('returns false when inventory is null', () => {
  assert.equal(canAssertAbsence(null), false);
});

test('returns false when inventory is undefined', () => {
  assert.equal(canAssertAbsence(undefined), false);
});

test('returns false when inventory ok is false', () => {
  const inventory = { ok: false, socketTable: { ok: true } };
  assert.equal(canAssertAbsence(inventory), false);
});

test('returns false when inventory ok is missing', () => {
  const inventory = { socketTable: { ok: true } };
  assert.equal(canAssertAbsence(inventory), false);
});

test('returns false when socketTable is null', () => {
  const inventory = { ok: true, socketTable: null };
  assert.equal(canAssertAbsence(inventory), false);
});

test('returns false when socketTable is missing', () => {
  const inventory = { ok: true };
  assert.equal(canAssertAbsence(inventory), false);
});

test('returns false when socketTable ok is false', () => {
  const inventory = { ok: true, socketTable: { ok: false } };
  assert.equal(canAssertAbsence(inventory), false);
});

test('returns false when socketTable ok is missing', () => {
  const inventory = { ok: true, socketTable: {} };
  assert.equal(canAssertAbsence(inventory), false);
});

test('returns false when inventory is an empty object', () => {
  assert.equal(canAssertAbsence({}), false);
});
