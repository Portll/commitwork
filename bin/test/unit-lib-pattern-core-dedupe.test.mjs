// Observations merged by identity with counts, sorted lines and top confidence (bin/lib/pattern-core.mjs dedupe).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupe } from '../lib/pattern-core.mjs';

test('An empty list of observations gives an empty list', () => {
  assert.deepEqual(dedupe([]), []);
});

test('A single observation without a line is kept once with no lines', () => {
  const r = dedupe([{ identity: 'a', confidence: 'structural', evidence: 'e1', place: { line: null } }]);
  assert.deepEqual(r, [
    { identity: 'a', confidence: 'structural', evidence: 'e1', place: { line: null }, occurrences: 1, lines: [] }
  ]);
});

test('Repeated observations collect their lines sorted numerically and keep the first evidence', () => {
  const r = dedupe([30, 2, 15, 100].map((line, i) => ({
    identity: 'a', confidence: 'inferred', evidence: 'e' + i, place: { line }
  })));
  assert.deepEqual(r, [
    { identity: 'a', confidence: 'inferred', evidence: 'e0', place: { line: 30 }, occurrences: 4, lines: [2, 15, 30, 100] }
  ]);
});

test('A later heuristic observation replaces an earlier inferred one', () => {
  const r = dedupe([
    { identity: 'k', confidence: 'inferred', evidence: 'weak', place: { file: 'a.js', line: 4 } },
    { identity: 'k', confidence: 'heuristic', evidence: 'mid', place: { file: 'b.js', line: 9 } }
  ]);
  assert.deepEqual(r, [
    { identity: 'k', confidence: 'heuristic', evidence: 'mid', place: { file: 'a.js', line: 9 }, occurrences: 2, lines: [4, 9] }
  ]);
});

test('A later structural observation replaces an earlier heuristic one', () => {
  const r = dedupe([
    { identity: 'k', confidence: 'heuristic', evidence: 'mid', place: { file: 'a.js', line: 12 } },
    { identity: 'k', confidence: 'structural', evidence: 'strong', place: { file: 'b.js', line: 3 } }
  ]);
  assert.deepEqual(r, [
    { identity: 'k', confidence: 'structural', evidence: 'strong', place: { file: 'a.js', line: 3 }, occurrences: 2, lines: [3, 12] }
  ]);
});

test('A later heuristic observation does not replace an earlier structural one', () => {
  const r = dedupe([
    { identity: 'k', confidence: 'structural', evidence: 'strong', place: { line: 5 } },
    { identity: 'k', confidence: 'heuristic', evidence: 'mid', place: { line: 2 } }
  ]);
  assert.deepEqual(r, [
    { identity: 'k', confidence: 'structural', evidence: 'strong', place: { line: 5 }, occurrences: 2, lines: [2, 5] }
  ]);
});

test('A later observation of equal confidence does not replace the evidence or place', () => {
  const r = dedupe([
    { identity: 'k', confidence: 'heuristic', evidence: 'first', place: { line: 8 } },
    { identity: 'k', confidence: 'heuristic', evidence: 'second', place: { line: 1 } }
  ]);
  assert.deepEqual(r, [
    { identity: 'k', confidence: 'heuristic', evidence: 'first', place: { line: 8 }, occurrences: 2, lines: [1, 8] }
  ]);
});

test('A repeated line and a missing line are not added to the lines again', () => {
  const r = dedupe([
    { identity: 'n', confidence: 'inferred', evidence: 'x', place: { line: 7 } },
    { identity: 'n', confidence: 'inferred', evidence: 'y', place: { line: 7 } },
    { identity: 'n', confidence: 'inferred', evidence: 'z', place: { line: null } }
  ]);
  assert.deepEqual(r, [
    { identity: 'n', confidence: 'inferred', evidence: 'x', place: { line: 7 }, occurrences: 3, lines: [7] }
  ]);
});

test('A stronger observation without a line sets the place line to null but adds no line', () => {
  const r = dedupe([
    { identity: 'm', confidence: 'inferred', evidence: 'i', place: { path: 'x.js', line: 3 } },
    { identity: 'm', confidence: 'structural', evidence: 's', place: { path: 'y.js', line: null } }
  ]);
  assert.deepEqual(r, [
    { identity: 'm', confidence: 'structural', evidence: 's', place: { path: 'x.js', line: null }, occurrences: 2, lines: [3] }
  ]);
});

test('Distinct identities stay separate in first-seen order', () => {
  const r = dedupe([
    { identity: 'b', confidence: 'structural', evidence: 'eb', place: { line: 2 } },
    { identity: 'a', confidence: 'heuristic', evidence: 'ea', place: { line: 1 } },
    { identity: 'b', confidence: 'inferred', evidence: 'eb2', place: { line: 2 } }
  ]);
  assert.deepEqual(r, [
    { identity: 'b', confidence: 'structural', evidence: 'eb', place: { line: 2 }, occurrences: 2, lines: [2] },
    { identity: 'a', confidence: 'heuristic', evidence: 'ea', place: { line: 1 }, occurrences: 1, lines: [1] }
  ]);
});
