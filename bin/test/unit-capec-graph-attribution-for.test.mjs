// Maps CWE ids to CAPEC patterns and attack techniques (bin/capec-graph.mjs attributionFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attributionFor } from '../capec-graph.mjs';

test('returns no-cwe reason when cweIds is null', () => {
  const graph = { byCwe: {}, patterns: {} };
  assert.deepEqual(attributionFor(null, graph), { capec: '', capecVia: '', attack: '', capecReason: 'no-cwe' });
});

test('returns no-cwe reason when cweIds is empty array', () => {
  const graph = { byCwe: {}, patterns: {} };
  assert.deepEqual(attributionFor([], graph), { capec: '', capecVia: '', attack: '', capecReason: 'no-cwe' });
});

test('returns direct capec when cwe maps to pattern', () => {
  const graph = { byCwe: { '89': ['109'] }, patterns: { '109': { attack: ['SQLi'] } } };
  assert.deepEqual(attributionFor(['CWE-89'], graph), { capec: 'CAPEC-109', capecVia: 'direct', attack: 'SQLi', capecReason: '' });
});

test('returns cwe-unmapped when no direct or ancestor match', () => {
  const graph = { byCwe: {}, patterns: {} };
  const cweGraph = { '89': ['79'] };
  const ancestors = (g, c) => g[c] || [];
  assert.deepEqual(attributionFor(['89'], graph, { cweGraph, ancestors }), { capec: '', capecVia: '', attack: '', capecReason: 'cwe-unmapped' });
});

test('returns ancestor capec when direct is empty but ancestor matches', () => {
  const graph = { byCwe: { '79': ['109'] }, patterns: { '109': { attack: ['XSS'] } } };
  const cweGraph = { '89': ['79'] };
  const ancestors = (g, c) => g[c] || [];
  assert.deepEqual(attributionFor(['89'], graph, { cweGraph, ancestors }), { capec: 'CAPEC-109', capecVia: 'ancestor', attack: 'XSS', capecReason: '' });
});

test('returns cwe-unmapped when ancestor exists but does not map to capec', () => {
  const graph = { byCwe: {}, patterns: {} };
  const cweGraph = { '89': ['79'] };
  const ancestors = (g, c) => g[c] || [];
  assert.deepEqual(attributionFor(['89'], graph, { cweGraph, ancestors }), { capec: '', capecVia: '', attack: '', capecReason: 'cwe-unmapped' });
});

test('caps results and reports capped reason when hits exceed cap', () => {
  const byCwe = {};
  const patterns = {};
  for (let i = 1; i <= 15; i++) {
    const id = String(i);
    byCwe['89'] = byCwe['89'] || [];
    byCwe['89'].push(id);
    patterns[id] = { attack: ['A' + i] };
  }
  const graph = { byCwe, patterns };
  const result = attributionFor(['89'], graph, { cap: 12 });
  assert.equal(result.capecVia, 'direct');
  assert.equal(result.capecReason, 'capped-15');
  assert.equal(result.capec.split(' ').length, 12);
});

test('reports capec-has-no-attack when pattern has no attack field', () => {
  const graph = { byCwe: { '89': ['109'] }, patterns: { '109': {} } };
  assert.deepEqual(attributionFor(['89'], graph), { capec: 'CAPEC-109', capecVia: 'direct', attack: '', capecReason: 'capec-has-no-attack' });
});

test('sorts capec ids numerically and deduplicates attacks', () => {
  const graph = { byCwe: { '89': ['200', '100'] }, patterns: { '100': { attack: ['X', 'Y'] }, '200': { attack: ['Y', 'Z'] } } };
  assert.deepEqual(attributionFor(['89'], graph), { capec: 'CAPEC-100 CAPEC-200', capecVia: 'direct', attack: 'X Y Z', capecReason: '' });
});

test('handles numeric cwe ids without prefix', () => {
  const graph = { byCwe: { '89': ['109'] }, patterns: { '109': { attack: ['SQLi'] } } };
  assert.deepEqual(attributionFor([89], graph), { capec: 'CAPEC-109', capecVia: 'direct', attack: 'SQLi', capecReason: '' });
});
