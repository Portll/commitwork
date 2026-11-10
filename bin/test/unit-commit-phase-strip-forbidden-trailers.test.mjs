// Removes Co-Authored-By trailer lines from a commit message (bin/commit-phase.mjs stripForbiddenTrailers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripForbiddenTrailers } from '../commit-phase.mjs';

test('returns the input unchanged with zero removed when no forbidden trailer is present', () => {
  const r = stripForbiddenTrailers('feat: add thing\n\nBody text here.');
  assert.deepEqual(r, { text: "feat: add thing\n\nBody text here.", removed: 0 });
});

test('returns the input unchanged with zero removed when the message is empty', () => {
  const r = stripForbiddenTrailers('');
  assert.deepEqual(r, { text: "", removed: 0 });
});

test('returns the input unchanged with zero removed when the message is null', () => {
  const r = stripForbiddenTrailers(null);
  assert.deepEqual(r, { text: "", removed: 0 });
});

test('returns the input unchanged with zero removed when the message is undefined', () => {
  const r = stripForbiddenTrailers(undefined);
  assert.deepEqual(r, { text: "", removed: 0 });
});

test('strips a single Co-Authored-By trailer and reports one removed', () => {
  const r = stripForbiddenTrailers('feat: add thing\n\nBody text.\n\nCo-Authored-By: Alice <alice@example.com>');
  assert.deepEqual(r, { text: "feat: add thing\n\nBody text.\n", removed: 1 });
});

test('strips multiple Co-Authored-By trailers and reports the count', () => {
  const r = stripForbiddenTrailers('fix: bug\n\nBody.\n\nCo-Authored-By: A <a@x.com>\nCo-Authored-By: B <b@x.com>');
  assert.deepEqual(r, { text: "fix: bug\n\nBody.\n", removed: 2 });
});

test('strips a Co-Authored-By trailer with leading whitespace and mixed case', () => {
  const r = stripForbiddenTrailers('chore: tidy\n\nBody.\n\n  co-authored-by: C <c@x.com>');
  assert.deepEqual(r, { text: "chore: tidy\n\nBody.\n", removed: 1 });
});

test('collapses the blank line left by a trailer block into a single blank line', () => {
  const r = stripForbiddenTrailers('feat: x\n\nBody.\n\n\nCo-Authored-By: D <d@x.com>');
  assert.deepEqual(r, { text: "feat: x\n\nBody.\n", removed: 1 });
});

test('strips a trailer at the end of the message leaving a trailing newline', () => {
  const r = stripForbiddenTrailers('docs: update\n\nCo-Authored-By: E <e@x.com>');
  assert.deepEqual(r, { text: "docs: update\n", removed: 1 });
});

test('strips a trailer in the middle of the message preserving the body', () => {
  const r = stripForbiddenTrailers('feat: y\n\nCo-Authored-By: F <f@x.com>\n\nMore body.');
  assert.deepEqual(r, { text: "feat: y\n\nMore body.\n", removed: 1 });
});
