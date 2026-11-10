// Builds a resolv.conf text with a fixed forwarder and preserved search/domain/options lines (bin/lib/sandbox-net.mjs resolvConf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvConf } from '../lib/sandbox-net.mjs';

test('returns nameserver line and trailing newline for empty input', () => {
  assert.equal(resolvConf(''), "nameserver 169.254.1.1\n");
});

test('returns nameserver line and trailing newline for default argument', () => {
  assert.equal(resolvConf(), "nameserver 169.254.1.1\n");
});

test('keeps a search line after the nameserver line', () => {
  assert.equal(resolvConf('search example.com'), "nameserver 169.254.1.1\nsearch example.com\n");
});

test('keeps a domain line after the nameserver line', () => {
  assert.equal(resolvConf('domain example.com'), "nameserver 169.254.1.1\ndomain example.com\n");
});

test('keeps an options line after the nameserver line', () => {
  assert.equal(resolvConf('options ndots:2'), "nameserver 169.254.1.1\noptions ndots:2\n");
});

test('drops a nameserver line from the input', () => {
  assert.equal(resolvConf('nameserver 8.8.8.8'), "nameserver 169.254.1.1\n");
});

test('drops a comment line from the input', () => {
  assert.equal(resolvConf('# comment'), "nameserver 169.254.1.1\n");
});

test('keeps multiple matching lines in order', () => {
  assert.equal(resolvConf('search a.com\ndomain b.com\noptions ndots:1'), "nameserver 169.254.1.1\nsearch a.com\ndomain b.com\noptions ndots:1\n");
});

test('keeps a search line with leading whitespace', () => {
  assert.equal(resolvConf('  search example.com'), "nameserver 169.254.1.1\n  search example.com\n");
});

test('drops a line where the keyword is not followed by whitespace', () => {
  assert.equal(resolvConf('searchx example.com'), "nameserver 169.254.1.1\n");
});
