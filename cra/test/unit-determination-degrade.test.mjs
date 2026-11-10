// Degrades a determination to *_unknown for any axis whose evidence is insufficient (cra/determination.mjs degrade).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { degrade } from '../determination.mjs';

test('returns the determination unchanged with an empty degraded list when evidence satisfies every axis', () => {
  const d = { reachability: 'unreachable_static', exploitability: 'adversary_cannot_control' };
  const evidence = [
    { method: 'call_graph' },
    { method: 'manual_review' },
    { method: 'dual_agent_adjudication' },
  ];
  const r = degrade(d, evidence);
  assert.deepEqual(r, { determination: { reachability: "unreachable_static", exploitability: "adversary_cannot_control" }, degraded: [] });
});

test('degrades reachability to reachability_unknown when the required call_graph evidence is missing', () => {
  const d = { reachability: 'unreachable_static', exploitability: 'reachable' };
  const evidence = [{ method: 'manual_review' }];
  const r = degrade(d, evidence);
  assert.deepEqual(r, { determination: { reachability: "reachability_unknown", exploitability: "reachable" }, degraded: [{ axis: "reachability", from: "unreachable_static", to: "reachability_unknown" }] });
});

test('degrades exploitability to exploitability_unknown when the required manual_review evidence is missing', () => {
  const d = { reachability: 'reachable', exploitability: 'adversary_cannot_control' };
  const evidence = [{ method: 'call_graph' }];
  const r = degrade(d, evidence);
  assert.deepEqual(r, { determination: { reachability: "reachable", exploitability: "exploitability_unknown" }, degraded: [{ axis: "exploitability", from: "adversary_cannot_control", to: "exploitability_unknown" }] });
});

test('degrades both axes when evidence is absent for both and records the correct from and to values', () => {
  const d = { reachability: 'unreachable_static', exploitability: 'adversary_cannot_control' };
  const evidence = [];
  const r = degrade(d, evidence);
  assert.deepEqual(r, { determination: { reachability: "reachability_unknown", exploitability: "exploitability_unknown" }, degraded: [{ axis: "reachability", from: "unreachable_static", to: "reachability_unknown" }, { axis: "exploitability", from: "adversary_cannot_control", to: "exploitability_unknown" }] });
});

test('degrades only the axis whose evidence is missing while leaving the other axis intact', () => {
  const d = { reachability: 'unreachable_static', exploitability: 'adversary_cannot_control' };
  const evidence = [{ method: 'dual_agent_adjudication' }];
  const r = degrade(d, evidence);
  assert.deepEqual(r, { determination: { reachability: "reachability_unknown", exploitability: "adversary_cannot_control" }, degraded: [{ axis: "reachability", from: "unreachable_static", to: "reachability_unknown" }] });
});

test('leaves axes with no evidence requirement untouched even when evidence is empty', () => {
  const d = { reachability: 'reachable', exploitability: 'exploitability_unknown' };
  const evidence = [];
  const r = degrade(d, evidence);
  assert.deepEqual(r, { determination: { reachability: "reachable", exploitability: "exploitability_unknown" }, degraded: [] });
});
