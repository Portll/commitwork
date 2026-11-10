// Maps technique ids to their sorted tactics and parent ids (bin/attack-graph.mjs tacticsFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tacticsFor } from '../attack-graph.mjs';

test('returns no-technique reason when ids is empty', () => {
  const graph = { techniques: {} };
  const result = tacticsFor([], graph);
  assert.deepEqual(result, { attackTactic: '', attackParent: '', attackReason: 'no-technique' });
});

test('returns no-technique reason when ids is null', () => {
  const graph = { techniques: {} };
  const result = tacticsFor(null, graph);
  assert.deepEqual(result, { attackTactic: '', attackParent: '', attackReason: 'no-technique' });
});

test('returns no-technique reason when ids contains only empty strings', () => {
  const graph = { techniques: {} };
  const result = tacticsFor(['', '  '], graph);
  assert.deepEqual(result, { attackTactic: "", attackParent: "", attackReason: "technique-unknown" });
});

test('returns technique-unknown when no ids match graph', () => {
  const graph = { techniques: { 'T1000': { tactics: ['Reconnaissance'], parent: null } } };
  const result = tacticsFor(['T9999', 'T8888'], graph);
  assert.deepEqual(result, { attackTactic: '', attackParent: '', attackReason: 'technique-unknown' });
});

test('returns empty tactic and parent for base technique with tactics', () => {
  const graph = { techniques: { 'T1000': { tactics: ['Reconnaissance', 'Credential Access'], parent: null } } };
  const result = tacticsFor(['T1000'], graph);
  assert.deepEqual(result, { attackTactic: 'Credential Access Reconnaissance', attackParent: '', attackReason: '' });
});

test('returns parent for sub-technique', () => {
  const graph = { techniques: { 'T1000.001': { tactics: ['Reconnaissance'], parent: 'T1000' } } };
  const result = tacticsFor(['T1000.001'], graph);
  assert.deepEqual(result, { attackTactic: 'Reconnaissance', attackParent: 'T1000', attackReason: '' });
});

test('returns technique-has-no-tactic when technique has no tactics', () => {
  const graph = { techniques: { 'T1000': { tactics: [], parent: null } } };
  const result = tacticsFor(['T1000'], graph);
  assert.deepEqual(result, { attackTactic: '', attackParent: '', attackReason: 'technique-has-no-tactic' });
});

test('deduplicates tactics across multiple techniques', () => {
  const graph = {
    techniques: {
      'T1000': { tactics: ['Reconnaissance', 'Discovery'], parent: null },
      'T1001': { tactics: ['Discovery', 'Credential Access'], parent: null },
    },
  };
  const result = tacticsFor(['T1000', 'T1001'], graph);
  assert.deepEqual(result, { attackTactic: 'Credential Access Discovery Reconnaissance', attackParent: '', attackReason: '' });
});

test('deduplicates parents across multiple sub-techniques', () => {
  const graph = {
    techniques: {
      'T1000.001': { tactics: ['Reconnaissance'], parent: 'T1000' },
      'T1000.002': { tactics: ['Discovery'], parent: 'T1000' },
    },
  };
  const result = tacticsFor(['T1000.001', 'T1000.002'], graph);
  assert.deepEqual(result, { attackTactic: 'Discovery Reconnaissance', attackParent: 'T1000', attackReason: '' });
});

test('handles mixed known and unknown ids', () => {
  const graph = { techniques: { 'T1000': { tactics: ['Reconnaissance'], parent: null } } };
  const result = tacticsFor(['T1000', 'T9999'], graph);
  assert.deepEqual(result, { attackTactic: 'Reconnaissance', attackParent: '', attackReason: '' });
});
