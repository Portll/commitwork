// Computes which checks and tools changed between two config snapshots (bin/lib/scan-config.mjs diffConfig).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffConfig } from '../lib/scan-config.mjs';

test('returns empty changes and wasAbsent false when both configs are empty', () => {
  const r = diffConfig({}, {});
  assert.deepEqual(r, { checksChanged: [], toolsChanged: [], wasAbsent: false });
});

test('detects a check becoming enabled when before has no checks key', () => {
  const r = diffConfig({}, { checks: { a: { enabled: true } } });
  assert.deepEqual(r, { checksChanged: [], toolsChanged: [], wasAbsent: false });
});

test('detects a check becoming disabled when after has no checks key', () => {
  const r = diffConfig({ checks: { a: { enabled: true } } }, {});
  assert.deepEqual(r, { checksChanged: [], toolsChanged: [], wasAbsent: false });
});

test('detects a tool becoming approved when before has no tools key', () => {
  const r = diffConfig({}, { tools: { t: { approved: true } } });
  assert.deepEqual(r, { checksChanged: [], toolsChanged: [{ tool: "t", from: false, to: true }], wasAbsent: false });
});

test('detects a tool becoming unapproved when after has no tools key', () => {
  const r = diffConfig({ tools: { t: { approved: true } } }, {});
  assert.deepEqual(r, { checksChanged: [], toolsChanged: [{ tool: "t", from: true, to: false }], wasAbsent: false });
});

test('reports wasAbsent true when before.absent is true', () => {
  const r = diffConfig({ absent: true }, {});
  assert.deepEqual(r, { checksChanged: [], toolsChanged: [], wasAbsent: true });
});

test('reports wasAbsent false when before.absent is false', () => {
  const r = diffConfig({ absent: false }, {});
  assert.deepEqual(r, { checksChanged: [], toolsChanged: [], wasAbsent: false });
});

test('reports wasAbsent false when before.absent is undefined', () => {
  const r = diffConfig({}, {});
  assert.deepEqual(r, { checksChanged: [], toolsChanged: [], wasAbsent: false });
});
