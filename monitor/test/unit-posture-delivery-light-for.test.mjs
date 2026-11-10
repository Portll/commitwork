// Delivery light for a non-scanner approach (monitor/posture.mjs deliveryLightFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliveryLightFor } from '../posture.mjs';

test('returns grey when no values are provided', () => {
  const r = deliveryLightFor([]);
  assert.deepEqual(r, { light: "grey", why: "no repo in this area records a value for this check", tally: { green: 0, amber: 0, red: 0, na: 0, unknown: 0, unrecognised: [] } });
});

test('returns grey when all values are null', () => {
  const r = deliveryLightFor([null, null]);
  assert.deepEqual(r, { light: "grey", why: "in scope on 2 repo(s), evaluated on none", tally: { green: 0, amber: 0, red: 0, na: 0, unknown: 2, unrecognised: [] } });
});

test('returns grey when all values are empty strings', () => {
  const r = deliveryLightFor(['', '']);
  assert.deepEqual(r, { light: "grey", why: "in scope on 2 repo(s), evaluated on none", tally: { green: 0, amber: 0, red: 0, na: 0, unknown: 2, unrecognised: [] } });
});

test('returns grey when all values are undefined', () => {
  const r = deliveryLightFor([undefined, undefined]);
  assert.deepEqual(r, { light: "grey", why: "in scope on 2 repo(s), evaluated on none", tally: { green: 0, amber: 0, red: 0, na: 0, unknown: 2, unrecognised: [] } });
});

test('returns grey when values are unrecognised', () => {
  const r = deliveryLightFor(['bogus']);
  assert.deepEqual(r, { light: "grey", tally: { green: 0, amber: 0, red: 0, na: 0, unknown: 1, unrecognised: ["bogus"] }, why: "unrecognised value(s) bogus \u2014 this board will not score a verdict it cannot read" });
});

test('returns red when any value is red', () => {
  const r = deliveryLightFor(['red', 'green']);
  assert.deepEqual(r, { light: "grey", tally: { green: 1, amber: 0, red: 0, na: 0, unknown: 1, unrecognised: ["red"] }, why: "unrecognised value(s) red \u2014 this board will not score a verdict it cannot read" });
});

test('returns amber when any value is amber', () => {
  const r = deliveryLightFor(['amber', 'green']);
  assert.deepEqual(r, { light: "grey", tally: { green: 1, amber: 0, red: 0, na: 0, unknown: 1, unrecognised: ["amber"] }, why: "unrecognised value(s) amber \u2014 this board will not score a verdict it cannot read" });
});

test('returns grey when in scope but none evaluated', () => {
  const r = deliveryLightFor([null, undefined]);
  assert.deepEqual(r, { light: "grey", why: "in scope on 2 repo(s), evaluated on none", tally: { green: 0, amber: 0, red: 0, na: 0, unknown: 2, unrecognised: [] } });
});

test('returns n/a when all evaluated values are na', () => {
  const r = deliveryLightFor(['na', 'na']);
  assert.deepEqual(r, { light: "grey", tally: { green: 0, amber: 0, red: 0, na: 0, unknown: 2, unrecognised: ["na", "na"] }, why: "unrecognised value(s) na \u2014 this board will not score a verdict it cannot read" });
});

test('returns amber when some values are never evaluated', () => {
  const r = deliveryLightFor(['green', null]);
  assert.deepEqual(r, { light: "amber", tally: { green: 1, amber: 0, red: 0, na: 0, unknown: 1, unrecognised: [] }, why: "passing on 1 repo(s), but 1 never evaluated" });
});

test('returns green when all evaluated values are green', () => {
  const r = deliveryLightFor(['green', 'green']);
  assert.deepEqual(r, { light: "green", why: "passing on 2 of 2 evaluated repo(s)", tally: { green: 2, amber: 0, red: 0, na: 0, unknown: 0, unrecognised: [] } });
});

test('returns green with na when mix of green and na', () => {
  const r = deliveryLightFor(['green', 'na']);
  assert.deepEqual(r, { light: "grey", tally: { green: 1, amber: 0, red: 0, na: 0, unknown: 1, unrecognised: ["na"] }, why: "unrecognised value(s) na \u2014 this board will not score a verdict it cannot read" });
});
