// Creates a registry object with state and methods (monitor/cwx-registry.mjs createRegistry).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '../cwx-registry.mjs';

test('initializes empty state when no argument is provided', () => {
  const r = createRegistry();
  assert.deepEqual(r.state, { nextOrdinal: 0, byKey: {}, entries: {} });
});

test('uses provided object as state when it is an object', () => {
  const r = createRegistry({ nextOrdinal: 5, byKey: {}, entries: {} });
  assert.deepEqual(r.state, { nextOrdinal: 5, byKey: {}, entries: {} });
});

test('initializes missing byKey and entries properties on provided state', () => {
  const r = createRegistry({ nextOrdinal: 0 });
  assert.deepEqual(r.state, { nextOrdinal: 0, byKey: {}, entries: {} });
});

test('initializes missing nextOrdinal to zero on provided state', () => {
  const r = createRegistry({ byKey: {}, entries: {} });
  assert.deepEqual(r.state, { byKey: {}, entries: {}, nextOrdinal: 0 });
});

test('mints first CWX id with ordinal zero and stores entry', () => {
  const r = createRegistry();
  const id = r.mint('key1', '2024-01-01T00:00:00Z', ['CWE-79']);
  assert.equal(id, "CWX-000000");
});

test('returns existing id when minting same finding key again', () => {
  const r = createRegistry();
  const id1 = r.mint('key1', '2024-01-01T00:00:00Z', ['CWE-79']);
  const id2 = r.mint('key1', '2024-01-02T00:00:00Z', ['CWE-89']);
  assert.equal(id2, "CWX-000000");
});

test('backfills weaknessClass when stored entry has empty class', () => {
  const r = createRegistry();
  const id = r.mint('key1', '2024-01-01T00:00:00Z', []);
  r.mint('key1', '2024-01-02T00:00:00Z', ['CWE-79']);
  assert.deepEqual(r.lookup(id).weaknessClass, ["CWE-79"]);
});

test('does not overwrite non-empty weaknessClass on re-mint', () => {
  const r = createRegistry();
  const id = r.mint('key1', '2024-01-01T00:00:00Z', ['CWE-79']);
  r.mint('key1', '2024-01-02T00:00:00Z', ['CWE-89']);
  assert.deepEqual(r.lookup(id).weaknessClass, ["CWE-79"]);
});

test('mapToPublic returns mapping object with CVE reference', () => {
  const r = createRegistry();
  const id = r.mint('key1', '2024-01-01T00:00:00Z', ['CWE-79']);
  const result = r.mapToPublic(id, 'CVE-2024-1234');
  assert.deepEqual(result, { primaryId: "CVE-2024-1234", cwxRef: "CWX-000000", foundationalNow: false, foundFirst: true });
});

test('mapToPublic throws when public advisory id is invalid', () => {
  const r = createRegistry();
  const id = r.mint('key1', '2024-01-01T00:00:00Z', ['CWE-79']);
  assert.throws(() => r.mapToPublic(id, 'INVALID'), { name: "Error", message: "not a public advisory: INVALID" });
});
