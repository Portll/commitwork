// Converts a YAML node tree into plain JavaScript values (lib/actions-yaml.mjs toPlain).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPlain } from '../actions-yaml.mjs';

test('returns the value directly for a scalar node', () => {
  const node = { type: 'scalar', value: 'hello' };
  assert.equal(toPlain(node), 'hello');
});

test('returns an array of plain values for a sequence node', () => {
  const node = {
    type: 'seq',
    items: [
      { type: 'scalar', value: 1 },
      { type: 'scalar', value: 'two' },
      { type: 'seq', items: [{ type: 'scalar', value: 3 }] }
    ]
  };
  assert.deepEqual(toPlain(node), [1, 'two', [3]]);
});

test('returns an empty object for a mapping node with no entries', () => {
  const node = { type: 'map', entries: [] };
  assert.deepEqual(toPlain(node), {});
});

test('returns an object with key-value pairs for a mapping node', () => {
  const node = {
    type: 'map',
    entries: [
      { key: { value: 'name' }, value: { type: 'scalar', value: 'Alice' } },
      { key: { value: 'age' }, value: { type: 'scalar', value: 30 } }
    ]
  };
  assert.deepEqual(toPlain(node), { name: 'Alice', age: 30 });
});

test('uses empty string as key when key value is null', () => {
  const node = {
    type: 'map',
    entries: [
      { key: { value: null }, value: { type: 'scalar', value: 'anon' } }
    ]
  };
  const result = toPlain(node);
  assert.deepEqual(result, { '': 'anon' });
  assert.ok(Object.prototype.hasOwnProperty.call(result, ''));
});

test('converts nested mapping values recursively', () => {
  const node = {
    type: 'map',
    entries: [
      {
        key: { value: 'config' },
        value: {
          type: 'map',
          entries: [
            { key: { value: 'debug' }, value: { type: 'scalar', value: true } },
            { key: { value: 'level' }, value: { type: 'scalar', value: 'info' } }
          ]
        }
      }
    ]
  };
  assert.deepEqual(toPlain(node), { config: { debug: true, level: 'info' } });
});

test('handles numeric scalar values', () => {
  const node = { type: 'scalar', value: 42 };
  assert.equal(toPlain(node), 42);
});

test('handles boolean scalar values', () => {
  const node = { type: 'scalar', value: false };
  assert.equal(toPlain(node), false);
});

test('handles null scalar values', () => {
  const node = { type: 'scalar', value: null };
  assert.equal(toPlain(node), null);
});

test('converts sequence items containing mappings', () => {
  const node = {
    type: 'seq',
    items: [
      {
        type: 'map',
        entries: [
          { key: { value: 'id' }, value: { type: 'scalar', value: 1 } }
        ]
      },
      {
        type: 'map',
        entries: [
          { key: { value: 'id' }, value: { type: 'scalar', value: 2 } }
        ]
      }
    ]
  };
  assert.deepEqual(toPlain(node), [{ id: 1 }, { id: 2 }]);
});
