// Builds the skipped export record with a reason and null path (monitor/memory-export-health.mjs skippedExport).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skippedExport } from '../memory-export-health.mjs';

test('returns the default reason when no argument is given', () => {
  assert.deepEqual(skippedExport(), { state: "skipped", rank: 0, kind: "ok", meaning: "the export was switched off for this run, so nothing was attempted and nothing is claimed about the backend", counts: null, tallyDivergence: null, generated: null, area: null, contractVersion: null, failedReasons: [], unverifiedReasons: [], undated: false, reason: "the export was switched off for this run, so nothing was attempted and nothing is claimed about the backend", path: null });
});

test('returns the provided reason when a non-empty string is passed', () => {
  assert.deepEqual(skippedExport('maintenance window'), { state: "skipped", rank: 0, kind: "ok", meaning: "the export was switched off for this run, so nothing was attempted and nothing is claimed about the backend", counts: null, tallyDivergence: null, generated: null, area: null, contractVersion: null, failedReasons: [], unverifiedReasons: [], undated: false, reason: "maintenance window", path: null });
});

test('returns the default reason when an empty string is passed', () => {
  assert.deepEqual(skippedExport(''), { state: "skipped", rank: 0, kind: "ok", meaning: "the export was switched off for this run, so nothing was attempted and nothing is claimed about the backend", counts: null, tallyDivergence: null, generated: null, area: null, contractVersion: null, failedReasons: [], unverifiedReasons: [], undated: false, reason: "the export was switched off for this run, so nothing was attempted and nothing is claimed about the backend", path: null });
});

test('returns the default reason when zero is passed', () => {
  assert.deepEqual(skippedExport(0), { state: "skipped", rank: 0, kind: "ok", meaning: "the export was switched off for this run, so nothing was attempted and nothing is claimed about the backend", counts: null, tallyDivergence: null, generated: null, area: null, contractVersion: null, failedReasons: [], unverifiedReasons: [], undated: false, reason: "the export was switched off for this run, so nothing was attempted and nothing is claimed about the backend", path: null });
});

test('returns the provided reason when a non-zero number is passed', () => {
  assert.deepEqual(skippedExport(42), { state: "skipped", rank: 0, kind: "ok", meaning: "the export was switched off for this run, so nothing was attempted and nothing is claimed about the backend", counts: null, tallyDivergence: null, generated: null, area: null, contractVersion: null, failedReasons: [], unverifiedReasons: [], undated: false, reason: 42, path: null });
});

test('returns the default reason when null is passed', () => {
  assert.deepEqual(skippedExport(null), { state: "skipped", rank: 0, kind: "ok", meaning: "the export was switched off for this run, so nothing was attempted and nothing is claimed about the backend", counts: null, tallyDivergence: null, generated: null, area: null, contractVersion: null, failedReasons: [], unverifiedReasons: [], undated: false, reason: "the export was switched off for this run, so nothing was attempted and nothing is claimed about the backend", path: null });
});

test('returns the provided reason when an object is passed', () => {
  assert.deepEqual(skippedExport({ code: 1 }), { state: "skipped", rank: 0, kind: "ok", meaning: "the export was switched off for this run, so nothing was attempted and nothing is claimed about the backend", counts: null, tallyDivergence: null, generated: null, area: null, contractVersion: null, failedReasons: [], unverifiedReasons: [], undated: false, reason: { code: 1 }, path: null });
});

test('returns the default reason when undefined is passed explicitly', () => {
  assert.deepEqual(skippedExport(undefined), { state: "skipped", rank: 0, kind: "ok", meaning: "the export was switched off for this run, so nothing was attempted and nothing is claimed about the backend", counts: null, tallyDivergence: null, generated: null, area: null, contractVersion: null, failedReasons: [], unverifiedReasons: [], undated: false, reason: "the export was switched off for this run, so nothing was attempted and nothing is claimed about the backend", path: null });
});
