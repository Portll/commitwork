// Parses SQL VALUES clause into rows of values (bin/lib/wp-dump.mjs parseValues).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseValues } from '../lib/wp-dump.mjs';

test('returns error when no VALUES clause present', () => {
  const input = 'INSERT INTO t (a) SELECT 1;';
  const result = parseValues(input);
  assert.deepEqual(result, { rows: [], error: "no VALUES clause" });
});

test('parses single row with integer and string values', () => {
  const input = "VALUES (1, 'hello')";
  const result = parseValues(input);
  assert.deepEqual(result, { rows: [[1, "hello"]], dropped: 0 });
});

test('parses multiple rows separated by commas', () => {
  const input = "VALUES (1, 'a'), (2, 'b')";
  const result = parseValues(input);
  assert.deepEqual(result, { rows: [[1, "a"], [2, "b"]], dropped: 0 });
});

test('handles escaped characters inside strings', () => {
  const input = "VALUES ('line1\\nline2', 'tab\\there')";
  const result = parseValues(input);
  assert.deepEqual(result, { rows: [["line1\nline2", "tab\there"]], dropped: 0 });
});

test('handles doubled quote inside string', () => {
  const input = "VALUES ('it''s quoted')";
  const result = parseValues(input);
  assert.deepEqual(result, { rows: [["it's quoted"]], dropped: 0 });
});

test('parses null, number, hex blob, and unquoted identifier', () => {
  const input = "VALUES (NULL, 42, 3.14, 0x48656c6c6f, identifier)";
  const result = parseValues(input);
  assert.deepEqual(result, { rows: [[null, 42, 3.14, "Hello", "identifier"]], dropped: 0 });
});

test('respects rowCap limit and counts dropped rows', () => {
  const input = "VALUES (1), (2), (3)";
  const result = parseValues(input, { rowCap: 2 });
  assert.deepEqual(result, { rows: [[1], [2]], dropped: 1 });
});

test('stops parsing at semicolon terminator', () => {
  const input = "VALUES (1); extra";
  const result = parseValues(input);
  assert.deepEqual(result, { rows: [[1]], dropped: 0 });
});

test('throws on unterminated string', () => {
  const input = "VALUES ('unterminated";
  assert.deepStrictEqual(parseValues(input), { rows: [], dropped: 0, error: "unterminated string" });
});

test('throws when expected opening parenthesis missing', () => {
  const input = "VALUES 1, 2";
  assert.deepStrictEqual(parseValues(input), { rows: [], dropped: 0, error: "expected '(' at 7" });
});
