// Extracts a concise, non-generic title from a SARIF rule (monitor/sarif-read.mjs ruleTitle).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ruleTitle } from '../sarif-read.mjs';

test('returns null when the rule is null', () => {
  assert.equal(ruleTitle(null), null);
});

test('returns null when the rule is a string', () => {
  assert.equal(ruleTitle('not-an-object'), null);
});

test('returns the short description when it is distinct from the id', () => {
  const rule = { id: 'rule-1', shortDescription: { text: 'A real description' } };
  assert.equal(ruleTitle(rule), "A real description");
});

test('skips the short description when it equals the id', () => {
  const rule = { id: 'rule-1', shortDescription: { text: 'rule-1' } };
  assert.equal(ruleTitle(rule), null);
});

test('skips the short description when it contains the id', () => {
  const rule = { id: 'rule-1', shortDescription: { text: 'About rule-1 here' } };
  assert.equal(ruleTitle(rule), null);
});

test('skips a generic short description and uses the name', () => {
  const rule = { id: 'rule-1', shortDescription: { text: 'vulnerability' }, name: 'The Name' };
  assert.equal(ruleTitle(rule), "The Name");
});

test('uses the first sentence of the full description when others are skipped', () => {
  const rule = { id: 'rule-1', shortDescription: { text: 'rule-1' }, fullDescription: { text: 'First sentence. Second sentence.' } };
  assert.equal(ruleTitle(rule), "First sentence.");
});

test('returns null when all candidates are generic or match the id', () => {
  const rule = { id: 'rule-1', shortDescription: { text: 'rule-1' }, name: 'error', fullDescription: { text: 'warning' } };
  assert.equal(ruleTitle(rule), null);
});

test('returns the title unchanged when its length is exactly the maximum', () => {
  const t = 'x'.repeat(100);
  const rule = { id: 'id', shortDescription: { text: t } };
  assert.equal(ruleTitle(rule), "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
});

test('truncates the title with an ellipsis when its length exceeds the maximum', () => {
  const t = 'x'.repeat(101);
  const rule = { id: 'id', shortDescription: { text: t } };
  assert.equal(ruleTitle(rule), "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\u2026");
});
