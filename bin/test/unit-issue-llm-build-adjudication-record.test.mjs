// Builds the adjudication record for a finding (bin/issue-llm.mjs buildAdjudicationRecord).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAdjudicationRecord } from '../issue-llm.mjs';

test('returns unanimous provenance and machine verdict when outcome is unanimous', () => {
  const issue = { repo: 'acme/widget' };
  const check = 'security';
  const findingKey = 'f-1';
  const fused = { outcome: 'unanimous', verdict: 'bug', reason: 'none' };
  const chains = [
    { verdict: 'bug', confidence: 0.9, truncated: false, error: null },
    { verdict: 'bug', confidence: 0.8, truncated: false, error: null },
  ];
  const model = 'gpt-4';

  const rec = buildAdjudicationRecord(issue, check, findingKey, fused, chains, model);

  assert.equal(rec.findingKey, 'f-1');
  assert.equal(rec.category, 'security');
  assert.equal(rec.repo, 'acme/widget');
  assert.equal(rec.machineVerdict, 'bug');
  assert.equal(rec.humanVerdict, null);
  assert.equal(rec.truth, null);
  assert.equal(rec.basis, 'unanimous verdict across 2 independent chains, no reasoning-lint flags');
  assert.equal(rec.evidence, JSON.stringify([
    { verdict: 'bug', confidence: 0.9, truncated: false, error: null },
    { verdict: 'bug', confidence: 0.8, truncated: false, error: null },
  ]));
  assert.equal(rec.model, 'gpt-4');
  assert.equal(rec.promptId, null);
  assert.equal(rec.bornSlice, null);
  assert.equal(rec.provenance, 'unanimous(2)');
});

test('returns escalation provenance and null machine verdict when outcome is not unanimous', () => {
  const issue = { repo: 'acme/widget' };
  const check = 'style';
  const findingKey = 'f-2';
  const fused = { outcome: 'divergent', verdict: 'bug', reason: 'confidence spread' };
  const chains = [
    { verdict: 'bug', confidence: 0.9, truncated: false, error: null },
    { verdict: 'not-a-bug', confidence: 0.7, truncated: true, error: null },
  ];
  const model = 'claude-3';

  const rec = buildAdjudicationRecord(issue, check, findingKey, fused, chains, model);

  assert.equal(rec.findingKey, 'f-2');
  assert.equal(rec.category, 'style');
  assert.equal(rec.repo, 'acme/widget');
  assert.equal(rec.machineVerdict, null);
  assert.equal(rec.humanVerdict, null);
  assert.equal(rec.truth, null);
  assert.equal(rec.basis, 'chains did not converge cleanly (confidence spread) \u2014 see evidence');
  assert.equal(rec.evidence, JSON.stringify([
    { verdict: 'bug', confidence: 0.9, truncated: false, error: null },
    { verdict: 'not-a-bug', confidence: 0.7, truncated: true, error: null },
  ]));
  assert.equal(rec.model, 'claude-3');
  assert.equal(rec.promptId, null);
  assert.equal(rec.bornSlice, null);
  assert.equal(rec.provenance, 'escalation:confidence spread(2)');
});

test('maps undefined verdict and confidence to null in evidence', () => {
  const issue = { repo: 'org/lib' };
  const check = 'perf';
  const findingKey = 'f-3';
  const fused = { outcome: 'unanimous', verdict: 'issue', reason: '' };
  const chains = [
    { verdict: undefined, confidence: undefined, truncated: undefined, error: undefined },
  ];
  const model = 'llama-3';

  const rec = buildAdjudicationRecord(issue, check, findingKey, fused, chains, model);

  assert.equal(rec.machineVerdict, 'issue');
  assert.equal(rec.evidence, JSON.stringify([
    { verdict: null, confidence: null, truncated: false, error: null },
  ]));
  assert.equal(rec.provenance, 'unanimous(1)');
});

