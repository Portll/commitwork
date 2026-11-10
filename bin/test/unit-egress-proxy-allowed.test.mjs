// Checks whether a host matches an allowlist entry (bin/egress-proxy.mjs allowed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowed } from '../egress-proxy.mjs';

test('exact host match returns true', () => {
  const r = allowed('example.com', [{ host: 'example.com' }]);
  assert.equal(r, true);
});

test('exact host mismatch returns false', () => {
  const r = allowed('other.com', [{ host: 'example.com' }]);
  assert.equal(r, false);
});

test('wildcard suffix match returns true', () => {
  const r = allowed('sub.example.com', [{ host: '.example.com' }]);
  assert.equal(r, true);
});

test('wildcard non-match returns false', () => {
  const r = allowed('sub.other.com', [{ host: '.example.com' }]);
  assert.equal(r, false);
});

test('wildcard exact domain returns true', () => {
  const r = allowed('example.com', [{ host: '.example.com' }]);
  assert.equal(r, true);
});

test('wildcard exact domain mismatch returns false', () => {
  const r = allowed('notexample.com', [{ host: '.example.com' }]);
  assert.equal(r, false);
});

test('port stripped before comparison returns true', () => {
  const r = allowed('example.com:8080', [{ host: 'example.com' }]);
  assert.equal(r, true);
});

test('ipv6 bracket stripped returns true', () => {
  const r = allowed('[::1]', [{ host: '::1' }]);
  assert.equal(r, true);
});

test('empty allowlist returns false', () => {
  const r = allowed('example.com', []);
  assert.equal(r, false);
});

test('case insensitive match returns true', () => {
  const r = allowed('EXAMPLE.COM', [{ host: 'example.com' }]);
  assert.equal(r, true);
});
