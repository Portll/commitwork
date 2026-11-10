// Computes the grouping key for a lane and row (monitor/feed-groups.mjs groupKeyFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupKeyFor } from '../feed-groups.mjs';

test('returns key with empty subject when lane has no identity and row has no fallback fields', () => {
  const r = groupKeyFor('lane-a', { repo: 'r1' });
  assert.deepEqual(r, { key: "r1\u0000lane-a\u0000", subject: "", subjectFields: [], identityDeclared: false });
});

test('returns key with rule as subject when lane has no identity and row has rule field', () => {
  const r = groupKeyFor('lane-b', { repo: 'r2', rule: 'no-eval' });
  assert.deepEqual(r, { key: "r2\u0000lane-b\u0000no-eval", subject: "no-eval", subjectFields: ["rule"], identityDeclared: false });
});

test('returns key with package as subject when lane has no identity and row has package field', () => {
  const r = groupKeyFor('lane-c', { repo: 'r3', package: 'lodash' });
  assert.deepEqual(r, { key: "r3\u0000lane-c\u0000lodash", subject: "lodash", subjectFields: ["package"], identityDeclared: false });
});

test('returns key with control as subject when lane has no identity and row has control field', () => {
  const r = groupKeyFor('lane-d', { repo: 'r4', control: 'C-1' });
  assert.deepEqual(r, { key: "r4\u0000lane-d\u0000C-1", subject: "C-1", subjectFields: ["control"], identityDeclared: false });
});

test('returns key with id as subject when lane has no identity and row has id field', () => {
  const r = groupKeyFor('lane-e', { repo: 'r5', id: 'ISSUE-42' });
  assert.deepEqual(r, { key: "r5\u0000lane-e\u0000ISSUE-42", subject: "ISSUE-42", subjectFields: ["id"], identityDeclared: false });
});

test('returns key with marker as subject when lane has no identity and row has marker field', () => {
  const r = groupKeyFor('lane-f', { repo: 'r6', marker: 'M-9' });
  assert.deepEqual(r, { key: "r6\u0000lane-f\u0000M-9", subject: "M-9", subjectFields: ["marker"], identityDeclared: false });
});

test('returns key with detector as subject when lane has no identity and row has detector field', () => {
  const r = groupKeyFor('lane-g', { repo: 'r7', detector: 'D-3' });
  assert.deepEqual(r, { key: "r7\u0000lane-g\u0000D-3", subject: "D-3", subjectFields: ["detector"], identityDeclared: false });
});

test('returns key with name as subject when lane has no identity and row has name field', () => {
  const r = groupKeyFor('lane-h', { repo: 'r8', name: 'my-func' });
  assert.deepEqual(r, { key: "r8\u0000lane-h\u0000my-func", subject: "my-func", subjectFields: ["name"], identityDeclared: false });
});

test('returns key with ecosystem appended when lane identity includes package and ecosystem', () => {
  const r = groupKeyFor('npm:lodash', { repo: 'r9', package: 'lodash', ecosystem: 'npm' });
  assert.deepEqual(r, { key: "r9\u0000npm:lodash\u0000lodash", subject: "lodash", subjectFields: ["package"], identityDeclared: false });
});

test('returns key with first subject field when lane identity has multiple subject fields', () => {
  const r = groupKeyFor('rule:custom', { repo: 'r10', rule: 'custom-rule', package: 'pkg' });
  assert.deepEqual(r, { key: "r10\u0000rule:custom\u0000custom-rule", subject: "custom-rule", subjectFields: ["rule"], identityDeclared: false });
});
