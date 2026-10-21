// Converts a parsed token tree into a plain JavaScript object (lib/actions-workflow.mjs tokenToPlain).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenToPlain } from '../actions-workflow.mjs';

test('returns the value for a string token', () => {
  const tok = { t: 'string', value: 'hello' };
  assert.deepEqual(tokenToPlain(tok), 'hello');
});

test('returns the value for a number token', () => {
  const tok = { t: 'number', value: 42 };
  assert.deepEqual(tokenToPlain(tok), 42);
});

test('returns the value for a boolean token', () => {
  const tok = { t: 'boolean', value: true };
  assert.deepEqual(tokenToPlain(tok), true);
});

test('returns the value for a null token', () => {
  const tok = { t: 'null', value: null };
  assert.deepEqual(tokenToPlain(tok), null);
});

test('returns an object with $expr for an expr token', () => {
  const tok = { t: 'expr', expression: 'github.ref' };
  assert.deepEqual(tokenToPlain(tok), { $expr: 'github.ref' });
});

test('returns an object with $expr insert for an insert token', () => {
  const tok = { t: 'insert' };
  assert.deepEqual(tokenToPlain(tok), { $expr: 'insert' });
});

test('returns an array for a seq token', () => {
  const tok = { t: 'seq', items: [{ t: 'string', value: 'a' }, { t: 'number', value: 1 }] };
  assert.deepEqual(tokenToPlain(tok), ['a', 1]);
});

test('returns an object for a map token', () => {
  const tok = {
    t: 'map',
    entries: [
      { key: { t: 'string', value: 'name' }, value: { t: 'string', value: 'test' } },
      { key: { t: 'string', value: 'count' }, value: { t: 'number', value: 5 } }
    ]
  };
  assert.deepEqual(tokenToPlain(tok), { name: 'test', count: 5 });
});

test('handles nested structures in map and seq tokens', () => {
  const tok = {
    t: 'map',
    entries: [
      { key: { t: 'string', value: 'list' }, value: { t: 'seq', items: [{ t: 'string', value: 'x' }] } },
      { key: { t: 'string', value: 'obj' }, value: { t: 'map', entries: [{ key: { t: 'string', value: 'y' }, value: { t: 'boolean', value: false } }] } }
    ]
  };
  assert.deepEqual(tokenToPlain(tok), { list: ['x'], obj: { y: false } });
});
