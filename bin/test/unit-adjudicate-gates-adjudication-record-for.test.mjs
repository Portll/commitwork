// Builds the adjudication journal record object from a gate record, verdict, and sha (bin/adjudicate-gates.mjs adjudicationRecordFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjudicationRecordFor } from '../adjudicate-gates.mjs';

test('includes recordPid and recordSession when present on the record', () => {
  const rec = { gate: 'g1', at: '2024-01-01T00:00:00.000Z', pid: 123, session: 'sess-abc' };
  const v = { evidence: 'ev1' };
  const sha = 'abc123';
  const result = adjudicationRecordFor(rec, v, sha);
  assert.equal(result.v, 1);
  assert.equal(result.kind, 'adjudication');
  assert.equal(result.gate, 'g1');
  assert.equal(result.recordAt, '2024-01-01T00:00:00.000Z');
  assert.equal(result.recordPid, 123);
  assert.equal(result.recordSession, 'sess-abc');
  assert.equal(result.evidence, 'ev1');
  assert.equal(result.method, 're-measurement');
  assert.equal(result.basis, 'RE-MEASURED at abc123: ev1. Method: bin/adjudicate-gates.mjs --verify (suite re-run twice in a detached worktree, agreement required; verdict derived from the measurement before the record\'s own verdict was read).');
  assert.equal(result.adjudicatedBy, 'adjudicate-gates (re-measurement; the operator of this tool may have authored the gates being judged \u2014 see the file header)');
});

test('omits recordPid and recordSession when absent from the record', () => {
  const rec = { gate: 'g2', at: '2024-01-02T00:00:00.000Z' };
  const v = { evidence: 'ev2' };
  const sha = 'def456';
  const result = adjudicationRecordFor(rec, v, sha);
  assert.equal(result.gate, 'g2');
  assert.equal(result.recordAt, '2024-01-02T00:00:00.000Z');
  assert.equal('recordPid' in result, false);
  assert.equal('recordSession' in result, false);
  assert.equal(result.evidence, 'ev2');
});

test('includes truth when verdict truth is truthy', () => {
  const rec = { gate: 'g3', at: '2024-01-03T00:00:00.000Z' };
  const v = { truth: true, evidence: 'ev3' };
  const sha = 'ghi789';
  const result = adjudicationRecordFor(rec, v, sha);
  assert.equal(result.truth, true);
  assert.equal(result.evidence, 'ev3');
});

test('omits truth when verdict truth is falsy', () => {
  const rec = { gate: 'g4', at: '2024-01-04T00:00:00.000Z' };
  const v = { truth: false, evidence: 'ev4' };
  const sha = 'jkl012';
  const result = adjudicationRecordFor(rec, v, sha);
  assert.equal('truth' in result, false);
  assert.equal(result.evidence, 'ev4');
});

test('includes attributionCorrect when it is a boolean', () => {
  const rec = { gate: 'g5', at: '2024-01-05T00:00:00.000Z' };
  const v = { attributionCorrect: true, evidence: 'ev5' };
  const sha = 'mno345';
  const result = adjudicationRecordFor(rec, v, sha);
  assert.equal(result.attributionCorrect, true);
  assert.equal(result.evidence, 'ev5');
});

test('omits attributionCorrect when it is not a boolean', () => {
  const rec = { gate: 'g6', at: '2024-01-06T00:00:00.000Z' };
  const v = { attributionCorrect: 'yes', evidence: 'ev6' };
  const sha = 'pqr678';
  const result = adjudicationRecordFor(rec, v, sha);
  assert.equal('attributionCorrect' in result, false);
  assert.equal(result.evidence, 'ev6');
});

test('includes measurement when verdict measurement is truthy', () => {
  const rec = { gate: 'g7', at: '2024-01-07T00:00:00.000Z' };
  const v = { measurement: { score: 95 }, evidence: 'ev7' };
  const sha = 'stu901';
  const result = adjudicationRecordFor(rec, v, sha);
  assert.deepEqual(result.measurement, { score: 95 });
  assert.equal(result.evidence, 'ev7');
});

test('omits measurement when verdict measurement is falsy', () => {
  const rec = { gate: 'g8', at: '2024-01-08T00:00:00.000Z' };
  const v = { measurement: null, evidence: 'ev8' };
  const sha = 'vwx234';
  const result = adjudicationRecordFor(rec, v, sha);
  assert.equal('measurement' in result, false);
  assert.equal(result.evidence, 'ev8');
});

test('sets evidence and basis from verdict evidence and sha', () => {
  const rec = { gate: 'g9', at: '2024-01-09T00:00:00.000Z' };
  const v = { evidence: 'all tests passed' };
  const sha = 'yz0123456789';
  const result = adjudicationRecordFor(rec, v, sha);
  assert.equal(result.evidence, 'all tests passed');
  assert.equal(result.basis, 'RE-MEASURED at yz0123456789: all tests passed. Method: bin/adjudicate-gates.mjs --verify (suite re-run twice in a detached worktree, agreement required; verdict derived from the measurement before the record\'s own verdict was read).');
});

test('handles empty evidence string in basis', () => {
  const rec = { gate: 'g10', at: '2024-01-10T00:00:00.000Z' };
  const v = { evidence: '' };
  const sha = 'empty-sha';
  const result = adjudicationRecordFor(rec, v, sha);
  assert.equal(result.evidence, '');
  assert.equal(result.basis, 'RE-MEASURED at empty-sha: . Method: bin/adjudicate-gates.mjs --verify (suite re-run twice in a detached worktree, agreement required; verdict derived from the measurement before the record\'s own verdict was read).');
});
