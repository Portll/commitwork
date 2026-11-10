// Normalizes a remediation item status into a word, kind, and detail (lib/remediation-md.mjs statusOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusOf } from '../remediation-md.mjs';

test('returns unassessed for undefined status', () => {
  assert.deepEqual(statusOf({ status: undefined }), { word: "UNASSESSED", kind: "unassessed", detail: "" });
});

test('returns unassessed for empty string status', () => {
  assert.deepEqual(statusOf({ status: '' }), { word: "UNASSESSED", kind: "unassessed", detail: "" });
});

test('returns unassessed with detail for non-matching status', () => {
  assert.deepEqual(statusOf({ status: 'PENDING' }), { word: "UNASSESSED", kind: "unassessed", detail: "PENDING" });
});

test('returns done with empty detail for exact DONE', () => {
  assert.deepEqual(statusOf({ status: 'DONE' }), { word: "DONE", kind: "done", detail: "" });
});

test('returns partial with detail for PARTIAL with trailing text', () => {
  assert.deepEqual(statusOf({ status: 'PARTIAL: needs review' }), { word: "PARTIAL", kind: "partial", detail: ": needs review" });
});

test('returns open with detail for OPEN with em dash', () => {
  assert.deepEqual(statusOf({ status: 'OPEN \u2014 blocked' }), { word: "OPEN", kind: "open", detail: "blocked" });
});

test('returns superseded with detail for SUPERSEDED with hyphen', () => {
  assert.deepEqual(statusOf({ status: 'SUPERSEDED - by v2' }), { word: "SUPERSEDED", kind: "superseded", detail: "by v2" });
});

test('returns wrong with detail for WRONG with space', () => {
  assert.deepEqual(statusOf({ status: 'WRONG  fix applied' }), { word: "WRONG", kind: "wrong", detail: "fix applied" });
});

test('returns unassessed for null status', () => {
  assert.deepEqual(statusOf({ status: null }), { word: "UNASSESSED", kind: "unassessed", detail: "" });
});

test('returns unassessed for whitespace-only status', () => {
  assert.deepEqual(statusOf({ status: '   ' }), { word: "UNASSESSED", kind: "unassessed", detail: "" });
});
