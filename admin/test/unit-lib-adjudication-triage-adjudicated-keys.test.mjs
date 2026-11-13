// Returns a Set of findingKeys from adjudication records with kind finding-adjudication and a truth value in TRUTHS (admin/lib/adjudication-triage.mjs adjudicatedKeys).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjudicatedKeys } from '../lib/adjudication-triage.mjs';
import { TRUTHS } from '../../bin/lib/verdict-journal-core.mjs';

const record = (findingKey, ...rest) => {
  const [truth, kind] = [rest.length > 0 ? rest[0] : 'true-alarm', rest.length > 1 ? rest[1] : 'finding-adjudication'];
  return { kind, findingKey, truth };
};

test('the four truths are the vocabulary this test is written in', () => {
  assert.deepEqual(TRUTHS, ['true-alarm', 'false-alarm', 'true-clean', 'false-clean']);
});

test('anything but an array gives an empty Set', () => {
  for (const input of [null, undefined, 'k1', { 0: record('k1'), length: 1 }, 7]) {
    assert.deepEqual(adjudicatedKeys(input), new Set(), String(input));
  }
});

test('every one of the four truths marks its finding as adjudicated', () => {
  const records = TRUTHS.map((truth, i) => record(`k${i}`, truth));
  assert.deepEqual(adjudicatedKeys(records), new Set(['k0', 'k1', 'k2', 'k3']));
});

test('a truth outside the four is not an adjudication', () => {
  for (const truth of ['confirmed', 'TRUE-ALARM', 'true_alarm', '', null, undefined]) {
    assert.deepEqual(adjudicatedKeys([record('k1', truth)]), new Set(), String(truth));
  }
});

test('only finding-adjudication records count', () => {
  const records = [record('k1', 'true-alarm', 'lane-adjudication'), record('k2', 'false-alarm', undefined), record('k3', 'true-clean')];
  assert.deepEqual(adjudicatedKeys(records), new Set(['k3']));
});

test('a record with no findingKey, or no record at all, is skipped without hiding the valid ones', () => {
  const records = [null, undefined, record(''), record(null), record(undefined), 'k9', record('k4', 'false-clean')];
  assert.deepEqual(adjudicatedKeys(records), new Set(['k4']));
});

test('a finding adjudicated twice, with different truths, appears once', () => {
  const result = adjudicatedKeys([record('k1', 'true-alarm'), record('k1', 'false-alarm'), record('k2', 'true-clean')]);
  assert.deepEqual(result, new Set(['k1', 'k2']));
  assert.equal(result.size, 2);
});
