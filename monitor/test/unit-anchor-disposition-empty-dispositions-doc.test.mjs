// Fresh empty dispositions document shape (monitor/anchor-disposition.mjs emptyDispositionsDoc).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyDispositionsDoc } from '../anchor-disposition.mjs';

test('returns an object with a note, version, and rulings', () => {
  const r = emptyDispositionsDoc();
  assert.deepEqual(r, { note: "Human rulings on drifted audit anchors \u2014 whether the finding was FIXED or merely moved. Append-only; each ruling carries the evidence digest it was made against and goes stale when that evidence changes. Written by the panel; never edit by hand.", version: 1, rulings: [] });
});

test('sets version to 1', () => {
  const r = emptyDispositionsDoc();
  assert.equal(r.version, 1);
});

test('initialises rulings as an empty array', () => {
  const r = emptyDispositionsDoc();
  assert.deepEqual(r.rulings, []);
});

test('note is a non-empty string', () => {
  const r = emptyDispositionsDoc();
  assert.equal(typeof r.note, "string");
});

test('note mentions FIXED and moved', () => {
  const r = emptyDispositionsDoc();
  assert.equal(r.note.includes('FIXED'), true);
});

test('note mentions append-only', () => {
  const r = emptyDispositionsDoc();
  assert.equal(r.note.includes('Append-only'), true);
});

test('note mentions stale when evidence changes', () => {
  const r = emptyDispositionsDoc();
  assert.equal(r.note.includes('stale'), true);
});

test('note mentions never edit by hand', () => {
  const r = emptyDispositionsDoc();
  assert.equal(r.note.includes('never edit by hand'), true);
});

test('note mentions evidence digest', () => {
  const r = emptyDispositionsDoc();
  assert.equal(r.note.includes('evidence digest'), true);
});

test('note mentions panel', () => {
  const r = emptyDispositionsDoc();
  assert.equal(r.note.includes('panel'), true);
});
