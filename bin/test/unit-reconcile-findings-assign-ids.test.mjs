// Assigns stable ids to entries grouped by file and summary (bin/reconcile-findings.mjs assignIds).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignIds } from '../reconcile-findings.mjs';

test('assigns the base id to a single entry', () => {
  const input = [{ file: 'a.txt', summary: 's1', evidence: 'e1', remediation: 'r1', key: 'k1' }];
  const result = assignIds(input);
  assert.deepEqual(result, [{ file: "a.txt", summary: "s1", evidence: "e1", remediation: "r1", key: "k1", id: "q-af1d0866" }]);
});

test('assigns suffixed ids to entries with identical file and summary', () => {
  const input = [
    { file: 'a.txt', summary: 's1', evidence: 'e1', remediation: 'r1', key: 'k1' },
    { file: 'a.txt', summary: 's1', evidence: 'e2', remediation: 'r2', key: 'k2' }
  ];
  const result = assignIds(input);
  assert.deepEqual(result, [{ file: "a.txt", summary: "s1", evidence: "e1", remediation: "r1", key: "k1", id: "q-af1d0866" }, { file: "a.txt", summary: "s1", evidence: "e2", remediation: "r2", key: "k2", id: "q-af1d0866-2" }]);
});

test('assigns distinct base ids to entries with different summaries', () => {
  const input = [
    { file: 'a.txt', summary: 's1', evidence: 'e1', remediation: 'r1', key: 'k1' },
    { file: 'a.txt', summary: 's2', evidence: 'e2', remediation: 'r2', key: 'k2' }
  ];
  const result = assignIds(input);
  assert.deepEqual(result, [{ file: "a.txt", summary: "s1", evidence: "e1", remediation: "r1", key: "k1", id: "q-af1d0866" }, { file: "a.txt", summary: "s2", evidence: "e2", remediation: "r2", key: "k2", id: "q-9d3139e6" }]);
});

test('sorts group members by summary when summaries differ', () => {
  const input = [
    { file: 'a.txt', summary: 'b', evidence: 'e1', remediation: 'r1', key: 'k1' },
    { file: 'a.txt', summary: 'a', evidence: 'e2', remediation: 'r2', key: 'k2' }
  ];
  const result = assignIds(input);
  assert.deepEqual(result, [{ file: "a.txt", summary: "b", evidence: "e1", remediation: "r1", key: "k1", id: "q-790a65f2" }, { file: "a.txt", summary: "a", evidence: "e2", remediation: "r2", key: "k2", id: "q-2c18c095" }]);
});

test('sorts group members by evidence when summaries are equal', () => {
  const input = [
    { file: 'a.txt', summary: 's', evidence: 'z', remediation: 'r1', key: 'k1' },
    { file: 'a.txt', summary: 's', evidence: 'a', remediation: 'r2', key: 'k2' }
  ];
  const result = assignIds(input);
  assert.deepEqual(result, [{ file: "a.txt", summary: "s", evidence: "z", remediation: "r1", key: "k1", id: "q-2484278c-2" }, { file: "a.txt", summary: "s", evidence: "a", remediation: "r2", key: "k2", id: "q-2484278c" }]);
});

test('sorts group members by remediation when summary and evidence are equal', () => {
  const input = [
    { file: 'a.txt', summary: 's', evidence: 'e', remediation: 'z', key: 'k1' },
    { file: 'a.txt', summary: 's', evidence: 'e', remediation: 'a', key: 'k2' }
  ];
  const result = assignIds(input);
  assert.deepEqual(result, [{ file: "a.txt", summary: "s", evidence: "e", remediation: "z", key: "k1", id: "q-2484278c-2" }, { file: "a.txt", summary: "s", evidence: "e", remediation: "a", key: "k2", id: "q-2484278c" }]);
});

test('sorts group members by key when summary, evidence, and remediation are equal', () => {
  const input = [
    { file: 'a.txt', summary: 's', evidence: 'e', remediation: 'r', key: 'z' },
    { file: 'a.txt', summary: 's', evidence: 'e', remediation: 'r', key: 'a' }
  ];
  const result = assignIds(input);
  assert.deepEqual(result, [{ file: "a.txt", summary: "s", evidence: "e", remediation: "r", key: "z", id: "q-2484278c-2" }, { file: "a.txt", summary: "s", evidence: "e", remediation: "r", key: "a", id: "q-2484278c" }]);
});

test('handles entries with undefined summary and evidence', () => {
  const input = [
    { file: 'a.txt', summary: undefined, evidence: undefined, remediation: 'r1', key: 'k1' },
    { file: 'a.txt', summary: undefined, evidence: undefined, remediation: 'r2', key: 'k2' }
  ];
  const result = assignIds(input);
  assert.deepEqual(result, [{ file: "a.txt", summary: undefined, evidence: undefined, remediation: "r1", key: "k1", id: "q-10fbdce5" }, { file: "a.txt", summary: undefined, evidence: undefined, remediation: "r2", key: "k2", id: "q-10fbdce5-2" }]);
});
