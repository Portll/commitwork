// Detects a cw-hazards-ignore-file marker in the first 40 lines of a file (bin/node-hazards.mjs fileSuppression).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileSuppression } from '../node-hazards.mjs';

test('returns null when no marker is present', () => {
  const r = fileSuppression('hello\nworld');
  assert.deepEqual(r, null);
});

test('returns marker with trimmed justification when reason is given', () => {
  const r = fileSuppression('cw-hazards-ignore-file: legacy code\nfoo');
  assert.deepEqual(r, { marker: "cw-hazards-ignore-file", justification: "legacy code", ownLine: false });
});

test('returns marker with default justification when reason is empty', () => {
  const r = fileSuppression('cw-hazards-ignore-file:\nfoo');
  assert.deepEqual(r, { marker: "cw-hazards-ignore-file", justification: "foo", ownLine: false });
});

test('returns marker with default justification when reason is only whitespace', () => {
  const r = fileSuppression('cw-hazards-ignore-file:   \nfoo');
  assert.deepEqual(r, { marker: "cw-hazards-ignore-file", justification: "foo", ownLine: false });
});

test('returns marker with default justification when reason is missing after colon', () => {
  const r = fileSuppression('cw-hazards-ignore-file:\nfoo');
  assert.deepEqual(r, { marker: "cw-hazards-ignore-file", justification: "foo", ownLine: false });
});

test('returns marker with default justification when reason is only spaces after colon', () => {
  const r = fileSuppression('cw-hazards-ignore-file:   \nfoo');
  assert.deepEqual(r, { marker: "cw-hazards-ignore-file", justification: "foo", ownLine: false });
});

test('returns marker with trimmed justification when reason has trailing spaces', () => {
  const r = fileSuppression('cw-hazards-ignore-file: reason here   \nfoo');
  assert.deepEqual(r, { marker: "cw-hazards-ignore-file", justification: "reason here", ownLine: false });
});

test('returns null when marker appears after line 40', () => {
  const lines = Array.from({ length: 40 }, () => 'x');
  const text = lines.join('\n') + '\ncw-hazards-ignore-file: late';
  const r = fileSuppression(text);
  assert.deepEqual(r, null);
});

test('returns marker when marker is on line 40', () => {
  const lines = Array.from({ length: 39 }, () => 'x');
  const text = lines.join('\n') + '\ncw-hazards-ignore-file: on line 40';
  const r = fileSuppression(text);
  assert.deepEqual(r, { marker: "cw-hazards-ignore-file", justification: "on line 40", ownLine: false });
});

test('returns null for empty string', () => {
  const r = fileSuppression('');
  assert.deepEqual(r, null);
});
