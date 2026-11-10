// Whether a commit message contains a Co-Authored-By trailer line (bin/commit-phase.mjs hasForbiddenTrailer).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasForbiddenTrailer } from '../commit-phase.mjs';

test('returns true for a message containing a Co-Authored-By trailer', () => {
  const msg = 'feat: add feature\n\nCo-Authored-By: Jane Doe <jane@example.com>';
  assert.equal(hasForbiddenTrailer(msg), true);
});

test('returns true when the trailer is the very first character of the message', () => {
  assert.equal(hasForbiddenTrailer('Co-Authored-By: Jane Doe <jane@example.com>'), true);
});

test('returns false for a message without any forbidden trailer', () => {
  const msg = 'fix: correct bug in parser\n\nSigned-off-by: John Smith <john@example.com>';
  assert.equal(hasForbiddenTrailer(msg), false);
});

test('returns true for a Co-Authored-By trailer indented with spaces and tabs', () => {
  const msg = 'chore: update deps\n\n \tCo-Authored-By : Alice <alice@example.com>';
  assert.equal(hasForbiddenTrailer(msg), true);
});

test('returns true for a lowercase co-authored-by trailer', () => {
  const msg = 'refactor: split module\n\nco-authored-by: Carol <carol@example.com>';
  assert.equal(hasForbiddenTrailer(msg), true);
});

test('returns false when Co-Authored-By has no colon after it', () => {
  assert.equal(hasForbiddenTrailer('docs: note\n\nCo-Authored-By Bob'), false);
});

test('returns false when Co-Authored-By appears mid-line rather than at line start', () => {
  assert.equal(hasForbiddenTrailer('docs: drop the Co-Authored-By: line'), false);
});

test('returns false for an empty string message', () => {
  assert.equal(hasForbiddenTrailer(''), false);
});

test('returns false for null and undefined input', () => {
  assert.equal(hasForbiddenTrailer(null), false);
  assert.equal(hasForbiddenTrailer(undefined), false);
});

test('returns true when called twice in a row with the same forbidden message', () => {
  const msg = 'Co-Authored-By: Dave <dave@example.com>';
  assert.equal(hasForbiddenTrailer(msg), true);
  assert.equal(hasForbiddenTrailer(msg), true);
});
