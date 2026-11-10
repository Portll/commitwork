// counts status words per item (lib/remediation-md.mjs tally).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tally } from '../remediation-md.mjs';

test('empty array yields all zero counts', () => {
  assert.deepEqual(tally([]), { DONE: 0, PARTIAL: 0, OPEN: 0, SUPERSEDED: 0, WRONG: 0, UNASSESSED: 0 });
});

test('single DONE status increments DONE count', () => {
  const items = [{ status: 'DONE' }];
  assert.deepEqual(tally(items), { DONE: 1, PARTIAL: 0, OPEN: 0, SUPERSEDED: 0, WRONG: 0, UNASSESSED: 0 });
});

test('case\u2011insensitive PARTIAL with extra text increments PARTIAL count', () => {
  const items = [{ status: 'partial some detail' }];
  assert.deepEqual(tally(items), { DONE: 0, PARTIAL: 1, OPEN: 0, SUPERSEDED: 0, WRONG: 0, UNASSESSED: 0 });
});

test('OPEN with leading whitespace and dash separator increments OPEN count', () => {
  const items = [{ status: '   OPEN - additional info' }];
  assert.deepEqual(tally(items), { DONE: 0, PARTIAL: 0, OPEN: 1, SUPERSEDED: 0, WRONG: 0, UNASSESSED: 0 });
});

test('SUPERSEDED with trailing detail increments SUPERSEDED count', () => {
  const items = [{ status: 'SUPERSEDED because of change' }];
  assert.deepEqual(tally(items), { DONE: 0, PARTIAL: 0, OPEN: 0, SUPERSEDED: 1, WRONG: 0, UNASSESSED: 0 });
});

test('WRONG with em\u2011dash separator increments WRONG count', () => {
  const items = [{ status: 'WRONG\u2014mistake' }];
  assert.deepEqual(tally(items), { DONE: 0, PARTIAL: 0, OPEN: 0, SUPERSEDED: 0, WRONG: 1, UNASSESSED: 0 });
});

test('missing or empty status counts as UNASSESSED', () => {
  const items = [{}, { status: '' }, { status: null }];
  assert.deepEqual(tally(items), { DONE: 0, PARTIAL: 0, OPEN: 0, SUPERSEDED: 0, WRONG: 0, UNASSESSED: 3 });
});

test('non\u2011iterable input throws TypeError', () => {
  assert.throws(() => tally(null), { name: "TypeError", message: "items is not iterable" });
});
