// Escalation queue projection from finding-adjudication journal rows (admin/lib/served-projection.mjs projectEscalations).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectEscalations } from '../lib/served-projection.mjs';

test('returns no-journal state when journal is absent', () => {
  assert.deepEqual(projectEscalations({ absent: true }), { state: 'no-journal' });
});

test('returns zero-unreinforced when no records exist', () => {
  assert.deepEqual(projectEscalations({ records: [] }), { state: 'zero-unreinforced' });
});

test('returns zero-corroborated when provenance exists but no escalation rows', () => {
  const journal = { records: [{ kind: 'finding-adjudication', provenance: 'manual' }] };
  assert.deepEqual(projectEscalations(journal), { state: 'zero-corroborated' });
});

test('projects escalation rows with parsed reason and chains', () => {
  const journal = { records: [{
    kind: 'finding-adjudication',
    findingKey: 'fk1',
    category: 'cat',
    repo: 'repo',
    provenance: 'escalation:timeout(3)',
    at: '2024-01-01T00:00:00Z',
    model: 'gpt-4',
    evidence: { sha256: 'abc' },
    basis: { sha256: 'def' },
  }]};
  const result = projectEscalations(journal);
  assert.equal(result.state, 'ok');
  assert.equal(result.pending, 1);
  assert.equal(result.resolved, 0);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].findingKey, 'fk1');
  assert.equal(result.rows[0].reason, 'timeout');
  assert.equal(result.rows[0].chains, 3);
  assert.equal(result.rows[0].evidenceSealed, true);
  assert.equal(result.rows[0].basisSealed, true);
});

test('marks escalation as resolved when later truth-bearing record exists', () => {
  const journal = { records: [
    { kind: 'finding-adjudication', findingKey: 'fk1', provenance: 'escalation:timeout(2)' },
    { kind: 'finding-adjudication', findingKey: 'fk1', truth: 'true-alarm' },
  ]};
  const result = projectEscalations(journal);
  assert.equal(result.state, 'ok');
  assert.equal(result.pending, 0);
  assert.equal(result.resolved, 1);
  assert.equal(result.rows.length, 0);
});

test('handles unparseable escalation provenance', () => {
  const journal = { records: [{
    kind: 'finding-adjudication',
    findingKey: 'fk2',
    provenance: 'escalation:bad-format',
  }]};
  const result = projectEscalations(journal);
  assert.equal(result.rows[0].reason, 'unparsed');
  assert.equal(result.rows[0].chains, null);
});

test('truncates pending rows to 50 with newest first', () => {
  const records = Array.from({ length: 55 }, (_, i) => ({
    kind: 'finding-adjudication',
    findingKey: `fk${i}`,
    provenance: `escalation:timeout(${i})`,
  }));
  const result = projectEscalations({ records });
  assert.equal(result.pending, 55);
  assert.equal(result.rows.length, 50);
  assert.equal(result.truncated, 5);
  assert.equal(result.rows[0].findingKey, 'fk54');
  assert.equal(result.rows[49].findingKey, 'fk5');
});

test('ignores non-finding-adjudication records', () => {
  const journal = { records: [
    { kind: 'other', provenance: 'escalation:timeout(1)' },
    { kind: 'finding-adjudication', provenance: 'escalation:timeout(1)', findingKey: 'fk1' },
  ]};
  const result = projectEscalations(journal);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].findingKey, 'fk1');
});
