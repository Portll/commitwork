// Aggregates per-lane verdicts into totals, findings, faults, unknowns, and a byVerdict map (bin/lane-staleness-core.mjs rollup).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollup } from '../lane-staleness-core.mjs';

test('empty input yields zero totals and empty byVerdict map', () => {
  assert.deepEqual(rollup([]), { total: 0, producing: 0, findings: 0, faults: 0, unknown: 0, byVerdict: { stale: 0, "voids-only": 0, "never-produced": 0, "lane-unreadable": 0, "clock-unreadable": 0, "cadence-undeclared": 0, "lane-absent": 0, producing: 0 } });
});

test('single producing lane counts as producing only', () => {
  assert.deepEqual(rollup([{ verdict: 'producing' }]), { total: 1, producing: 1, findings: 0, faults: 0, unknown: 0, byVerdict: { stale: 0, "voids-only": 0, "never-produced": 0, "lane-unreadable": 0, "clock-unreadable": 0, "cadence-undeclared": 0, "lane-absent": 0, producing: 1 } });
});

test('single stale lane counts as one finding', () => {
  assert.deepEqual(rollup([{ verdict: 'stale' }]), { total: 1, producing: 0, findings: 1, faults: 0, unknown: 0, byVerdict: { stale: 1, "voids-only": 0, "never-produced": 0, "lane-unreadable": 0, "clock-unreadable": 0, "cadence-undeclared": 0, "lane-absent": 0, producing: 0 } });
});

test('single voids-only lane counts as one finding', () => {
  assert.deepEqual(rollup([{ verdict: 'voids-only' }]), { total: 1, producing: 0, findings: 1, faults: 0, unknown: 0, byVerdict: { stale: 0, "voids-only": 1, "never-produced": 0, "lane-unreadable": 0, "clock-unreadable": 0, "cadence-undeclared": 0, "lane-absent": 0, producing: 0 } });
});

test('single never-produced lane counts as one finding', () => {
  assert.deepEqual(rollup([{ verdict: 'never-produced' }]), { total: 1, producing: 0, findings: 1, faults: 0, unknown: 0, byVerdict: { stale: 0, "voids-only": 0, "never-produced": 1, "lane-unreadable": 0, "clock-unreadable": 0, "cadence-undeclared": 0, "lane-absent": 0, producing: 0 } });
});

test('single lane-unreadable lane counts as one fault', () => {
  assert.deepEqual(rollup([{ verdict: 'lane-unreadable' }]), { total: 1, producing: 0, findings: 0, faults: 1, unknown: 0, byVerdict: { stale: 0, "voids-only": 0, "never-produced": 0, "lane-unreadable": 1, "clock-unreadable": 0, "cadence-undeclared": 0, "lane-absent": 0, producing: 0 } });
});

test('single clock-unreadable lane counts as one fault', () => {
  assert.deepEqual(rollup([{ verdict: 'clock-unreadable' }]), { total: 1, producing: 0, findings: 0, faults: 1, unknown: 0, byVerdict: { stale: 0, "voids-only": 0, "never-produced": 0, "lane-unreadable": 0, "clock-unreadable": 1, "cadence-undeclared": 0, "lane-absent": 0, producing: 0 } });
});

test('single cadence-undeclared lane counts as one unknown', () => {
  assert.deepEqual(rollup([{ verdict: 'cadence-undeclared' }]), { total: 1, producing: 0, findings: 0, faults: 0, unknown: 1, byVerdict: { stale: 0, "voids-only": 0, "never-produced": 0, "lane-unreadable": 0, "clock-unreadable": 0, "cadence-undeclared": 1, "lane-absent": 0, producing: 0 } });
});

test('single lane-absent lane counts as one unknown', () => {
  assert.deepEqual(rollup([{ verdict: 'lane-absent' }]), { total: 1, producing: 0, findings: 0, faults: 0, unknown: 1, byVerdict: { stale: 0, "voids-only": 0, "never-produced": 0, "lane-unreadable": 0, "clock-unreadable": 0, "cadence-undeclared": 0, "lane-absent": 1, producing: 0 } });
});

test('mixed verdicts partition into findings, faults, unknown, and producing', () => {
  const results = [
    { verdict: 'stale' },
    { verdict: 'voids-only' },
    { verdict: 'never-produced' },
    { verdict: 'lane-unreadable' },
    { verdict: 'clock-unreadable' },
    { verdict: 'cadence-undeclared' },
    { verdict: 'lane-absent' },
    { verdict: 'producing' },
    { verdict: 'producing' },
    { verdict: 'stale' },
  ];
  assert.deepEqual(rollup(results), { total: 10, producing: 2, findings: 4, faults: 2, unknown: 2, byVerdict: { stale: 2, "voids-only": 1, "never-produced": 1, "lane-unreadable": 1, "clock-unreadable": 1, "cadence-undeclared": 1, "lane-absent": 1, producing: 2 } });
});
