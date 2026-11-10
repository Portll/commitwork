// joins a base URL with a relative path, handling absolute URLs and slash normalization (bin/vendor-verify.mjs joinUrl).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinUrl } from '../vendor-verify.mjs';

test('returns absolute URL unchanged when rest starts with a scheme', () => {
  assert.equal(joinUrl('https://base.com', 'http://example.org'), 'http://example.org');
});

test('returns absolute URL unchanged for mixed case scheme', () => {
  assert.equal(joinUrl('https://base.com', 'HTTPS://example.org'), 'HTTPS://example.org');
});

test('returns absolute URL unchanged when rest starts with a scheme containing digit 1', () => {
  assert.equal(joinUrl('https://base.com', 'http1://example.org'), 'http1://example.org');
});

test('returns absolute URL unchanged when rest starts with a scheme containing digit 2', () => {
  assert.equal(joinUrl('https://base.com', 'http2://example.org'), 'http2://example.org');
});

test('joins base and relative path, removing extra slashes', () => {
  assert.equal(joinUrl('https://base.com/', '/path/to/resource'), 'https://base.com/path/to/resource');
});

test('joins base without trailing slash and rest without leading slash', () => {
  assert.equal(joinUrl('https://base.com', 'path'), 'https://base.com/path');
});

test('handles base with multiple trailing slashes and rest with multiple leading slashes', () => {
  assert.equal(joinUrl('https://base.com///', '///deep'), 'https://base.com/deep');
});

test('converts non-string rest to string before joining', () => {
  assert.equal(joinUrl('https://base.com', 42), 'https://base.com/42');
});

test('returns base followed by slash when rest is empty string', () => {
  assert.equal(joinUrl('https://base.com/', ''), 'https://base.com/');
});
