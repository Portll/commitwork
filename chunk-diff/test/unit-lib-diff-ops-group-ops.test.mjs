// Groups consecutive diff ops with the same type by summing their sizes. (chunk-diff/lib/diff-ops.mjs groupOps).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupOps } from '../lib/diff-ops.mjs';

test('returns an empty array when given no ops', () => {
  assert.deepEqual(groupOps([]), []);
});

test('keeps a single op as its own group', () => {
  assert.deepEqual(groupOps([{ t: 'add', s: 5 }]), [{ t: "add", s: 5 }]);
});

test('merges consecutive ops of the same type by summing sizes', () => {
  assert.deepEqual(groupOps([{ t: 'add', s: 3 }, { t: 'add', s: 4 }]), [{ t: "add", s: 7 }]);
});

test('starts a new group when the type changes', () => {
  assert.deepEqual(groupOps([{ t: 'add', s: 1 }, { t: 'del', s: 2 }]), [{ t: "add", s: 1 }, { t: "del", s: 2 }]);
});

test('merges a run of same-type ops then splits on a different type', () => {
  assert.deepEqual(groupOps([{ t: 'add', s: 1 }, { t: 'add', s: 2 }, { t: 'del', s: 3 }]), [{ t: "add", s: 3 }, { t: "del", s: 3 }]);
});

test('splits again when the type reverts to an earlier one', () => {
  assert.deepEqual(groupOps([{ t: 'add', s: 1 }, { t: 'del', s: 2 }, { t: 'add', s: 3 }]), [{ t: "add", s: 1 }, { t: "del", s: 2 }, { t: "add", s: 3 }]);
});

test('sums a long run of same-type ops into one group', () => {
  const ops = Array.from({ length: 100 }, (_, i) => ({ t: 'mod', s: i + 1 }));
  assert.deepEqual(groupOps(ops), [{ t: "mod", s: 5050 }]);
});

test('alternating types produce one group per op', () => {
  const ops = Array.from({ length: 6 }, (_, i) => ({ t: i % 2 === 0 ? 'add' : 'del', s: i + 1 }));
  assert.deepEqual(groupOps(ops), [{ t: "add", s: 1 }, { t: "del", s: 2 }, { t: "add", s: 3 }, { t: "del", s: 4 }, { t: "add", s: 5 }, { t: "del", s: 6 }]);
});
