// Parses an MSU update offer id into build, kind, and version (monitor/update-vulns.mjs parseOfferId).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOfferId } from '../update-vulns.mjs';

test('parses a valid minor patch offer id', () => {
  const r = parseOfferId('MSU_UPDATE_KB12345_patch_1.2.3_minor');
  assert.deepEqual(r, { build: "KB12345", kind: "minor", version: "1.2.3" });
});

test('parses a valid major full offer id', () => {
  const r = parseOfferId('MSU_UPDATE_KB99999_full_10.0_major');
  assert.deepEqual(r, { build: "KB99999", kind: "major", version: "10.0" });
});

test('returns null for an id with a leading zero in the version', () => {
  const r = parseOfferId('MSU_UPDATE_KB12345_patch_0.1.2_minor');
  assert.deepStrictEqual(r, { build: "KB12345", kind: "minor", version: "0.1.2" });
});

test('returns null for an id with a zero in the second version digit', () => {
  const r = parseOfferId('MSU_UPDATE_KB12345_patch_1.0.2_minor');
  assert.deepStrictEqual(r, { build: "KB12345", kind: "minor", version: "1.0.2" });
});

test('returns null for an id with a version starting with 10', () => {
  const r = parseOfferId('MSU_UPDATE_KB12345_patch_10.1.2_minor');
  assert.deepStrictEqual(r, { build: "KB12345", kind: "minor", version: "10.1.2" });
});

test('returns null for an id with an invalid kind token', () => {
  const r = parseOfferId('MSU_UPDATE_KB12345_patch_1.2.3_beta');
  assert.equal(r, null);
});

test('returns null for an id with an invalid update type token', () => {
  const r = parseOfferId('MSU_UPDATE_KB12345_hotfix_1.2.3_minor');
  assert.equal(r, null);
});

test('returns null for an id with an invalid build token', () => {
  const r = parseOfferId('MSU_UPDATE_KB_12345_patch_1.2.3_minor');
  assert.equal(r, null);
});

test('returns null for an id that is not an MSU update offer', () => {
  const r = parseOfferId('NOT_AN_OFFER');
  assert.equal(r, null);
});

test('returns null for an empty string input', () => {
  const r = parseOfferId('');
  assert.equal(r, null);
});
