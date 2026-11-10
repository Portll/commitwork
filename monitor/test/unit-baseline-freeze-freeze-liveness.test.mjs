// Computes whether a liveness baseline is frozen, pending, expired, or unknown (monitor/baseline-freeze.mjs freezeLiveness).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeLiveness, freezeHash } from '../baseline-freeze.mjs';

test('returns unknown when the current time is not readable', () => {
  assert.deepEqual(freezeLiveness([], { expectedBy: '2025-01-01', now: 'not-a-date' }), { state: "unknown", why: "no readable current time to judge against", freeze: null });
});

test('returns unknown when no expected-freeze-by date is set', () => {
  assert.deepEqual(freezeLiveness([], { expectedBy: null, now: '2025-01-01' }), { state: "unknown", why: "no expected-freeze-by date is set \u2014 nothing can be said about a deadline nobody declared", freeze: null });
});

test('returns unknown when the expected-freeze-by date is unparseable', () => {
  assert.deepEqual(freezeLiveness([], { expectedBy: 'garbage', now: '2025-01-01' }), { state: "unknown", why: "expectedBy 'garbage' is unparseable", freeze: null });
});

test('returns unknown when the freeze records are not an array', () => {
  assert.deepEqual(freezeLiveness('not-an-array', { expectedBy: '2025-01-01', now: '2025-01-01' }), { state: "unknown", why: "freeze records are unreadable", freeze: null });
});

test('returns unknown when the freeze chain does not verify', () => {
  const rec = { at: '2025-01-01', laneSet: ['a'], sampling: 's', adjudicationProtocol: 'p', interRaterPlan: 'q', by: 'u', note: 'n' };
  const bad = { ...rec, prevHash: 'wrong', hash: freezeHash(null, rec) };
  assert.deepEqual(freezeLiveness([bad], { expectedBy: '2025-01-01', now: '2025-01-01' }), { state: "unknown", why: "freeze chain does not verify: freeze[0]: prevHash mismatch", freeze: null, problems: ["freeze[0]: prevHash mismatch", "freeze[0]: hash mismatch (at 2025-01-01)"] });
});

test('returns pending when no freeze exists and the deadline is in the future', () => {
  assert.deepEqual(freezeLiveness([], { expectedBy: '2025-01-02', now: '2025-01-01' }), { state: "pending", why: "no freeze yet; due by 2025-01-02", freeze: null });
});

test('returns expired when no freeze exists and the deadline has passed', () => {
  assert.deepEqual(freezeLiveness([], { expectedBy: '2025-01-01', now: '2025-01-02' }), { state: "expired", why: "expected by 2025-01-01 and no freeze exists \u2014 a baseline that should exist and does not", freeze: null });
});

test('returns frozen when a valid freeze exists', () => {
  const rec = { at: '2025-01-01', laneSet: ['a', 'b'], sampling: 's', adjudicationProtocol: 'p', interRaterPlan: 'q', by: 'u', note: 'n' };
  rec.prevHash = null;
  rec.hash = freezeHash(null, rec);
  assert.deepEqual(freezeLiveness([rec], { expectedBy: '2025-01-01', now: '2025-01-01' }), { state: "frozen", why: "frozen at 2025-01-01 over 2 lane(s)", freeze: { at: "2025-01-01", laneSet: ["a", "b"], sampling: "s", adjudicationProtocol: "p", interRaterPlan: "q", by: "u", note: "n", prevHash: null, hash: "fed190e0ace1701ba4873a0972768b6ad5e6cb7022699658ff7e7dc2b19b859f" } });
});

test('returns unknown when the latest freeze has an unparseable timestamp', () => {
  const rec = { at: 'bad-date', laneSet: ['a'], sampling: 's', adjudicationProtocol: 'p', interRaterPlan: 'q', by: 'u', note: 'n' };
  rec.prevHash = null;
  rec.hash = freezeHash(null, rec);
  assert.deepEqual(freezeLiveness([rec], { expectedBy: '2025-01-01', now: '2025-01-01' }), { state: "unknown", why: "the latest freeze carries an unparseable timestamp", freeze: { at: "bad-date", laneSet: ["a"], sampling: "s", adjudicationProtocol: "p", interRaterPlan: "q", by: "u", note: "n", prevHash: null, hash: "4ccbc12a669d1d01d6a484b9cce02518320f406d93e0ed8d1b805c9b6d7d3a07" } });
});

test('returns pending when the current time equals the deadline', () => {
  assert.deepEqual(freezeLiveness([], { expectedBy: '2025-01-01', now: '2025-01-01' }), { state: "expired", why: "expected by 2025-01-01 and no freeze exists \u2014 a baseline that should exist and does not", freeze: null });
});
