// The last, outermost JSON object in text that has a required key (lib/salvage-json.mjs salvageObject).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salvageObject } from '../salvage-json.mjs';

test('returns null when the text is empty or missing', () => {
  assert.equal(salvageObject('', 'key'), null);
  assert.equal(salvageObject(null, 'key'), null);
  assert.equal(salvageObject(undefined, 'key'), null);
});

test('returns null when the required key is empty or missing even if a member matches it', () => {
  assert.equal(salvageObject('{"":1}', ''), null);
  assert.equal(salvageObject('{"key":1}', null), null);
});

test('returns the parsed object with the offsets of its braces', () => {
  assert.deepEqual(salvageObject('{"key":1}', 'key'), { value: { key: 1 }, start: 0, end: 8 });
  const padded = 'x'.repeat(1000) + '{"key":1}';
  assert.deepEqual(salvageObject(padded, 'key'), { value: { key: 1 }, start: 1000, end: 1008 });
});

test('ignores prose around the object and stops at its closing brace', () => {
  assert.deepEqual(salvageObject('answer: {"key":1}.', 'key'), { value: { key: 1 }, start: 8, end: 16 });
  assert.deepEqual(salvageObject('[{"key":1}]', 'key'), { value: { key: 1 }, start: 1, end: 9 });
});

test('returns the outermost object when a nested member shares the key', () => {
  assert.deepEqual(salvageObject('{"key":1,"n":{"key":2}}', 'key'), {
    value: { key: 1, n: { key: 2 } },
    start: 0,
    end: 22,
  });
});

test('prefers the final of two sibling objects that both have the key', () => {
  assert.deepEqual(salvageObject('{"key":1} {"key":2}', 'key'), { value: { key: 2 }, start: 10, end: 18 });
});

test('falls back to an earlier object when the final one lacks the key', () => {
  assert.deepEqual(salvageObject('{"key":1} {"other":2}', 'key'), { value: { key: 1 }, start: 0, end: 8 });
});

test('keeps the nested object when the enclosing object lacks the key', () => {
  assert.deepEqual(salvageObject('{"a":{"key":2}}', 'key'), { value: { key: 2 }, start: 5, end: 13 });
});

test('treats braces and escaped quotes inside strings as text', () => {
  assert.deepEqual(salvageObject('{"key":"}{"}', 'key'), { value: { key: '}{' }, start: 0, end: 11 });
  assert.deepEqual(salvageObject('{"key":"a\\"}"}', 'key'), { value: { key: 'a"}' }, start: 0, end: 13 });
});

test('returns null for unclosed, invalid or keyless objects and skips an unclosed outer brace', () => {
  assert.equal(salvageObject('{"key":1', 'key'), null);
  assert.equal(salvageObject('{key:1}', 'key'), null);
  assert.equal(salvageObject('{"other":1}', 'key'), null);
  assert.deepEqual(salvageObject('{"note": {"key":2}', 'key'), { value: { key: 2 }, start: 9, end: 17 });
});
