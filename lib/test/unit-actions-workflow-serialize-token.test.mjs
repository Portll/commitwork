// Converts a parsed YAML token tree into a serializable JSON-safe structure (lib/actions-workflow.mjs serializeToken).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializeToken } from '../actions-workflow.mjs';

test('returns the raw value for scalar tokens', () => {
  const result = serializeToken({ t: 'scalar', value: 'hello' });
  assert.deepEqual(result, 'hello');
});

test('returns the raw value for numeric tokens', () => {
  const result = serializeToken({ t: 'scalar', value: 42 });
  assert.deepEqual(result, 42);
});

test('returns the raw value for boolean tokens', () => {
  const result = serializeToken({ t: 'scalar', value: true });
  assert.deepEqual(result, true);
});

test('returns the raw value for null tokens', () => {
  const result = serializeToken({ t: 'scalar', value: null });
  assert.deepEqual(result, null);
});

test('serializes a sequence token with type 1 and mapped items', () => {
  const tok = { t: 'seq', items: [{ t: 'scalar', value: 1 }, { t: 'scalar', value: 2 }] };
  const result = serializeToken(tok);
  assert.deepEqual(result, { type: 1, seq: [1, 2] });
});

test('serializes a map token with type 2 and key-value pairs', () => {
  const tok = {
    t: 'map',
    entries: [
      { key: { t: 'scalar', value: 'a' }, value: { t: 'scalar', value: 1 } },
      { key: { t: 'scalar', value: 'b' }, value: { t: 'scalar', value: 2 } }
    ]
  };
  const result = serializeToken(tok);
  assert.deepEqual(result, { type: 2, map: [{ Key: 'a', Value: 1 }, { Key: 'b', Value: 2 }] });
});

test('serializes an expression token with type 3 and the expression string', () => {
  const tok = { t: 'expr', expression: 'github.event_name == "push"' };
  const result = serializeToken(tok);
  assert.deepEqual(result, { type: 3, expr: 'github.event_name == "push"' });
});

test('serializes an insert token with type 4 and fixed expr value', () => {
  const tok = { t: 'insert' };
  const result = serializeToken(tok);
  assert.deepEqual(result, { type: 4, expr: 'insert' });
});

test('handles nested structures recursively', () => {
  const tok = {
    t: 'map',
    entries: [
      {
        key: { t: 'scalar', value: 'list' },
        value: { t: 'seq', items: [{ t: 'scalar', value: 'x' }, { t: 'scalar', value: 'y' }] }
      }
    ]
  };
  const result = serializeToken(tok);
  assert.deepEqual(result, { type: 2, map: [{ Key: 'list', Value: { type: 1, seq: ['x', 'y'] } }] });
});
