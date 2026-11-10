// Parses PHP-serialized data into JavaScript values (bin/lib/php-serialize.mjs unserialize).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unserialize } from '../lib/php-serialize.mjs';

test('unserialize returns null for N type', () => {
  const result = unserialize('N;');
  assert.equal(result, null);
});

test('unserialize returns true for boolean 1', () => {
  const result = unserialize('b:1;');
  assert.equal(result, true);
});

test('unserialize returns false for boolean 0', () => {
  const result = unserialize('b:0;');
  assert.equal(result, false);
});

test('unserialize parses positive integer', () => {
  const result = unserialize('i:42;');
  assert.equal(result, 42);
});

test('unserialize parses negative integer', () => {
  const result = unserialize('i:-7;');
  assert.equal(result, -7);
});

test('unserialize parses finite float', () => {
  const result = unserialize('d:3.14;');
  assert.equal(result, 3.14);
});

test('unserialize parses INF float', () => {
  const result = unserialize('d:INF;');
  assert.equal(result, NaN);
});

test('unserialize parses NAN float', () => {
  const result = unserialize('d:NAN;');
  assert.ok(Number.isNaN(result));
});

test('unserialize parses negative INF float', () => {
  const result = unserialize('d:-INF;');
  assert.equal(result, NaN);
});

test('unserialize parses string with length', () => {
  const result = unserialize('s:5:"hello";');
  assert.equal(result, 'hello');
});

test('unserialize parses empty string', () => {
  const result = unserialize('s:0:"";');
  assert.equal(result, '');
});

test('unserialize parses empty array', () => {
  const result = unserialize('a:0:{}');
  assert.deepEqual(result, Object.create(null));
});

test('unserialize parses array with string key', () => {
  const result = unserialize('a:1:{s:1:"a";i:1;}');
  assert.deepEqual(result, Object.assign(Object.create(null), { a: 1 }));
});

test('unserialize parses array with integer key', () => {
  const result = unserialize('a:1:{i:5;s:1:"x";}');
  assert.deepEqual(result, Object.assign(Object.create(null), { 5: 'x' }));
});

test('unserialize parses array with multiple entries', () => {
  const result = unserialize('a:2:{i:0;s:1:"a";i:1;s:1:"b";}');
  assert.deepEqual(result, Object.assign(Object.create(null), { 0: 'a', 1: 'b' }));
});

test('unserialize parses object with public property', () => {
  const result = unserialize('O:8:"stdClass":1:{s:3:"foo";i:1;}');
  assert.deepEqual(result, Object.assign(Object.create(null), { __class: 'stdClass', foo: 1 }));
});

test('unserialize parses object with private property', () => {
  const input = 'O:4:"Test":1:{s:9:"\0Test\0foo";i:1;}';
  const result = unserialize(input);
  assert.deepEqual(result, Object.assign(Object.create(null), { __class: 'Test', foo: 1 }));
});

test('unserialize parses object with protected property', () => {
  const input = 'O:4:"Test":1:{s:6:"\0*\0foo";i:1;}';
  const result = unserialize(input);
  assert.deepEqual(result, Object.assign(Object.create(null), { __class: 'Test', foo: 1 }));
});

test('unserialize parses nested array', () => {
  const result = unserialize('a:1:{s:1:"a";a:1:{i:0;i:42;}}');
  assert.deepEqual(result, Object.assign(Object.create(null), { a: Object.assign(Object.create(null), { 0: 42 }) }));
});

test('unserialize parses nested object', () => {
  const input = 'O:8:"stdClass":1:{s:3:"foo";O:8:"stdClass":1:{s:3:"bar";i:1;}}';
  const result = unserialize(input);
  assert.deepEqual(result, Object.assign(Object.create(null), { __class: 'stdClass', foo: Object.assign(Object.create(null), { __class: 'stdClass', bar: 1 }) }));
});

test('unserialize parses negative zero integer', () => {
  const result = unserialize('i:-0;');
  assert.equal(result, -0);
});

test('unserialize parses Buffer input', () => {
  const result = unserialize(Buffer.from('i:42;'));
  assert.equal(result, 42);
});

test('unserialize throws on trailing bytes', () => {
  assert.throws(() => unserialize('N;x'), { name: 'Error', message: 'unserialize: trailing bytes at byte 2' });
});

test('unserialize throws on unknown type', () => {
  assert.throws(() => unserialize('x:1;'), { name: "Error", message: "unserialize: unknown type 'x' at byte 1" });
});

test('unserialize throws on bad boolean value', () => {
  assert.throws(() => unserialize('b:2;'), { name: "Error", message: "unserialize: bad boolean at byte 4" });
});

test('unserialize throws on non-integer in integer field', () => {
  assert.throws(() => unserialize('i:abc;'), { name: "Error", message: "unserialize: not an integer: abc at byte 6" });
});

test('unserialize throws on bad float format', () => {
  assert.throws(() => unserialize('d:abc;'), { name: "Error", message: "unserialize: bad float at byte 6" });
});

