// Extracts the WebSocket URL from Chrome DevTools Protocol stderr output (lib/cdp.mjs parseDevToolsUrl).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDevToolsUrl } from '../cdp.mjs';

test('returns the ws URL when present in stderr', () => {
  const input = 'DevTools listening on ws://127.0.0.1:9222/devtools/browser/abc123';
  assert.equal(parseDevToolsUrl(input), 'ws://127.0.0.1:9222/devtools/browser/abc123');
});

test('returns null when stderr is empty string', () => {
  assert.equal(parseDevToolsUrl(''), null);
});

test('returns null when stderr is null', () => {
  assert.equal(parseDevToolsUrl(null), null);
});

test('returns null when stderr is undefined', () => {
  assert.equal(parseDevToolsUrl(undefined), null);
});

test('returns null when DevTools text is absent', () => {
  assert.equal(parseDevToolsUrl('Some other output'), null);
});

test('returns null when DevTools text is present but no ws URL follows', () => {
  assert.equal(parseDevToolsUrl('DevTools listening on http://127.0.0.1:9222'), null);
});

test('returns the ws URL when it contains a path with query parameters', () => {
  const input = 'DevTools listening on ws://localhost:9222/devtools/page/xyz?token=abc';
  assert.equal(parseDevToolsUrl(input), 'ws://localhost:9222/devtools/page/xyz?token=abc');
});

test('returns the ws URL when it is the only content in stderr', () => {
  // nosemgrep: javascript.lang.security.detect-insecure-websocket.detect-insecure-websocket -- parser test input, no connection is opened
  const input = 'DevTools listening on ws://0.0.0.0:8080';
  // nosemgrep: javascript.lang.security.detect-insecure-websocket.detect-insecure-websocket -- parser test input, no connection is opened
  assert.equal(parseDevToolsUrl(input), 'ws://0.0.0.0:8080');
});

test('returns null when input is a non-string type', () => {
  assert.equal(parseDevToolsUrl(12345), null);
});
