// Session roster summary with verdict and completeness (bin/session-roster.mjs summarise).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarise } from '../session-roster.mjs';

test('returns null name and empty arrays for empty input', () => {
  assert.deepEqual(summarise([]), { name: null, ids: [], refs: [], verdict: "single", complete: false });
});

test('returns single verdict for one row with id and ref', () => {
  assert.deepEqual(summarise([{ id: 'a', ref: 'r', name: 'n' }]), { name: "n", ids: ["a"], refs: ["r"], verdict: "single", complete: true });
});

test('returns reused verdict for two distinct ids', () => {
  assert.deepEqual(summarise([{ id: 'a', ref: 'r' }, { id: 'b', ref: 'r' }]), { name: null, ids: ["a", "b"], refs: ["r"], verdict: "reused", complete: false });
});

test('returns ambiguous verdict for two distinct refs and no ids', () => {
  assert.deepEqual(summarise([{ ref: 'r1' }, { ref: 'r2' }]), { name: null, ids: [], refs: ["r1", "r2"], verdict: "ambiguous", complete: false });
});

test('returns single verdict for one id and multiple refs', () => {
  assert.deepEqual(summarise([{ id: 'a', ref: 'r1' }, { id: 'a', ref: 'r2' }]), { name: null, ids: ["a"], refs: ["r1", "r2"], verdict: "single", complete: false });
});

test('returns single verdict for multiple rows with same id and ref', () => {
  assert.deepEqual(summarise([{ id: 'a', ref: 'r' }, { id: 'a', ref: 'r' }]), { name: null, ids: ["a"], refs: ["r"], verdict: "single", complete: true });
});

test('returns single verdict for one id and one ref with multiple rows', () => {
  assert.deepEqual(summarise([{ id: 'a', ref: 'r' }, { id: 'a', ref: 'r' }]), { name: null, ids: ["a"], refs: ["r"], verdict: "single", complete: true });
});

test('returns single verdict for one ref and no ids', () => {
  assert.deepEqual(summarise([{ ref: 'r' }]), { name: null, ids: [], refs: ["r"], verdict: "single", complete: false });
});
