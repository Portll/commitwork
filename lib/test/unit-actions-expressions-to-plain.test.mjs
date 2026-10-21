// Converts Dict and nested arrays to plain objects and arrays (lib/actions-expressions.mjs toPlain).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPlain, Dict } from '../actions-expressions.mjs';

test('returns primitives unchanged', () => {
  assert.equal(toPlain(42), 42);
  assert.equal(toPlain('hello'), 'hello');
  assert.equal(toPlain(null), null);
  assert.equal(toPlain(undefined), undefined);
  assert.equal(toPlain(true), true);
});

test('returns empty object for empty Dict', () => {
  const d = new Dict();
  assert.deepEqual(toPlain(d), {});
});

test('converts Dict with single entry to plain object', () => {
  const d = new Dict();
  d.add('Name', 'Alice');
  assert.deepEqual(toPlain(d), { Name: 'Alice' });
});

test('converts Dict with multiple entries to plain object', () => {
  const d = new Dict();
  d.add('First', 'John');
  d.add('Last', 'Doe');
  d.add('Age', 30);
  assert.deepEqual(toPlain(d), { First: 'John', Last: 'Doe', Age: 30 });
});

test('converts Dict with duplicate keys keeping first value', () => {
  const d = new Dict();
  d.add('Key', 'first');
  d.add('key', 'second');
  d.add('KEY', 'third');
  assert.deepEqual(toPlain(d), { Key: 'first' });
});

test('converts array of primitives to plain array', () => {
  assert.deepEqual(toPlain([1, 2, 3]), [1, 2, 3]);
});

test('converts array containing Dict to array with plain object', () => {
  const d = new Dict();
  d.add('Id', 1);
  const arr = [d, 'text', 99];
  assert.deepEqual(toPlain(arr), [{ Id: 1 }, 'text', 99]);
});

test('converts nested Dict inside array to nested plain object', () => {
  const inner = new Dict();
  inner.add('X', 10);
  const outer = new Dict();
  outer.add('Inner', inner);
  outer.add('List', [inner, 5]);
  assert.deepEqual(toPlain(outer), { Inner: { X: 10 }, List: [{ X: 10 }, 5] });
});

test('converts empty array to empty array', () => {
  assert.deepEqual(toPlain([]), []);
});

test('handles Dict with boolean and null values', () => {
  const d = new Dict();
  d.add('Flag', true);
  d.add('Null', null);
  d.add('Zero', 0);
  assert.deepEqual(toPlain(d), { Flag: true, Null: null, Zero: 0 });
});
