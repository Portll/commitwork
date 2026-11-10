// Fleet verdict failures from a sweep verdict (bin/digest.mjs fleetVerdictFailures).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fleetVerdictFailures } from '../digest.mjs';

test('returns an empty array when areas and finalize are absent', () => {
  const r = fleetVerdictFailures({ at: '2024-01-01T00:00:00.000Z', stamp: 's1' });
  assert.deepEqual(r, []);
});

test('flags a timed-out area with its slug and duration', () => {
  const r = fleetVerdictFailures({ at: '2024-01-01T00:00:00.000Z', stamp: 's1', areas: [{ slug: 'alpha', timedOut: true, secs: 30 }] });
  assert.deepEqual(r, [{ at: "2024-01-01T00:00:00.000Z", area: "alpha", sliceId: "sweep-s1", type: "area-sweep-timed-out", subject: "alpha", detail: "after 30s", key: "sweep:area-sweep-timed-out|alpha" }]);
});

test('flags a non-zero exit code as an area sweep failure', () => {
  const r = fleetVerdictFailures({ at: '2024-01-01T00:00:00.000Z', stamp: 's1', areas: [{ slug: 'beta', code: 1 }] });
  assert.deepEqual(r, [{ at: "2024-01-01T00:00:00.000Z", area: "beta", sliceId: "sweep-s1", type: "area-sweep-failed", subject: "beta", detail: "exit 1", key: "sweep:area-sweep-failed|beta" }]);
});

test('ignores an area with a zero exit code and no timeout', () => {
  const r = fleetVerdictFailures({ at: '2024-01-01T00:00:00.000Z', stamp: 's1', areas: [{ slug: 'gamma', code: 0 }] });
  assert.deepEqual(r, []);
});

test('flags a finalize step marked failed', () => {
  const r = fleetVerdictFailures({ at: '2024-01-01T00:00:00.000Z', stamp: 's1', finalize: { build: 'failed' } });
  assert.deepEqual(r, [{ at: "2024-01-01T00:00:00.000Z", area: null, sliceId: "sweep-s1", type: "step-failed", subject: "fleet.finalize.build", detail: null, key: "sweep:step-failed|fleet.finalize.build" }]);
});

test('ignores a finalize step marked ok', () => {
  const r = fleetVerdictFailures({ at: '2024-01-01T00:00:00.000Z', stamp: 's1', finalize: { build: 'ok' } });
  assert.deepEqual(r, []);
});

test('sorts areas by slug before emitting failures', () => {
  const r = fleetVerdictFailures({ at: '2024-01-01T00:00:00.000Z', stamp: 's1', areas: [{ slug: 'zeta', code: 2 }, { slug: 'alpha', code: 3 }] });
  assert.deepEqual(r, [{ at: "2024-01-01T00:00:00.000Z", area: "alpha", sliceId: "sweep-s1", type: "area-sweep-failed", subject: "alpha", detail: "exit 3", key: "sweep:area-sweep-failed|alpha" }, { at: "2024-01-01T00:00:00.000Z", area: "zeta", sliceId: "sweep-s1", type: "area-sweep-failed", subject: "zeta", detail: "exit 2", key: "sweep:area-sweep-failed|zeta" }]);
});

test('sorts finalize keys alphabetically before emitting failures', () => {
  const r = fleetVerdictFailures({ at: '2024-01-01T00:00:00.000Z', stamp: 's1', finalize: { zeta: 'failed', alpha: 'failed' } });
  assert.deepEqual(r, [{ at: "2024-01-01T00:00:00.000Z", area: null, sliceId: "sweep-s1", type: "step-failed", subject: "fleet.finalize.alpha", detail: null, key: "sweep:step-failed|fleet.finalize.alpha" }, { at: "2024-01-01T00:00:00.000Z", area: null, sliceId: "sweep-s1", type: "step-failed", subject: "fleet.finalize.zeta", detail: null, key: "sweep:step-failed|fleet.finalize.zeta" }]);
});

test('uses a null area and sliceId when stamp is absent', () => {
  const r = fleetVerdictFailures({ at: '2024-01-01T00:00:00.000Z', areas: [{ slug: 'solo', code: 5 }] });
  assert.deepEqual(r, [{ at: "2024-01-01T00:00:00.000Z", area: "solo", sliceId: null, type: "area-sweep-failed", subject: "solo", detail: "exit 5", key: "sweep:area-sweep-failed|solo" }]);
});

test('handles an area with a null code as a failure', () => {
  const r = fleetVerdictFailures({ at: '2024-01-01T00:00:00.000Z', stamp: 's1', areas: [{ slug: 'nullcode', code: null }] });
  assert.deepEqual(r, [{ at: "2024-01-01T00:00:00.000Z", area: "nullcode", sliceId: "sweep-s1", type: "area-sweep-failed", subject: "nullcode", detail: "exit null", key: "sweep:area-sweep-failed|nullcode" }]);
});
