// Set of outcome keys carried by finding-adjudication journal records (monitor/remediation-outcome.mjs alreadyOutcomedKeys).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alreadyOutcomedKeys } from '../remediation-outcome.mjs';

const MISSING_DIR = '/nonexistent/commitwork-unit-test';
const originalIterator = Array.prototype[Symbol.iterator];
let pendingRecords = null;
let inspecting = false;

function patchedIterator() {
  if (pendingRecords !== null && !inspecting && this && this.length === 0) {
    inspecting = true;
    let caller = '';
    try {
      caller = String(String(new Error().stack).split('\n')[2]);
    } finally {
      inspecting = false;
    }
    if (caller.includes('alreadyOutcomedKeys') || caller.includes('remediation-outcome.mjs')) {
      const records = pendingRecords;
      pendingRecords = null;
      return originalIterator.call(records);
    }
  }
  return originalIterator.call(this);
}

function journalWith(records) {
  pendingRecords = records;
  Array.prototype[Symbol.iterator] = patchedIterator;
  return { dir: MISSING_DIR };
}

function restore() {
  Array.prototype[Symbol.iterator] = originalIterator;
  pendingRecords = null;
}

test('a directory with no adjudications journal gives an empty set', () => {
  const input = { dir: MISSING_DIR };
  const result = alreadyOutcomedKeys(input);
  assert.deepEqual(result, new Set());
});

test('a finding-adjudication record contributes its outcome key', () => {
  const input = journalWith([{ kind: 'finding-adjudication', outcomeKey: 'key1' }]);
  const result = alreadyOutcomedKeys(input);
  restore();
  assert.deepEqual(result, new Set(['key1']));
});

test('a record of another kind is ignored even when it has an outcome key', () => {
  const input = journalWith([{ kind: 'other', outcomeKey: 'key1' }]);
  const result = alreadyOutcomedKeys(input);
  restore();
  assert.deepEqual(result, new Set());
});

test('a kind that differs only in letter case is ignored', () => {
  const input = journalWith([{ kind: 'Finding-Adjudication', outcomeKey: 'key2' }]);
  const result = alreadyOutcomedKeys(input);
  restore();
  assert.deepEqual(result, new Set());
});

test('a finding-adjudication record without an outcome key is ignored', () => {
  const input = journalWith([{ kind: 'finding-adjudication' }]);
  const result = alreadyOutcomedKeys(input);
  restore();
  assert.deepEqual(result, new Set());
});

test('falsy outcome keys are ignored while a truthy number key is kept', () => {
  const input = journalWith([
    { kind: 'finding-adjudication', outcomeKey: '' },
    { kind: 'finding-adjudication', outcomeKey: 0 },
    { kind: 'finding-adjudication', outcomeKey: 7 },
  ]);
  const result = alreadyOutcomedKeys(input);
  restore();
  assert.deepEqual(result, new Set([7]));
});

test('null and undefined records are skipped without throwing', () => {
  const input = journalWith([null, undefined, { kind: 'finding-adjudication', outcomeKey: 'kept' }]);
  const result = alreadyOutcomedKeys(input);
  restore();
  assert.deepEqual(result, new Set(['kept']));
});

test('repeated outcome keys collapse and first-seen order is kept', () => {
  const input = journalWith([
    { kind: 'finding-adjudication', outcomeKey: 'b' },
    { kind: 'finding-adjudication', outcomeKey: 'a' },
    { kind: 'finding-adjudication', outcomeKey: 'b' },
  ]);
  const result = alreadyOutcomedKeys(input);
  restore();
  assert.deepEqual([...result], ['b', 'a']);
});

test('only qualifying records survive a mixed journal', () => {
  const input = journalWith([
    null,
    { kind: 'other', outcomeKey: 'z' },
    { kind: 'finding-adjudication', outcomeKey: 'y' },
    { kind: 'finding-adjudication' },
    { outcomeKey: 'w' },
  ]);
  const result = alreadyOutcomedKeys(input);
  restore();
  assert.deepEqual(result, new Set(['y']));
});
