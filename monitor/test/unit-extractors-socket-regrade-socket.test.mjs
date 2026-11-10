// Recomputes severity for criticalCVE findings and tallies socket results (monitor/extractors/socket.mjs regradeSocket).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regradeSocket } from '../extractors/socket.mjs';

test('returns the lane unchanged when lane is null', () => {
  assert.deepEqual(regradeSocket(null, []), null);
});

test('returns the lane unchanged when findings is an empty array', () => {
  const lane = { findings: [] };
  assert.deepEqual(regradeSocket(lane, []), { findings: [] });
});

test('returns the lane unchanged when no findings match criticalCVE', () => {
  const lane = { findings: [{ rule: 'other', sev: 'high' }] };
  assert.deepEqual(regradeSocket(lane, []), { findings: [{ rule: "other", sev: "high" }] });
});

test('sets severity to crit for a sole witness criticalCVE finding', () => {
  const lane = { findings: [{ rule: 'criticalCVE', claimKind: 'dep', corroboratedBy: [] }] };
  assert.deepEqual(regradeSocket(lane, []), { findings: [{ rule: "criticalCVE", claimKind: "dep", corroboratedBy: [], sev: "crit", sevReason: "" }], crit: 1, high: 0, med: 0, low: 0, undetermined: 0, byKind: { dep: { crit: 1, high: 0, med: 0, low: 0, undetermined: 0 } } });
});

test('sets severity to empty for a corroborated criticalCVE finding', () => {
  const lane = { findings: [{ rule: 'criticalCVE', claimKind: 'dep', corroboratedBy: [{ tool: 'socket' }] }] };
  assert.deepEqual(regradeSocket(lane, []), { findings: [{ rule: "criticalCVE", claimKind: "dep", corroboratedBy: [{ tool: "socket" }], sev: "", sevReason: "corroborated-by-socket" }], crit: 0, high: 0, med: 0, low: 0, undetermined: 1, byKind: { dep: { crit: 0, high: 0, med: 0, low: 0, undetermined: 1 } } });
});

test('returns the lane unchanged when findings is not an array', () => {
  const lane = { findings: 'not-an-array' };
  assert.deepEqual(regradeSocket(lane, []), { findings: "not-an-array" });
});

test('returns the lane unchanged when lane is a valid object with criticalCVE findings', () => {
  const lane = { findings: [{ rule: 'criticalCVE', claimKind: 'dep', corroboratedBy: [] }] };
  assert.deepEqual(regradeSocket(lane, []), { findings: [{ rule: "criticalCVE", claimKind: "dep", corroboratedBy: [], sev: "crit", sevReason: "" }], crit: 1, high: 0, med: 0, low: 0, undetermined: 0, byKind: { dep: { crit: 1, high: 0, med: 0, low: 0, undetermined: 0 } } });
});
