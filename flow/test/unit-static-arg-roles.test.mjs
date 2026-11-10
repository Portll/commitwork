// Maps argument names to read/write roles based on call-site verbs (flow/static.mjs argRoles).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { argRoles } from '../static.mjs';

test('returns empty map when no read or write verbs are called', () => {
  const r = argRoles('foo(bar)');
  assert.deepEqual(r, new Map([]));
});

test('marks argument as reads when first argument is a read verb', () => {
  const r = argRoles('readFileSync(path)');
  assert.deepEqual(r, new Map([["path", new Set(["reads"])]]));
});

test('marks argument as writes when first argument is a write verb', () => {
  const r = argRoles('writeFileSync(path)');
  assert.deepEqual(r, new Map([["path", new Set(["writes"])]]));
});

test('accumulates multiple roles for the same argument name', () => {
  const r = argRoles('readFileSync(p); writeFileSync(p)');
  assert.deepEqual(r, new Map([["p", new Set(["reads", "writes"])]]));
});

test('distinguishes different argument names with same verb', () => {
  const r = argRoles('readFileSync(a); readFileSync(b)');
  assert.deepEqual(r, new Map([["a", new Set(["reads"])], ["b", new Set(["reads"])]]));
});

test('handles multiple arguments in a single call', () => {
  const r = argRoles('readFileSync(a, b)');
  assert.deepEqual(r, new Map([["a", new Set(["reads"])]]));
});

test('ignores verbs that are not in read or write lists', () => {
  const r = argRoles('unknownVerb(x)');
  assert.deepEqual(r, new Map([]));
});

test('handles comma-separated arguments with write verb', () => {
  const r = argRoles('writeFileSync(a, b)');
  assert.deepEqual(r, new Map([["a", new Set(["writes"])]]));
});