test('unserialize throws on string length exceeding input', () => {
  assert.throws(() => unserialize('s:10:"short";'), { name: "Error", message: "unserialize: string length exceeds input at byte 6" });
});

test('unserialize throws on array key that is not string or integer', () => {
  assert.throws(() => unserialize('a:1:{a:1;i:1;}'), { name: "Error", message: "unserialize: not an integer: 1;i at byte 11" });
});

test('unserialize throws on object property name that is not string', () => {
  assert.throws(() => unserialize('O:8:"stdClass":1:{i:1;i:1;}'), { name: "Error", message: "unserialize: object property name must be a string at byte 22" });
});

test('unserialize throws on boolean missing semicolon', () => {
  assert.throws(() => unserialize('b:1'), { name: 'Error', message: "unserialize: unterminated token, expected ';' at byte 2" });
});

test('unserialize throws on integer missing semicolon', () => {
  assert.throws(() => unserialize('i:42'), { name: 'Error', message: "unserialize: unterminated token, expected ';' at byte 2" });
});

test('unserialize throws on float missing semicolon', () => {
  assert.throws(() => unserialize('d:3.14'), { name: 'Error', message: "unserialize: unterminated token, expected ';' at byte 2" });
});

test('unserialize throws on string missing closing quote', () => {
  assert.throws(() => unserialize('s:5:"hello'), { name: "Error", message: "unserialize: expected '\"' at byte 10" });
});

test('unserialize throws on array missing closing brace', () => {
  assert.throws(() => unserialize('a:1:{s:1:"a";i:1;'), { name: "Error", message: "unserialize: expected '}' at byte 17" });
});

test('unserialize throws on object missing closing brace', () => {
  assert.throws(() => unserialize('O:8:"stdClass":1:{s:3:"foo";i:1;'), { name: "Error", message: "unserialize: expected '}' at byte 32" });
});

test('unserialize throws on array count mismatch', () => {
  assert.throws(() => unserialize('a:2:{s:1:"a";i:1;}'), { name: "Error", message: "unserialize: unknown type '}' at byte 18" });
});

test('unserialize throws on object count mismatch', () => {
  assert.throws(() => unserialize('O:8:"stdClass":2:{s:3:"foo";i:1;}'), { name: "Error", message: "unserialize: unknown type '}' at byte 33" });
});

test('unserialize throws on missing colon after type', () => {
  assert.throws(() => unserialize('i42;'), { name: 'Error', message: "unserialize: expected ':' at byte 1" });
});

test('unserialize throws on missing colon after string length', () => {
  assert.throws(() => unserialize('s:5"hello";'), { name: "Error", message: "unserialize: unterminated token, expected ':' at byte 2" });
});

test('unserialize throws on missing colon after array count', () => {
  assert.throws(() => unserialize('a:1{'), { name: "Error", message: "unserialize: unterminated token, expected ':' at byte 2" });
});

test('unserialize throws on missing colon after object class name', () => {
  assert.throws(() => unserialize('O:8:"stdClass"1:{s:3:"foo";i:1;}'), { name: 'Error', message: "unserialize: expected ':' at byte 14" });
});

test('unserialize throws on missing colon after object property count', () => {
  assert.throws(() => unserialize('O:8:"stdClass":1{s:3:"foo";i:1;}'), { name: "Error", message: "unserialize: not an integer: 1{s at byte 19" });
});

test('unserialize throws on missing opening brace for array', () => {
  assert.throws(() => unserialize('a:1:}'), { name: 'Error', message: "unserialize: expected '{' at byte 4" });
});

test('unserialize throws on missing opening brace for object', () => {
  assert.throws(() => unserialize('O:8:"stdClass":1:}'), { name: 'Error', message: "unserialize: expected '{' at byte 17" });
});

test('unserialize throws on array key being null', () => {
  assert.throws(() => unserialize('a:1:{N;i:1;}'), { name: "Error", message: "unserialize: array key must be string or integer at byte 7" });
});

test('unserialize throws on array key being boolean', () => {
  assert.throws(() => unserialize('a:1:{b:1;i:1;}'), { name: "Error", message: "unserialize: array key must be string or integer at byte 9" });
});

test('unserialize throws on array key being array', () => {
  assert.throws(() => unserialize('a:1:{a:0:{}i:1;}'), { name: "Error", message: "unserialize: array key must be string or integer at byte 11" });
});

test('unserialize throws on object property name being integer', () => {
  assert.throws(() => unserialize('O:8:"stdClass":1:{i:1;i:1;}'), { name: "Error", message: "unserialize: object property name must be a string at byte 22" });
});

test('unserialize throws on object property name being null', () => {
  assert.throws(() => unserialize('O:8:"stdClass":1:{N;i:1;}'), { name: "Error", message: "unserialize: object property name must be a string at byte 20" });
});

test('unserialize throws on object property name being boolean', () => {
  assert.throws(() => unserialize('O:8:"stdClass":1:{b:1;i:1;}'), { name: "Error", message: "unserialize: object property name must be a string at byte 22" });
});
