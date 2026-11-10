// Parses JSONC text, stripping comments and trailing commas when needed (bin/agent-config.mjs parseJsonc).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonc } from '../agent-config.mjs';

test('parses valid JSON without modification', () => {
  const text = '{"a":1,"b":[2,3]}';
  const result = parseJsonc(text);
  assert.deepEqual(result, { value: { a: 1, b: [2, 3] } });
});

test('strips line comments before parsing', () => {
  const text = '{"a":1, // comment\n"b":2}';
  const result = parseJsonc(text);
  assert.deepEqual(result, { value: { a: 1, b: 2 } });
});

test('strips block comments before parsing', () => {
  const text = '{"a":1, /* block */ "b":2}';
  const result = parseJsonc(text);
  assert.deepEqual(result, { value: { a: 1, b: 2 } });
});

test('removes trailing commas before closing braces', () => {
  const text = '{"a":1,}';
  const result = parseJsonc(text);
  assert.deepEqual(result, { value: { a: 1 } });
});

test('removes trailing commas before closing brackets', () => {
  const text = '{"a":[1,2,]}';
  const result = parseJsonc(text);
  assert.deepEqual(result, { value: { a: [1, 2] } });
});

test('handles trailing comma followed by comment', () => {
  const text = '{"a":1, // comment\n}';
  const result = parseJsonc(text);
  assert.deepEqual(result, { value: { a: 1 } });
});

test('preserves comment-like sequences inside strings', () => {
  const text = '{"a":"// not a comment","b":"/* also not */"}';
  const result = parseJsonc(text);
  assert.deepEqual(result, { value: { a: '// not a comment', b: '/* also not */' } });
});

test('returns error for invalid JSON that cannot be fixed', () => {
  const text = '{"a":1, "b":}';
  const result = parseJsonc(text);
  assert.equal(typeof result.error, 'string');
  assert.equal(result.value, undefined);
});

test('handles nested structures with comments and trailing commas', () => {
  const text = '{"a":{"b":1, // inner comment\n},"c":[2,3,]}';
  const result = parseJsonc(text);
  assert.deepEqual(result, { value: { a: { b: 1 }, c: [2, 3] } });
});

test('preserves escaped quotes in strings during comment stripping', () => {
  const text = '{"a":"\\" // not comment","b":1}';
  const result = parseJsonc(text);
  assert.deepEqual(result, { value: { a: '" // not comment', b: 1 } });
});
