// Compares analyst verdicts to determine agreement (bin/finding-analysis.mjs compareAnalysts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareAnalysts } from '../finding-analysis.mjs';

test('returns indeterminate when only one analyst ran', () => {
  const results = [
    { analyst: 'a1', state: 'analysed', verdict: 'safe' },
  ];
  const result = compareAnalysts(results);
  assert.deepEqual(result, {
    agreement: 'indeterminate',
    reason: 'only 1 analyst ran \u2014 a comparison needs two, so this is a reading, not a corroboration',
    verdicts: [
      { analyst: 'a1', state: 'analysed', verdict: 'safe' },
    ],
  });
});

test('returns indeterminate when two analysts ran but only one produced a verdict', () => {
  const results = [
    { analyst: 'a1', state: 'analysed', verdict: 'safe' },
    { analyst: 'a2', state: 'timeout', verdict: null },
  ];
  const result = compareAnalysts(results);
  assert.deepEqual(result, {
    agreement: 'indeterminate',
    reason: '1 of 2 analysts produced a verdict \u2014 absence is not concurrence',
    verdicts: [
      { analyst: 'a1', state: 'analysed', verdict: 'safe' },
      { analyst: 'a2', state: 'timeout', verdict: null },
    ],
  });
});

test('returns indeterminate when three analysts ran but only one produced a verdict', () => {
  const results = [
    { analyst: 'a1', state: 'analysed', verdict: 'safe' },
    { analyst: 'a2', state: 'timeout', verdict: null },
    { analyst: 'a3', state: 'error', verdict: null },
  ];
  const result = compareAnalysts(results);
  assert.deepEqual(result, {
    agreement: 'indeterminate',
    reason: '1 of 3 analysts produced a verdict \u2014 absence is not concurrence',
    verdicts: [
      { analyst: 'a1', state: 'analysed', verdict: 'safe' },
      { analyst: 'a2', state: 'timeout', verdict: null },
      { analyst: 'a3', state: 'error', verdict: null },
    ],
  });
});

test('returns agree when two analysts produced identical verdicts', () => {
  const results = [
    { analyst: 'a1', state: 'analysed', verdict: 'safe' },
    { analyst: 'a2', state: 'analysed', verdict: 'safe' },
  ];
  const result = compareAnalysts(results);
  assert.deepEqual(result, {
    agreement: 'agree',
    reason: null,
    verdicts: [
      { analyst: 'a1', state: 'analysed', verdict: 'safe' },
      { analyst: 'a2', state: 'analysed', verdict: 'safe' },
    ],
  });
});

test('returns disagree when two analysts produced different verdicts', () => {
  const results = [
    { analyst: 'a1', state: 'analysed', verdict: 'safe' },
    { analyst: 'a2', state: 'analysed', verdict: 'risky' },
  ];
  const result = compareAnalysts(results);
  assert.deepEqual(result, {
    agreement: 'disagree',
    reason: 'analysts disagree: a1=safe, a2=risky \u2014 recorded as a split, not resolved',
    verdicts: [
      { analyst: 'a1', state: 'analysed', verdict: 'safe' },
      { analyst: 'a2', state: 'analysed', verdict: 'risky' },
    ],
  });
});

test('returns agree when three analysts produced identical verdicts', () => {
  const results = [
    { analyst: 'a1', state: 'analysed', verdict: 'safe' },
    { analyst: 'a2', state: 'analysed', verdict: 'safe' },
    { analyst: 'a3', state: 'analysed', verdict: 'safe' },
  ];
  const result = compareAnalysts(results);
  assert.deepEqual(result, {
    agreement: 'agree',
    reason: null,
    verdicts: [
      { analyst: 'a1', state: 'analysed', verdict: 'safe' },
      { analyst: 'a2', state: 'analysed', verdict: 'safe' },
      { analyst: 'a3', state: 'analysed', verdict: 'safe' },
    ],
  });
});

test('returns disagree when three analysts have mixed verdicts', () => {
  const results = [
    { analyst: 'a1', state: 'analysed', verdict: 'safe' },
    { analyst: 'a2', state: 'analysed', verdict: 'safe' },
    { analyst: 'a3', state: 'analysed', verdict: 'risky' },
  ];
  const result = compareAnalysts(results);
  assert.deepEqual(result, {
    agreement: 'disagree',
    reason: 'analysts disagree: a1=safe, a2=safe, a3=risky \u2014 recorded as a split, not resolved',
    verdicts: [
      { analyst: 'a1', state: 'analysed', verdict: 'safe' },
      { analyst: 'a2', state: 'analysed', verdict: 'safe' },
      { analyst: 'a3', state: 'analysed', verdict: 'risky' },
    ],
  });
});

test('returns indeterminate when no analysts ran', () => {
  const results = [];
  const result = compareAnalysts(results);
  assert.deepEqual(result, {
    agreement: 'indeterminate',
    reason: 'only 0 analyst ran \u2014 a comparison needs two, so this is a reading, not a corroboration',
    verdicts: [],
  });
});
