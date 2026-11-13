// Computes a 16-character hash identifier from identity, tier and patch (lib/remediation-contract.mjs candidateId).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidateId } from '../remediation-contract.mjs';

test('hash with all three string fields present', () => {
  const input = { identity: 'user123', tier: 'gold', patch: 'v1.2.3' };
  const result = candidateId(input);
  assert.equal(result, "8ecf70e4a293143d");
});

test('hash when identity is undefined, tier and patch provided', () => {
  const input = { identity: undefined, tier: 'silver', patch: 'v0.9' };
  const result = candidateId(input);
  assert.equal(result, "f7e57adc1cffabd7");
});

test('hash when tier is null, identity and patch provided', () => {
  const input = { identity: 'alice', tier: null, patch: 'beta' };
  const result = candidateId(input);
  assert.equal(result, "6f74b8663fe419a8");
});

test('hash when patch is missing, identity and tier provided', () => {
  const input = { identity: 'bob', tier: 'bronze' };
  const result = candidateId(input);
  assert.equal(result, "420f673066227e68");
});

test('hash with all fields undefined', () => {
  const input = { identity: undefined, tier: undefined, patch: undefined };
  const result = candidateId(input);
  assert.equal(result, "96a296d224f285c6");
});

test('hash with empty strings for all fields', () => {
  const input = { identity: '', tier: '', patch: '' };
  const result = candidateId(input);
  assert.equal(result, "96a296d224f285c6");
});

test('hash with long identity and short tier/patch', () => {
  const input = { identity: 'x'.repeat(1000), tier: 't', patch: 'p' };
  const result = candidateId(input);
  assert.equal(result, "0d800de2a55e0cd4");
});

test('hash with special characters and null values', () => {
  const input = { identity: '\u03a9\u2248\u00e7\u221a\u222b\u02dc\u00b5\u2264\u2265\u00f7', tier: null, patch: null };
  const result = candidateId(input);
  assert.equal(result, "dbce1078788e7dac");
});
