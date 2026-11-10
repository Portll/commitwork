// Computes a stable dedup key from a Semgrep result (bin/semgrep-retry.mjs resultKey).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resultKey } from '../semgrep-retry.mjs';

test('returns fingerprint key when matchBasedId is present', () => {
  const input = { fingerprints: { 'matchBasedId/v1': 'abc123' }, ruleId: 'r1' };
  const result = resultKey(input);
  assert.equal(result, "fp:abc123");
});

test('returns place key with full location details', () => {
  const input = {
    ruleId: 'rule-x',
    locations: [{
      physicalLocation: {
        artifactLocation: { uri: 'src/app.js' },
        region: { startLine: 10, startColumn: 5, endLine: 12, endColumn: 20 }
      }
    }]
  };
  const result = resultKey(input);
  assert.equal(result, "place:rule-x|src/app.js|10|5|12|20");
});

test('returns place key with undefined location fields when no physicalLocation', () => {
  const input = { ruleId: 'rule-y', locations: [{}] };
  const result = resultKey(input);
  assert.equal(result, "place:rule-y|undefined|undefined|undefined|undefined|undefined");
});

test('returns place key with empty ruleId and location when res is null', () => {
  const input = null;
  const result = resultKey(input);
  assert.equal(result, "place:null|undefined|undefined|undefined|undefined|undefined");
});

test('returns place key when locations array is empty', () => {
  const input = { ruleId: 'rule-z', locations: [] };
  const result = resultKey(input);
  assert.equal(result, "place:rule-z|undefined|undefined|undefined|undefined|undefined");
});

test('returns place key when locations is undefined', () => {
  const input = { ruleId: 'rule-w' };
  const result = resultKey(input);
  assert.equal(result, "place:rule-w|undefined|undefined|undefined|undefined|undefined");
});

test('returns place key when fingerprints exist but matchBasedId is missing', () => {
  const input = { fingerprints: { otherKey: 'val' }, ruleId: 'rule-v', locations: [] };
  const result = resultKey(input);
  assert.equal(result, "place:rule-v|undefined|undefined|undefined|undefined|undefined");
});

test('returns place key when fingerprints is undefined', () => {
  const input = { ruleId: 'rule-u', locations: [{ physicalLocation: { artifactLocation: { uri: 'file.txt' }, region: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 } } }] };
  const result = resultKey(input);
  assert.equal(result, "place:rule-u|file.txt|1|1|1|1");
});
