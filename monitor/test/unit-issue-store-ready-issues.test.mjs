// Filters open, unblocked, unwaived issues by area and authority, then sorts by severity, SLA, and id (monitor/issue-store.mjs readyIssues).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readyIssues } from '../issue-store.mjs';

test('returns empty array when no issues are open', () => {
  const doc = { issues: { a: { id: 'a', state: 'closed', area: 'x', severity: 'low', slaDueAt: '2024-01-01T00:00:00Z', deps: { blockedBy: [] } } } };
  assert.deepEqual(readyIssues(doc, { now: '2024-01-01T00:00:00Z' }), []);
});

test('excludes issues that require authority when includeAuthority is false', () => {
  const doc = { issues: { a: { id: 'a', state: 'open', area: 'x', severity: 'low', slaDueAt: '2024-01-01T00:00:00Z', authorityRequired: true, deps: { blockedBy: [] } } } };
  assert.deepEqual(readyIssues(doc, { now: '2024-01-01T00:00:00Z' }), []);
});

test('includes issues that require authority when includeAuthority is true', () => {
  const doc = { issues: { a: { id: 'a', state: 'open', area: 'x', severity: 'low', slaDueAt: '2024-01-01T00:00:00Z', authorityRequired: true, deps: { blockedBy: [] } } } };
  assert.deepEqual(readyIssues(doc, { now: '2024-01-01T00:00:00Z', includeAuthority: true }), [{ id: "a", state: "open", area: "x", severity: "low", slaDueAt: "2024-01-01T00:00:00Z", authorityRequired: true, deps: { blockedBy: [] } }]);
});

test('excludes issues whose area does not match the filter', () => {
  const doc = { issues: { a: { id: 'a', state: 'open', area: 'y', severity: 'low', slaDueAt: '2024-01-01T00:00:00Z', deps: { blockedBy: [] } } } };
  assert.deepEqual(readyIssues(doc, { now: '2024-01-01T00:00:00Z', area: 'x' }), []);
});

test('includes issues whose area matches the filter', () => {
  const doc = { issues: { a: { id: 'a', state: 'open', area: 'x', severity: 'low', slaDueAt: '2024-01-01T00:00:00Z', deps: { blockedBy: [] } } } };
  assert.deepEqual(readyIssues(doc, { now: '2024-01-01T00:00:00Z', area: 'x' }), [{ id: "a", state: "open", area: "x", severity: "low", slaDueAt: "2024-01-01T00:00:00Z", deps: { blockedBy: [] } }]);
});

test('excludes issues with an active waiver', () => {
  const doc = { issues: { a: { id: 'a', state: 'open', area: 'x', severity: 'low', slaDueAt: '2024-01-01T00:00:00Z', waiver: { expiresAt: '2025-01-01T00:00:00Z' }, deps: { blockedBy: [] } } } };
  assert.deepEqual(readyIssues(doc, { now: '2024-01-01T00:00:00Z' }), []);
});

test('includes issues with an expired waiver', () => {
  const doc = { issues: { a: { id: 'a', state: 'open', area: 'x', severity: 'low', slaDueAt: '2024-01-01T00:00:00Z', waiver: { expiresAt: '2023-01-01T00:00:00Z' }, deps: { blockedBy: [] } } } };
  assert.deepEqual(readyIssues(doc, { now: '2024-01-01T00:00:00Z' }), [{ id: "a", state: "open", area: "x", severity: "low", slaDueAt: "2024-01-01T00:00:00Z", waiver: { expiresAt: "2023-01-01T00:00:00Z" }, deps: { blockedBy: [] } }]);
});

test('excludes issues blocked by an open dependency', () => {
  const doc = { issues: { a: { id: 'a', state: 'open', area: 'x', severity: 'low', slaDueAt: '2024-01-01T00:00:00Z', deps: { blockedBy: ['b'] } }, b: { id: 'b', state: 'open', area: 'x', severity: 'low', slaDueAt: '2024-01-01T00:00:00Z', deps: { blockedBy: [] } } } };
  assert.deepEqual(readyIssues(doc, { now: '2024-01-01T00:00:00Z' }), [{ id: "b", state: "open", area: "x", severity: "low", slaDueAt: "2024-01-01T00:00:00Z", deps: { blockedBy: [] } }]);
});

test('includes issues blocked only by closed dependencies', () => {
  const doc = { issues: { a: { id: 'a', state: 'open', area: 'x', severity: 'low', slaDueAt: '2024-01-01T00:00:00Z', deps: { blockedBy: ['b'] } }, b: { id: 'b', state: 'closed', area: 'x', severity: 'low', slaDueAt: '2024-01-01T00:00:00Z', deps: { blockedBy: [] } } } };
  assert.deepEqual(readyIssues(doc, { now: '2024-01-01T00:00:00Z' }), [{ id: "a", state: "open", area: "x", severity: "low", slaDueAt: "2024-01-01T00:00:00Z", deps: { blockedBy: ["b"] } }]);
});

test('sorts by severity rank, then SLA due date, then id', () => {
  const doc = { issues: {
    a: { id: 'a', state: 'open', area: 'x', severity: 'low', slaDueAt: '2024-01-02T00:00:00Z', deps: { blockedBy: [] } },
    b: { id: 'b', state: 'open', area: 'x', severity: 'high', slaDueAt: '2024-01-03T00:00:00Z', deps: { blockedBy: [] } },
    c: { id: 'c', state: 'open', area: 'x', severity: 'high', slaDueAt: '2024-01-01T00:00:00Z', deps: { blockedBy: [] } }
  } };
  assert.deepEqual(readyIssues(doc, { now: '2024-01-01T00:00:00Z' }), [{ id: "c", state: "open", area: "x", severity: "high", slaDueAt: "2024-01-01T00:00:00Z", deps: { blockedBy: [] } }, { id: "b", state: "open", area: "x", severity: "high", slaDueAt: "2024-01-03T00:00:00Z", deps: { blockedBy: [] } }, { id: "a", state: "open", area: "x", severity: "low", slaDueAt: "2024-01-02T00:00:00Z", deps: { blockedBy: [] } }]);
});
