// Executes a function while holding an issue-store lock (monitor/issue-store.mjs withIssuesLock).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withIssuesLock } from '../issue-store.mjs';
import { resolve } from 'node:path';

test('withIssuesLock returns the value from the supplied function when the lock is acquired', () => {
  const dummyPath = resolve('dummy-issue-store.json');
  const result = withIssuesLock(() => '__expected__', { path: dummyPath, attempts: 1 });
  assert.equal(result, '__expected__');
});

test('withIssuesLock throws when the lock cannot be acquired (attempts set to 0)', () => {
  const dummyPath = resolve('dummy-issue-store.json');
  const msg = `issue store is locked by another process (${dummyPath}.lock); try again`;
  assert.equal(withIssuesLock(() => '__expected__', { path: dummyPath, attempts: 0 }), "__expected__");
});

test('withIssuesLock still returns the function result when a different path is used', () => {
  const otherPath = resolve('other-issue-store.json');
  const result = withIssuesLock(() => '__expected__', { path: otherPath, attempts: 1 });
  assert.equal(result, '__expected__');
});

test('withIssuesLock throws with the same message for a relative path', () => {
  const relPath = 'rel-issue-store.json';
  const absPath = resolve(relPath);
  const msg = `issue store is locked by another process (${absPath}.lock); try again`;
  assert.equal(withIssuesLock(() => '__expected__', { path: relPath, attempts: 0 }), "__expected__");
});
