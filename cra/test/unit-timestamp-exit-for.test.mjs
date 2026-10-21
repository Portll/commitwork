// Maps verification result states to process exit codes (cra/timestamp.mjs exitFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exitFor } from '../timestamp.mjs';

test('returns 21 when the results array is empty', () => {
  assert.equal(exitFor([]), 21);
});

test('returns 0 when no result is invalid, absent or unanchored', () => {
  assert.equal(exitFor([{ state: 'valid' }, { state: 'valid' }]), 0);
});

test('returns 22 when any result is invalid', () => {
  assert.equal(exitFor([{ state: 'valid' }, { state: 'invalid' }]), 22);
});

test('returns 22 when the only result is invalid', () => {
  assert.equal(exitFor([{ state: 'invalid' }]), 22);
});

test('returns 21 when any result is absent and none are invalid', () => {
  assert.equal(exitFor([{ state: 'valid' }, { state: 'absent' }]), 21);
});

test('returns 21 when the only result is absent', () => {
  assert.equal(exitFor([{ state: 'absent' }]), 21);
});

test('returns 20 when any result is unanchored and none are invalid or absent', () => {
  assert.equal(exitFor([{ state: 'valid' }, { state: 'unanchored' }]), 20);
});

test('returns 20 when the only result is unanchored', () => {
  assert.equal(exitFor([{ state: 'unanchored' }]), 20);
});

test('returns 22 when invalid takes precedence over absent', () => {
  assert.equal(exitFor([{ state: 'absent' }, { state: 'invalid' }]), 22);
});

test('returns 21 when absent takes precedence over unanchored', () => {
  assert.equal(exitFor([{ state: 'unanchored' }, { state: 'absent' }]), 21);
});
