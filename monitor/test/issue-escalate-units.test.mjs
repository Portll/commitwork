// monitor/test/issue-escalate-units.test.mjs — case tests for alreadyPaged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { alreadyPaged } from '../issue-escalate.mjs';

test('returns false when events is empty', () => {
  const doc = { events: [] };
  assert.equal(alreadyPaged(doc, 'i1', '2026-01-01T00:00:00.000Z'), false);
});

test('returns true when a matching paged event exists', () => {
  const doc = {
    events: [
      { type: 'paged', issueId: 'i1', data: { slaDueAt: '2026-01-01T00:00:00.000Z' } },
    ],
  };
  assert.equal(alreadyPaged(doc, 'i1', '2026-01-01T00:00:00.000Z'), true);
});

test('returns false when issueId does not match', () => {
  const doc = {
    events: [
      { type: 'paged', issueId: 'i1', data: { slaDueAt: '2026-01-01T00:00:00.000Z' } },
    ],
  };
  assert.equal(alreadyPaged(doc, 'i2', '2026-01-01T00:00:00.000Z'), false);
});

test('returns false when slaDueAt does not match', () => {
  const doc = {
    events: [
      { type: 'paged', issueId: 'i1', data: { slaDueAt: '2026-01-01T00:00:00.000Z' } },
    ],
  };
  assert.equal(alreadyPaged(doc, 'i1', '2026-02-01T00:00:00.000Z'), false);
});

test('returns false when event type is not paged', () => {
  const doc = {
    events: [
      { type: 'created', issueId: 'i1', data: { slaDueAt: '2026-01-01T00:00:00.000Z' } },
    ],
  };
  assert.equal(alreadyPaged(doc, 'i1', '2026-01-01T00:00:00.000Z'), false);
});

test('returns true when multiple events exist and one matches', () => {
  const doc = {
    events: [
      { type: 'created', issueId: 'i1', data: { slaDueAt: '2026-01-01T00:00:00.000Z' } },
      { type: 'paged', issueId: 'i1', data: { slaDueAt: '2026-01-01T00:00:00.000Z' } },
      { type: 'closed', issueId: 'i1', data: {} },
    ],
  };
  assert.equal(alreadyPaged(doc, 'i1', '2026-01-01T00:00:00.000Z'), true);
});

test('returns false when data is undefined on a paged event', () => {
  const doc = {
    events: [
      { type: 'paged', issueId: 'i1' },
    ],
  };
  assert.equal(alreadyPaged(doc, 'i1', '2026-01-01T00:00:00.000Z'), false);
});
