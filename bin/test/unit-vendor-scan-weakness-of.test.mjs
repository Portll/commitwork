// Weakness and attack attribution fields for one advisory finding (bin/vendor-scan.mjs weaknessOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weaknessOf } from '../vendor-scan.mjs';

const NO_CWE = { cwe: '', cwePillar: '', capec: '', capecVia: '', attack: '', attackTactic: '', capecReason: 'no-cwe' };

const FOUND_TWO = { cwe: '79 89', cwePillar: '', capec: '', capecVia: '', attack: '', attackTactic: '', capecReason: '' };

test('an indexed advisory with two cwe ids joins them and leaves graph fields empty without graphs', () => {
  const index = { 'CVE-1': { cwe: ['79', '89'] } };
  const r = weaknessOf({ id: 'CVE-1' }, index, null, null, null);
  assert.deepEqual(r, FOUND_TWO);
});

test('a null index yields the no-cwe result', () => {
  const r = weaknessOf({ id: 'CVE-1' }, null, null, null, null);
  assert.deepEqual(r, NO_CWE);
});

test('a null finding yields the no-cwe result even when the index has entries', () => {
  const index = { 'CVE-1': { cwe: ['79'] } };
  const r = weaknessOf(null, index, null, null, null);
  assert.deepEqual(r, NO_CWE);
});

test('a finding with no id or a zero id yields the no-cwe result', () => {
  const index = { 'CVE-1': { cwe: ['79'] }, '0': { cwe: ['20'] } };
  assert.deepEqual(weaknessOf({}, index, null, null, null), NO_CWE);
  assert.deepEqual(weaknessOf({ id: 0 }, index, null, null, null), NO_CWE);
});

test('an id missing from the index yields the no-cwe result', () => {
  const index = { 'CVE-1': { cwe: ['79'] } };
  const r = weaknessOf({ id: 'CVE-999' }, index, null, null, null);
  assert.deepEqual(r, NO_CWE);
});

test('an entry with an empty cwe list is no-cwe while a single cwe id is reported', () => {
  const index = { 'CVE-1': { cwe: [] }, 'CVE-2': { cwe: ['79'] }, 'CVE-3': {} };
  assert.deepEqual(weaknessOf({ id: 'CVE-1' }, index, null, null, null), NO_CWE);
  assert.deepEqual(weaknessOf({ id: 'CVE-3' }, index, null, null, null), NO_CWE);
  assert.deepEqual(weaknessOf({ id: 'CVE-2' }, index, null, null, null), {
    cwe: '79', cwePillar: '', capec: '', capecVia: '', attack: '', attackTactic: '', capecReason: '',
  });
});

test('a numeric id is looked up under its string key', () => {
  const index = { '42': { cwe: ['22', '78', '400'] } };
  const r = weaknessOf({ id: 42 }, index, null, null, null);
  assert.deepEqual(r, {
    cwe: '22 78 400', cwePillar: '', capec: '', capecVia: '', attack: '', attackTactic: '', capecReason: '',
  });
});

test('an attack graph without any attributed attack leaves the tactic empty', () => {
  const index = { 'CVE-1': { cwe: ['79', '89'] } };
  const r = weaknessOf({ id: 'CVE-1' }, index, null, null, {});
  assert.deepEqual(r, FOUND_TWO);
});

test('default arguments behave like a missing index', () => {
  const r = weaknessOf({ id: 'CVE-1' });
  assert.deepEqual(r, NO_CWE);
});
