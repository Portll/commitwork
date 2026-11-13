// builds a remediation object from repository data (lib/remediation-contract.mjs buildRemediation)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRemediation } from '../remediation-contract.mjs';

test('returns empty arrays when no findings, undetermined, or notMeasured are provided', () => {
  const input = {
    repository: { url: 'git@example.com/repo.git' },
    commit: 'abc123',
    generatedAt: '2024-01-01T00:00:00Z',
    toolVersion: '1.0.0',
  };
  const result = buildRemediation(input);
  assert.deepEqual(result, { schema: "commitwork.remediation/1", generatedAt: "2024-01-01T00:00:00Z", tool: { name: "commitwork", version: "1.0.0" }, repository: { url: "git@example.com/repo.git" }, commit: "abc123", findings: [], undetermined: [], notMeasured: [] });
});

test('sorts findings by identity then occurrence, handling equal and different values', () => {
  const input = {
    repository: { url: 'git@example.com/repo.git' },
    generatedAt: '2024-01-01T00:00:00Z',
    toolVersion: '1.0.0',
    findings: [
      { identity: 'idB', occurrence: 2, ruleId: 'R1', lane: 'L1', severity: 'high' },
      { identity: 'idA', occurrence: 5, ruleId: 'R2', lane: 'L2', severity: 'low' },
      { identity: 'idA', occurrence: 3, ruleId: 'R3', lane: 'L3', severity: 'medium' },
    ],
  };
  const result = buildRemediation(input);
  assert.deepEqual(result, { schema: "commitwork.remediation/1", generatedAt: "2024-01-01T00:00:00Z", tool: { name: "commitwork", version: "1.0.0" }, repository: { url: "git@example.com/repo.git" }, commit: null, findings: [{ identity: "idA", occurrence: 3, ruleId: "R3", lane: "L3", file: null, severity: "medium", candidates: [], actions: [] }, { identity: "idA", occurrence: 5, ruleId: "R2", lane: "L2", file: null, severity: "low", candidates: [], actions: [] }, { identity: "idB", occurrence: 2, ruleId: "R1", lane: "L1", file: null, severity: "high", candidates: [], actions: [] }], undetermined: [], notMeasured: [] });
});

test('undetermined sorting uses identity, then ruleId, then lane when those differ', () => {
  const input = {
    repository: { url: 'git@example.com/repo.git' },
    generatedAt: '2024-01-01T00:00:00Z',
    toolVersion: '1.0.0',
    undetermined: [
      { identity: 'id2', ruleId: 'R1', lane: 'L2', claimedSeverity: 'low', reason: 'r1' },
      { identity: 'id1', ruleId: 'R2', lane: 'L1', claimedSeverity: 'high', reason: 'r2' },
      { identity: 'id1', ruleId: 'R1', lane: 'L3', claimedSeverity: 'medium', reason: 'r3' },
    ],
  };
  const result = buildRemediation(input);
  assert.deepEqual(result, { schema: "commitwork.remediation/1", generatedAt: "2024-01-01T00:00:00Z", tool: { name: "commitwork", version: "1.0.0" }, repository: { url: "git@example.com/repo.git" }, commit: null, findings: [], undetermined: [{ identity: "id1", ruleId: "R1", lane: "L3", claimedSeverity: "medium", reason: "r3" }, { identity: "id1", ruleId: "R2", lane: "L1", claimedSeverity: "high", reason: "r2" }, { identity: "id2", ruleId: "R1", lane: "L2", claimedSeverity: "low", reason: "r1" }], notMeasured: [] });
});

