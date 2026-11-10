// Determines if an issue has a matching paged event for its current SLA due date (monitor/issue-escalate.mjs projectEscalation).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectEscalation } from '../issue-escalate.mjs';

test('returns true when a matching paged event exists', () => {
  const iss = { id: 1, slaDueAt: '2023-01-01' };
  const events = [
    { type: 'paged', issueId: 1, data: { slaDueAt: '2023-01-01' }, at: 100 }
  ];
  const r = projectEscalation(iss, events);
  assert.equal(r, true);
});

test('returns false when no events are provided', () => {
  const iss = { id: 2, slaDueAt: '2023-02-02' };
  const events = [];
  const r = projectEscalation(iss, events);
  assert.equal(r, false);
});

test('returns false when event type does not match', () => {
  const iss = { id: 3, slaDueAt: '2023-03-03' };
  const events = [
    { type: 'comment', issueId: 3, data: { slaDueAt: '2023-03-03' }, at: 200 }
  ];
  const r = projectEscalation(iss, events);
  assert.equal(r, false);
});

test('returns false when issueId does not match', () => {
  const iss = { id: 4, slaDueAt: '2023-04-04' };
  const events = [
    { type: 'paged', issueId: 99, data: { slaDueAt: '2023-04-04' }, at: 300 }
  ];
  const r = projectEscalation(iss, events);
  assert.equal(r, false);
});

test('returns false when slaDueAt does not match', () => {
  const iss = { id: 5, slaDueAt: '2023-05-05' };
  const events = [
    { type: 'paged', issueId: 5, data: { slaDueAt: '2023-05-06' }, at: 400 }
  ];
  const r = projectEscalation(iss, events);
  assert.equal(r, false);
});

test('returns true when later matching event overrides earlier non\u2011matching one', () => {
  const iss = { id: 6, slaDueAt: '2023-06-06' };
  const events = [
    { type: 'comment', issueId: 6, data: { slaDueAt: '2023-06-06' }, at: 500 },
    { type: 'paged', issueId: 6, data: { slaDueAt: '2023-06-06' }, at: 600 }
  ];
  const r = projectEscalation(iss, events);
  assert.equal(r, true);
});
