// parseToml parses a TOML string into a JavaScript object (lib/toml.mjs parseToml).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseToml } from '../toml.mjs';

test('throws TypeError when input is not a string', () => {
  assert.throws(() => parseToml(123), { name: 'TypeError', message: 'parseToml expects a string' });
});

test('throws TypeError when input is null', () => {
  assert.throws(() => parseToml(null), { name: 'TypeError', message: 'parseToml expects a string' });
});

test('returns empty object for empty string input', () => {
  const result = parseToml('');
  assert.deepEqual(result, {});
});

test('parses simple key value pair with string', () => {
  const result = parseToml('key = "value"');
  assert.deepEqual(result, { key: 'value' });
});

test('parses integer value', () => {
  const result = parseToml('key = 42');
  assert.deepEqual(result, { key: 42 });
});

test('parses boolean true value', () => {
  const result = parseToml('key = true');
  assert.deepEqual(result, { key: true });
});

test('parses table header with key value', () => {
  const result = parseToml('[table]\nkey = "value"');
  assert.deepEqual(result, { table: { key: 'value' } });
});

test('parses array of tables header', () => {
  const result = parseToml('[[table]]\nkey = "value1"\n[[table]]\nkey = "value2"');
  assert.deepEqual(result, { table: [{ key: 'value1' }, { key: 'value2' }] });
});

test('parses dotted keys creating nested tables', () => {
  const result = parseToml('a.b.c = 1');
  assert.deepEqual(result, { a: { b: { c: 1 } } });
});

test('throws on duplicate table definition', () => {
  assert.throws(() => parseToml('[table]\n[table]'), { name: 'TomlError', message: 'toml: line 2: table "table" is defined more than once' });
});
