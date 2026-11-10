// Computes the diff between a baseline and current host observation (monitor/host-baseline.mjs diffAgainstBaseline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffAgainstBaseline } from '../host-baseline.mjs';

test('returns unusable when current is null', () => {
  const r = diffAgainstBaseline({ entries: [] }, null);
  assert.deepEqual(r, { usable: false, unknown: true, unknownReason: "not-run", unknownDetail: "the current host observation failed; nothing may be compared against it", changes: [], counts: { unchanged: 0, new: 0, gone: 0, changed: 0, unknown: 0 } });
});

test('returns unusable when current ok is false', () => {
  const r = diffAgainstBaseline({ entries: [] }, { ok: false, entries: [] });
  assert.deepEqual(r, { usable: false, unknown: true, unknownReason: "not-run", unknownDetail: "the current host observation failed; nothing may be compared against it", changes: [], counts: { unchanged: 0, new: 0, gone: 0, changed: 0, unknown: 0 } });
});

test('returns unusable when baseline is null', () => {
  const r = diffAgainstBaseline(null, { ok: true, entries: [] });
  assert.deepEqual(r, { usable: false, unknown: true, unknownReason: "no-reference", unknownDetail: "no accepted baseline exists \u2014 run with --accept once the current surface has been reviewed", changes: [], counts: { unchanged: 0, new: 0, gone: 0, changed: 0, unknown: 0 } });
});

test('returns unusable when baseline entries is not an array', () => {
  const r = diffAgainstBaseline({ entries: 'nope' }, { ok: true, entries: [] });
  assert.deepEqual(r, { usable: false, unknown: true, unknownReason: "no-reference", unknownDetail: "no accepted baseline exists \u2014 run with --accept once the current surface has been reviewed", changes: [], counts: { unchanged: 0, new: 0, gone: 0, changed: 0, unknown: 0 } });
});

test('detects a new port as NEW', () => {
  const baseline = { entries: [] };
  const current = { ok: true, entries: [{ port: 8080, proto: 'tcp', owner: 'alice', external: false, binding: '127.0.0.1', owners: [], containers: [], declaredFor: [] }] };
  const r = diffAgainstBaseline(baseline, current);
  assert.deepEqual(r, { usable: true, baselineAcceptedAt: null, baselineAcceptedBy: null, observedAt: null, absenceAssertable: false, ephemeralExcluded: 0, counts: { unchanged: 0, new: 1, gone: 0, changed: 0, unknown: 0 }, changes: [{ key: "8080/tcp", change: "new", port: 8080, proto: "tcp", after: { owner: "alice", external: false, binding: "127.0.0.1", holders: [], containers: [], declaredFor: [] }, before: null, detail: "listening now, and absent from the accepted baseline" }] });
});

test('detects a gone port as GONE when absence is assertable', () => {
  const baseline = { entries: [{ port: 8080, proto: 'tcp', owner: 'alice', external: false, binding: '127.0.0.1', owners: [], containers: [], declaredFor: [] }] };
  const current = { ok: true, entries: [], socketTable: { ok: true } };
  const r = diffAgainstBaseline(baseline, current);
  assert.deepEqual(r, { usable: true, baselineAcceptedAt: null, baselineAcceptedBy: null, observedAt: null, absenceAssertable: true, ephemeralExcluded: 0, counts: { unchanged: 0, new: 0, gone: 1, changed: 0, unknown: 0 }, changes: [{ key: "8080/tcp", change: "gone", port: 8080, proto: "tcp", before: { owner: "alice", external: false, binding: "127.0.0.1", holders: [], containers: [], declaredFor: [] }, after: null, detail: "baselined port is absent from a socket table that was successfully read" }] });
});

