// Re-observes prior hunk attribution against current rows, reporting state changes and absences (bin/lib/touch-attribution.mjs reobserve).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reobserve } from '../lib/touch-attribution.mjs';

test('returns empty attribution and changes when priorAttribution is null', () => {
  const r = reobserve(null, [], 'f');
  assert.deepEqual(r, { attribution: [], changes: [] });
});

test('returns empty attribution and changes when priorAttribution is empty array', () => {
  const r = reobserve([], [], 'f');
  assert.deepEqual(r, { attribution: [], changes: [] });
});

test('reports absent when prior claim is no longer in the ledger', () => {
  const prior = [{ n: 'a1', state: 'standing', supersededBy: null }];
  const r = reobserve(prior, [], 'f');
  assert.deepEqual(r, { attribution: [], changes: [{ n: "a1", from: "standing", to: "absent", why: "the claim is no longer in the ledger \u2014 rotation, or a reader that did not walk the chain" }] });
});

test('reports state change when current state differs from prior', () => {
  const prior = [{ n: 'a1', state: 'standing', supersededBy: null }];
  const rows = [
    { f: 'f', n: 'a1', h: null, at: '2024-01-01T00:00:00Z', s: 's1', t: 'edit' },
    { f: 'f', n: 'a2', h: 'a1', at: '2024-01-02T00:00:00Z', s: 's2', t: 'edit' },
  ];
  const r = reobserve(prior, rows, 'f');
  assert.deepEqual(r, { attribution: [{ n: "a1", h: null, at: "2024-01-01T00:00:00Z", session: "s1", tool: "edit", state: "superseded", supersededBy: "s2" }, { n: "a2", h: "a1", at: "2024-01-02T00:00:00Z", session: "s2", tool: "edit", state: "standing", supersededBy: null }], changes: [{ n: "a1", from: "standing", to: "superseded", why: "re-observed at gate time; supersededBy=s2" }] });
});

test('reports no change when current state matches prior state', () => {
  const prior = [{ n: 'a1', state: 'standing', supersededBy: null }];
  const rows = [{ f: 'f', n: 'a1', h: null, at: '2024-01-01T00:00:00Z', s: 's1', t: 'edit' }];
  const r = reobserve(prior, rows, 'f');
  assert.deepEqual(r, { attribution: [{ n: "a1", h: null, at: "2024-01-01T00:00:00Z", session: "s1", tool: "edit", state: "standing", supersededBy: null }], changes: [] });
});

test('reports state change to unknown when later whole-file write follows', () => {
  const prior = [{ n: 'a1', state: 'standing', supersededBy: null }];
  const rows = [
    { f: 'f', n: 'a1', h: null, at: '2024-01-01T00:00:00Z', s: 's1', t: 'edit' },
    { f: 'f', n: null, h: null, at: '2024-01-02T00:00:00Z', s: 's2', t: 'write' },
  ];
  const r = reobserve(prior, rows, 'f');
  assert.deepEqual(r, { attribution: [{ n: "a1", h: null, at: "2024-01-01T00:00:00Z", session: "s1", tool: "edit", state: "standing", supersededBy: null }], changes: [] });
});

test('reports state change to superseded with correct supersededBy session', () => {
  const prior = [{ n: 'a1', state: 'standing', supersededBy: null }];
  const rows = [
    { f: 'f', n: 'a1', h: null, at: '2024-01-01T00:00:00Z', s: 's1', t: 'edit' },
    { f: 'f', n: 'a2', h: 'a1', at: '2024-01-02T00:00:00Z', s: 's2', t: 'edit' },
  ];
  const r = reobserve(prior, rows, 'f');
  assert.deepEqual(r, { attribution: [{ n: "a1", h: null, at: "2024-01-01T00:00:00Z", session: "s1", tool: "edit", state: "superseded", supersededBy: "s2" }, { n: "a2", h: "a1", at: "2024-01-02T00:00:00Z", session: "s2", tool: "edit", state: "standing", supersededBy: null }], changes: [{ n: "a1", from: "standing", to: "superseded", why: "re-observed at gate time; supersededBy=s2" }] });
});

test('handles multiple prior claims with mixed outcomes', () => {
  const prior = [
    { n: 'a1', state: 'standing', supersededBy: null },
    { n: 'a2', state: 'standing', supersededBy: null },
    { n: 'a3', state: 'standing', supersededBy: null },
  ];
  const rows = [
    { f: 'f', n: 'a1', h: null, at: '2024-01-01T00:00:00Z', s: 's1', t: 'edit' },
    { f: 'f', n: 'a2', h: 'a1', at: '2024-01-02T00:00:00Z', s: 's2', t: 'edit' },
    { f: 'f', n: null, h: null, at: '2024-01-03T00:00:00Z', s: 's3', t: 'write' },
  ];
  const r = reobserve(prior, rows, 'f');
  assert.deepEqual(r, { attribution: [{ n: "a1", h: null, at: "2024-01-01T00:00:00Z", session: "s1", tool: "edit", state: "superseded", supersededBy: "s2" }, { n: "a2", h: "a1", at: "2024-01-02T00:00:00Z", session: "s2", tool: "edit", state: "standing", supersededBy: null }], changes: [{ n: "a1", from: "standing", to: "superseded", why: "re-observed at gate time; supersededBy=s2" }, { n: "a3", from: "standing", to: "absent", why: "the claim is no longer in the ledger \u2014 rotation, or a reader that did not walk the chain" }] });
});
