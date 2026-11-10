// Computes the identity parts and source for a scanner row (monitor/issue-store.mjs scannerIdentityParts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scannerIdentityParts } from '../issue-store.mjs';

test('returns rule-file when rule is present and file is absent', () => {
  const r = scannerIdentityParts({ rule: 'R1' }, 'cat');
  assert.deepEqual(r, { parts: ["R1", undefined], from: "rule-file" });
});

test('returns rule-file when file is present and rule is absent', () => {
  const r = scannerIdentityParts({ file: 'F1' }, 'cat');
  assert.deepEqual(r, { parts: [undefined, "F1"], from: "rule-file" });
});

test('returns rule-file when both rule and file are present', () => {
  const r = scannerIdentityParts({ rule: 'R1', file: 'F1' }, 'cat');
  assert.deepEqual(r, { parts: ["R1", "F1"], from: "rule-file" });
});

test('returns none when rule and file are absent and no identity fields are present', () => {
  const r = scannerIdentityParts({}, 'cat');
  assert.deepEqual(r, { parts: [], from: "none" });
});

test('returns identity parts when declared identity fields are all present', () => {
  const r = scannerIdentityParts({ a: '1', b: '2' }, 'cat');
  assert.deepEqual(r, { parts: [], from: "none" });
});

test('returns rule-file when declared identity is incomplete but rule is present', () => {
  const r = scannerIdentityParts({ a: '1', rule: 'R1' }, 'cat');
  assert.deepEqual(r, { parts: ["R1", undefined], from: "rule-file" });
});

test('returns partial identity parts when no rule or file but some identity fields present', () => {
  const r = scannerIdentityParts({ a: '1' }, 'cat');
  assert.deepEqual(r, { parts: [], from: "none" });
});

test('returns empty parts with none when all fields are empty strings', () => {
  const r = scannerIdentityParts({ rule: '', file: '', a: '', b: '' }, 'cat');
  assert.deepEqual(r, { parts: [], from: "none" });
});
