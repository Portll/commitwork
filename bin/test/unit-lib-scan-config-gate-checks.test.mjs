// Splits checks into runnable and blocked based on config (bin/lib/scan-config.mjs gateChecks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateChecks } from '../lib/scan-config.mjs';

test('returns gated false when config is absent', () => {
  const checks = [{ id: 'a' }, { id: 'b' }];
  const r = gateChecks(checks, { absent: true });
  assert.deepEqual(r, { gated: false, runnable: [{ id: "a" }, { id: "b" }], blocked: [] });
});

test('returns gated true when config is present', () => {
  const checks = [{ id: 'a' }];
  const r = gateChecks(checks, {});
  assert.deepEqual(r, { gated: true, runnable: [{ id: "a" }], blocked: [] });
});

test('blocks check when disabled', () => {
  const checks = [{ id: 'a' }];
  const cfg = { checks: { a: { enabled: false } } };
  const r = gateChecks(checks, cfg);
  assert.deepEqual(r, { gated: true, runnable: [], blocked: [{ id: "a", reason: "disabled", tools: [] }] });
});

test('runs check when enabled', () => {
  const checks = [{ id: 'a' }];
  const cfg = { checks: { a: { enabled: true } } };
  const r = gateChecks(checks, cfg);
  assert.deepEqual(r, { gated: true, runnable: [{ id: "a" }], blocked: [] });
});

test('blocks check when tool is unapproved', () => {
  const checks = [{ id: 'a', requires: { tools: ['x'] } }];
  const cfg = { tools: { x: { approved: false } } };
  const r = gateChecks(checks, cfg);
  assert.deepEqual(r, { gated: true, runnable: [], blocked: [{ id: "a", reason: "unapproved-tool", tools: ["x"] }] });
});

test('runs check when tool is approved', () => {
  const checks = [{ id: 'a', requires: { tools: ['x'] } }];
  const cfg = { tools: { x: { approved: true } } };
  const r = gateChecks(checks, cfg);
  assert.deepEqual(r, { gated: true, runnable: [{ id: "a", requires: { tools: ["x"] } }], blocked: [] });
});

test('handles multiple checks with mixed states', () => {
  const checks = [
    { id: 'a' },
    { id: 'b' },
    { id: 'c', requires: { tools: ['x'] } }
  ];
  const cfg = {
    checks: { b: { enabled: false } },
    tools: { x: { approved: false } }
  };
  const r = gateChecks(checks, cfg);
  assert.deepEqual(r, { gated: true, runnable: [{ id: "a" }], blocked: [{ id: "b", reason: "disabled", tools: [] }, { id: "c", reason: "unapproved-tool", tools: ["x"] }] });
});

test('handles empty checks array', () => {
  const r = gateChecks([], {});
  assert.deepEqual(r, { gated: true, runnable: [], blocked: [] });
});
