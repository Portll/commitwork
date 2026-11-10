// Extracts the reclaimed space value from docker system df output (bin/docker-gc.mjs parseReclaimed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReclaimed } from '../docker-gc.mjs';

test('returns the captured value when the pattern matches', () => {
  const r = parseReclaimed('Total reclaimed space: 1.2GB');
  assert.equal(r, "1.2GB");
});

test('returns null when the pattern is absent', () => {
  const r = parseReclaimed('No reclaimed space here');
  assert.equal(r, null);
});

test('returns null when the input is null', () => {
  const r = parseReclaimed(null);
  assert.equal(r, null);
});

test('returns null when the input is undefined', () => {
  const r = parseReclaimed(undefined);
  assert.equal(r, null);
});

test('returns the captured value when the label is uppercase', () => {
  const r = parseReclaimed('TOTAL RECLAIMED SPACE: 500MB');
  assert.equal(r, "500MB");
});

test('returns the captured value when the label is mixed case', () => {
  const r = parseReclaimed('Total Reclaimed Space: 100MB');
  assert.equal(r, "100MB");
});

test('returns the captured value when there are multiple spaces after the colon', () => {
  const r = parseReclaimed('Total reclaimed space:   2.5GB');
  assert.equal(r, "2.5GB");
});

test('returns the captured value when the input is a non-string object', () => {
  const r = parseReclaimed({ toString: () => 'Total reclaimed space: 1GB' });
  assert.equal(r, "1GB");
});

test('returns null when the label is present but the value is empty', () => {
  const r = parseReclaimed('Total reclaimed space:');
  assert.equal(r, null);
});

test('returns the captured value when the value contains a dot', () => {
  const r = parseReclaimed('Total reclaimed space: 1.234GB');
  assert.equal(r, "1.234GB");
});
