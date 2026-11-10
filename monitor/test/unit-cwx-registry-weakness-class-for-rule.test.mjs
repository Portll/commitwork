// Maps a rule id to its CWE weakness class via table lookup or heuristic (monitor/cwx-registry.mjs weaknessClassForRule).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weaknessClassForRule } from '../cwx-registry.mjs';

test('returns empty array when ruleId is falsy', () => {
  const r = weaknessClassForRule('', {}, { allowHeuristic: true });
  assert.deepEqual(r, []);
});

test('returns table value when ruleCweTable has the ruleId', () => {
  const r = weaknessClassForRule('rule-1', { 'rule-1': ['CWE-1'] }, { allowHeuristic: true });
  assert.deepEqual(r, ["CWE-1"]);
});

test('returns empty array when allowHeuristic is false and no table match', () => {
  const r = weaknessClassForRule('some-rule', null, { allowHeuristic: false });
  assert.deepEqual(r, []);
});

test('returns CWE-89 for sql injection heuristic', () => {
  const r = weaknessClassForRule('sql-injection', null, { allowHeuristic: true });
  assert.deepEqual(r, ["CWE-89"]);
});

test('returns CWE-639 for idor heuristic', () => {
  const r = weaknessClassForRule('idor-check', null, { allowHeuristic: true });
  assert.deepEqual(r, ["CWE-639"]);
});

test('returns empty array for non-matching heuristic', () => {
  const r = weaknessClassForRule('unknown-rule', null, { allowHeuristic: true });
  assert.deepEqual(r, []);
});

test('returns table value when ruleCweTable is truthy but ruleId not in table', () => {
  const r = weaknessClassForRule('missing', { other: ['CWE-9'] }, { allowHeuristic: true });
  assert.deepEqual(r, []);
});

test('returns empty array when ruleId is truthy but table is null and heuristic disabled', () => {
  const r = weaknessClassForRule('some-id', null, { allowHeuristic: false });
  assert.deepEqual(r, []);
});