test('detects a missing port as UNKNOWN when absence is not assertable', () => {
  const baseline = { entries: [{ port: 8080, proto: 'tcp', owner: 'alice', external: false, binding: '127.0.0.1', owners: [], containers: [], declaredFor: [] }] };
  const current = { ok: true, entries: [], socketTable: { ok: false } };
  const r = diffAgainstBaseline(baseline, current);
  assert.deepEqual(r, { usable: true, baselineAcceptedAt: null, baselineAcceptedBy: null, observedAt: null, absenceAssertable: false, ephemeralExcluded: 0, counts: { unchanged: 0, new: 0, gone: 0, changed: 0, unknown: 1 }, changes: [{ key: "8080/tcp", change: "unknown", port: 8080, proto: "tcp", before: { owner: "alice", external: false, binding: "127.0.0.1", holders: [], containers: [], declaredFor: [] }, after: null, unknown: true, unknownReason: "not-permitted", unknownDetail: "the socket table could not be read, so this port is unverifiable \u2014 NOT gone", detail: "baselined port not seen, by an observation that cannot assert absence" }] });
});

test('detects an unchanged port as UNCHANGED', () => {
  const entry = { port: 8080, proto: 'tcp', owner: 'alice', external: false, binding: '127.0.0.1', owners: [], containers: [], declaredFor: [] };
  const baseline = { entries: [entry] };
  const current = { ok: true, entries: [{ ...entry }], socketTable: { ok: true } };
  const r = diffAgainstBaseline(baseline, current);
  assert.deepEqual(r, { usable: true, baselineAcceptedAt: null, baselineAcceptedBy: null, observedAt: null, absenceAssertable: true, ephemeralExcluded: 0, counts: { unchanged: 1, new: 0, gone: 0, changed: 0, unknown: 0 }, changes: [{ key: "8080/tcp", change: "unchanged", port: 8080, proto: "tcp", before: { owner: "alice", external: false, binding: "127.0.0.1", holders: [], containers: [], declaredFor: [] }, after: { owner: "alice", external: false, binding: "127.0.0.1", holders: [], containers: [], declaredFor: [] } }] });
});

test('detects a changed port as CHANGED when owner differs', () => {
  const baseline = { entries: [{ port: 8080, proto: 'tcp', owner: 'alice', external: false, binding: '127.0.0.1', owners: [], containers: [], declaredFor: [] }] };
  const current = { ok: true, entries: [{ port: 8080, proto: 'tcp', owner: 'bob', external: false, binding: '127.0.0.1', owners: [], containers: [], declaredFor: [] }], socketTable: { ok: true } };
  const r = diffAgainstBaseline(baseline, current);
  assert.deepEqual(r, { usable: true, baselineAcceptedAt: null, baselineAcceptedBy: null, observedAt: null, absenceAssertable: true, ephemeralExcluded: 0, counts: { unchanged: 0, new: 0, gone: 0, changed: 1, unknown: 0 }, changes: [{ key: "8080/tcp", change: "changed", port: 8080, proto: "tcp", before: { owner: "alice", external: false, binding: "127.0.0.1", holders: [], containers: [], declaredFor: [] }, after: { owner: "bob", external: false, binding: "127.0.0.1", holders: [], containers: [], declaredFor: [] }, detail: "owner alice -> bob" }] });
});

test('detects a changed port as UNKNOWN when after owner is unknown', () => {
  const baseline = { entries: [{ port: 8080, proto: 'tcp', owner: 'alice', external: false, binding: '127.0.0.1', owners: [], containers: [], declaredFor: [] }] };
  const current = { ok: true, entries: [{ port: 8080, proto: 'tcp', owner: 'unknown', external: false, binding: '127.0.0.1', owners: [], containers: [], declaredFor: [] }], socketTable: { ok: true } };
  const r = diffAgainstBaseline(baseline, current);
  assert.deepEqual(r, { usable: true, baselineAcceptedAt: null, baselineAcceptedBy: null, observedAt: null, absenceAssertable: true, ephemeralExcluded: 0, counts: { unchanged: 0, new: 0, gone: 0, changed: 0, unknown: 1 }, changes: [{ key: "8080/tcp", change: "unknown", port: 8080, proto: "tcp", before: { owner: "alice", external: false, binding: "127.0.0.1", holders: [], containers: [], declaredFor: [] }, after: { owner: "unknown", external: false, binding: "127.0.0.1", holders: [], containers: [], declaredFor: [] }, unknown: true, unknownReason: "not-permitted", unknownDetail: "ownership of this port is unknown; the difference from the baseline cannot be attributed" }] });
});
