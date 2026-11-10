// Maps declared checks to lanes, notLanes, and unaccounted (monitor/lane-roster.mjs accountChecks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountChecks } from '../lane-roster.mjs';

test('maps a check id to its lane when the roster row matches', () => {
  const roster = [['laneA', 'checkA', 'x', {}]];
  const checks = [{ id: 'checkA' }];
  const r = accountChecks(checks, roster, {});
  assert.deepEqual(r, { declared: 1, lanes: { checkA: "laneA" }, notLanes: {}, unaccounted: [] });
});

test('maps a check id to its lane via a feeder alias', () => {
  const roster = [['laneA', 'checkA', 'x', { also: { aliasA: 'note' } }]];
  const checks = [{ id: 'aliasA' }];
  const r = accountChecks(checks, roster, {});
  assert.deepEqual(r, { declared: 1, lanes: { aliasA: "laneA" }, notLanes: {}, unaccounted: [] });
});

test('does not overwrite an existing lane mapping for a feeder alias', () => {
  const roster = [
    ['laneA', 'checkA', 'x', { also: { aliasA: 'note' } }],
    ['laneB', 'aliasA', 'y', {}],
  ];
  const checks = [{ id: 'aliasA' }];
  const r = accountChecks(checks, roster, {});
  assert.deepEqual(r, { declared: 1, lanes: { aliasA: "laneB" }, notLanes: {}, unaccounted: [] });
});

test('records a reason for a check marked notALane with no lane', () => {
  const roster = [['laneA', 'checkA', 'x', {}]];
  const checks = [{ id: 'orphan', notALane: '  manual  ' }];
  const r = accountChecks(checks, roster, {});
  assert.deepEqual(r, { declared: 1, lanes: {}, notLanes: { orphan: { reason: "manual" } }, unaccounted: [] });
});

test('flags a check that feeds a lane and is also marked notALane', () => {
  const roster = [['laneA', 'checkA', 'x', {}]];
  const checks = [{ id: 'checkA', notALane: 'reason' }];
  const r = accountChecks(checks, roster, {});
  assert.deepEqual(r, { declared: 1, lanes: {}, notLanes: {}, unaccounted: [{ check: "checkA", why: "feeds lane laneA and is also marked notALane" }] });
});

test('flags a check marked notALane with no reason and no lane', () => {
  const roster = [['laneA', 'checkA', 'x', {}]];
  const checks = [{ id: 'orphan', notALane: '' }];
  const r = accountChecks(checks, roster, {});
  assert.deepEqual(r, { declared: 1, lanes: {}, notLanes: {}, unaccounted: [{ check: "orphan", why: "notALane carries no reason" }] });
});

test('flags a check with no lane and no notALane mark', () => {
  const roster = [['laneA', 'checkA', 'x', {}]];
  const checks = [{ id: 'orphan' }];
  const r = accountChecks(checks, roster, {});
  assert.deepEqual(r, { declared: 1, lanes: {}, notLanes: {}, unaccounted: [{ check: "orphan", why: "no lane reads it and it is not marked notALane" }] });
});

test('sorts checks by id before processing', () => {
  const roster = [['laneA', 'checkA', 'x', {}]];
  const checks = [{ id: 'zeta' }, { id: 'alpha' }];
  const r = accountChecks(checks, roster, {});
  assert.deepEqual(r, { declared: 2, lanes: {}, notLanes: {}, unaccounted: [{ check: "alpha", why: "no lane reads it and it is not marked notALane" }, { check: "zeta", why: "no lane reads it and it is not marked notALane" }] });
});
