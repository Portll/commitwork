// Maps lane evidence to a confidence band (monitor/lane-confidence.mjs bandFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bandFor } from '../lane-confidence.mjs';

test('returns unmeasured when adjudicated is zero', () => {
  const r = bandFor({ adjudicated: 0, sampling: 'random', intervalStated: false, intervalWide: true, interRater: false, externalEval: false, positiveControl: 'absent' });
  assert.deepEqual(r, { band: "unmeasured", rank: 1, condition: "no adjudicated findings in this lane", why: "no adjudicated findings", positiveControl: "absent" });
});

test('returns unmeasured when sampling is opportunistic and adjudicated is below five', () => {
  const r = bandFor({ adjudicated: 3, sampling: 'opportunistic', intervalStated: false, intervalWide: true, interRater: false, externalEval: false, positiveControl: 'absent' });
  assert.deepEqual(r, { band: "unmeasured", rank: 1, condition: "no adjudicated findings in this lane", why: "sampling is 'opportunistic' \u2014 a selection cannot become a measurement by growing, so this lane is capped at anecdotal regardless of count (3 adjudicated)", positiveControl: "absent" });
});

test('returns anecdotal when sampling is opportunistic and adjudicated is five or more', () => {
  const r = bandFor({ adjudicated: 5, sampling: 'opportunistic', intervalStated: false, intervalWide: true, interRater: false, externalEval: false, positiveControl: 'absent' });
  assert.deepEqual(r, { band: "anecdotal", rank: 2, condition: "fewer than 5 adjudicated findings", why: "sampling is 'opportunistic' \u2014 a selection cannot become a measurement by growing, so this lane is capped at anecdotal regardless of count (5 adjudicated)", positiveControl: "absent" });
});

test('returns anecdotal when sampling is random and adjudicated is below five', () => {
  const r = bandFor({ adjudicated: 4, sampling: 'random', intervalStated: false, intervalWide: true, interRater: false, externalEval: false, positiveControl: 'absent' });
  assert.deepEqual(r, { band: "anecdotal", rank: 2, condition: "fewer than 5 adjudicated findings", why: "4 adjudicated, fewer than 5", positiveControl: "absent" });
});

test('returns indicative when sampling is random, adjudicated is five or more, and no interval is stated', () => {
  const r = bandFor({ adjudicated: 5, sampling: 'random', intervalStated: false, intervalWide: true, interRater: false, externalEval: false, positiveControl: 'absent' });
  assert.deepEqual(r, { band: "indicative", rank: 3, condition: "a sample exists; no interval stated", why: "a random sample exists but no interval is stated", positiveControl: "absent" });
});

test('returns well-measured when sampling is random, interval is stated, and inter-rater agreement exists', () => {
  const r = bandFor({ adjudicated: 5, sampling: 'random', intervalStated: true, intervalWide: true, interRater: true, externalEval: false, positiveControl: 'absent' });
  assert.deepEqual(r, { band: "well-measured", rank: 6, condition: "stated interval AND inter-rater agreement", why: "stated interval and inter-rater agreement", positiveControl: "absent" });
});

test('returns provisional when sampling is random, interval is stated, no inter-rater, and interval is wide', () => {
  const r = bandFor({ adjudicated: 5, sampling: 'random', intervalStated: true, intervalWide: true, interRater: false, externalEval: false, positiveControl: 'absent' });
  assert.deepEqual(r, { band: "provisional", rank: 4, condition: "sample with a wide interval", why: "stated interval, but wide", positiveControl: "absent" });
});

test('returns measured when sampling is random, interval is stated, no inter-rater, and interval is not wide', () => {
  const r = bandFor({ adjudicated: 5, sampling: 'random', intervalStated: true, intervalWide: false, interRater: false, externalEval: false, positiveControl: 'absent' });
  assert.deepEqual(r, { band: "measured", rank: 5, condition: "sample with a stated interval", why: "stated interval", positiveControl: "absent" });
});

test('returns externally-verified when external evaluation is present', () => {
  const r = bandFor({ adjudicated: 0, sampling: 'random', intervalStated: false, intervalWide: true, interRater: false, externalEval: true, positiveControl: 'absent' });
  assert.deepEqual(r, { band: "externally-verified", rank: 7, condition: "independently evaluated by a third party", why: "a third party evaluated this lane independently", positiveControl: "absent" });
});

test('throws when positive control state is invalid', () => {
  assert.throws(() => bandFor({ adjudicated: 0, sampling: 'random', intervalStated: false, intervalWide: true, interRater: false, externalEval: false, positiveControl: 'bogus' }), { name: 'Error', message: "'bogus' is not a positive-control state (absent|missed|stale|current)" });
});
