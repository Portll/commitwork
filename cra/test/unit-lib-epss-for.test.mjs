// EPSS score lookup for a CVE, null when absent or non-numeric (cra/lib.mjs epssFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { epssFor } from '../lib.mjs';

test('returns the numeric score when the CVE maps to a number', () => {
  const r = epssFor({ 'CVE-2024-0001': 0.42 }, 'CVE-2024-0001');
  assert.equal(r, 0.42);
});

test('returns null when the CVE is missing from the document', () => {
  const r = epssFor({ 'CVE-2024-0001': 0.42 }, 'CVE-9999-9999');
  assert.equal(r, null);
});

test('returns null when the CVE maps to a string instead of a number', () => {
  const r = epssFor({ 'CVE-2024-0001': '0.42' }, 'CVE-2024-0001');
  assert.equal(r, null);
});

test('returns null when the CVE maps to a boolean instead of a number', () => {
  const r = epssFor({ 'CVE-2024-0001': true }, 'CVE-2024-0001');
  assert.equal(r, null);
});

test('returns null when the CVE maps to an object instead of a number', () => {
  const r = epssFor({ 'CVE-2024-0001': { score: 0.42 } }, 'CVE-2024-0001');
  assert.equal(r, null);
});

test('returns null when the CVE maps to null instead of a number', () => {
  const r = epssFor({ 'CVE-2024-0001': null }, 'CVE-2024-0001');
  assert.equal(r, null);
});

test('returns null when the document is null', () => {
  const r = epssFor(null, 'CVE-2024-0001');
  assert.equal(r, null);
});

test('returns null when the document is undefined', () => {
  const r = epssFor(undefined, 'CVE-2024-0001');
  assert.equal(r, null);
});

test('returns the score zero when the CVE maps to zero', () => {
  const r = epssFor({ 'CVE-2024-0001': 0 }, 'CVE-2024-0001');
  assert.equal(r, 0);
});

test('returns the score one when the CVE maps to one', () => {
  const r = epssFor({ 'CVE-2024-0001': 1 }, 'CVE-2024-0001');
  assert.equal(r, 1);
});
