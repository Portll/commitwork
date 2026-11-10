// Checks whether a session id is already bound in a roster (bin/session-start-roster.mjs alreadyBound).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alreadyBound } from '../session-start-roster.mjs';

test('returns false when sessionId is empty', () => {
  const r = alreadyBound('', '{"id":"s1","name":"n"}');
  assert.equal(r, false);
});

test('returns false when raw is not a string', () => {
  const r = alreadyBound('s1', 123);
  assert.equal(r, false);
});

test('returns true when a line matches sessionId and has a name', () => {
  const r = alreadyBound('s1', '{"id":"s1","name":"n"}');
  assert.equal(r, true);
});

test('returns false when no line matches sessionId', () => {
  const r = alreadyBound('s1', '{"id":"s2","name":"n"}');
  assert.equal(r, false);
});

test('returns false when matching line has no name', () => {
  const r = alreadyBound('s1', '{"id":"s1"}');
  assert.equal(r, false);
});

test('returns false when a line is invalid JSON', () => {
  const r = alreadyBound('s1', 'not-json');
  assert.equal(r, false);
});

test('returns false when a line is empty', () => {
  const r = alreadyBound('s1', '');
  assert.equal(r, false);
});

test('returns true when a later line matches after a non-matching line', () => {
  const r = alreadyBound('s1', '{"id":"s2","name":"n"}\n{"id":"s1","name":"n"}');
  assert.equal(r, true);
});

test('returns false when sessionId is null', () => {
  const r = alreadyBound(null, '{"id":"s1","name":"n"}');
  assert.equal(r, false);
});

test('returns false when raw is undefined', () => {
  const r = alreadyBound('s1', undefined);
  assert.equal(r, false);
});
