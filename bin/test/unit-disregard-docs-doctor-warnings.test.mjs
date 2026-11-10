// Collects docs-doctor warnings from orange/grey docs and index findings (bin/disregard.mjs docsDoctorWarnings).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docsDoctorWarnings } from '../disregard.mjs';

test('returns an empty array when result has no docs or indexFindings', () => {
  assert.deepEqual(docsDoctorWarnings({}), []);
});

test('returns an empty array when docs are all green', () => {
  assert.deepEqual(docsDoctorWarnings({ docs: [{ status: 'green', path: 'a.md', reasons: ['ok'] }] }), []);
});

test('returns an empty array when indexFindings is empty', () => {
  assert.deepEqual(docsDoctorWarnings({ indexFindings: [] }), []);
});

test('includes an orange doc with its reasons joined by semicolons', () => {
  assert.deepEqual(docsDoctorWarnings({ docs: [{ status: 'orange', path: 'docs/a.md', reasons: ['stale', 'missing'] }] }), [{ source: "docs-doctor", code: "orange", subject: "docs/a.md", message: "stale; missing" }]);
});

test('includes a grey doc with its reasons joined by semicolons', () => {
  assert.deepEqual(docsDoctorWarnings({ docs: [{ status: 'grey', path: 'docs/b.md', reasons: ['unlinked'] }] }), [{ source: "docs-doctor", code: "grey", subject: "docs/b.md", message: "unlinked" }]);
});

test('omits a red doc from the output', () => {
  assert.deepEqual(docsDoctorWarnings({ docs: [{ status: 'red', path: 'docs/c.md', reasons: ['broken'] }] }), []);
});

test('includes an index finding with code index and its reason', () => {
  assert.deepEqual(docsDoctorWarnings({ indexFindings: [{ path: 'docs/index.md', reason: 'duplicate entry' }] }), [{ source: "docs-doctor", code: "index", subject: "docs/index.md", message: "duplicate entry" }]);
});

test('omits a doc whose status is neither orange nor grey', () => {
  assert.deepEqual(docsDoctorWarnings({ docs: [{ status: 'blue', path: 'docs/d.md', reasons: ['weird'] }] }), []);
});
