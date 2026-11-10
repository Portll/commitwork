// Parses a commit gate send name into name, ref, and project (bin/hooks/gate-send-name.mjs parseTo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTo } from '../hooks/gate-send-name.mjs';

test('returns null for undefined input', () => {
  const r = parseTo(undefined);
  assert.deepEqual(r, null);
});

test('returns null for empty string input', () => {
  const r = parseTo('');
  assert.deepEqual(r, null);
});

test('parses valid name with two hex ref chars', () => {
  const r = parseTo('proj-12');
  assert.deepEqual(r, { name: "proj-12", ref: null, project: "proj" });
});

test('parses valid name with four hex ref chars', () => {
  const r = parseTo('proj-12[abcd]');
  assert.deepEqual(r, { name: "proj-12", ref: "abcd", project: "proj" });
});

test('parses valid name with eight hex ref chars', () => {
  const r = parseTo('proj-12[abcdef12]');
  assert.deepEqual(r, { name: "proj-12", ref: "abcdef12", project: "proj" });
});

test('returns null for name with three hex chars', () => {
  const r = parseTo('proj-123');
  assert.deepEqual(r, null);
});

test('returns null for ref with three hex chars', () => {
  const r = parseTo('proj-12[abc]');
  assert.deepEqual(r, null);
});

test('returns null for ref with nine hex chars', () => {
  const r = parseTo('proj-12[abcdef123]');
  assert.deepEqual(r, null);
});

test('parses name with multiple hyphens', () => {
  const r = parseTo('my-proj-12');
  assert.deepEqual(r, { name: "my-proj-12", ref: null, project: "my-proj" });
});

test('parses name with leading and trailing whitespace', () => {
  const r = parseTo('  proj-12  ');
  assert.deepEqual(r, { name: "proj-12", ref: null, project: "proj" });
});
