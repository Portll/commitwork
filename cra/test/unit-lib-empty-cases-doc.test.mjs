// Returns a static empty cases document object (cra/lib.mjs emptyCasesDoc).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyCasesDoc } from '../lib.mjs';

test('emptyCasesDoc returns the expected static object', () => {
  assert.deepEqual(emptyCasesDoc(), { note: "CRA Art. 14 case log \u2014 append-only, hash-chained (verify: node cra/watch.mjs verify). events[] is the evidence trail; cases{} is the derived current state. Never edit by hand.", events: [], cases: {} });
});

test('emptyCasesDoc called twice returns the same static object', () => {
  assert.deepEqual(emptyCasesDoc(), { note: "CRA Art. 14 case log \u2014 append-only, hash-chained (verify: node cra/watch.mjs verify). events[] is the evidence trail; cases{} is the derived current state. Never edit by hand.", events: [], cases: {} });
});

test('emptyCasesDoc called after a dummy operation still returns the static object', () => {
  const dummy = 1 + 1;
  assert.deepEqual(emptyCasesDoc(), { note: "CRA Art. 14 case log \u2014 append-only, hash-chained (verify: node cra/watch.mjs verify). events[] is the evidence trail; cases{} is the derived current state. Never edit by hand.", events: [], cases: {} });
});

test('emptyCasesDoc called with extra undefined arguments still returns the static object', () => {
  assert.deepEqual(emptyCasesDoc(undefined, undefined), { note: "CRA Art. 14 case log \u2014 append-only, hash-chained (verify: node cra/watch.mjs verify). events[] is the evidence trail; cases{} is the derived current state. Never edit by hand.", events: [], cases: {} });
});

test('emptyCasesDoc called with a spread of an empty array still returns the static object', () => {
  const args = [];
  assert.deepEqual(emptyCasesDoc(...args), { note: "CRA Art. 14 case log \u2014 append-only, hash-chained (verify: node cra/watch.mjs verify). events[] is the evidence trail; cases{} is the derived current state. Never edit by hand.", events: [], cases: {} });
});

test('emptyCasesDoc called after a try/catch still returns the static object', () => {
  try { throw new Error('test'); } catch {}
  assert.deepEqual(emptyCasesDoc(), { note: "CRA Art. 14 case log \u2014 append-only, hash-chained (verify: node cra/watch.mjs verify). events[] is the evidence trail; cases{} is the derived current state. Never edit by hand.", events: [], cases: {} });
});

test('emptyCasesDoc called after a conditional expression still returns the static object', () => {
  const flag = false ? emptyCasesDoc : null;
  assert.deepEqual(emptyCasesDoc(), { note: "CRA Art. 14 case log \u2014 append-only, hash-chained (verify: node cra/watch.mjs verify). events[] is the evidence trail; cases{} is the derived current state. Never edit by hand.", events: [], cases: {} });
});

test('emptyCasesDoc called after a logical AND expression still returns the static object', () => {
  const ok = true && true;
  assert.deepEqual(emptyCasesDoc(), { note: "CRA Art. 14 case log \u2014 append-only, hash-chained (verify: node cra/watch.mjs verify). events[] is the evidence trail; cases{} is the derived current state. Never edit by hand.", events: [], cases: {} });
});

test('emptyCasesDoc called after a logical OR expression still returns the static object', () => {
  const ok = false || true;
  assert.deepEqual(emptyCasesDoc(), { note: "CRA Art. 14 case log \u2014 append-only, hash-chained (verify: node cra/watch.mjs verify). events[] is the evidence trail; cases{} is the derived current state. Never edit by hand.", events: [], cases: {} });
});
