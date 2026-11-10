// Maps a lane name to its probe class (read, write, or unknown). (bin/lib/probe-oracle.mjs probeClass).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeClass } from '../lib/probe-oracle.mjs';

test('returns read for unauth-exposure lane', () => {
  assert.equal(probeClass('unauth-exposure'), "read");
});

test('returns read for bola lane', () => {
  assert.equal(probeClass('bola'), "read");
});

test('returns write for state-replay lane', () => {
  assert.equal(probeClass('state-replay'), "write");
});

test('returns write for mass-assignment lane', () => {
  assert.equal(probeClass('mass-assignment'), "write");
});

test('returns unknown for unlisted lane', () => {
  assert.equal(probeClass('nonexistent-lane'), "unknown");
});

test('returns unknown for empty string lane', () => {
  assert.equal(probeClass(''), "unknown");
});

test('returns unknown for undefined lane', () => {
  assert.equal(probeClass(undefined), "unknown");
});

test('returns unknown for null lane', () => {
  assert.equal(probeClass(null), "unknown");
});
