// Open, untouched, past-due issues not yet paged (monitor/issue-escalate.mjs overdueUnpaged).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overdueUnpaged } from '../issue-escalate.mjs';
import { createHash } from 'node:crypto';

const DUE = '2000-01-01T00:00:00.000Z';
const AT = '2000-01-02T00:00:00.000Z';
const refOf = (id) => createHash('sha256').update(`issue-page|${id}`).digest('hex').slice(0, 16);
const issue = (id, over = {}) => ({ id, state: 'open', slaDueAt: DUE, severity: 'high', ...over });
const docOf = (iss, events = []) => ({ issues: { [`key-${iss.id}`]: iss }, events });
const row = (id, overdueByDays, over = {}) => ({
  issueId: id,
  slaDueAt: DUE,
  severity: 'high',
  overdueByDays,
  ref: refOf(id),
  ...over,
});

test('a doc with null, missing or empty issues yields an empty list', () => {
  assert.deepEqual(overdueUnpaged({ issues: null }, AT), []);
  assert.deepEqual(overdueUnpaged({}, AT), []);
  assert.deepEqual(overdueUnpaged({ issues: {}, events: [] }, AT), []);
});

test('an open untouched issue past due is reported with overdue days rounded to one decimal', () => {
  const doc = docOf(issue('i1', { claim: null, attemptCount: 0 }));
  assert.deepEqual(overdueUnpaged(doc, '2000-01-02T06:14:24.000Z'), [row('i1', 1.3)]);
  assert.deepEqual(overdueUnpaged(doc, '2000-01-02T12:00:00.000Z'), [row('i1', 1.5)]);
});

test('one millisecond past due is overdue, while exactly due, one millisecond early and an invalid time are not', () => {
  const doc = docOf(issue('i1'));
  assert.deepEqual(overdueUnpaged(doc, '2000-01-01T00:00:00.001Z'), [row('i1', 0)]);
  assert.deepEqual(overdueUnpaged(doc, DUE), []);
  assert.deepEqual(overdueUnpaged(doc, '1999-12-31T23:59:59.999Z'), []);
  assert.deepEqual(overdueUnpaged(doc, 'not-a-time'), []);
});

test('an issue in any state other than open is left out', () => {
  for (const state of ['claimed', 'blocked', 'closed']) {
    assert.deepEqual(overdueUnpaged(docOf(issue('i1', { state })), AT), []);
  }
});

test('an issue holding a claim is left out even with no attempts, and a null claim is reported', () => {
  const claim = { by: 'agent-1', expiresAt: '1999-01-01T00:00:00.000Z' };
  assert.deepEqual(overdueUnpaged(docOf(issue('i1', { claim, attemptCount: 0 })), AT), []);
  assert.deepEqual(overdueUnpaged(docOf(issue('i1', { claim: null })), AT), [row('i1', 1)]);
});

test('an issue with one or more attempts is left out, and zero or missing attempts are reported', () => {
  assert.deepEqual(overdueUnpaged(docOf(issue('i1', { attemptCount: 1 })), AT), []);
  assert.deepEqual(overdueUnpaged(docOf(issue('i1', { attemptCount: 2 })), AT), []);
  assert.deepEqual(overdueUnpaged(docOf(issue('i1', { attemptCount: 0 })), AT), [row('i1', 1)]);
  assert.deepEqual(overdueUnpaged(docOf(issue('i1')), AT), [row('i1', 1)]);
});

test('a due value that is not a string or does not parse is left out', () => {
  for (const slaDueAt of [12345, null, undefined, 'not-a-date', '']) {
    assert.deepEqual(overdueUnpaged(docOf(issue('i1', { slaDueAt })), AT), []);
  }
});

test('an issue already paged for the same due value is left out', () => {
  const events = [{ type: 'paged', issueId: 'i1', data: { slaDueAt: DUE } }];
  assert.deepEqual(overdueUnpaged(docOf(issue('i1'), events), AT), []);
});

test('events for another due value, issue or type, or without data, do not suppress the issue', () => {
  const events = [
    { type: 'paged', issueId: 'i1', data: { slaDueAt: '1999-01-01T00:00:00.000Z' } },
    { type: 'paged', issueId: 'i2', data: { slaDueAt: DUE } },
    { type: 'claimed', issueId: 'i1', data: { slaDueAt: DUE } },
    { type: 'paged', issueId: 'i1' },
  ];
  assert.deepEqual(overdueUnpaged(docOf(issue('i1'), events), AT), [row('i1', 1)]);
});

test('reported issues are sorted by issueId regardless of insertion order', () => {
  const older = '1999-12-31T00:00:00.000Z';
  const doc = {
    issues: {
      z: issue('b', { severity: 'low' }),
      y: issue('a', { slaDueAt: older }),
      x: issue('c', { state: 'closed' }),
    },
    events: [],
  };
  assert.deepEqual(overdueUnpaged(doc, AT), [
    row('a', 2, { slaDueAt: older }),
    row('b', 1, { severity: 'low' }),
  ]);
});
