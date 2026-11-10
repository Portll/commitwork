// Fuses parallel LLM chains into a single verdict or escalation (bin/issue-llm.mjs fuseChains).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuseChains } from '../issue-llm.mjs';

test('returns escalate with chain-error reason when any chain has an error', () => {
  const results = [
    { verdict: 'approve', thinking: 'ok' },
    { error: 'timeout' },
  ];
  assert.deepEqual(fuseChains(results), { outcome: 'escalate', reason: 'chain-error' });
});

test('returns escalate with chain-error reason when the only chain has an error', () => {
  const results = [{ error: 'network' }];
  assert.deepEqual(fuseChains(results), { outcome: 'escalate', reason: 'chain-error' });
});

test('returns escalate with disagreement reason when verdicts differ', () => {
  const results = [
    { verdict: 'approve', thinking: 'ok' },
    { verdict: 'reject', thinking: 'bad' },
  ];
  assert.deepEqual(fuseChains(results), { outcome: 'escalate', reason: 'disagreement' });
});

test('returns escalate with disagreement reason when a verdict is undefined', () => {
  const results = [
    { verdict: 'approve', thinking: 'ok' },
    { verdict: undefined, thinking: 'ok' },
  ];
  assert.deepEqual(fuseChains(results), { outcome: 'escalate', reason: 'disagreement' });
});

test('returns escalate with disagreement reason when the first verdict is undefined', () => {
  const results = [
    { verdict: undefined, thinking: 'ok' },
    { verdict: undefined, thinking: 'ok' },
  ];
  assert.deepEqual(fuseChains(results), { outcome: 'escalate', reason: 'disagreement' });
});

test('returns escalate with disagreement reason when chainResults is empty', () => {
  assert.deepEqual(fuseChains([]), { outcome: 'escalate', reason: 'disagreement' });
});

test('returns unanimous with the shared verdict when all chains agree and lint passes', () => {
  const results = [
    { verdict: 'approve', thinking: 'looks good' },
    { verdict: 'approve', thinking: 'also good' },
  ];
  assert.deepEqual(fuseChains(results), { outcome: 'unanimous', verdict: 'approve' });
});

test('returns unanimous with the shared verdict for a single chain that agrees with itself', () => {
  const results = [{ verdict: 'reject', thinking: 'bad code' }];
  assert.deepEqual(fuseChains(results), { outcome: 'unanimous', verdict: 'reject' });
});

test('returns unanimous with the shared verdict when thinking is empty but verdicts agree', () => {
  const results = [
    { verdict: 'approve', thinking: '' },
    { verdict: 'approve', thinking: '' },
  ];
  assert.deepEqual(fuseChains(results), { outcome: 'unanimous', verdict: 'approve' });
});
