// Maps declared adapter capabilities to observed receipt counts, flagging unknown, observed, and undeclared backends (admin/lib/memory-view.mjs adapterComparison).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adapterComparison } from '../lib/memory-view.mjs';

test('returns unknown observation when input is null', () => {
  const rows = adapterComparison(null);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].adapter, 'local');
  assert.equal(rows[0].observation, 'unknown');
  assert.equal(rows[0].observationReason, 'the receipt store could not be read, so nothing is known about this backend on this box');
  assert.equal(rows[0].counts, null);
  assert.equal(rows[1].adapter, 'veld');
  assert.equal(rows[1].observation, 'unknown');
  assert.equal(rows[1].counts, null);
});

test('returns unknown observation when input is undefined', () => {
  const rows = adapterComparison(undefined);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].observation, 'unknown');
  assert.equal(rows[1].observation, 'unknown');
});

test('returns unknown observation when input is a non-object primitive', () => {
  const rows = adapterComparison('local');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].observation, 'unknown');
  assert.equal(rows[1].observation, 'unknown');
});

test('marks declared adapters as never-observed when not in input object', () => {
  const rows = adapterComparison({});
  assert.equal(rows.length, 2);
  assert.equal(rows[0].adapter, 'local');
  assert.equal(rows[0].observation, 'never-observed');
  assert.equal(rows[0].observationReason, 'no receipt from this backend has ever been recorded here \u2014 that is nobody having looked, not a clean run');
  assert.equal(rows[0].counts, null);
  assert.equal(rows[1].adapter, 'veld');
  assert.equal(rows[1].observation, 'never-observed');
  assert.equal(rows[1].counts, null);
});

test('marks declared adapters as observed when present in input object', () => {
  const localCounts = { receipts: 5 };
  const veldCounts = { receipts: 3 };
  const rows = adapterComparison({ local: localCounts, veld: veldCounts });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].adapter, 'local');
  assert.equal(rows[0].observation, 'observed');
  assert.equal(rows[0].observationReason, null);
  assert.equal(rows[0].counts, localCounts);
  assert.equal(rows[1].adapter, 'veld');
  assert.equal(rows[1].observation, 'observed');
  assert.equal(rows[1].observationReason, null);
  assert.equal(rows[1].counts, veldCounts);
});

test('appends undeclared adapter when input contains unknown backend name', () => {
  const pgCounts = { receipts: 10 };
  const rows = adapterComparison({ postgres: pgCounts });
  assert.equal(rows.length, 3);
  assert.equal(rows[0].adapter, 'local');
  assert.equal(rows[0].observation, 'never-observed');
  assert.equal(rows[1].adapter, 'veld');
  assert.equal(rows[1].observation, 'never-observed');
  assert.equal(rows[2].adapter, 'postgres');
  assert.equal(rows[2].label, 'postgres \u2014 undeclared');
  assert.equal(rows[2].declared, false);
  assert.equal(rows[2].durability, null);
  assert.equal(rows[2].expectedStoredForm, null);
  assert.equal(rows[2].holds, null);
  assert.equal(rows[2].verification, null);
  assert.equal(rows[2].mintsTags, null);
  assert.equal(rows[2].tagsNote, null);
  assert.equal(rows[2].truncates, null);
  assert.equal(rows[2].identity, null);
  assert.equal(rows[2].source, null);
  assert.equal(rows[2].observation, 'observed');
  assert.equal(rows[2].observationReason, 'this backend has written receipts here but declares no capability row, so its stored form cannot be read as a property of the backend \u2014 only as a per-record surprise');
  assert.equal(rows[2].counts, pgCounts);
});

test('preserves declared adapter fields in output rows', () => {
  const rows = adapterComparison({ local: { x: 1 } });
  assert.equal(rows[0].declared, true);
  assert.equal(rows[0].durability, 'full');
  assert.equal(rows[0].mintsTags, false);
  assert.equal(rows[0].truncates, false);
  assert.equal(rows[0].label, 'local SQLite \u2014 lib/memory-store.mjs');
  assert.equal(rows[1].declared, true);
  assert.equal(rows[1].durability, 'preview');
  assert.equal(rows[1].mintsTags, true);
  assert.equal(rows[1].truncates, true);
  assert.equal(rows[1].label, 'veld / memory-layer \u2014 lib/memory-layer-client.mjs');
});

test('handles multiple undeclared adapters in input', () => {
  const rows = adapterComparison({ mysql: { a: 1 }, sqlite: { b: 2 } });
  assert.equal(rows.length, 4);
  assert.equal(rows[2].adapter, 'mysql');
  assert.equal(rows[2].declared, false);
  assert.equal(rows[3].adapter, 'sqlite');
  assert.equal(rows[3].declared, false);
});
