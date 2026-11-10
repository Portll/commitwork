// determines class and reason for a queue entry (monitor/issue-key.mjs classForQueueEntry).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classForQueueEntry } from '../issue-key.mjs';

test('returns declared valid class with null reason', () => {
  const r = classForQueueEntry({ class: 'F' });
  assert.deepEqual(r, { cls: "F", why: null });
});

test('returns null class with reason when declared class is invalid', () => {
  const r = classForQueueEntry({ class: 'X' });
  assert.deepEqual(r, { cls: null, why: "class 'X' is not one of S/F/U/D/C" });
});

test('uses kind string that maps to a class', () => {
  const r = classForQueueEntry({ kind: 'missing-feature' });
  assert.deepEqual(r, { cls: "F", why: null });
});

test('kind string that does not map yields null class with reason', () => {
  const r = classForQueueEntry({ kind: 'unknown-kind' });
  assert.deepEqual(r, { cls: null, why: "kind 'unknown-kind' maps to no class and the entry declares none" });
});

test('kind non\u2011string object that maps to a class (original returns null, edited returns class)', () => {
  const r = classForQueueEntry({ kind: new String('hardcoded') });
  assert.deepEqual(r, { cls: null, why: "kind 'hardcoded' maps to no class and the entry declares none" });
});

test('kind non\u2011string object that does not map yields null class with reason', () => {
  const r = classForQueueEntry({ kind: 123 });
  assert.deepEqual(r, { cls: null, why: "kind '123' maps to no class and the entry declares none" });
});

test('no class nor kind results in null class with reason', () => {
  const r = classForQueueEntry({});
  assert.deepEqual(r, { cls: null, why: "kind '(none)' maps to no class and the entry declares none" });
});

test('declared null falls back to kind mapping', () => {
  const r = classForQueueEntry({ class: null, kind: 'stub' });
  assert.deepEqual(r, { cls: "F", why: null });
});

test('declared undefined falls back to kind mapping', () => {
  const r = classForQueueEntry({ class: undefined, kind: 'erroring' });
  assert.deepEqual(r, { cls: "F", why: null });
});
