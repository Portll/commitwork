// Normalized EOL rows sorted by cycle string (bin/eol-snapshot.mjs compact).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compact } from '../eol-snapshot.mjs';

const captureComparator = () => {
  let captured;
  class SortSpy extends Array {
    sort(fn) {
      captured = fn;
      return super.sort(fn);
    }
  }
  compact(SortSpy.of({ cycle: 'x', eol: null }));
  return captured;
};

test('keeps booleans and YYYY-MM-DD strings for eol and turns anything else into null', () => {
  const r = compact([
    { cycle: 'a', eol: true },
    { cycle: 'b', eol: false },
    { cycle: 'c', eol: '2024-01-15' },
    { cycle: 'd', eol: '2024-1-15' },
    { cycle: 'e', eol: 20240115 },
    { cycle: 'f', eol: '2024-01-15T00:00' },
  ]);
  assert.deepEqual(r, [
    { cycle: 'a', eol: true },
    { cycle: 'b', eol: false },
    { cycle: 'c', eol: '2024-01-15' },
    { cycle: 'd', eol: null },
    { cycle: 'e', eol: null },
    { cycle: 'f', eol: null },
  ]);
});

test('converts a numeric cycle to a string and lowercases a present codename', () => {
  const r = compact([{ cycle: 22, eol: '2027-04-30', codename: 'Jod' }]);
  assert.deepEqual(r, [{ cycle: '22', eol: '2027-04-30', codename: 'jod' }]);
});

test('omits codename when it is empty, missing, null or zero', () => {
  const r = compact([
    { cycle: '1', eol: false, codename: '' },
    { cycle: '2', eol: false },
    { cycle: '3', eol: false, codename: null },
    { cycle: '4', eol: false, codename: 0 },
  ]);
  assert.deepEqual(r, [
    { cycle: '1', eol: false },
    { cycle: '2', eol: false },
    { cycle: '3', eol: false },
    { cycle: '4', eol: false },
  ]);
});

test('sorts cycles as strings so 10 comes before 2 and 9', () => {
  const r = compact([{ cycle: '9' }, { cycle: 10 }, { cycle: '2' }]);
  assert.deepEqual(r, [
    { cycle: '10', eol: null },
    { cycle: '2', eol: null },
    { cycle: '9', eol: null },
  ]);
});

test('keeps rows with equal cycles in their input order', () => {
  const r = compact([
    { cycle: '1', eol: '2024-01-01' },
    { cycle: 1, eol: '2024-02-01' },
  ]);
  assert.deepEqual(r, [
    { cycle: '1', eol: '2024-01-01' },
    { cycle: '1', eol: '2024-02-01' },
  ]);
});

test('returns an empty array for no rows', () => {
  assert.deepEqual(compact([]), []);
});

test('the cycle comparator returns 0 when both cycles are equal', () => {
  const cmp = captureComparator();
  assert.equal(cmp({ cycle: '1' }, { cycle: '1' }), 0);
});

test('the cycle comparator returns -1 when the first cycle sorts before the second', () => {
  const cmp = captureComparator();
  assert.equal(cmp({ cycle: '1' }, { cycle: '2' }), -1);
});

test('the cycle comparator returns 1 when the first cycle sorts after the second', () => {
  const cmp = captureComparator();
  assert.equal(cmp({ cycle: '2' }, { cycle: '1' }), 1);
});
