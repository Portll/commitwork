// Whether a turn runs the full suite, a selection of tests or no tests (bin/lib/test-selection.mjs turnDecision).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { turnDecision } from '../lib/test-selection.mjs';

const epoch = '1970-01-01T00:00:00.000Z';
const last = { at: epoch, names: [] };
const noRecord = { run: 'full', reason: 'no full run is on record to compare a selection against' };
const notComputed = { run: 'full', reason: 'the selection could not be computed' };

test('with no last full run on record it runs the full suite', () => {
  assert.deepEqual(turnDecision({ mode: 'none', reason: 'r' }, null, { now: 0 }), noRecord);
  assert.deepEqual(turnDecision({ mode: 'none', reason: 'r' }, undefined, { now: 0 }), noRecord);
});

test('a last run whose names are not an array counts as no run on record', () => {
  const r = turnDecision({ mode: 'none', reason: 'r' }, { at: epoch, names: 'a' }, { now: 0 });
  assert.deepEqual(r, noRecord);
});

test('a last run with an unparseable or missing time counts as no run on record', () => {
  assert.deepEqual(turnDecision({ mode: 'none', reason: 'r' }, { at: 'not a date', names: [] }, { now: 0 }), noRecord);
  assert.deepEqual(turnDecision({ mode: 'none', reason: 'r' }, { names: [] }, { now: 0 }), noRecord);
});

test('a full run exactly six hours old is due again by default', () => {
  const r = turnDecision({ mode: 'none', reason: 'r' }, last, { now: 21600000 });
  assert.deepEqual(r, { run: 'full', reason: 'the last full run was 360 min ago, and a full run is due every 360 min' });
});

test('a full run one millisecond short of the interval lets the plan decide', () => {
  assert.deepEqual(turnDecision({ mode: 'none', reason: 'nothing changed' }, last, { now: 21599999 }), { run: 'skip', reason: 'nothing changed' });
  assert.deepEqual(turnDecision({ mode: 'none', reason: 'quiet' }, last, { now: 119999, fullEveryMs: 120000 }), { run: 'skip', reason: 'quiet' });
  assert.deepEqual(
    turnDecision({ mode: 'none', reason: 'quiet' }, last, { now: 120000, fullEveryMs: 120000 }),
    { run: 'full', reason: 'the last full run was 2 min ago, and a full run is due every 2 min' },
  );
});

test('a last full run in the future forces a full run while one at this instant does not', () => {
  assert.deepEqual(
    turnDecision({ mode: 'none', reason: 'r' }, last, { now: -1 }),
    { run: 'full', reason: 'the last full run was 0 min ago, and a full run is due every 360 min' },
  );
  assert.deepEqual(turnDecision({ mode: 'none', reason: 'same instant' }, last, { now: 0 }), { run: 'skip', reason: 'same instant' });
});

test('a plan in full mode passes its reason through as a string', () => {
  const r = turnDecision({ mode: 'full', reason: 42 }, last, { now: 1000 });
  assert.deepEqual(r, { run: 'full', reason: '42' });
});

test('a selective plan of string test files runs only those files', () => {
  const r = turnDecision({ mode: 'selective', tests: ['a.test.mjs', 'b.test.mjs'] }, last, { now: 1000 });
  assert.deepEqual(r, { run: 'selective', reason: "2 test file(s) can reach this turn's changes" });
});

test('a selective plan with no tests or a non-string test falls back to a full run', () => {
  assert.deepEqual(turnDecision({ mode: 'selective', tests: [] }, last, { now: 1000 }), notComputed);
  assert.deepEqual(turnDecision({ mode: 'selective', tests: ['a.test.mjs', 7] }, last, { now: 1000 }), notComputed);
  assert.deepEqual(turnDecision({ mode: 'selective', tests: 'a.test.mjs' }, last, { now: 1000 }), notComputed);
});

test('a missing plan or one in another mode falls back to a full run', () => {
  assert.deepEqual(turnDecision({ mode: 'other', tests: ['a.test.mjs'] }, last, { now: 1000 }), notComputed);
  assert.deepEqual(turnDecision(undefined, last, { now: 1000 }), notComputed);
});
