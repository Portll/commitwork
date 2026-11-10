// strips root prefix and session/pid keys from served values (monitor/sweep-verdict.mjs sanitizeServed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeServed } from '../sweep-verdict.mjs';

test('returns the string unchanged when root is falsy', () => {
  assert.equal(sanitizeServed('/a/b', null), "/a/b");
});

test('returns the string unchanged when it does not start with root slash', () => {
  assert.equal(sanitizeServed('/other', '/a'), "/other");
});

test('strips the root prefix from a matching string', () => {
  assert.equal(sanitizeServed('/a/b', '/a'), "b");
});

test('strips the root prefix from each array element', () => {
  assert.deepEqual(sanitizeServed(['/a/b', '/c'], '/a'), ["b", "/c"]);
});

test('recurses into nested objects and arrays', () => {
  assert.deepEqual(sanitizeServed({ a: ['/a/b'], b: { c: '/a/d' } }, '/a'), { a: ["b"], b: { c: "d" } });
});

test('omits session and pid keys from objects', () => {
  assert.deepEqual(sanitizeServed({ session: 's', pid: 1, name: 'n' }, null), { name: "n" });
});

test('returns a plain object with all keys when root is null', () => {
  assert.deepEqual(sanitizeServed({ session: 's', pid: 2, x: 1 }, null), { x: 1 });
});

test('returns the value unchanged for non-object primitives', () => {
  assert.equal(sanitizeServed(42, '/a'), 42);
});
