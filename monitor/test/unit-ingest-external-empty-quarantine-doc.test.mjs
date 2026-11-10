// Builds the initial empty quarantine ledger document (monitor/ingest-external.mjs emptyQuarantineDoc).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyQuarantineDoc } from '../ingest-external.mjs';

const NOTE = 'commitwork external-ingest QUARANTINE \u2014 every judgement the return path refused, with '
  + 'the raw payload kept as an opaque STRING. Never re-applied, never parsed back into the '
  + 'issue store. Written by monitor/ingest-external.mjs; never edit by hand.';

test('the note describes the quarantine ledger with the exact fixed text', () => {
  const r = emptyQuarantineDoc();
  assert.equal(r.note, NOTE);
});

test('the version starts at 1', () => {
  const r = emptyQuarantineDoc();
  assert.equal(r.version, 1);
});

test('the dropped counter starts at 0', () => {
  const r = emptyQuarantineDoc();
  assert.equal(r.dropped, 0);
});

test('the entries list starts empty', () => {
  const r = emptyQuarantineDoc();
  assert.deepEqual(r.entries, []);
});

test('the keys are note, version, dropped and entries in that order', () => {
  const r = emptyQuarantineDoc();
  assert.deepEqual(Object.keys(r), ['note', 'version', 'dropped', 'entries']);
});

test('the document is a plain object', () => {
  const r = emptyQuarantineDoc();
  assert.equal(Object.getPrototypeOf(r), Object.prototype);
});

test('the whole document matches the exact expected value', () => {
  const r = emptyQuarantineDoc();
  assert.deepEqual(r, { note: NOTE, version: 1, dropped: 0, entries: [] });
});

test('each call returns a new document with a new entries array', () => {
  const a = emptyQuarantineDoc();
  const b = emptyQuarantineDoc();
  assert.equal(a === b, false);
  assert.equal(a.entries === b.entries, false);
});

test('changing one document does not affect the next one returned', () => {
  const a = emptyQuarantineDoc();
  a.dropped = 5;
  a.version = 9;
  a.entries.push('payload');
  const b = emptyQuarantineDoc();
  assert.deepEqual(b, { note: NOTE, version: 1, dropped: 0, entries: [] });
});
