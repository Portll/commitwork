// Classifies a base URL as local, lan, hosted, or null (monitor/llm-runtime.mjs reachOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reachOf } from '../llm-runtime.mjs';

test('returns local for localhost', () => {
  assert.equal(reachOf('http://localhost:8080'), "local");
});

test('returns local for ::1', () => {
  assert.equal(reachOf('http://[::1]:8080'), "local");
});

test('returns local for 127.0.0.1', () => {
  assert.equal(reachOf('http://127.0.0.1:8080'), "local");
});

test('returns lan for .local suffix', () => {
  assert.equal(reachOf('http://myhost.local:8080'), "lan");
});

test('returns lan for .internal suffix', () => {
  assert.equal(reachOf('http://myhost.internal:8080'), "lan");
});

test('returns lan for 192.168.1.1', () => {
  assert.equal(reachOf('http://192.168.1.1:8080'), "lan");
});

test('returns lan for fc00::1', () => {
  assert.equal(reachOf('http://[fc00::1]:8080'), "lan");
});

test('returns hosted for public domain', () => {
  assert.equal(reachOf('https://api.example.com'), "hosted");
});

test('returns null for unparseable URL', () => {
  assert.equal(reachOf('not-a-url'), null);
});
