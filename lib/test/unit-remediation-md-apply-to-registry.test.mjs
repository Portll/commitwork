// Merges parsed remediation and attribution lists into the registry (lib/remediation-md.mjs applyToRegistry).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyToRegistry } from '../remediation-md.mjs';

test('merges remediations when registry has existing entries', () => {
  const registry = { remediations: [{ rank: 1, status: 'open' }], attributionPlan: [] };
  const parsed = { remediations: [{ rank: 1, status: 'closed' }], attributionPlan: [] };
  const r = applyToRegistry(registry, parsed);
  assert.deepEqual(r, { remediations: [{ rank: 1, status: "closed" }], attributionPlan: [] });
});

test('merges attributionPlan when registry has existing entries', () => {
  const registry = { remediations: [], attributionPlan: [{ area: 'a', status: 'open' }] };
  const parsed = { remediations: [], attributionPlan: [{ area: 'a', status: 'closed' }] };
  const r = applyToRegistry(registry, parsed);
  assert.deepEqual(r, { remediations: [], attributionPlan: [{ area: "a", status: "closed" }] });
});

test('handles empty registry with parsed remediations', () => {
  const registry = {};
  const parsed = { remediations: [{ rank: 1, status: 'open' }], attributionPlan: [] };
  const r = applyToRegistry(registry, parsed);
  assert.deepEqual(r, { remediations: [{ rank: 1, status: "open" }], attributionPlan: [] });
});

test('handles empty registry with parsed attributionPlan', () => {
  const registry = {};
  const parsed = { remediations: [], attributionPlan: [{ area: 'x', status: 'open' }] };
  const r = applyToRegistry(registry, parsed);
  assert.deepEqual(r, { remediations: [], attributionPlan: [{ area: "x", status: "open" }] });
});

test('preserves registry keys other than remediations and attributionPlan', () => {
  const registry = { foo: 'bar', remediations: [{ rank: 1 }], attributionPlan: [{ area: 'a' }] };
  const parsed = { remediations: [{ rank: 1, status: 'done' }], attributionPlan: [{ area: 'a', status: 'done' }] };
  const r = applyToRegistry(registry, parsed);
  assert.deepEqual(r, { foo: "bar", remediations: [{ rank: 1, status: "done" }], attributionPlan: [{ area: "a", status: "done" }] });
});

test('fails when a remediation rank appears twice in parsed', () => {
  const registry = { remediations: [], attributionPlan: [] };
  const parsed = { remediations: [{ rank: 1 }, { rank: 1 }], attributionPlan: [] };
  assert.throws(() => applyToRegistry(registry, parsed), { name: "Error", message: "action 1 appears twice" });
});

test('fails when a surface area appears twice in parsed', () => {
  const registry = { remediations: [], attributionPlan: [] };
  const parsed = { remediations: [], attributionPlan: [{ area: 'a' }, { area: 'a' }] };
  assert.throws(() => applyToRegistry(registry, parsed), { name: "Error", message: "surface a appears twice" });
});

test('fails when a required field line is missing in a merged remediation', () => {
  const registry = { remediations: [{ rank: 1, status: 'open', layer: 'core' }], attributionPlan: [] };
  const parsed = { remediations: [{ rank: 1, status: 'closed' }], attributionPlan: [] };
  assert.throws(() => applyToRegistry(registry, parsed), { name: "Error", message: "action 1: the Layer line is missing; keep the line, empty, to clear the field" });
});

test('fails when a required field line is missing in a merged surface', () => {
  const registry = { remediations: [], attributionPlan: [{ area: 'a', status: 'open', defect: 'bug' }] };
  const parsed = { remediations: [], attributionPlan: [{ area: 'a', status: 'closed' }] };
  assert.throws(() => applyToRegistry(registry, parsed), { name: "Error", message: "surface a: the Defect line is missing; keep the line, empty, to clear the field" });
});
