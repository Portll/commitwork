// Parses a newline-delimited plain list into typed indicator objects (monitor/indicators.mjs parsePlainList).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlainList } from '../indicators.mjs';

test('rejects an undeclared observable type with a descriptive error', () => {
  assert.throws(() => parsePlainList('foo', 'bogus'), {
    name: 'Error',
    message: "indicators: 'bogus' is not a declared observable type. Declared: domain, url, ipv4, ipv6, sha256, sha512, sha1, md5, email, process, package"
  });
});

test('returns an empty indicator list when the text is blank', () => {
  const r = parsePlainList('   \n  ', 'domain');
  assert.deepEqual(r, { source: null, indicators: [], rejected: [] });
});

test('lowercases and strips trailing dot for domain values', () => {
  const r = parsePlainList('Example.COM.\n', 'domain');
  assert.deepEqual(r, { source: null, indicators: [{ id: null, name: null, created: null, type: 'domain', value: 'example.com', source: null }], rejected: [] });
});

test('lowercases sha256 values', () => {
  const r = parsePlainList('ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789\n', 'sha256');
  assert.deepEqual(r, { source: null, indicators: [{ id: null, name: null, created: null, type: 'sha256', value: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789', source: null }], rejected: [] });
});

test('preserves case for url values', () => {
  const r = parsePlainList('https://Example.COM/Path\n', 'url');
  assert.deepEqual(r, { source: null, indicators: [{ id: null, name: null, created: null, type: 'url', value: 'https://Example.COM/Path', source: null }], rejected: [] });
});

test('strips inline comments and skips empty lines', () => {
  const r = parsePlainList('a.com # note\n\n  \nb.com\n', 'domain');
  assert.deepEqual(r, { source: null, indicators: [{ id: null, name: null, created: null, type: 'domain', value: 'a.com', source: null }, { id: null, name: null, created: null, type: 'domain', value: 'b.com', source: null }], rejected: [] });
});

test('propagates the source option into every indicator and the result', () => {
  const r = parsePlainList('x.com\n', 'domain', { source: 'test' });
  assert.deepEqual(r, { source: 'test', indicators: [{ id: null, name: null, created: null, type: 'domain', value: 'x.com', source: 'test' }], rejected: [] });
});

test('lowercases email values and strips trailing dot', () => {
  const r = parsePlainList('User@Example.COM.\n', 'email');
  assert.deepEqual(r, { source: null, indicators: [{ id: null, name: null, created: null, type: 'email', value: 'user@example.com', source: null }], rejected: [] });
});
