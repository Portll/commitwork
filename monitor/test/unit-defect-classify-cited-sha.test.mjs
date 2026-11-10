// Extracts the first 7-40 char hex token from text (monitor/defect-classify.mjs citedSha).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { citedSha } from '../defect-classify.mjs';

test('returns null when input is null', () => {
  assert.equal(citedSha(null), null);
});

test('returns null when input is undefined', () => {
  assert.equal(citedSha(undefined), null);
});

test('returns null when input is empty string', () => {
  assert.equal(citedSha(''), null);
});

test('returns null when input has no hex token', () => {
  assert.equal(citedSha('no hex here'), null);
});

test('returns the 7 char hex token', () => {
  assert.equal(citedSha('sha 1234567 end'), "1234567");
});

test('returns the 8 char hex token', () => {
  assert.equal(citedSha('sha 12345678 end'), "12345678");
});

test('returns the 40 char hex token', () => {
  assert.equal(citedSha('sha ' + 'a'.repeat(40) + ' end'), "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
});

test('returns null when hex token is 41 chars', () => {
  assert.equal(citedSha('sha ' + 'a'.repeat(41) + ' end'), null);
});

test('returns the hex token containing zero', () => {
  assert.equal(citedSha('sha 0123456 end'), "0123456");
});

test('returns the hex token containing one', () => {
  assert.equal(citedSha('sha 1123456 end'), "1123456");
});
