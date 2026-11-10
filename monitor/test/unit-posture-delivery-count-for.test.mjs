// Counts pending deliveries across repos, reporting a light and tally (monitor/posture.mjs deliveryCountFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliveryCountFor } from '../posture.mjs';

test('returns grey when no values are provided', () => {
  const r = deliveryCountFor([]);
  assert.deepEqual(r, { light: "grey", why: "no repo in this area records a count", tally: { green: 0, amber: 0, red: 0, na: 0, unknown: 0, unrecognised: [], total: 0 } });
});

test('returns grey with unevaluated count when values are non-numeric', () => {
  const r = deliveryCountFor(['a', 'b']);
  assert.deepEqual(r, { light: "grey", why: "no repo in this area records a count (2 unevaluated)", tally: { green: 0, amber: 0, red: 0, na: 0, unknown: 2, unrecognised: [], total: 0 } });
});

test('returns green when all values are zero', () => {
  const r = deliveryCountFor([0, 0]);
  assert.deepEqual(r, { light: "green", why: "nothing pending across 2 repo(s)", tally: { green: 0, amber: 0, red: 0, na: 0, unknown: 0, unrecognised: [], total: 0 } });
});

test('returns amber when total is positive', () => {
  const r = deliveryCountFor([1, 2]);
  assert.deepEqual(r, { light: "amber", tally: { green: 0, amber: 0, red: 0, na: 0, unknown: 0, unrecognised: [], total: 3 }, why: "3 pending across 2 repo(s) \u2014 a backlog, not a defect" });
});

test('returns amber with unevaluated count when mixed values', () => {
  const r = deliveryCountFor([1, 'x']);
  assert.deepEqual(r, { light: "amber", tally: { green: 0, amber: 0, red: 0, na: 0, unknown: 1, unrecognised: [], total: 1 }, why: "1 pending across 1 repo(s), 1 never evaluated \u2014 a backlog, not a defect" });
});

test('returns green when single zero value', () => {
  const r = deliveryCountFor([0]);
  assert.deepEqual(r, { light: "green", why: "nothing pending across 1 repo(s)", tally: { green: 0, amber: 0, red: 0, na: 0, unknown: 0, unrecognised: [], total: 0 } });
});

test('returns amber when single positive value', () => {
  const r = deliveryCountFor([5]);
  assert.deepEqual(r, { light: "amber", tally: { green: 0, amber: 0, red: 0, na: 0, unknown: 0, unrecognised: [], total: 5 }, why: "5 pending across 1 repo(s) \u2014 a backlog, not a defect" });
});

test('returns grey when values contain only non-finite numbers', () => {
  const r = deliveryCountFor([NaN, Infinity]);
  assert.deepEqual(r, { light: "grey", why: "no repo in this area records a count (2 unevaluated)", tally: { green: 0, amber: 0, red: 0, na: 0, unknown: 2, unrecognised: [], total: 0 } });
});
