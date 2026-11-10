// Computes scenario, correctness, and attribution summary counts (bin/canary-harness.mjs summarise).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarise } from '../canary-harness.mjs';

test('returns empty summary for no results', () => {
  assert.deepEqual(summarise([]), { scenarios: 0, scored: 0, correct: 0, falseClean: 0, falseAlarm: 0, skipped: 0 });
});

test('counts true-alarm and true-clean as correct', () => {
  const results = [
    { truth: 'true-alarm' },
    { truth: 'true-clean' },
    { truth: 'false-alarm' },
    { truth: 'false-clean' },
  ];
  assert.deepEqual(summarise(results), { scenarios: 4, scored: 4, correct: 2, falseClean: 1, falseAlarm: 1, skipped: 0 });
});

test('excludes skipped results from scored counts', () => {
  const results = [
    { truth: 'true-alarm', skipped: true },
    { truth: 'true-clean' },
    { truth: 'false-alarm' },
  ];
  assert.deepEqual(summarise(results), { scenarios: 3, scored: 2, correct: 1, falseClean: 0, falseAlarm: 1, skipped: 1 });
});

test('omits attribution fields when no boolean attributionCorrect present', () => {
  const results = [
    { truth: 'true-alarm', attributionCorrect: 'yes' },
    { truth: 'true-clean', attributionCorrect: null },
  ];
  assert.deepEqual(summarise(results), { scenarios: 2, scored: 2, correct: 2, falseClean: 0, falseAlarm: 0, skipped: 0 });
});

test('includes attribution fields when boolean attributionCorrect present', () => {
  const results = [
    { truth: 'true-alarm', attributionCorrect: true },
    { truth: 'true-clean', attributionCorrect: false },
    { truth: 'false-alarm', attributionCorrect: true },
  ];
  assert.deepEqual(summarise(results), {
    scenarios: 3, scored: 3, correct: 2, falseClean: 0, falseAlarm: 1, skipped: 0,
    attributionScored: 3, attributionCorrect: 2, attributionWrong: 1,
  });
});

test('counts attributionCorrect true and false separately', () => {
  const results = [
    { truth: 'true-alarm', attributionCorrect: true },
    { truth: 'true-clean', attributionCorrect: true },
    { truth: 'false-alarm', attributionCorrect: false },
    { truth: 'false-clean', attributionCorrect: false },
  ];
  assert.deepEqual(summarise(results), {
    scenarios: 4, scored: 4, correct: 2, falseClean: 1, falseAlarm: 1, skipped: 0,
    attributionScored: 4, attributionCorrect: 2, attributionWrong: 2,
  });
});

test('handles mixed skipped and non-skipped with attribution', () => {
  const results = [
    { truth: 'true-alarm', skipped: true, attributionCorrect: true },
    { truth: 'false-clean', attributionCorrect: false },
    { truth: 'false-alarm', attributionCorrect: true },
  ];
  assert.deepEqual(summarise(results), {
    scenarios: 3, scored: 2, correct: 0, falseClean: 1, falseAlarm: 1, skipped: 1,
    attributionScored: 2, attributionCorrect: 1, attributionWrong: 1,
  });
});

test('returns zero attribution counts when all skipped', () => {
  const results = [
    { truth: 'true-alarm', skipped: true, attributionCorrect: true },
    { truth: 'false-clean', skipped: true, attributionCorrect: false },
  ];
  assert.deepEqual(summarise(results), { scenarios: 2, scored: 0, correct: 0, falseClean: 0, falseAlarm: 0, skipped: 2 });
});
