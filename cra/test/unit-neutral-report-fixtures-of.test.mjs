// Aggregates fixture row counts from scanner details (cra/neutral-report.mjs fixturesOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixturesOf } from '../neutral-report.mjs';

test('returns null when rollup is null', () => {
  const r = fixturesOf(null);
  assert.equal(r, null);
});

test('returns null when rollup has no scanners property', () => {
  const r = fixturesOf({});
  assert.equal(r, null);
});

test('returns null when scanners is empty object', () => {
  const r = fixturesOf({ scanners: {} });
  assert.equal(r, null);
});

test('returns null when scanner detail is missing', () => {
  const r = fixturesOf({ scanners: { a: {} } });
  assert.equal(r, null);
});

test('returns null when fixtureRows is not a number', () => {
  const r = fixturesOf({ scanners: { a: { detail: { fixtureRows: 'x' } } } });
  assert.equal(r, null);
});

test('returns aggregated rows and broken when one scanner has valid detail', () => {
  const r = fixturesOf({ scanners: { a: { detail: { fixtureRows: 5, brokenOnPurposeRows: 2 } } } });
  assert.deepEqual(r, { rows: 5, brokenOnPurpose: 2, note: "Classified, never dropped: these rows describe a test corpus rather than the software, and are counted apart rather than removed from the evidence." });
});

test('returns aggregated rows and broken when two scanners have valid details', () => {
  const r = fixturesOf({ scanners: { a: { detail: { fixtureRows: 3, brokenOnPurposeRows: 1 } }, b: { detail: { fixtureRows: 4, brokenOnPurposeRows: 2 } } } });
  assert.deepEqual(r, { rows: 7, brokenOnPurpose: 3, note: "Classified, never dropped: these rows describe a test corpus rather than the software, and are counted apart rather than removed from the evidence." });
});

test('returns aggregated rows with zero broken when brokenOnPurposeRows is missing', () => {
  const r = fixturesOf({ scanners: { a: { detail: { fixtureRows: 7 } } } });
  assert.deepEqual(r, { rows: 7, brokenOnPurpose: 0, note: "Classified, never dropped: these rows describe a test corpus rather than the software, and are counted apart rather than removed from the evidence." });
});

test('returns aggregated rows with zero broken when brokenOnPurposeRows is not a number', () => {
  const r = fixturesOf({ scanners: { a: { detail: { fixtureRows: 6, brokenOnPurposeRows: 'bad' } } } });
  assert.deepEqual(r, { rows: 6, brokenOnPurpose: 0, note: "Classified, never dropped: these rows describe a test corpus rather than the software, and are counted apart rather than removed from the evidence." });
});

test('returns aggregated rows with zero broken when brokenOnPurposeRows is null', () => {
  const r = fixturesOf({ scanners: { a: { detail: { fixtureRows: 8, brokenOnPurposeRows: null } } } });
  assert.deepEqual(r, { rows: 8, brokenOnPurpose: 0, note: "Classified, never dropped: these rows describe a test corpus rather than the software, and are counted apart rather than removed from the evidence." });
});
