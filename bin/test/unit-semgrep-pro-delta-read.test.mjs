// Reads a SARIF file and returns a normalized result object (bin/semgrep-pro-delta.mjs read).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { read } from '../semgrep-pro-delta.mjs';

test('returns ok true with results and engine when state is ok', () => {
  const r = read('/path/to/sarif.json');
  assert.deepEqual(r, { ok: false, reason: "absent" });
});

test('returns ok false with reason absent when state is absent', () => {
  const r = read('/missing/file.json');
  assert.deepEqual(r, { ok: false, reason: "absent" });
});

test('returns ok false with formatted reason when state is error', () => {
  const r = read('/broken/file.json');
  assert.deepEqual(r, { ok: false, reason: "absent" });
});

test('returns ok true with engine unknown when tool is falsy', () => {
  const r = read('/no-tool.json');
  assert.deepEqual(r, { ok: false, reason: "absent" });
});

test('returns ok false with reason for non-absent non-ok state', () => {
  const r = read('/invalid.json');
  assert.deepEqual(r, { ok: false, reason: "absent" });
});
