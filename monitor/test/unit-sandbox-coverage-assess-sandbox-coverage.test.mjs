// Computes a coverage summary of sandbox isolation and repo-code execution per check (monitor/sandbox-coverage.mjs assessSandboxCoverage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessSandboxCoverage } from '../sandbox-coverage.mjs';

test('normalizes non-string isolation to unrecorded', () => {
  const rows = [{ repo: 'a', check: 'c1', isolation: 123 }];
  const flags = { declared: 0, byCheck: new Map() };
  const r = assessSandboxCoverage(rows, flags);
  assert.deepEqual(r, { lanes: 1, byIsolation: { unrecorded: 1 }, matrix: { "unrecorded/repo-code-unknown": 1 }, unconfined: [], unconfinedReasons: {}, repoCodeUnknown: 1, isolationUnrecorded: 1, repoCodeDeclared: 0 });
});

test('preserves string isolation and handles empty string', () => {
  const rows = [
    { repo: 'a', check: 'c1', isolation: 'none' },
    { repo: 'b', check: 'c2', isolation: '' }
  ];
  const flags = { declared: 0, byCheck: new Map() };
  const r = assessSandboxCoverage(rows, flags);
  assert.deepEqual(r, { lanes: 2, byIsolation: { none: 1, unrecorded: 1 }, matrix: { "none/repo-code-unknown": 1, "unrecorded/repo-code-unknown": 1 }, unconfined: [], unconfinedReasons: {}, repoCodeUnknown: 2, isolationUnrecorded: 1, repoCodeDeclared: 0 });
});

test('known check with declared flag sets repoCode based on map value', () => {
  const rows = [
    { repo: 'a', check: 'c1', isolation: 'none' },
    { repo: 'b', check: 'c2', isolation: 'none' }
  ];
  const flags = { declared: 2, byCheck: new Map([['c1', true], ['c2', false]]) };
  const r = assessSandboxCoverage(rows, flags);
  assert.deepEqual(r, { lanes: 2, byIsolation: { none: 2 }, matrix: { "none/no-repo-code": 1, "none/repo-code": 1 }, unconfined: [{ repo: "a", check: "c1", isolationReason: null }], unconfinedReasons: { "(no reason recorded)": 1 }, repoCodeUnknown: 0, isolationUnrecorded: 0, repoCodeDeclared: 2 });
});

test('declared zero makes known false even if check is in map', () => {
  const rows = [{ repo: 'a', check: 'c1', isolation: 'none' }];
  const flags = { declared: 0, byCheck: new Map([['c1', true]]) };
  const r = assessSandboxCoverage(rows, flags);
  assert.deepEqual(r, { lanes: 1, byIsolation: { none: 1 }, matrix: { "none/repo-code-unknown": 1 }, unconfined: [], unconfinedReasons: {}, repoCodeUnknown: 1, isolationUnrecorded: 0, repoCodeDeclared: 0 });
});

test('normalizes non-string isolationReason to null', () => {
  const rows = [
    { repo: 'a', check: 'c1', isolation: 'none', isolationReason: 42 },
    { repo: 'b', check: 'c2', isolation: 'none', isolationReason: 'because' }
  ];
  const flags = { declared: 2, byCheck: new Map([['c1', true], ['c2', true]]) };
  const r = assessSandboxCoverage(rows, flags);
  assert.deepEqual(r, { lanes: 2, byIsolation: { none: 2 }, matrix: { "none/repo-code": 2 }, unconfined: [{ repo: "a", check: "c1", isolationReason: null }, { repo: "b", check: "c2", isolationReason: "because" }], unconfinedReasons: { "(no reason recorded)": 1, because: 1 }, repoCodeUnknown: 0, isolationUnrecorded: 0, repoCodeDeclared: 2 });
});

test('sorts by repo then check with null repos', () => {
  const rows = [
    { repo: 'z', check: 'a', isolation: 'none' },
    { repo: null, check: 'b', isolation: 'none' },
    { repo: 'a', check: 'z', isolation: 'none' },
    { repo: 'a', check: 'a', isolation: 'none' }
  ];
  const flags = { declared: 0, byCheck: new Map() };
  const r = assessSandboxCoverage(rows, flags);
  assert.deepEqual(r, { lanes: 4, byIsolation: { none: 4 }, matrix: { "none/repo-code-unknown": 4 }, unconfined: [], unconfinedReasons: {}, repoCodeUnknown: 4, isolationUnrecorded: 0, repoCodeDeclared: 0 });
});

test('filters unconfined to repoCode true and isolation none', () => {
  const rows = [
    { repo: 'a', check: 'c1', isolation: 'none' },
    { repo: 'b', check: 'c2', isolation: 'sandbox' },
    { repo: 'c', check: 'c3', isolation: 'none' }
  ];
  const flags = { declared: 3, byCheck: new Map([['c1', true], ['c2', true], ['c3', false]]) };
  const r = assessSandboxCoverage(rows, flags);
  assert.deepEqual(r, { lanes: 3, byIsolation: { none: 2, sandbox: 1 }, matrix: { "none/no-repo-code": 1, "none/repo-code": 1, "sandbox/repo-code": 1 }, unconfined: [{ repo: "a", check: "c1", isolationReason: null }], unconfinedReasons: { "(no reason recorded)": 1 }, repoCodeUnknown: 0, isolationUnrecorded: 0, repoCodeDeclared: 3 });
});

test('tallies repoCodeUnknown and isolationUnrecorded counts', () => {
  const rows = [
    { repo: 'a', check: 'c1', isolation: 'none' },
    { repo: 'b', check: 'c2' },
    { repo: 'c', check: 'c3', isolation: 'sandbox' }
  ];
  const flags = { declared: 1, byCheck: new Map([['c1', true]]) };
  const r = assessSandboxCoverage(rows, flags);
  assert.deepEqual(r, { lanes: 3, byIsolation: { none: 1, sandbox: 1, unrecorded: 1 }, matrix: { "none/repo-code": 1, "sandbox/repo-code-unknown": 1, "unrecorded/repo-code-unknown": 1 }, unconfined: [{ repo: "a", check: "c1", isolationReason: null }], unconfinedReasons: { "(no reason recorded)": 1 }, repoCodeUnknown: 2, isolationUnrecorded: 1, repoCodeDeclared: 1 });
});

test('builds matrix keys for all repoCode states', () => {
  const rows = [
    { repo: 'a', check: 'c1', isolation: 'none' },
    { repo: 'b', check: 'c2', isolation: 'sandbox' },
    { repo: 'c', check: 'c3', isolation: 'none' }
  ];
  const flags = { declared: 3, byCheck: new Map([['c1', true], ['c2', false], ['c3', 'weird']]) };
  const r = assessSandboxCoverage(rows, flags);
  assert.deepEqual(r, { lanes: 3, byIsolation: { none: 2, sandbox: 1 }, matrix: { "none/no-repo-code": 1, "none/repo-code": 1, "sandbox/no-repo-code": 1 }, unconfined: [{ repo: "a", check: "c1", isolationReason: null }], unconfinedReasons: { "(no reason recorded)": 1 }, repoCodeUnknown: 0, isolationUnrecorded: 0, repoCodeDeclared: 3 });
});

test('handles empty rows array', () => {
  const rows = [];
  const flags = { declared: 0, byCheck: new Map() };
  const r = assessSandboxCoverage(rows, flags);
  assert.deepEqual(r, { lanes: 0, byIsolation: {}, matrix: {}, unconfined: [], unconfinedReasons: {}, repoCodeUnknown: 0, isolationUnrecorded: 0, repoCodeDeclared: 0 });
});
