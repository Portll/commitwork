// computes added, removed, new ports and state (monitor/egress-baseline.mjs diffEgress).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffEgress } from '../egress-baseline.mjs';

test('returns no-baseline state when baseline is null', () => {
  const observed = { items: [], unknowns: [] };
  const result = diffEgress(observed, null);
  assert.deepEqual(result, { added: [], newPorts: [], gone: [], known: 0, unknowns: [], state: "no-baseline" });
});

test('detects added items when baseline is empty', () => {
  const observed = { items: [{ id: 'a', ports: [] }], unknowns: [] };
  const baseline = { items: [] };
  const result = diffEgress(observed, baseline);
  assert.deepEqual(result, { added: [{ id: "a", ports: [] }], newPorts: [], gone: [], known: 0, unknowns: [], state: "findings" });
});

test('detects new ports on existing item', () => {
  const observed = { items: [{ id: 'b', ports: [80, 443] }], unknowns: [] };
  const baseline = { items: [{ id: 'b', ports: [80] }] };
  const result = diffEgress(observed, baseline);
  assert.deepEqual(result, { added: [], newPorts: [{ id: "b", ports: [80, 443], newPorts: [443], baselinePorts: [80] }], gone: [], known: 1, unknowns: [], state: "findings" });
});

test('detects gone items when they disappear from observed', () => {
  const observed = { items: [], unknowns: [] };
  const baseline = { items: [{ id: 'c', ports: [] }] };
  const result = diffEgress(observed, baseline);
  assert.deepEqual(result, { added: [], newPorts: [], gone: [{ id: "c", ports: [] }], known: 0, unknowns: [], state: "ok" });
});

test('returns partial state when unknowns are present', () => {
  const observed = { items: [], unknowns: [{ id: 'u' }] };
  const baseline = { items: [] };
  const result = diffEgress(observed, baseline);
  assert.deepEqual(result, { added: [], newPorts: [], gone: [], known: 0, unknowns: [{ id: "u" }], state: "partial" });
});

test('counts known items correctly when ids match', () => {
  const observed = { items: [{ id: 'd', ports: [] }], unknowns: [] };
  const baseline = { items: [{ id: 'd', ports: [] }] };
  const result = diffEgress(observed, baseline);
  assert.deepEqual(result, { added: [], newPorts: [], gone: [], known: 1, unknowns: [], state: "ok" });
});

test('handles baseline item with undefined ports', () => {
  const observed = { items: [{ id: 'e', ports: [123] }], unknowns: [] };
  const baseline = { items: [{ id: 'e' }] };
  const result = diffEgress(observed, baseline);
  assert.deepEqual(result, { added: [], newPorts: [{ id: "e", ports: [123], newPorts: [123], baselinePorts: [] }], gone: [], known: 1, unknowns: [], state: "findings" });
});
