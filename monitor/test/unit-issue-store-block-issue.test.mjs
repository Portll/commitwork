// Sets an issue to blocked with a reason, clearing its claim (monitor/issue-store.mjs blockIssue).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockIssue } from '../issue-store.mjs';

test('throws when reason is empty string', () => {
  const doc = { issues: { 'a-1': { state: 'open' } }, events: [] };
  assert.throws(() => blockIssue(doc, 'a-1', { at: '2025-01-01T00:00:00Z', reason: '' }), {
    name: 'Error',
    message: 'blockIssue requires a reason',
  });
});

test('throws when reason is null', () => {
  const doc = { issues: { 'a-1': { state: 'open' } }, events: [] };
  assert.throws(() => blockIssue(doc, 'a-1', { at: '2025-01-01T00:00:00Z', reason: null }), {
    name: 'Error',
    message: 'blockIssue requires a reason',
  });
});

test('throws when reason is undefined', () => {
  const doc = { issues: { 'a-1': { state: 'open' } }, events: [] };
  assert.throws(() => blockIssue(doc, 'a-1', { at: '2025-01-01T00:00:00Z' }), {
    name: 'Error',
    message: 'blockIssue requires a reason',
  });
});

test('throws when issue id is not in doc', () => {
  const doc = { issues: {}, events: [] };
  assert.throws(() => blockIssue(doc, 'missing', { at: '2025-01-01T00:00:00Z', reason: 'dep' }), {
    name: 'Error',
    message: 'unknown issue missing',
  });
});

test('throws when issue is closed', () => {
  const doc = { issues: { 'a-1': { state: 'closed' } }, events: [] };
  assert.throws(() => blockIssue(doc, 'a-1', { at: '2025-01-01T00:00:00Z', reason: 'dep' }), {
    name: 'Error',
    message: 'a-1 is closed',
  });
});

test('throws when issue is unsatisfiable', () => {
  const doc = { issues: { 'a-1': { state: 'unsatisfiable' } }, events: [] };
  assert.throws(() => blockIssue(doc, 'a-1', { at: '2025-01-01T00:00:00Z', reason: 'dep' }), {
    name: 'Error',
    message: 'a-1 is unsatisfiable \u2014 reopen it before blocking it',
  });
});

test('blocks an open issue and returns the mutated issue', () => {
  const doc = { issues: { 'a-1': { state: 'open', claim: { by: 'x' } } }, events: [] };
  const r = blockIssue(doc, 'a-1', { at: '2025-01-01T00:00:00Z', reason: 'dep' });
  assert.deepEqual(r, { state: "blocked", claim: null, blockedReason: "dep", updatedAt: "2025-01-01T00:00:00Z" });
});

test('blocks a blocked issue and returns the mutated issue', () => {
  const doc = { issues: { 'a-1': { state: 'blocked', claim: null } }, events: [] };
  const r = blockIssue(doc, 'a-1', { at: '2025-01-01T00:00:00Z', reason: 'dep' });
  assert.deepEqual(r, { state: "blocked", claim: null, blockedReason: "dep", updatedAt: "2025-01-01T00:00:00Z" });
});
