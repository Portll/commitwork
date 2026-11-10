// appends a chained event to a case document (cra/lib.mjs appendCaseEvent).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendCaseEvent } from '../lib.mjs';

test('adds event when document has no prior events', () => {
  const doc = { events: [] };
  const r = appendCaseEvent(doc, 'typeA', 'case1', { foo: 1 }, '2023-01-01T00:00:00Z');
  assert.deepEqual(r, { type: "typeA", caseId: "case1", at: "2023-01-01T00:00:00Z", data: { foo: 1 }, prevHash: null, hash: "174f88296ed8d740be7e2673850dba555f375ed56640f83a8a399c2c94fa28a7" });
  assert.deepEqual(doc.events, [r]);
});

test('adds event when document has one prior event', () => {
  const prior = { type: 'typePrev', caseId: 'case0', at: '2022-12-31T23:59:59Z', data: {}, prevHash: null, hash: 'hash0' };
  const doc = { events: [prior] };
  const r = appendCaseEvent(doc, 'typeB', 'case2', { bar: 2 }, '2023-01-02T00:00:00Z');
  assert.deepEqual(r, { type: "typeB", caseId: "case2", at: "2023-01-02T00:00:00Z", data: { bar: 2 }, prevHash: "hash0", hash: "71b2d88e03e77aaf392019e5765c72ca5f0ff8e240adec65296d94bd5224ebb2" });
  assert.deepEqual(doc.events, [prior, r]);
});

test('adds event when document has multiple prior events', () => {
  const ev1 = { type: 't1', caseId: 'c1', at: 'a', data: {}, prevHash: null, hash: 'h1' };
  const ev2 = { type: 't2', caseId: 'c2', at: 'b', data: {}, prevHash: 'h1', hash: 'h2' };
  const doc = { events: [ev1, ev2] };
  const r = appendCaseEvent(doc, 'typeC', 'case3', { baz: 3 }, '2023-01-03T00:00:00Z');
  assert.deepEqual(r, { type: "typeC", caseId: "case3", at: "2023-01-03T00:00:00Z", data: { baz: 3 }, prevHash: "h2", hash: "6adbad4d38aacbce697be5d2543a1fb8720771520e65db782cf57a899bcb88c5" });
  assert.deepEqual(doc.events, [ev1, ev2, r]);
});

test('event prevHash is null for empty history and non\u2011null otherwise', () => {
  const emptyDoc = { events: [] };
  const r1 = appendCaseEvent(emptyDoc, 't', 'c', {}, 't1');
  assert.deepEqual(r1.prevHash, null);
  const filledDoc = { events: [{ hash: 'prevHashVal' }] };
  const r2 = appendCaseEvent(filledDoc, 't', 'c', {}, 't2');
  assert.deepEqual(r2.prevHash, "prevHashVal");
});

test('event hash is computed from stable stringification (placeholder)', () => {
  const doc = { events: [] };
  const r = appendCaseEvent(doc, 'typeD', 'case4', { a: undefined, b: 2 }, '2023-01-04T00:00:00Z');
  assert.deepEqual(r.hash, "bb5716796c68e78bc209daa6d4caa5c4f44252d239166cd8cb75997a702fcc73");
});
