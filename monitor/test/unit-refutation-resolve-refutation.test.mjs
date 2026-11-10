// Resolves an open refutation by recording its outcome and appending a chained event. (monitor/refutation.mjs resolveRefutation).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRefutation } from '../refutation.mjs';

test('throws for an unknown refutation id', () => {
  const doc = { refutations: {}, events: [] };
  assert.throws(() => resolveRefutation(doc, 'missing', { resolution: 'upheld', why: 'w', by: 'b', at: 1 }), { name: 'Error', message: 'unknown refutation missing' });
});

test('throws when the refutation is already resolved', () => {
  const doc = { refutations: { r1: { state: 'resolved', resolution: 'upheld', by: 'x' } }, events: [] };
  assert.throws(() => resolveRefutation(doc, 'r1', { resolution: 'conceded', why: 'w', by: 'b', at: 1 }), { name: 'Error', message: 'r1 is already resolved (upheld)' });
});

test('throws for a resolution outside the allowed set', () => {
  const doc = { refutations: { r1: { state: 'open', by: 'x' } }, events: [] };
  assert.throws(() => resolveRefutation(doc, 'r1', { resolution: 'bogus', why: 'w', by: 'b', at: 1 }), { name: 'Error', message: 'resolution must be one of upheld|conceded|withdrawn' });
});

test('throws when the reason is blank', () => {
  const doc = { refutations: { r1: { state: 'open', by: 'x' } }, events: [] };
  assert.throws(() => resolveRefutation(doc, 'r1', { resolution: 'upheld', why: '   ', by: 'b', at: 1 }), { name: 'Error', message: 'resolving a refutation requires a reason \u2014 an unexplained resolution is the claim winning by default' });
});

test('throws when the resolver is blank', () => {
  const doc = { refutations: { r1: { state: 'open', by: 'x' } }, events: [] };
  assert.throws(() => resolveRefutation(doc, 'r1', { resolution: 'upheld', why: 'w', by: '  ', at: 1 }), { name: 'Error', message: 'resolving a refutation requires a named resolver' });
});

test('throws when a non-refuter tries to withdraw', () => {
  const doc = { refutations: { r1: { state: 'open', by: 'alice' } }, events: [] };
  assert.throws(() => resolveRefutation(doc, 'r1', { resolution: 'withdrawn', why: 'w', by: 'bob', at: 1 }), { name: 'Error', message: 'only the refuter may withdraw their own refutation \u2014 anyone else resolving it is upholding or conceding, and must say which' });
});

test('marks a self-withdrawal as not independent', () => {
  const doc = { refutations: { r1: { state: 'open', by: 'alice' } }, events: [] };
  const r = resolveRefutation(doc, 'r1', { resolution: 'withdrawn', why: 'w', by: 'alice', at: 1 });
  assert.deepEqual(r, { state: "resolved", by: "alice", resolution: "withdrawn", resolvedBy: "alice", resolvedWhy: "w", resolvedAt: 1, resolvedIndependently: false });
});

test('marks an independent concession as independent', () => {
  const doc = { refutations: { r1: { state: 'open', by: 'alice' } }, events: [] };
  const r = resolveRefutation(doc, 'r1', { resolution: 'conceded', why: 'w', by: 'bob', at: 1 });
  assert.deepEqual(r, { state: "resolved", by: "alice", resolution: "conceded", resolvedBy: "bob", resolvedWhy: "w", resolvedAt: 1, resolvedIndependently: true });
});

test('marks a self-upholding as not independent', () => {
  const doc = { refutations: { r1: { state: 'open', by: 'alice' } }, events: [] };
  const r = resolveRefutation(doc, 'r1', { resolution: 'upheld', why: 'w', by: 'alice', at: 1 });
  assert.deepEqual(r, { state: "resolved", by: "alice", resolution: "upheld", resolvedBy: "alice", resolvedWhy: "w", resolvedAt: 1, resolvedIndependently: false });
});

test('appends a chained event to the document', () => {
  const doc = { refutations: { r1: { state: 'open', by: 'alice' } }, events: [] };
  const r = resolveRefutation(doc, 'r1', { resolution: 'upheld', why: 'w', by: 'bob', at: 1 });
  assert.deepEqual(doc, { refutations: { r1: { state: "resolved", by: "alice", resolution: "upheld", resolvedBy: "bob", resolvedWhy: "w", resolvedAt: 1, resolvedIndependently: true } }, events: [{ type: "refutation-resolved", refutationId: "r1", at: 1, data: { resolution: "upheld", by: "bob", independent: true }, prevHash: null, hash: "cd8ce5ce4ac8cd6ed445e07aec066e0e832d1e65a5ecc454d3bb6577fca34e56" }] });
});
