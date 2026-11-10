// Computes per-edition class counts, attribution map, unattributed ids, and claim-drift errors (bin/taxonomy-web.mjs reconcile).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcile } from '../taxonomy-web.mjs';

test('empty registry and lineage yield empty results', () => {
  const r = reconcile({ classes: [] }, { editions: [] });
  assert.deepEqual(r, { editions: [], byClass: new Map([]), unattributed: [], errors: [] });
});

test('single edition with one class and matching countAfter', () => {
  const registry = { classes: [{ id: 'a' }] };
  const lineage = { editions: [{ version: 1, changes: [{ kind: 'classes', ids: ['a'] }], countAfter: 1 }] };
  const r = reconcile(registry, lineage);
  assert.deepEqual(r, { editions: [{ version: 1, changes: [{ kind: "classes", ids: ["a"] }], countAfter: 1, computedAfter: 1, addedCount: 1 }], byClass: new Map([["a", 1]]), unattributed: [], errors: [] });
});

test('edition with no changes field defaults to empty', () => {
  const registry = { classes: [{ id: 'a' }] };
  const lineage = { editions: [{ version: 1, countAfter: 0 }] };
  const r = reconcile(registry, lineage);
  assert.deepEqual(r, { editions: [{ version: 1, countAfter: 0, computedAfter: 0, addedCount: 0 }], byClass: new Map([]), unattributed: ["a"], errors: [] });
});

test('edition with no ids field defaults to empty', () => {
  const registry = { classes: [{ id: 'a' }] };
  const lineage = { editions: [{ version: 1, changes: [{ kind: 'classes' }], countAfter: 0 }] };
  const r = reconcile(registry, lineage);
  assert.deepEqual(r, { editions: [{ version: 1, changes: [{ kind: "classes" }], countAfter: 0, computedAfter: 0, addedCount: 0 }], byClass: new Map([]), unattributed: ["a"], errors: [] });
});

test('non-class change kind is skipped', () => {
  const registry = { classes: [{ id: 'a' }] };
  const lineage = { editions: [{ version: 1, changes: [{ kind: 'other', ids: ['a'] }], countAfter: 0 }] };
  const r = reconcile(registry, lineage);
  assert.deepEqual(r, { editions: [{ version: 1, changes: [{ kind: "other", ids: ["a"] }], countAfter: 0, computedAfter: 0, addedCount: 0 }], byClass: new Map([]), unattributed: ["a"], errors: [] });
});

test('unknown class id in non-retired change produces error', () => {
  const registry = { classes: [{ id: 'a' }] };
  const lineage = { editions: [{ version: 1, changes: [{ kind: 'classes', ids: ['b'] }], countAfter: 1 }] };
  const r = reconcile(registry, lineage);
  assert.deepEqual(r, { editions: [{ version: 1, changes: [{ kind: "classes", ids: ["b"] }], countAfter: 1, computedAfter: 1, addedCount: 1 }], byClass: new Map([["b", 1]]), unattributed: ["a"], errors: ["v1 claims to introduce b, which the registry does not hold. Either the class was renamed or removed without the lineage moving, or the id is wrong; both are claim drift in the document whose subject is claim drift."] });
});

test('unknown class id in retired change produces no error', () => {
  const registry = { classes: [{ id: 'a' }] };
  const lineage = { editions: [{ version: 1, changes: [{ kind: 'classes', ids: ['b'], retired: true }], countAfter: 1 }] };
  const r = reconcile(registry, lineage);
  assert.deepEqual(r, { editions: [{ version: 1, changes: [{ kind: "classes", ids: ["b"], retired: true }], countAfter: 1, computedAfter: 1, addedCount: 1 }], byClass: new Map([["b", 1]]), unattributed: ["a"], errors: [] });
});

test('known class id in non-retired change produces no error', () => {
  const registry = { classes: [{ id: 'a' }] };
  const lineage = { editions: [{ version: 1, changes: [{ kind: 'classes', ids: ['a'] }], countAfter: 1 }] };
  const r = reconcile(registry, lineage);
  assert.deepEqual(r, { editions: [{ version: 1, changes: [{ kind: "classes", ids: ["a"] }], countAfter: 1, computedAfter: 1, addedCount: 1 }], byClass: new Map([["a", 1]]), unattributed: [], errors: [] });
});

test('class claimed by two editions produces duplicate error', () => {
  const registry = { classes: [{ id: 'a' }] };
  const lineage = { editions: [
    { version: 1, changes: [{ kind: 'classes', ids: ['a'] }], countAfter: 1 },
    { version: 2, changes: [{ kind: 'classes', ids: ['a'] }], countAfter: 2 }
  ]};
  const r = reconcile(registry, lineage);
  assert.deepEqual(r, { editions: [{ version: 1, changes: [{ kind: "classes", ids: ["a"] }], countAfter: 1, computedAfter: 1, addedCount: 1 }, { version: 2, changes: [{ kind: "classes", ids: ["a"] }], countAfter: 2, computedAfter: 2, addedCount: 1 }], byClass: new Map([["a", 1]]), unattributed: [], errors: ["Classes claimed by more than one edition: a (v1 and v2). Each class enters the catalogue once."] });
});

test('mismatched countAfter produces error', () => {
  const registry = { classes: [{ id: 'a' }] };
  const lineage = { editions: [{ version: 1, changes: [{ kind: 'classes', ids: ['a'] }], countAfter: 5 }] };
  const r = reconcile(registry, lineage);
  assert.deepEqual(r, { editions: [{ version: 1, changes: [{ kind: "classes", ids: ["a"] }], countAfter: 5, computedAfter: 1, addedCount: 1 }], byClass: new Map([["a", 1]]), unattributed: [], errors: ["v1 declares countAfter 5; the ids across every edition up to it sum to 1. A version history that does not add up cannot be checked by the reader it is for."] });
});

test('missing countAfter produces no count error', () => {
  const registry = { classes: [{ id: 'a' }] };
  const lineage = { editions: [{ version: 1, changes: [{ kind: 'classes', ids: ['a'] }] }] };
  const r = reconcile(registry, lineage);
  assert.deepEqual(r, { editions: [{ version: 1, changes: [{ kind: "classes", ids: ["a"] }], computedAfter: 1, addedCount: 1 }], byClass: new Map([["a", 1]]), unattributed: [], errors: [] });
});
