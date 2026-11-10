// Maps a reachability result onto a record's defence vector, preserving human-authored evidence (monitor/reachability-axis.mjs applyReachabilityAxis).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyReachabilityAxis } from '../reachability-axis.mjs';

test('returns skipped when the result is null', () => {
  const rec = {};
  assert.equal(applyReachabilityAxis(rec, null), "skipped");
});

test('returns skipped when the result is a string', () => {
  const rec = {};
  assert.equal(applyReachabilityAxis(rec, 'not-an-object'), "skipped");
});

test('returns refused when the result is refused', () => {
  const rec = {};
  const res = { refused: 'ambiguous alias', claimedBy: ['a'], why: 'w' };
  assert.equal(applyReachabilityAxis(rec, res), "refused");
});

test('returns skipped when the evidence method is not call_graph', () => {
  const rec = {};
  const res = { evidence: [{ method: 'scanner_default' }], reachability: 'reachable' };
  assert.equal(applyReachabilityAxis(rec, res), "skipped");
});

test('returns skipped when the result has no evidence', () => {
  const rec = {};
  const res = { reachability: 'reachable' };
  assert.equal(applyReachabilityAxis(rec, res), "skipped");
});

test('returns set and writes the axis when reachability is reachable', () => {
  const rec = {};
  const res = {
    evidence: [{ method: 'call_graph', source: 'main', detail: 'traced' }],
    reachability: 'reachable',
    via: 'entry',
    aliased: true,
    fanOut: 3,
  };
  assert.equal(applyReachabilityAxis(rec, res), "set");
});

test('returns set and writes the axis when reachability is unproven', () => {
  const rec = {};
  const res = {
    evidence: [{ method: 'call_graph', source: 'main', detail: 'no path' }],
    reachability: 'reachability_unproven',
  };
  assert.equal(applyReachabilityAxis(rec, res), "set");
});

test('returns skipped when a human already wrote evidence on the axis', () => {
  const rec = { defenceVector: { reachability: { state: 'open', evidence: 'human wrote this' } } };
  const res = {
    evidence: [{ method: 'call_graph', source: 'main', detail: 'traced' }],
    reachability: 'reachable',
  };
  assert.equal(applyReachabilityAxis(rec, res), "skipped");
});

test('returns set when the existing axis has empty evidence', () => {
  const rec = { defenceVector: { reachability: { state: 'open', evidence: '   ' } } };
  const res = {
    evidence: [{ method: 'call_graph', source: 'main', detail: 'traced' }],
    reachability: 'reachable',
  };
  assert.equal(applyReachabilityAxis(rec, res), "set");
});

test('returns set when the existing axis is undefined', () => {
  const rec = { defenceVector: {} };
  const res = {
    evidence: [{ method: 'call_graph', source: 'main', detail: 'traced' }],
    reachability: 'reachable',
  };
  assert.equal(applyReachabilityAxis(rec, res), "set");
});
