// Re-grades a closed issue's verdict, preserving the original (monitor/issue-store.mjs regradeClosure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regradeClosure } from '../issue-store.mjs';

test('rejects a target that is not in the closed-as list', () => {
  const doc = { issues: { 'a-1': { state: 'closed', closedAs: 'fixed', evidence: [] } }, events: [] };
  assert.throws(() => regradeClosure(doc, 'a-1', { to: 'bogus', why: 'w', evidence: 'e', at: '2025-01-01T00:00:00Z' }), { name: 'Error', message: 'regrade target must be one of fixed|accepted|refuted|superseded' });
});

test('rejects a re-grade that carries no evidence', () => {
  const doc = { issues: { 'a-1': { state: 'closed', closedAs: 'fixed', evidence: [] } }, events: [] };
  assert.throws(() => regradeClosure(doc, 'a-1', { to: 'refuted', why: 'w', evidence: '', at: '2025-01-01T00:00:00Z' }), { name: 'Error', message: 'regrade requires evidence (a re-grade without it is an assertion, not a correction)' });
});

test('rejects a re-grade for an id that is not in the store', () => {
  const doc = { issues: {}, events: [] };
  assert.throws(() => regradeClosure(doc, 'missing', { to: 'refuted', why: 'w', evidence: 'e', at: '2025-01-01T00:00:00Z' }), { name: 'Error', message: 'unknown issue missing' });
});

test('rejects a re-grade when the issue is still open', () => {
  const doc = { issues: { 'a-1': { state: 'open', closedAs: null, evidence: [] } }, events: [] };
  assert.throws(() => regradeClosure(doc, 'a-1', { to: 'refuted', why: 'w', evidence: 'e', at: '2025-01-01T00:00:00Z' }), { name: 'Error', message: 'a-1 is not closed \u2014 re-grading applies to a verdict, and an open issue has none' });
});

test('rejects a re-grade whose target equals the current verdict', () => {
  const doc = { issues: { 'a-1': { state: 'closed', closedAs: 'fixed', evidence: [] } }, events: [] };
  assert.throws(() => regradeClosure(doc, 'a-1', { to: 'fixed', why: 'w', evidence: 'e', at: '2025-01-01T00:00:00Z' }), { name: 'Error', message: 'a-1 is already fixed \u2014 a re-grade must change the verdict' });
});

test('moves the verdict and records the original on a first re-grade', () => {
  const doc = { issues: { 'a-1': { state: 'closed', closedAs: 'fixed', evidence: [] } }, events: [] };
  const r = regradeClosure(doc, 'a-1', { to: 'refuted', why: 'moved', evidence: 'proof', at: '2025-01-01T00:00:00Z' });
  assert.deepEqual(r, { state: "closed", closedAs: "refuted", evidence: [], closedAsOriginal: "fixed", regradeCount: 1, updatedAt: "2025-01-01T00:00:00Z" });
});

test('increments the re-grade count on a second re-grade', () => {
  const doc = { issues: { 'a-1': { state: 'closed', closedAs: 'refuted', closedAsOriginal: 'fixed', regradeCount: 1, evidence: [] } }, events: [] };
  const r = regradeClosure(doc, 'a-1', { to: 'accepted', why: 'revisit', evidence: 'proof2', at: '2025-01-02T00:00:00Z' });
  assert.deepEqual(r, { state: "closed", closedAs: "accepted", closedAsOriginal: "fixed", regradeCount: 2, evidence: [], updatedAt: "2025-01-02T00:00:00Z" });
});

test('keeps the first original verdict when re-grading a second time', () => {
  const doc = { issues: { 'a-1': { state: 'closed', closedAs: 'refuted', closedAsOriginal: 'fixed', regradeCount: 1, evidence: [] } }, events: [] };
  const r = regradeClosure(doc, 'a-1', { to: 'superseded', why: 'again', evidence: 'proof3', at: '2025-01-03T00:00:00Z' });
  assert.deepEqual(r, { state: "closed", closedAs: "superseded", closedAsOriginal: "fixed", regradeCount: 2, evidence: [], updatedAt: "2025-01-03T00:00:00Z" });
});

test('stringifies a null why to an empty string in the event', () => {
  const doc = { issues: { 'a-1': { state: 'closed', closedAs: 'fixed', evidence: [] } }, events: [] };
  const r = regradeClosure(doc, 'a-1', { to: 'refuted', why: null, evidence: 'e', at: '2025-01-01T00:00:00Z' });
  assert.deepEqual(r, { state: "closed", closedAs: "refuted", evidence: [], closedAsOriginal: "fixed", regradeCount: 1, updatedAt: "2025-01-01T00:00:00Z" });
});

test('stringifies a provided why verbatim in the event', () => {
  const doc = { issues: { 'a-1': { state: 'closed', closedAs: 'fixed', evidence: [] } }, events: [] };
  const r = regradeClosure(doc, 'a-1', { to: 'refuted', why: 'real reason', evidence: 'e', at: '2025-01-01T00:00:00Z' });
  assert.deepEqual(r, { state: "closed", closedAs: "refuted", evidence: [], closedAsOriginal: "fixed", regradeCount: 1, updatedAt: "2025-01-01T00:00:00Z" });
});
