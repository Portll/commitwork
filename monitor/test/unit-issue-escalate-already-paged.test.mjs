// Determines if a document already contains a paged event for a given issue and SLA due date (monitor/issue-escalate.mjs alreadyPaged).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alreadyPaged } from '../issue-escalate.mjs';

test('returns true when an event matches type, issueId and slaDueAt', () => {
  const doc = {
    events: [
      { type: 'paged', issueId: 42, data: { slaDueAt: '2023-12-31T23:59:59Z' } },
      { type: 'other', issueId: 1, data: {} },
    ],
  };
  assert.equal(alreadyPaged(doc, 42, '2023-12-31T23:59:59Z'), true);
});

test('returns false when type matches but issueId differs', () => {
  const doc = {
    events: [
      { type: 'paged', issueId: 99, data: { slaDueAt: '2023-12-31T23:59:59Z' } },
    ],
  };
  assert.equal(alreadyPaged(doc, 42, '2023-12-31T23:59:59Z'), false);
});

test('returns false when type and issueId match but slaDueAt differs', () => {
  const doc = {
    events: [
      { type: 'paged', issueId: 42, data: { slaDueAt: '2024-01-01T00:00:00Z' } },
    ],
  };
  assert.equal(alreadyPaged(doc, 42, '2023-12-31T23:59:59Z'), false);
});

test('returns false when no event has the required type', () => {
  const doc = {
    events: [
      { type: 'other', issueId: 42, data: { slaDueAt: '2023-12-31T23:59:59Z' } },
    ],
  };
  assert.equal(alreadyPaged(doc, 42, '2023-12-31T23:59:59Z'), false);
});

test('returns false when matching event lacks data.slaDueAt', () => {
  const doc = {
    events: [
      { type: 'paged', issueId: 42, data: {} },
    ],
  };
  assert.equal(alreadyPaged(doc, 42, '2023-12-31T23:59:59Z'), false);
});

test('returns false when events array is empty', () => {
  const doc = { events: [] };
  assert.equal(alreadyPaged(doc, 42, '2023-12-31T23:59:59Z'), false);
});

test('throws TypeError when doc.events is undefined', () => {
  const doc = {};
  assert.throws(() => alreadyPaged(doc, 42, '2023-12-31T23:59:59Z'), { name: "TypeError", message: "Cannot read properties of undefined (reading 'some')" });
});
