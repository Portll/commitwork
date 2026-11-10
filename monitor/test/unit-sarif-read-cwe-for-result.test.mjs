// CWE ids a SARIF result's rule asserts, with a provenance tag (monitor/sarif-read.mjs cweForResult).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cweForResult } from '../sarif-read.mjs';

test('returns no-rule-id when result is null', () => {
  assert.deepEqual(cweForResult(null, {}), { cwe: [], via: "no-rule-id" });
});

test('returns no-rule-id when result has no ruleId or rule', () => {
  assert.deepEqual(cweForResult({}, {}), { cwe: [], via: "no-rule-id" });
});

test('returns no-rule-id when result.rule exists but has no id', () => {
  assert.deepEqual(cweForResult({ rule: {} }, {}), { cwe: [], via: "no-rule-id" });
});

test('returns rule-not-found when rule id is not in rules', () => {
  assert.deepEqual(cweForResult({ ruleId: 'missing' }, {}), { cwe: [], via: "rule-not-found" });
});

test('returns rule-asserts-none when rule has no cwe properties', () => {
  assert.deepEqual(cweForResult({ ruleId: 'r1' }, { r1: {} }), { cwe: [], via: "rule-asserts-none" });
});

test('returns rule-tags with cwe from semgrep string property', () => {
  assert.deepEqual(cweForResult({ ruleId: 'r1' }, { r1: { properties: { cwe: 'CWE-79: Improper Neutralization' } } }), { cwe: ["CWE-79"], via: "rule-tags" });
});

test('returns rule-tags with cwe from codeql tags array', () => {
  assert.deepEqual(cweForResult({ ruleId: 'r1' }, { r1: { properties: { tags: ['external/cwe/cwe-079'] } } }), { cwe: ["CWE-79"], via: "rule-tags" });
});

test('returns rule-tags with multiple cwe ids sorted numerically', () => {
  assert.deepEqual(cweForResult({ ruleId: 'r1' }, { r1: { properties: { cwe: ['CWE-119: Buffer Overflow', 'CWE-79: XSS'] } } }), { cwe: ["CWE-79", "CWE-119"], via: "rule-tags" });
});

test('returns rule-tags when rule id comes from result.rule.id', () => {
  assert.deepEqual(cweForResult({ rule: { id: 'r1' } }, { r1: { properties: { cwe: 'CWE-89: SQL Injection' } } }), { cwe: ["CWE-89"], via: "rule-tags" });
});

test('returns rule-tags with cwe from array property with zero padding', () => {
  assert.deepEqual(cweForResult({ ruleId: 'r1' }, { r1: { properties: { cwe: ['CWE-007: Argument Injection'] } } }), { cwe: ["CWE-7"], via: "rule-tags" });
});
