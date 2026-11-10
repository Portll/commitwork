// a schema-validated atomic issue store write under its lock (monitor/issue-store.mjs saveIssues).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { saveIssues } from '../issue-store.mjs';

const lockRefusal = (target) => ({
  name: 'Error',
  message: `refusing to save the issue store at ${target} without its lock \u2014 wrap the load/mutate/save in `
    + 'withIssuesLock(). The write itself is atomic, which prevents a TORN file and does nothing '
    + 'about a LOST one: a concurrent writer\'s document simply replaces yours, and verifyChain '
    + 'reports no problem because the records it lost were never in the file it hashed.',
});

test('A save to an absolute path without the lock is refused and names that path', () => {
  assert.throws(
    () => saveIssues({}, { path: '/commitwork-unit/store/issues.json' }),
    lockRefusal('/commitwork-unit/store/issues.json'),
  );
});

test('A refusal names the normalised path when the given path has dot segments', () => {
  assert.throws(
    () => saveIssues({}, { path: '/commitwork-unit/store/./sub/../issues.json' }),
    lockRefusal('/commitwork-unit/store/issues.json'),
  );
});

test('A relative path is resolved against the working directory before it is refused', () => {
  assert.throws(
    () => saveIssues({}, { path: 'commitwork-unit/issues.json' }),
    lockRefusal(resolve('commitwork-unit/issues.json')),
  );
});

test('A null document gets the lock refusal because the lock is checked before validation', () => {
  assert.throws(
    () => saveIssues(null, { path: '/commitwork-unit/null/issues.json' }),
    lockRefusal('/commitwork-unit/null/issues.json'),
  );
});

test('A missing schema file does not change the refusal because the schema is never read without the lock', () => {
  assert.throws(
    () => saveIssues({}, {
      path: '/commitwork-unit/schema/issues.json',
      schemaPath: '/commitwork-unit/schema/missing.schema.json',
    }),
    lockRefusal('/commitwork-unit/schema/issues.json'),
  );
});

test('A second attempt on the same path is refused the same way as the first', () => {
  const path = '/commitwork-unit/repeat/issues.json';
  assert.throws(() => saveIssues({}, { path }), lockRefusal(path));
  assert.throws(() => saveIssues({}, { path }), lockRefusal(path));
});
