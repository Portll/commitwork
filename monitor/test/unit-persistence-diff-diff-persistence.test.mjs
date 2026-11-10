// Computes added, changed, removed, unverified, unbaselined, and state from observed vs baseline persistence items (monitor/persistence-diff.mjs diffPersistence).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffPersistence } from '../persistence-diff.mjs';

test('returns no-baseline state with empty arrays when baseline is null', () => {
  const observed = { items: [{ id: 'a', kind: 'ssh', sha256: 'x' }], unknowns: [] };
  const r = diffPersistence(observed, null);
  assert.deepEqual(r, { added: [], changed: [], removed: [], unchanged: 0, unverified: [], unbaselined: [], unknowns: [], state: "no-baseline" });
});

test('returns ok state when all items are unchanged and no unknowns exist', () => {
  const observed = { items: [{ id: 'a', kind: 'ssh', sha256: 'x' }], unknowns: [] };
  const baseline = { items: [{ id: 'a', kind: 'ssh', sha256: 'x' }], surfaces: ['ssh'] };
  const r = diffPersistence(observed, baseline);
  assert.deepEqual(r, { added: [], changed: [], removed: [], unchanged: 1, unverified: [], unbaselined: [], unknowns: [], state: "ok" });
});

test('returns findings state when an item is added', () => {
  const observed = { items: [{ id: 'a', kind: 'ssh', sha256: 'x' }, { id: 'b', kind: 'ssh', sha256: 'y' }], unknowns: [] };
  const baseline = { items: [{ id: 'a', kind: 'ssh', sha256: 'x' }], surfaces: ['ssh'] };
  const r = diffPersistence(observed, baseline);
  assert.deepEqual(r, { added: [{ id: "b", kind: "ssh", sha256: "y" }], changed: [], removed: [], unchanged: 1, unverified: [], unbaselined: [], unknowns: [], state: "findings" });
});

test('returns findings state when an item is changed', () => {
  const observed = { items: [{ id: 'a', kind: 'ssh', sha256: 'y' }], unknowns: [] };
  const baseline = { items: [{ id: 'a', kind: 'ssh', sha256: 'x' }], surfaces: ['ssh'] };
  const r = diffPersistence(observed, baseline);
  assert.deepEqual(r, { added: [], changed: [{ id: "a", kind: "ssh", sha256: "y", baselineSha256: "x" }], removed: [], unchanged: 0, unverified: [], unbaselined: [], unknowns: [], state: "findings" });
});

test('returns findings state when an item is removed', () => {
  const observed = { items: [], unknowns: [] };
  const baseline = { items: [{ id: 'a', kind: 'ssh', sha256: 'x' }], surfaces: ['ssh'] };
  const r = diffPersistence(observed, baseline);
  assert.deepEqual(r, { added: [], changed: [], removed: [{ id: "a", kind: "ssh", sha256: "x" }], unchanged: 0, unverified: [], unbaselined: [], unknowns: [], state: "findings" });
});

test('returns partial state when an item is unverified due to unreadable root', () => {
  const observed = { items: [], unknowns: [{ id: '/etc' }] };
  const baseline = { items: [{ id: '/etc/ssh', kind: 'ssh', sha256: 'x' }], surfaces: ['ssh'] };
  const r = diffPersistence(observed, baseline);
  assert.deepEqual(r, { added: [], changed: [], removed: [], unchanged: 0, unverified: [{ id: "/etc/ssh", kind: "ssh", sha256: "x" }], unbaselined: [], unknowns: [{ id: "/etc" }], state: "partial" });
});

test('returns partial state when an item is unbaselined', () => {
  const observed = { items: [{ id: 'a', kind: 'ssh', sha256: 'x' }], unknowns: [] };
  const baseline = { items: [], surfaces: [] };
  const r = diffPersistence(observed, baseline);
  assert.deepEqual(r, { added: [], changed: [], removed: [], unchanged: 0, unverified: [], unbaselined: [{ id: "a", kind: "ssh", sha256: "x" }], unknowns: [], state: "partial" });
});

test('returns partial state when unknowns exist but no findings', () => {
  const observed = { items: [{ id: 'a', kind: 'ssh', sha256: 'x' }], unknowns: [{ id: '/etc' }] };
  const baseline = { items: [{ id: 'a', kind: 'ssh', sha256: 'x' }], surfaces: ['ssh'] };
  const r = diffPersistence(observed, baseline);
  assert.deepEqual(r, { added: [], changed: [], removed: [], unchanged: 1, unverified: [], unbaselined: [], unknowns: [{ id: "/etc" }], state: "partial" });
});
