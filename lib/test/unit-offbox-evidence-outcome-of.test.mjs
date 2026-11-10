// Maps a probe kind and verdict to its outcome token, or null when either is unknown (lib/offbox-evidence.mjs outcomeOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outcomeOf } from '../offbox-evidence.mjs';

test('returns pass for protected EDGE_AUTH', () => {
  assert.equal(outcomeOf('protected', 'EDGE_AUTH'), "pass");
});

test('returns fail for protected UNPROTECTED', () => {
  assert.equal(outcomeOf('protected', 'UNPROTECTED'), "fail");
});

test('returns no-information for protected UNREACHABLE', () => {
  assert.equal(outcomeOf('protected', 'UNREACHABLE'), "no-information");
});

test('returns no-information for protected UNVERIFIABLE', () => {
  assert.equal(outcomeOf('protected', 'UNVERIFIABLE'), "no-information");
});

test('returns fail for available-and-protected UNREACHABLE', () => {
  assert.equal(outcomeOf('available-and-protected', 'UNREACHABLE'), "fail");
});

test('returns fail for available-and-protected UNVERIFIABLE', () => {
  assert.equal(outcomeOf('available-and-protected', 'UNVERIFIABLE'), "fail");
});

test('returns pass for unreachable UNREACHABLE', () => {
  assert.equal(outcomeOf('unreachable', 'UNREACHABLE'), "pass");
});

test('returns fail for unreachable EDGE_AUTH', () => {
  assert.equal(outcomeOf('unreachable', 'EDGE_AUTH'), "fail");
});

test('returns null for an unknown kind', () => {
  assert.equal(outcomeOf('nonexistent-kind', 'EDGE_AUTH'), null);
});

test('returns null for a known kind with an unknown verdict', () => {
  assert.equal(outcomeOf('protected', 'UNKNOWN_VERDICT'), null);
});
