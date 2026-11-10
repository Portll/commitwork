// Parses a STIX pattern into observable terms or an unknown status (monitor/indicators.mjs parsePattern).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePattern } from '../indicators.mjs';

test('returns unstated for a non-string input', () => {
  assert.deepEqual(parsePattern(42), { unknown: true, unknownReason: "unstated", unknownDetail: "empty pattern" });
});

test('returns unstated for a whitespace-only string', () => {
  assert.deepEqual(parsePattern('   '), { unknown: true, unknownReason: "unstated", unknownDetail: "empty pattern" });
});

test('returns unexaminable when the pattern uses MATCHES', () => {
  assert.deepEqual(parsePattern("[domain-name:value MATCHES '.*']"), { unknown: true, unknownReason: "unexaminable", unknownDetail: "pattern uses an operator this parser does not implement: [domain-name:value MATCHES '.*']" });
});

test('returns unexaminable when the pattern has no brackets', () => {
  assert.deepEqual(parsePattern("domain-name:value = 'example.com'"), { unknown: true, unknownReason: "unexaminable", unknownDetail: "pattern is not a single observation expression: domain-name:value = 'example.com'" });
});

test('returns unexaminable when the pattern has two bracket groups', () => {
  assert.deepEqual(parsePattern("[domain-name:value = 'a.com'] [domain-name:value = 'b.com']"), { unknown: true, unknownReason: "unexaminable", unknownDetail: "pattern is not a single observation expression: [domain-name:value = 'a.com'] [domain-name:value = 'b.com']" });
});

test('returns unexaminable when the pattern conjoins terms with AND', () => {
  assert.deepEqual(parsePattern("[domain-name:value = 'a.com' AND domain-name:value = 'b.com']"), { unknown: true, unknownReason: "unexaminable", unknownDetail: "pattern conjoins terms with AND, which this parser cannot evaluate: [domain-name:value = 'a.com' AND domain-name:value = 'b.com']" });
});

test('returns unexaminable when no supported object path is present', () => {
  assert.deepEqual(parsePattern("[foo:bar = 'baz']"), { unknown: true, unknownReason: "unexaminable", unknownDetail: "no supported object path in the pattern (saw foo:bar)" });
});

test('returns unexaminable when no comparison is recognised', () => {
  assert.deepEqual(parsePattern("[domain-name:value =]"), { unknown: true, unknownReason: "unexaminable", unknownDetail: "no comparison this parser recognises: [domain-name:value =]" });
});

test('returns ok with terms for a single supported comparison', () => {
  assert.deepEqual(parsePattern("[domain-name:value = 'example.com']"), { ok: true, terms: [{ type: "domain", value: "example.com" }], unsupportedPaths: [] });
});

test('returns ok with terms for multiple supported comparisons joined by OR', () => {
  assert.deepEqual(parsePattern("[domain-name:value = 'a.com' OR url:value = 'http://b.com']"), { ok: true, terms: [{ type: "domain", value: "a.com" }, { type: "url", value: "http://b.com" }], unsupportedPaths: [] });
});
