// Records a scored divergence row into the nondeterministic store (monitor/divergence.mjs recordDivergence).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordDivergence } from '../divergence.mjs';

test('throws when subject is missing', () => {
  assert.throws(() => recordDivergence({}), /subject is required/);
});

test('returns recorded false when verdictA is absent', () => {
  const r = recordDivergence({ subject: 's', verdictA: null, verdictB: { verdict: 'pass', findings: [] } });
  assert.equal(r.recorded, false);
  assert.equal(r.score, null);
  assert.equal(r.why, 'one side absent \u2014 undefined, not 0 and not 1');
});

test('returns recorded false when verdictB is absent', () => {
  const r = recordDivergence({ subject: 's', verdictA: { verdict: 'pass', findings: [] }, verdictB: undefined });
  assert.equal(r.recorded, false);
  assert.equal(r.score, null);
});

test('records zero divergence for identical verdicts with no findings', () => {
  const v = { verdict: 'pass', findings: [] };
  const r = recordDivergence({ subject: 's', verdictA: v, verdictB: v, correlation: 0 });
  assert.equal(r.recorded, true);
  assert.equal(r.score, 0);
  assert.equal(r.components.perFinding, 0);
  assert.equal(r.components.verdictMismatch, 0);
  assert.equal(r.components.coveragePenalty, 0);
  assert.equal(r.coverage.both, 0);
  assert.equal(r.coverage.onlyOne, 0);
  assert.equal(r.coverage.total, 1);
  assert.equal(r.row.subject, 's');
  assert.ok(r.row.ts);
});

test('records full divergence for opposite verdicts with no shared findings', () => {
  const a = { verdict: 'pass', findings: [{ id: '1', classification: 'pass' }] };
  const b = { verdict: 'fail', findings: [{ id: '2', classification: 'fail' }] };
  const r = recordDivergence({ subject: 's', verdictA: a, verdictB: b, correlation: 0 });
  assert.equal(r.recorded, true);
  assert.equal(r.score, 1);
  assert.equal(r.components.perFinding, 1);
  assert.equal(r.components.verdictMismatch, 1);
  assert.equal(r.components.coveragePenalty, 1);
  assert.equal(r.coverage.both, 0);
  assert.equal(r.coverage.onlyOne, 2);
  assert.equal(r.coverage.total, 2);
});

test('records partial divergence with shared findings and correlation discount', () => {
  const a = { verdict: 'pass', findings: [{ id: '1', classification: 'pass' }, { id: '2', classification: 'pass' }] };
  const b = { verdict: 'fail', findings: [{ id: '1', classification: 'fail' }, { id: '2', classification: 'needs-human' }] };
  const r = recordDivergence({ subject: 's', verdictA: a, verdictB: b, correlation: 0.5 });
  assert.equal(r.recorded, true);
  assert.equal(r.score, 0.775);
  assert.equal(r.components.perFinding, 0.5);
  assert.equal(r.components.verdictMismatch, 1);
  assert.equal(r.components.coveragePenalty, 0);
  assert.equal(r.coverage.both, 2);
  assert.equal(r.coverage.onlyOne, 0);
  assert.equal(r.coverage.total, 2);
  assert.equal(r.correlation, 0.5);
});

test('merges caller detail beside scored components', () => {
  const v = { verdict: 'pass', findings: [] };
  const r = recordDivergence({ subject: 's', verdictA: v, verdictB: v, correlation: 0, detail: { note: 'hello' } });
  assert.equal(r.recorded, true);
  assert.equal(r.row.detail.note, 'hello');
  assert.equal(r.row.detail.components.perFinding, 0);
  assert.equal(r.row.detail.coverage.total, 1);
  assert.equal(r.row.detail.correlation, 0);
});

test('records coverage penalty when findings are disjoint but verdicts match', () => {
  const a = { verdict: 'pass', findings: [{ id: '1', classification: 'pass' }] };
  const b = { verdict: 'pass', findings: [{ id: '2', classification: 'pass' }] };
  const r = recordDivergence({ subject: 's', verdictA: a, verdictB: b, correlation: 0 });
  assert.equal(r.recorded, true);
  assert.equal(r.score, 0.8);
  assert.equal(r.components.perFinding, 1);
  assert.equal(r.components.verdictMismatch, 0);
  assert.equal(r.components.coveragePenalty, 1);
  assert.equal(r.coverage.both, 0);
  assert.equal(r.coverage.onlyOne, 2);
  assert.equal(r.coverage.total, 2);
});
