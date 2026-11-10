// Rejects records containing absolute paths or forbidden keys (monitor/sweep-verdict.mjs assertServedSafe).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertServedSafe } from '../sweep-verdict.mjs';

test('returns true for a safe record with relative paths and no forbidden keys', () => {
  const r = assertServedSafe({ path: 'relative', items: ['a', 'b'] });
  assert.equal(r, true);
});

test('throws for a string value starting with a slash', () => {
  assert.throws(() => assertServedSafe({ path: '/absolute' }), { name: "Error", message: "absolute path at $.path: /absolute" });
});

test('throws for a non-string value that has a startsWith method returning true', () => {
  const obj = { startsWith: () => true };
  assert.equal(assertServedSafe({ val: obj }), true);
});

test('throws for a record with a session key', () => {
  assert.throws(() => assertServedSafe({ session: 'abc' }), { name: "Error", message: "forbidden key \"session\" at $" });
});

test('throws for a record with a pid key', () => {
  assert.throws(() => assertServedSafe({ pid: 123 }), { name: "Error", message: "forbidden key \"pid\" at $" });
});

test('returns true for a record with a key that is neither session nor pid', () => {
  const r = assertServedSafe({ name: 'test', value: 42 });
  assert.equal(r, true);
});

test('throws for a nested object with a forbidden key', () => {
  assert.throws(() => assertServedSafe({ nested: { pid: 999 } }), { name: "Error", message: "forbidden key \"pid\" at $.nested" });
});

test('returns true for an empty object', () => {
  const r = assertServedSafe({});
  assert.equal(r, true);
});
