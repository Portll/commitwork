// Checks if an observed domain matches an indicator domain (monitor/indicators.mjs domainMatches).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { domainMatches } from '../indicators.mjs';

test('returns true when observed equals indicator domain exactly', () => {
  const r = domainMatches('example.com', 'example.com');
  assert.equal(r, true);
});

test('returns true when observed is a subdomain of indicator domain', () => {
  const r = domainMatches('example.com', 'sub.example.com');
  assert.equal(r, true);
});

test('returns false when observed is a different domain', () => {
  const r = domainMatches('example.com', 'other.com');
  assert.equal(r, false);
});

test('returns true when observed has trailing dot and matches indicator domain', () => {
  const r = domainMatches('example.com', 'example.com.');
  assert.equal(r, true);
});

test('returns true when observed is a subdomain with trailing dot', () => {
  const r = domainMatches('example.com', 'sub.example.com.');
  assert.equal(r, true);
});

test('returns false when observed is a suffix but not a subdomain', () => {
  const r = domainMatches('example.com', 'notexample.com');
  assert.equal(r, false);
});

test('returns true when indicator domain is uppercase and observed is lowercase', () => {
  const r = domainMatches('EXAMPLE.COM', 'example.com');
  assert.equal(r, true);
});

test('returns true when observed is uppercase and indicator domain is lowercase', () => {
  const r = domainMatches('example.com', 'EXAMPLE.COM');
  assert.equal(r, true);
});

test('returns true when observed is a multi-level subdomain', () => {
  const r = domainMatches('example.com', 'a.b.example.com');
  assert.equal(r, true);
});

test('returns false when observed is empty string', () => {
  const r = domainMatches('example.com', '');
  assert.equal(r, false);
});
