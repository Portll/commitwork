// Drafts a comment block into fact lines or voids it (bin/comment-suggest.mjs draft).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draft } from '../comment-suggest.mjs';

test('voids a structured list block', () => {
  const block = ['1. first item', '2. second item', '3. third item'];
  const result = draft(block, 0);
  assert.deepEqual(result, { lines: [], sentences: ["1.", "first item 2.", "second item 3. third item"], used: [], keptCount: 0, droppedCount: 3, dropped: ["1.", "first item 2.", "second item 3. third item"], void: true, reason: "a list or mapping block \u2014 collapsing it would reorder or drop items" });
});

test('voids a block with no causal sentences', () => {
  const block = ['The function returns a value', 'It processes the input data'];
  const result = draft(block, 0);
  assert.deepEqual(result, { lines: [], sentences: ["The function returns a value It processes the input data"], used: [], keptCount: 0, droppedCount: 1, dropped: ["The function returns a value It processes the input data"], void: true, reason: "no sentence here carries a counterfactual \u2014 the claim must be stated by hand" });
});

test('drafts a block with causal sentences', () => {
  const block = ['The function returns a value', 'It fails closed because of safety'];
  const result = draft(block, 0);
  assert.deepEqual(result, { lines: ["// fact: The function returns a value It fails closed because of safety"], sentences: ["The function returns a value It fails closed because of safety"], used: [0], keptCount: 1, droppedCount: 0, dropped: [], void: false, reason: "" });
});

test('drafts a facts block', () => {
  const block = ['fact: alpha (expiry: never)', 'fact: beta (expiry: never)'];
  const result = draft(block, 0);
  assert.deepEqual(result, { lines: ["// fact: alpha (expiry: never)", "// fact: beta (expiry: never)"], sentences: ["alpha (expiry: never)", "beta (expiry: never)"], used: [0, 1], keptCount: 2, droppedCount: 0, dropped: [], void: false, reason: "" });
});

test('voids a facts block that is structured', () => {
  const block = ['fact: alpha (expiry: never)', '1. one', '2. two'];
  const result = draft(block, 0);
  assert.deepEqual(result, { lines: [], sentences: ["fact: alpha (expiry: never) 1. one 2. two"], used: [], keptCount: 1, droppedCount: 1, dropped: ["fact: alpha (expiry: never) 1. one 2. two"], void: true, reason: "a list or mapping block \u2014 collapsing it would reorder or drop items" });
});

test('drafts a single causal sentence', () => {
  const block = ['It fails closed because of safety'];
  const result = draft(block, 0);
  assert.deepEqual(result, { lines: ["// fact: It fails closed because of safety"], sentences: ["It fails closed because of safety"], used: [0], keptCount: 1, droppedCount: 0, dropped: [], void: false, reason: "" });
});

test('voids a block with only restating lines', () => {
  const block = ['usage: run the tool', 'returns: a value'];
  const result = draft(block, 0);
  assert.deepEqual(result, { lines: [], sentences: [], used: [], keptCount: 0, droppedCount: 0, dropped: [], void: true, reason: "no sentence here carries a counterfactual \u2014 the claim must be stated by hand" });
});

test('drafts with indent', () => {
  const block = ['The function returns a value', 'It fails closed because of safety'];
  const result = draft(block, 2);
  assert.deepEqual(result, { lines: ["  // fact: The function returns a value It fails closed because of safety"], sentences: ["The function returns a value It fails closed because of safety"], used: [0], keptCount: 1, droppedCount: 0, dropped: [], void: false, reason: "" });
});