test('coerces truthy truncated to true and falsy to false in evidence', () => {
  const issue = { repo: 'org/lib' };
  const check = 'security';
  const findingKey = 'f-4';
  const fused = { outcome: 'divergent', verdict: null, reason: 'timeout' };
  const chains = [
    { verdict: 'bug', confidence: 0.5, truncated: 1, error: 'timeout' },
    { verdict: 'bug', confidence: 0.5, truncated: 0, error: null },
  ];
  const model = 'gpt-4';

  const rec = buildAdjudicationRecord(issue, check, findingKey, fused, chains, model);

  const parsed = JSON.parse(rec.evidence);
  assert.equal(parsed[0].truncated, true);
  assert.equal(parsed[0].error, 'timeout');
  assert.equal(parsed[1].truncated, false);
  assert.equal(parsed[1].error, null);
  assert.equal(rec.machineVerdict, null);
  assert.equal(rec.provenance, 'escalation:timeout(2)');
});

test('handles single chain with unanimous outcome', () => {
  const issue = { repo: 'solo/repo' };
  const check = 'logic';
  const findingKey = 'f-5';
  const fused = { outcome: 'unanimous', verdict: 'bug', reason: '' };
  const chains = [
    { verdict: 'bug', confidence: 1.0, truncated: false, error: null },
  ];
  const model = 'gpt-4';

  const rec = buildAdjudicationRecord(issue, check, findingKey, fused, chains, model);

  assert.equal(rec.machineVerdict, 'bug');
  assert.equal(rec.basis, 'unanimous verdict across 1 independent chains, no reasoning-lint flags');
  assert.equal(rec.provenance, 'unanimous(1)');
  assert.equal(rec.evidence, JSON.stringify([
    { verdict: 'bug', confidence: 1.0, truncated: false, error: null },
  ]));
});

test('handles empty chains array with escalation outcome', () => {
  const issue = { repo: 'org/empty' };
  const check = 'security';
  const findingKey = 'f-6';
  const fused = { outcome: 'divergent', verdict: null, reason: 'no chains' };
  const chains = [];
  const model = 'gpt-4';

  const rec = buildAdjudicationRecord(issue, check, findingKey, fused, chains, model);

  assert.equal(rec.machineVerdict, null);
  assert.equal(rec.basis, 'chains did not converge cleanly (no chains) \u2014 see evidence');
  assert.equal(rec.evidence, JSON.stringify([]));
  assert.equal(rec.provenance, 'escalation:no chains(0)');
});

test('preserves error string in evidence when present', () => {
  const issue = { repo: 'org/err' };
  const check = 'security';
  const findingKey = 'f-7';
  const fused = { outcome: 'divergent', verdict: null, reason: 'error' };
  const chains = [
    { verdict: null, confidence: null, truncated: false, error: 'rate limit exceeded' },
  ];
  const model = 'gpt-4';

  const rec = buildAdjudicationRecord(issue, check, findingKey, fused, chains, model);

  const parsed = JSON.parse(rec.evidence);
  assert.equal(parsed[0].error, 'rate limit exceeded');
  assert.equal(parsed[0].verdict, null);
  assert.equal(parsed[0].confidence, null);
  assert.equal(parsed[0].truncated, false);
});

test('uses exact reason string in escalation provenance and basis', () => {
  const issue = { repo: 'org/reason' };
  const check = 'style';
  const findingKey = 'f-8';
  const fused = { outcome: 'divergent', verdict: null, reason: 'verdict mismatch' };
  const chains = [
    { verdict: 'a', confidence: 0.5, truncated: false, error: null },
    { verdict: 'b', confidence: 0.5, truncated: false, error: null },
    { verdict: 'c', confidence: 0.5, truncated: false, error: null },
  ];
  const model = 'gpt-4';

  const rec = buildAdjudicationRecord(issue, check, findingKey, fused, chains, model);

  assert.equal(rec.provenance, 'escalation:verdict mismatch(3)');
  assert.equal(rec.basis, 'chains did not converge cleanly (verdict mismatch) \u2014 see evidence');
  assert.equal(rec.machineVerdict, null);
});
