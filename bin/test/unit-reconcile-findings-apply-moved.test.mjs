// Applies moved ledger rows to matching entries, updating file, line, anchor, and disposition. (bin/reconcile-findings.mjs applyMoved).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMoved } from '../reconcile-findings.mjs';

test('returns empty array when movedLedger is empty', () => {
  const entries = [{ id: '1', file: 'a.js', line: 1, summary: 's', key: 'k1' }];
  const result = applyMoved(entries, []);
  assert.deepEqual(result, []);
});

test('applies move when entry matches file and summary regex', () => {
  const entries = [{ id: '1', file: 'a.js', line: 10, summary: 'old code', key: 'k1', disposition: 'open' }];
  const movedLedger = [{ item: 'I1', file: 'a.js', to: 'b.js:20', match: /old/, at: 'head1', note: 'renamed' }];
  const summariesByKey = new Map([['k1', ['old code']]]);
  const result = applyMoved(entries, movedLedger, summariesByKey);
  assert.equal(result.length, 1);
  assert.equal(result[0].item, 'I1');
  assert.equal(result[0].from, 'a.js');
  assert.equal(result[0].to, 'b.js:20');
  assert.equal(result[0].bound, 1);
  assert.deepEqual(result[0].applied, ['1']);
  assert.equal(entries[0].file, 'b.js');
  assert.equal(entries[0].line, 20);
  assert.equal(entries[0].anchor, 'b.js:20');
  assert.equal(entries[0].disposition, 'moved');
  assert.equal(entries[0].dispositionReason, 'I1 \u2014 still live, and no longer in a.js: renamed');
  assert.equal(entries[0].verifiedAtHead, 'head1');
  assert.deepEqual(entries[0].movedFrom, { file: 'a.js', line: 10, anchor: undefined });
});

test('skips entry with disposition fixed', () => {
  const entries = [{ id: '1', file: 'a.js', line: 10, summary: 'old code', key: 'k1', disposition: 'fixed' }];
  const movedLedger = [{ item: 'I1', file: 'a.js', to: 'b.js:20', match: /old/, at: 'head1', note: 'renamed' }];
  const summariesByKey = new Map([['k1', ['old code']]]);
  const result = applyMoved(entries, movedLedger, summariesByKey);
  assert.equal(result[0].bound, 1);
  assert.deepEqual(result[0].applied, []);
  assert.equal(entries[0].disposition, 'fixed');
  assert.equal(entries[0].file, 'a.js');
});

test('skips entry with disposition refuted', () => {
  const entries = [{ id: '1', file: 'a.js', line: 10, summary: 'old code', key: 'k1', disposition: 'refuted' }];
  const movedLedger = [{ item: 'I1', file: 'a.js', to: 'b.js:20', match: /old/, at: 'head1', note: 'renamed' }];
  const summariesByKey = new Map([['k1', ['old code']]]);
  const result = applyMoved(entries, movedLedger, summariesByKey);
  assert.equal(result[0].bound, 1);
  assert.deepEqual(result[0].applied, []);
  assert.equal(entries[0].disposition, 'refuted');
});

test('skips entry when to line is not finite', () => {
  const entries = [{ id: '1', file: 'a.js', line: 10, summary: 'old code', key: 'k1', disposition: 'open' }];
  const movedLedger = [{ item: 'I1', file: 'a.js', to: 'b.js:abc', match: /old/, at: 'head1', note: 'renamed' }];
  const summariesByKey = new Map([['k1', ['old code']]]);
  const result = applyMoved(entries, movedLedger, summariesByKey);
  assert.equal(result[0].bound, 1);
  assert.deepEqual(result[0].applied, []);
  assert.equal(entries[0].disposition, 'open');
  assert.equal(entries[0].file, 'a.js');
});

test('skips entry when to has no file part', () => {
  const entries = [{ id: '1', file: 'a.js', line: 10, summary: 'old code', key: 'k1', disposition: 'open' }];
  const movedLedger = [{ item: 'I1', file: 'a.js', to: ':20', match: /old/, at: 'head1', note: 'renamed' }];
  const summariesByKey = new Map([['k1', ['old code']]]);
  const result = applyMoved(entries, movedLedger, summariesByKey);
  assert.equal(result[0].bound, 1);
  assert.deepEqual(result[0].applied, []);
  assert.equal(entries[0].disposition, 'open');
});

test('matches entry via movedFrom file instead of current file', () => {
  const entries = [{ id: '1', file: 'c.js', line: 30, summary: 'old code', key: 'k1', disposition: 'open', movedFrom: { file: 'a.js', line: 10, anchor: 'a.js:10' } }];
  const movedLedger = [{ item: 'I1', file: 'a.js', to: 'b.js:20', match: /old/, at: 'head1', note: 'renamed' }];
  const summariesByKey = new Map([['k1', ['old code']]]);
  const result = applyMoved(entries, movedLedger, summariesByKey);
  assert.equal(result[0].bound, 1);
  assert.deepEqual(result[0].applied, ['1']);
  assert.equal(entries[0].file, 'b.js');
  assert.equal(entries[0].line, 20);
});

test('does not match when summary does not satisfy regex', () => {
  const entries = [{ id: '1', file: 'a.js', line: 10, summary: 'new code', key: 'k1', disposition: 'open' }];
  const movedLedger = [{ item: 'I1', file: 'a.js', to: 'b.js:20', match: /old/, at: 'head1', note: 'renamed' }];
  const summariesByKey = new Map([['k1', ['new code']]]);
  const result = applyMoved(entries, movedLedger, summariesByKey);
  assert.equal(result[0].bound, 0);
  assert.deepEqual(result[0].applied, []);
});

test('uses summariesByKey value when present and matches', () => {
  const entries = [{ id: '1', file: 'a.js', line: 10, summary: 'different', key: 'k1', disposition: 'open' }];
  const movedLedger = [{ item: 'I1', file: 'a.js', to: 'b.js:20', match: /matched/, at: 'head1', note: 'renamed' }];
  const summariesByKey = new Map([['k1', ['matched text']]]);
  const result = applyMoved(entries, movedLedger, summariesByKey);
  assert.equal(result[0].bound, 1);
  assert.deepEqual(result[0].applied, ['1']);
});

test('falls back to entry summary when summariesByKey has no entry', () => {
  const entries = [{ id: '1', file: 'a.js', line: 10, summary: 'matched text', key: 'k1', disposition: 'open' }];
  const movedLedger = [{ item: 'I1', file: 'a.js', to: 'b.js:20', match: /matched/, at: 'head1', note: 'renamed' }];
  const summariesByKey = new Map();
  const result = applyMoved(entries, movedLedger, summariesByKey);
  assert.equal(result[0].bound, 1);
  assert.deepEqual(result[0].applied, ['1']);
});
