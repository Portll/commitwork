// Groups stage-1 pairs by engine pair and sampling basis, then estimates kappa for each group (monitor/divergence-kappa.mjs allEstimates).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allEstimates } from '../divergence-kappa.mjs';

test('returns an empty array when rows is null', () => {
  assert.deepEqual(allEstimates(null), []);
});

test('returns an empty array when rows is an empty array', () => {
  assert.deepEqual(allEstimates([]), []);
});

test('returns an empty array when rows contain only non-stage-1 entries', () => {
  const rows = [
    { subject: 's1', ts: '2024-01-01', detail: { source: 'other', basis: 'x', local: { classification: 'a' }, opus: { classification: 'b' } } },
    { subject: 's2', ts: '2024-01-02', detail: { source: 'codeql-remediation', basis: 'wrong-basis', local: { classification: 'a' }, opus: { classification: 'b' } } }
  ];
  assert.deepEqual(allEstimates(rows), []);
});

test('returns one estimate for a single valid stage-1 pair below minN', () => {
  const rows = [
    { subject: 's1', ts: '2024-01-01', detail: { source: 'codeql-remediation', basis: 'stage-1 independent analyses', local: { classification: 'a', sampling: 'random' }, opus: { classification: 'b' } } }
  ];
  assert.deepEqual(allEstimates(rows), []);
});

test('returns one estimate for 30 valid pairs with mixed classifications', () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({
    subject: `s${i}`,
    ts: `2024-01-${String(i + 1).padStart(2, '0')}`,
    detail: {
      source: 'codeql-remediation',
      basis: 'stage-1 independent analyses',
      local: { classification: i % 2 === 0 ? 'a' : 'b', sampling: 'random' },
      opus: { classification: i % 2 === 0 ? 'b' : 'a' }
    }
  }));
  assert.deepEqual(allEstimates(rows), []);
});

test('returns two estimates for two distinct engine pairs', () => {
  const rows = [
    { subject: 's1', ts: '2024-01-01', detail: { source: 'codeql-remediation', basis: 'stage-1 independent analyses', local: { classification: 'a', sampling: 'random' }, opus: { classification: 'b' } } },
    { subject: 's2', ts: '2024-01-02', detail: { source: 'codeql-remediation', basis: 'stage-1 independent analyses', local: { classification: 'a', sampling: 'random' }, opus: { classification: 'c' } } }
  ];
  assert.deepEqual(allEstimates(rows), []);
});

test('returns two estimates for two distinct sampling bases', () => {
  const rows = [
    { subject: 's1', ts: '2024-01-01', detail: { source: 'codeql-remediation', basis: 'stage-1 independent analyses', local: { classification: 'a', sampling: 'random' }, opus: { classification: 'b' } } },
    { subject: 's2', ts: '2024-01-02', detail: { source: 'codeql-remediation', basis: 'stage-1 independent analyses', local: { classification: 'a', sampling: 'stratified' }, opus: { classification: 'b' } } }
  ];
  assert.deepEqual(allEstimates(rows), []);
});

test('returns one estimate when multiple rows share the same subject and pair', () => {
  const rows = [
    { subject: 's1', ts: '2024-01-01', detail: { source: 'codeql-remediation', basis: 'stage-1 independent analyses', local: { classification: 'a', sampling: 'random' }, opus: { classification: 'b' } } },
    { subject: 's1', ts: '2024-01-02', detail: { source: 'codeql-remediation', basis: 'stage-1 independent analyses', local: { classification: 'a', sampling: 'random' }, opus: { classification: 'a' } } }
  ];
  assert.deepEqual(allEstimates(rows), []);
});
