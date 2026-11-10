// Extracts indicators from a STIX bundle (monitor/indicators.mjs parseStixBundle).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStixBundle } from '../indicators.mjs';

test('returns unparseable when bundle is null', () => {
  const r = parseStixBundle(null);
  assert.deepEqual(r, { source: null, indicators: [], rejected: [], unknown: true, unknownReason: "unparseable", unknownDetail: "not a STIX bundle: no objects[] array" });
});

test('returns unparseable when bundle is a string', () => {
  const r = parseStixBundle('not an object');
  assert.deepEqual(r, { source: null, indicators: [], rejected: [], unknown: true, unknownReason: "unparseable", unknownDetail: "not a STIX bundle: no objects[] array" });
});

test('returns unparseable when bundle is an empty array', () => {
  const r = parseStixBundle([]);
  assert.deepEqual(r, { source: null, indicators: [], rejected: [] });
});

test('returns unparseable when bundle has no objects property', () => {
  const r = parseStixBundle({ foo: 'bar' });
  assert.deepEqual(r, { source: null, indicators: [], rejected: [], unknown: true, unknownReason: "unparseable", unknownDetail: "not a STIX bundle: no objects[] array" });
});

test('returns unparseable when objects is not an array', () => {
  const r = parseStixBundle({ objects: 'not-array' });
  assert.deepEqual(r, { source: null, indicators: [], rejected: [], unknown: true, unknownReason: "unparseable", unknownDetail: "not a STIX bundle: no objects[] array" });
});

test('returns empty indicators and rejected for bundle with no indicators', () => {
  const r = parseStixBundle({ objects: [{ type: 'malware', id: 'm1' }] });
  assert.deepEqual(r, { source: null, indicators: [], rejected: [] });
});

test('returns empty indicators and rejected for bundle with null object', () => {
  const r = parseStixBundle({ objects: [null] });
  assert.deepEqual(r, { source: null, indicators: [], rejected: [] });
});

test('parses a domain indicator into an indicator with normalised value', () => {
  const r = parseStixBundle({ objects: [{ type: 'indicator', id: 'ind-1', name: 'Bad Domain', pattern: "[domain-name:value = 'EXAMPLE.COM.']" }] });
  assert.deepEqual(r, { source: null, indicators: [{ id: "ind-1", name: "Bad Domain", created: null, type: "domain", value: "example.com", source: null }], rejected: [] });
});

test('rejects an indicator with an unsupported pattern operator', () => {
  const r = parseStixBundle({ objects: [{ type: 'indicator', id: 'ind-2', name: 'Bad Pattern', pattern: "[domain-name:value MATCHES '.*']" }] });
  assert.deepEqual(r, { source: null, indicators: [], rejected: [{ id: "ind-2", name: "Bad Pattern", pattern: "[domain-name:value MATCHES '.*']", unknownReason: "unexaminable", unknownDetail: "pattern uses an operator this parser does not implement: [domain-name:value MATCHES '.*']" }] });
});

test('parses a file hash indicator into an indicator with lowercased value', () => {
  const r = parseStixBundle({ objects: [{ type: 'indicator', id: 'ind-3', name: 'Bad File', pattern: "[file:hashes.'SHA-256' = 'ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890']" }] });
  assert.deepEqual(r, { source: null, indicators: [{ id: "ind-3", name: "Bad File", created: null, type: "sha256", value: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890", source: null }], rejected: [] });
});
