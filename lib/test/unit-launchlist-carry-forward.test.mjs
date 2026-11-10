// carries forward prior measured results when a check is not opted-in (lib/launchlist.mjs carryForward).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carryForward } from '../launchlist.mjs';
import { STATUS, OPT_IN_CHECKS } from '../launchlist.mjs';

test('returns identical results when all items are opted\u2011in', () => {
  const results = { a: { status: STATUS.PASS } };
  const previous = null;
  const cfg = { items: [{ id: 'a', check: 'secretsHistory' }], flags: { history: true } };
  assert.deepEqual(carryForward(results, previous, cfg), { a: { status: "pass" } });
});

test('skips item when flag is missing (continue via !flag)', () => {
  const results = { a: { status: STATUS.PASS } };
  const previous = null;
  const cfg = { items: [{ id: 'a', check: 'unknownCheck' }], flags: {} };
  assert.deepEqual(carryForward(results, previous, cfg), { a: { status: "pass" } });
});

test('skips item when flag is true (continue via flags[flag])', () => {
  const results = { a: { status: STATUS.PASS } };
  const previous = null;
  const cfg = { items: [{ id: 'a', check: 'secretsHistory' }], flags: { history: true } };
  assert.deepEqual(carryForward(results, previous, cfg), { a: { status: "pass" } });
});

test('carries forward when flag is false and prior result exists with non\u2011UNMEASURED status', () => {
  const results = {};
  const previous = { results: { a: { status: STATUS.FAIL, detail: 1 } }, measuredAt: '2023-01-01T00:00:00Z' };
  const cfg = { items: [{ id: 'a', check: 'secretsHistory' }], flags: { history: false } };
  assert.deepEqual(carryForward(results, previous, cfg), { a: { status: "fail", detail: 1, carriedFrom: "2023-01-01T00:00:00Z" } });
});

test('does not carry forward when prior result status is UNMEASURED', () => {
  const results = {};
  const previous = { results: { a: { status: STATUS.UNMEASURED } }, measuredAt: '2023-01-01T00:00:00Z' };
  const cfg = { items: [{ id: 'a', check: 'secretsHistory' }], flags: { history: false } };
  assert.deepEqual(carryForward(results, previous, cfg), {});
});

test('does not carry forward when no prior result for the id', () => {
  const results = {};
  const previous = { results: {}, measuredAt: '2023-01-01T00:00:00Z' };
  const cfg = { items: [{ id: 'a', check: 'secretsHistory' }], flags: { history: false } };
  assert.deepEqual(carryForward(results, previous, cfg), {});
});

test('uses previous.measuredAt when prior result has no carriedFrom', () => {
  const results = {};
  const previous = { results: { a: { status: STATUS.PASS } }, measuredAt: '2023-02-02T00:00:00Z' };
  const cfg = { items: [{ id: 'a', check: 'secretsHistory' }], flags: { history: false } };
  assert.deepEqual(carryForward(results, previous, cfg), { a: { status: "pass", carriedFrom: "2023-02-02T00:00:00Z" } });
});

test('preserves existing carriedFrom from prior result', () => {
  const results = {};
  const previous = { results: { a: { status: STATUS.PASS, carriedFrom: 'old' } }, measuredAt: '2023-02-02T00:00:00Z' };
  const cfg = { items: [{ id: 'a', check: 'secretsHistory' }], flags: { history: false } };
  assert.deepEqual(carryForward(results, previous, cfg), { a: { status: "pass", carriedFrom: "old" } });
});

test('handles previous being undefined gracefully', () => {
  const results = { a: { status: STATUS.PASS } };
  const previous = undefined;
  const cfg = { items: [{ id: 'a', check: 'secretsHistory' }], flags: { history: false } };
  assert.deepEqual(carryForward(results, previous, cfg), { a: { status: "pass" } });
});
