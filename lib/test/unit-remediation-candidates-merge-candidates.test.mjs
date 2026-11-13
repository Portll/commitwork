// merges remediation findings with produced candidates (lib/remediation-candidates.mjs mergeCandidates).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeCandidates } from '../remediation-candidates.mjs';

test('throws TypeError when remediationFindings is not an array', () => {
  assert.throws(
    () => mergeCandidates(null, []),
    { name: 'TypeError', message: 'mergeCandidates: remediationFindings must be an array' }
  );
});

test('throws TypeError when produced is not an array', () => {
  assert.throws(
    () => mergeCandidates([], null),
    { name: 'TypeError', message: 'mergeCandidates: produced must be an array' }
  );
});

test('adds a new candidate when none exists for the finding', () => {
  const remediationFindings = [
    { identity: 'file1', occurrence: 1, candidates: [] }
  ];
  const produced = [
    { identity: 'file1', occurrence: 1, candidate: { id: 'c1', data: 42 } }
  ];
  const result = mergeCandidates(remediationFindings, produced);
  assert.deepEqual(result, [{ identity: "file1", occurrence: 1, candidates: [{ id: "c1", data: 42 }] }]);
});

test('does not duplicate a candidate with the same id', () => {
  const remediationFindings = [
    { identity: 'file2', occurrence: 2, candidates: [{ id: 'c2', data: 1 }] }
  ];
  const produced = [
    { identity: 'file2', occurrence: 2, candidate: { id: 'c2', data: 99 } }
  ];
  const result = mergeCandidates(remediationFindings, produced);
  assert.deepEqual(result, [{ identity: "file2", occurrence: 2, candidates: [{ id: "c2", data: 1 }] }]);
});

test('throws when a produced entry has no matching finding', () => {
  const remediationFindings = [
    { identity: 'file3', occurrence: 3, candidates: [] }
  ];
  const produced = [
    { identity: 'fileX', occurrence: 99, candidate: { id: 'cX', data: 0 } }
  ];
  assert.throws(
    () => mergeCandidates(remediationFindings, produced),
    { name: 'Error', message: 'mergeCandidates: no finding for fileX occurrence 99' }
  );
});

test('handles duplicate keys in remediationFindings, candidate applied to first occurrence', () => {
  const remediationFindings = [
    { identity: 'dup', occurrence: 1, candidates: [] },
    { identity: 'dup', occurrence: 1, candidates: [] }
  ];
  const produced = [
    { identity: 'dup', occurrence: 1, candidate: { id: 'cDup', data: 'first' } }
  ];
  const result = mergeCandidates(remediationFindings, produced);
  assert.deepEqual(result, [{ identity: "dup", occurrence: 1, candidates: [{ id: "cDup", data: "first" }] }, { identity: "dup", occurrence: 1, candidates: [] }]);
});

test('adds candidate when candidates property is missing', () => {
  const remediationFindings = [
    { identity: 'noCand', occurrence: 5 }
  ];
  const produced = [
    { identity: 'noCand', occurrence: 5, candidate: { id: 'c5', data: true } }
  ];
  const result = mergeCandidates(remediationFindings, produced);
  assert.deepEqual(result, [{ identity: "noCand", occurrence: 5, candidates: [{ id: "c5", data: true }] }]);
});

test('adds multiple distinct candidates to the same finding', () => {
  const remediationFindings = [
    { identity: 'multi', occurrence: 7, candidates: [] }
  ];
  const produced = [
    { identity: 'multi', occurrence: 7, candidate: { id: 'cA', data: 'A' } },
    { identity: 'multi', occurrence: 7, candidate: { id: 'cB', data: 'B' } }
  ];
  const result = mergeCandidates(remediationFindings, produced);
  assert.deepEqual(result, [{ identity: "multi", occurrence: 7, candidates: [{ id: "cA", data: "A" }, { id: "cB", data: "B" }] }]);
});
