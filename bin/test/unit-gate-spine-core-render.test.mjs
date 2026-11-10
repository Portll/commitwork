// Formats a spine gate verdict into a human-readable status line (bin/gate-spine-core.mjs render).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../gate-spine-core.mjs';

test('returns unknown prefix when block is false and grey is true', () => {
  const v = { block: false, grey: true, detail: 'cannot determine' };
  const r = render(v);
  assert.equal(r, "spine gate: UNKNOWN \u2014 cannot determine");
});

test('returns plain prefix when block is false and grey is false', () => {
  const v = { block: false, grey: false, detail: 'cannot determine' };
  const r = render(v);
  assert.equal(r, "spine gate: cannot determine");
});

test('returns plain prefix when block is false and grey is undefined', () => {
  const v = { block: false, detail: 'cannot determine' };
  const r = render(v);
  assert.equal(r, "spine gate: cannot determine");
});

test('returns plain prefix when block is true and reason is decoy-suspected', () => {
  const v = { block: true, reason: 'decoy-suspected', detail: 'looks like a decoy' };
  const r = render(v);
  assert.equal(r, "spine gate: looks like a decoy");
});

test('returns plan guidance with default threshold when block is true and reason is not decoy-suspected', () => {
  const v = { block: true, reason: 'too-many-edits', detail: '8 files changed' };
  const r = render(v);
  assert.equal(r, "spine gate: 8 files changed Create or reuse a plan and put the work in it \u2014 `mcp__spine__list_plans`, then `create_task` with a planId. Threshold is 5 edited files (CW_SPINE_MIN_EDITS).");
});

test('returns plan guidance with custom threshold when minEdits is provided', () => {
  const v = { block: true, reason: 'too-many-edits', detail: '8 files changed' };
  const r = render(v, { minEdits: 10 });
  assert.equal(r, "spine gate: 8 files changed Create or reuse a plan and put the work in it \u2014 `mcp__spine__list_plans`, then `create_task` with a planId. Threshold is 10 edited files (CW_SPINE_MIN_EDITS).");
});

test('returns plan guidance with custom threshold of 1 when minEdits is 1', () => {
  const v = { block: true, reason: 'too-many-edits', detail: '2 files changed' };
  const r = render(v, { minEdits: 1 });
  assert.equal(r, "spine gate: 2 files changed Create or reuse a plan and put the work in it \u2014 `mcp__spine__list_plans`, then `create_task` with a planId. Threshold is 1 edited files (CW_SPINE_MIN_EDITS).");
});

test('returns plan guidance with custom threshold of 6 when minEdits is 6', () => {
  const v = { block: true, reason: 'too-many-edits', detail: '7 files changed' };
  const r = render(v, { minEdits: 6 });
  assert.equal(r, "spine gate: 7 files changed Create or reuse a plan and put the work in it \u2014 `mcp__spine__list_plans`, then `create_task` with a planId. Threshold is 6 edited files (CW_SPINE_MIN_EDITS).");
});
