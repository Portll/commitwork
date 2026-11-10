// Serialises an advisory index object to a formatted JSON string with sorted keys and counts. (bin/advisory-index.mjs serialise).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serialise } from '../advisory-index.mjs';

test('serialises empty index with zero count and empty objects', () => {
  const input = { advisories: {}, cweNames: {} };
  const expected = JSON.stringify({ advisories: {}, cweNames: {}, count: 0 }, null, 2) + '\n';
  assert.equal(serialise(input), expected);
});

test('serialises single advisory with all defined fields', () => {
  const input = {
    advisories: {
      'CVE-2024-0001': {
        label: 'test', cve: 'CVE-2024-0001', cwe: 'CWE-79', nvd: '9.8',
        v2: 'high', s2: 'critical', v3: '9.8', s3: 'critical', v4: '10.0', s4: 'critical'
      }
    },
    cweNames: { 'CWE-79': 'Cross-site Scripting' }
  };
  const expected = JSON.stringify({
    advisories: {
      'CVE-2024-0001': {
        label: 'test', cve: 'CVE-2024-0001', cwe: 'CWE-79', nvd: '9.8',
        v2: 'high', s2: 'critical', v3: '9.8', s3: 'critical', v4: '10.0', s4: 'critical'
      }
    },
    cweNames: { 'CWE-79': 'Cross-site Scripting' },
    count: 1
  }, null, 2) + '\n';
  assert.equal(serialise(input), expected);
});

test('omits undefined fields from advisory object', () => {
  const input = {
    advisories: {
      'CVE-2024-0002': { label: 'partial', cve: 'CVE-2024-0002' }
    },
    cweNames: {}
  };
  const expected = JSON.stringify({
    advisories: {
      'CVE-2024-0002': { label: 'partial', cve: 'CVE-2024-0002' }
    },
    cweNames: {},
    count: 1
  }, null, 2) + '\n';
  assert.equal(serialise(input), expected);
});

test('sorts advisory IDs alphabetically in output', () => {
  const input = {
    advisories: {
      'CVE-2024-0003': { label: 'c' },
      'CVE-2024-0001': { label: 'a' },
      'CVE-2024-0002': { label: 'b' }
    },
    cweNames: {}
  };
  const result = serialise(input);
  const parsed = JSON.parse(result);
  const keys = Object.keys(parsed.advisories);
  assert.deepEqual(keys, ['CVE-2024-0001', 'CVE-2024-0002', 'CVE-2024-0003']);
  assert.equal(parsed.count, 3);
});

test('sorts cweNames keys alphabetically', () => {
  const input = {
    advisories: {},
    cweNames: { 'CWE-79': 'XSS', 'CWE-89': 'SQLi', 'CWE-1': 'Bad' }
  };
  const result = serialise(input);
  const parsed = JSON.parse(result);
  const keys = Object.keys(parsed.cweNames);
  assert.deepEqual(keys, ['CWE-1', 'CWE-79', 'CWE-89']);
});

test('handles missing cweNames property by defaulting to empty object', () => {
  const input = { advisories: { 'CVE-2024-0004': { label: 'x' } } };
  const expected = JSON.stringify({
    advisories: { 'CVE-2024-0004': { label: 'x' } },
    count: 1,
    cweNames: {}
  }, null, 2) + '\n';
  assert.equal(serialise(input), expected);
});

test('preserves extra top-level properties in index', () => {
  const input = {
    advisories: { 'CVE-2024-0005': { label: 'y' } },
    cweNames: {},
    version: '1.0.0',
    generatedAt: '2024-01-01T00:00:00Z'
  };
  const result = serialise(input);
  const parsed = JSON.parse(result);
  assert.equal(parsed.version, '1.0.0');
  assert.equal(parsed.generatedAt, '2024-01-01T00:00:00Z');
  assert.equal(parsed.count, 1);
});

test('serialises multiple advisories with mixed defined fields', () => {
  const input = {
    advisories: {
      'CVE-2024-0006': { label: 'full', cve: 'CVE-2024-0006', cwe: 'CWE-1' },
      'CVE-2024-0007': { label: 'minimal' }
    },
    cweNames: { 'CWE-1': 'Bad Practice' }
  };
  const result = serialise(input);
  const parsed = JSON.parse(result);
  assert.equal(parsed.count, 2);
  assert.deepEqual(parsed.advisories['CVE-2024-0006'], { label: 'full', cve: 'CVE-2024-0006', cwe: 'CWE-1' });
  assert.deepEqual(parsed.advisories['CVE-2024-0007'], { label: 'minimal' });
  assert.deepEqual(parsed.cweNames, { 'CWE-1': 'Bad Practice' });
});
