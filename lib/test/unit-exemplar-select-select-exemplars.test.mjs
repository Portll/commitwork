// Selects up to k exemplar findings from a ledger for a given check category (lib/exemplar-select.mjs selectExemplars).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectExemplars } from '../exemplar-select.mjs';

test('returns empty array when check is falsy', () => {
  const r = selectExemplars([], { check: null });
  assert.deepEqual(r, []);
});

test('returns empty array when ledgerRecords is not an array', () => {
  const r = selectExemplars('not-array', { check: 'security' });
  assert.deepEqual(r, []);
});

test('returns empty array when ledgerRecords is empty', () => {
  const r = selectExemplars([], { check: 'security' });
  assert.deepEqual(r, []);
});

test('filters out records with wrong category', () => {
  const rec = { kind: 'finding-adjudication', category: 'other', model: null, truth: 'true-alarm', findingKey: 'k1', at: '2024-01-01' };
  const r = selectExemplars([rec], { check: 'security' });
  assert.deepEqual(r, []);
});

test('filters out records with invalid truth value', () => {
  const rec = { kind: 'finding-adjudication', category: 'security', model: null, truth: 'unknown', findingKey: 'k1', at: '2024-01-01' };
  const r = selectExemplars([rec], { check: 'security' });
  assert.deepEqual(r, []);
});

test('filters out records with non-string findingKey', () => {
  const rec = { kind: 'finding-adjudication', category: 'security', model: null, truth: 'true-alarm', findingKey: 123, at: '2024-01-01' };
  const r = selectExemplars([rec], { check: 'security' });
  assert.deepEqual(r, []);
});

test('filters out records with non-string at', () => {
  const rec = { kind: 'finding-adjudication', category: 'security', model: null, truth: 'true-alarm', findingKey: 'k1', at: 123 };
  const r = selectExemplars([rec], { check: 'security' });
  assert.deepEqual(r, []);
});

test('selects one true alarm when k is 1', () => {
  const rec = { kind: 'finding-adjudication', category: 'security', model: null, truth: 'true-alarm', findingKey: 'k1', at: '2024-01-01', humanVerdict: 'yes' };
  const r = selectExemplars([rec], { check: 'security', k: 1 });
  assert.deepEqual(r, [{ identity: "k1", rule: null, verdict: "true-alarm", reason: "yes" }]);
});

test('selects one false alarm when k is 1', () => {
  const rec = { kind: 'finding-adjudication', category: 'security', model: null, truth: 'false-alarm', findingKey: 'k1', at: '2024-01-01', humanVerdict: 'no' };
  const r = selectExemplars([rec], { check: 'security', k: 1 });
  assert.deepEqual(r, [{ identity: "k1", rule: null, verdict: "false-alarm", reason: "no" }]);
});

test('alternates true and false alarms when k is 2', () => {
  const t = { kind: 'finding-adjudication', category: 'security', model: null, truth: 'true-alarm', findingKey: 't1', at: '2024-01-01', humanVerdict: 'yes' };
  const f = { kind: 'finding-adjudication', category: 'security', model: null, truth: 'false-alarm', findingKey: 'f1', at: '2024-01-01', humanVerdict: 'no' };
  const r = selectExemplars([t, f], { check: 'security', k: 2 });
  assert.deepEqual(r, [{ identity: "t1", rule: null, verdict: "true-alarm", reason: "yes" }, { identity: "f1", rule: null, verdict: "false-alarm", reason: "no" }]);
});
