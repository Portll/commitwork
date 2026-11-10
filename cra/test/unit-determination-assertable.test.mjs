// Checks whether a determination is supported by the required evidence methods (cra/determination.mjs assertable).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertable } from '../determination.mjs';

test('returns ok true when no evidence is needed for unknown values', () => {
  const d = { reachability: 'reachability_unknown', exploitability: 'exploitability_unknown' };
  const r = assertable(d, []);
  assert.deepEqual(r, { ok: true, refusals: [] });
});

test('returns ok false when required evidence method is missing', () => {
  const d = { reachability: 'unreachable_static', exploitability: 'exploitability_unknown' };
  const r = assertable(d, []);
  assert.deepEqual(r, { ok: false, refusals: ["reachability='unreachable_static' requires evidence with method 'call_graph'; got none. Degrade to 'reachability_unknown' \u2014 an unchecked claim is not a determination."] });
});

test('returns ok true when required evidence method is present', () => {
  const d = { reachability: 'unreachable_static', exploitability: 'exploitability_unknown' };
  const r = assertable(d, [{ method: 'call_graph' }]);
  assert.deepEqual(r, { ok: true, refusals: [] });
});

test('returns ok false when evidence method does not match requirement', () => {
  const d = { reachability: 'unreachable_static', exploitability: 'exploitability_unknown' };
  const r = assertable(d, [{ method: 'manual_review' }]);
  assert.deepEqual(r, { ok: false, refusals: ["reachability='unreachable_static' requires evidence with method 'call_graph'; got 'manual_review'. Degrade to 'reachability_unknown' \u2014 an unchecked claim is not a determination."] });
});

test('returns ok false when both axes lack required evidence', () => {
  const d = { reachability: 'unreachable_static', exploitability: 'adversary_cannot_control' };
  const r = assertable(d, []);
  assert.deepEqual(r, { ok: false, refusals: ["reachability='unreachable_static' requires evidence with method 'call_graph'; got none. Degrade to 'reachability_unknown' \u2014 an unchecked claim is not a determination.", "exploitability='adversary_cannot_control' requires evidence with method 'manual_review' or 'dual_agent_adjudication'; got none. Degrade to 'exploitability_unknown' \u2014 an unchecked claim is not a determination."] });
});

test('returns ok true when both axes have required evidence', () => {
  const d = { reachability: 'unreachable_static', exploitability: 'adversary_cannot_control' };
  const r = assertable(d, [{ method: 'call_graph' }, { method: 'manual_review' }]);
  assert.deepEqual(r, { ok: true, refusals: [] });
});

test('returns ok false when reachability needs call_graph but only manual_review is given', () => {
  const d = { reachability: 'reachability_unproven', exploitability: 'exploitability_unknown' };
  const r = assertable(d, [{ method: 'manual_review' }]);
  assert.deepEqual(r, { ok: false, refusals: ["reachability='reachability_unproven' requires evidence with method 'call_graph'; got 'manual_review'. Degrade to 'reachability_unknown' \u2014 an unchecked claim is not a determination."] });
});

test('returns ok true when reachability_unproven has call_graph evidence', () => {
  const d = { reachability: 'reachability_unproven', exploitability: 'exploitability_unknown' };
  const r = assertable(d, [{ method: 'call_graph' }]);
  assert.deepEqual(r, { ok: true, refusals: [] });
});

test('returns ok false when exploitability needs manual_review but only call_graph is given', () => {
  const d = { reachability: 'reachability_unknown', exploitability: 'adversary_cannot_control' };
  const r = assertable(d, [{ method: 'call_graph' }]);
  assert.deepEqual(r, { ok: false, refusals: ["exploitability='adversary_cannot_control' requires evidence with method 'manual_review' or 'dual_agent_adjudication'; got 'call_graph'. Degrade to 'exploitability_unknown' \u2014 an unchecked claim is not a determination."] });
});

test('returns ok true when exploitability has manual_review evidence', () => {
  const d = { reachability: 'reachability_unknown', exploitability: 'adversary_cannot_control' };
  const r = assertable(d, [{ method: 'manual_review' }]);
  assert.deepEqual(r, { ok: true, refusals: [] });
});
