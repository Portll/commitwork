// Maps a reachability result to an axis reading with evidence and notes (monitor/reachability-axis.mjs reachabilityAxis).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reachabilityAxis } from '../reachability-axis.mjs';

test('returns null for non-object input', () => {
  assert.deepEqual(reachabilityAxis('string'), null);
});

test('returns null for null input', () => {
  assert.deepEqual(reachabilityAxis(null), null);
});

test('returns refusal note when refused is truthy', () => {
  const res = { refused: 'ambiguous', claimedBy: ['a'], why: 'w' };
  assert.deepEqual(reachabilityAxis(res), { axis: null, note: { reachabilityRefused: "ambiguous", claimedBy: ["a"], why: "w" } });
});

test('returns null when evidence is missing', () => {
  const res = { reachability: 'reachable', evidence: [] };
  assert.deepEqual(reachabilityAxis(res), null);
});

test('returns null when method is not call_graph', () => {
  const res = { reachability: 'reachable', evidence: [{ method: 'scanner_default' }] };
  assert.deepEqual(reachabilityAxis(res), null);
});

test('returns open axis for reachable with call_graph evidence', () => {
  const res = {
    reachability: 'reachable',
    evidence: [{ method: 'call_graph', source: 'src', detail: 'traced' }],
    via: 'v',
    aliased: true,
    fanOut: 2
  };
  assert.deepEqual(reachabilityAxis(res), { axis: { state: "open", evidence: "traced [alias fan-out 2]", ref: "call-graph:src via v" }, note: { reachabilityVia: "v", reachabilityAliased: true, reachabilityFanOut: 2 } });
});

test('returns partial axis for unproven with call_graph evidence', () => {
  const res = {
    reachability: 'reachability_unproven',
    evidence: [{ method: 'call_graph', source: 'src', detail: 'none' }],
    via: 'v',
    aliased: false,
    fanOut: 1
  };
  assert.deepEqual(reachabilityAxis(res), { axis: { state: "partial", evidence: "none", ref: "call-graph:src", rationale: "govulncheck showed no call path; absence of proof is not proof of absence, so this never blocks" }, note: { reachabilityVia: "v", reachabilityAliased: false, reachabilityFanOut: 1 } });
});

test('returns null for unknown reachability value', () => {
  const res = {
    reachability: 'other',
    evidence: [{ method: 'call_graph', source: 'src' }]
  };
  assert.deepEqual(reachabilityAxis(res), null);
});