test('undetermined sorting falls through to claimedSeverity when identity, ruleId, and lane are equal', () => {
  const input = {
    repository: { url: 'git@example.com/repo.git' },
    generatedAt: '2024-01-01T00:00:00Z',
    toolVersion: '1.0.0',
    undetermined: [
      { identity: 'same', ruleId: 'same', lane: 'same', claimedSeverity: 'low', reason: 'a' },
      { identity: 'same', ruleId: 'same', lane: 'same', claimedSeverity: 'high', reason: 'b' },
    ],
  };
  const result = buildRemediation(input);
  assert.deepEqual(result, { schema: "commitwork.remediation/1", generatedAt: "2024-01-01T00:00:00Z", tool: { name: "commitwork", version: "1.0.0" }, repository: { url: "git@example.com/repo.git" }, commit: null, findings: [], undetermined: [{ identity: "same", ruleId: "same", lane: "same", claimedSeverity: "high", reason: "b" }, { identity: "same", ruleId: "same", lane: "same", claimedSeverity: "low", reason: "a" }], notMeasured: [] });
});

test('undetermined sorting finally uses reason when claimedSeverity also equal', () => {
  const input = {
    repository: { url: 'git@example.com/repo.git' },
    generatedAt: '2024-01-01T00:00:00Z',
    toolVersion: '1.0.0',
    undetermined: [
      { identity: 'same', ruleId: 'same', lane: 'same', claimedSeverity: 'same', reason: 'z' },
      { identity: 'same', ruleId: 'same', lane: 'same', claimedSeverity: 'same', reason: 'a' },
    ],
  };
  const result = buildRemediation(input);
  assert.deepEqual(result, { schema: "commitwork.remediation/1", generatedAt: "2024-01-01T00:00:00Z", tool: { name: "commitwork", version: "1.0.0" }, repository: { url: "git@example.com/repo.git" }, commit: null, findings: [], undetermined: [{ identity: "same", ruleId: "same", lane: "same", claimedSeverity: "same", reason: "a" }, { identity: "same", ruleId: "same", lane: "same", claimedSeverity: "same", reason: "z" }], notMeasured: [] });
});

test('notMeasured sorting uses lane then reason, testing both comparison directions', () => {
  const input = {
    repository: { url: 'git@example.com/repo.git' },
    generatedAt: '2024-01-01T00:00:00Z',
    toolVersion: '1.0.0',
    notMeasured: [
      { lane: 'b', reason: 'second' },
      { lane: 'a', reason: 'first' },
      { lane: 'a', reason: 'second' },
    ],
  };
  const result = buildRemediation(input);
  assert.deepEqual(result, { schema: "commitwork.remediation/1", generatedAt: "2024-01-01T00:00:00Z", tool: { name: "commitwork", version: "1.0.0" }, repository: { url: "git@example.com/repo.git" }, commit: null, findings: [], undetermined: [], notMeasured: [{ lane: "a", reason: "first" }, { lane: "a", reason: "second" }, { lane: "b", reason: "second" }] });
});

test('candidate verification witness lanes are sorted alphabetically', () => {
  const input = {
    repository: { url: 'git@example.com/repo.git' },
    generatedAt: '2024-01-01T00:00:00Z',
    toolVersion: '1.0.0',
    findings: [
      {
        identity: 'id',
        occurrence: 1,
        ruleId: 'R',
        lane: 'L',
        severity: 'high',
        candidates: [
          {
            tier: 'high',
            verification: {
              status: 'passed',
              witness: {
                lanes: ['z', 'a', 'm'],
                before: 'old',
                after: 'new',
                digest: 'abc',
              },
            },
          },
        ],
      },
    ],
  };
  const result = buildRemediation(input);
  assert.deepEqual(result, { schema: "commitwork.remediation/1", generatedAt: "2024-01-01T00:00:00Z", tool: { name: "commitwork", version: "1.0.0" }, repository: { url: "git@example.com/repo.git" }, commit: null, findings: [{ identity: "id", occurrence: 1, ruleId: "R", lane: "L", file: null, severity: "high", candidates: [{ id: "3327d2169b784411", tier: "high", provenance: undefined, patch: null, cached: undefined, verification: { status: "passed", witness: { lanes: ["a", "m", "z"], before: "old", after: "new", digest: "abc" }, newFindings: [], tests: undefined, reason: undefined } }], actions: [] }], undetermined: [], notMeasured: [] });
});
