// clears snoozedUntil and records an unsnooze event (monitor/issue-store.mjs unsnoozeIssue).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unsnoozeIssue } from '../issue-store.mjs';

const AT = '2025-01-01T00:00:00Z';
const UNTIL = '2025-02-01T00:00:00Z';
const EARLIER = '2024-12-31T00:00:00Z';

const eventsOf = (doc) =>
  doc.events.map(({ type, issueId, at, data, prevHash }) => ({ type, issueId, at, data, prevHash }));

test('throws when the issue id is not present in the document', () => {
  const doc = { issues: {}, events: [] };
  assert.throws(() => unsnoozeIssue(doc, 'missing', { at: AT }), {
    name: 'Error',
    message: 'unknown issue missing',
  });
  assert.deepEqual(doc.events, []);
});

test('leaves an issue with no snoozedUntil property untouched and records no event', () => {
  const doc = { issues: { a: { id: 'a' } }, events: [] };
  const r = unsnoozeIssue(doc, 'a', { at: AT });
  assert.deepEqual(r, { id: 'a' });
  assert.deepEqual(doc.events, []);
});

test('keeps the earlier updatedAt and records no event when snoozedUntil is null', () => {
  const doc = { issues: { b: { id: 'b', snoozedUntil: null, updatedAt: EARLIER } }, events: [] };
  const r = unsnoozeIssue(doc, 'b', { at: AT });
  assert.deepEqual(r, { id: 'b', snoozedUntil: null, updatedAt: EARLIER });
  assert.deepEqual(doc.events, []);
});

test('leaves an empty string snoozedUntil as it is and records no event', () => {
  const doc = { issues: { c: { id: 'c', snoozedUntil: '' } }, events: [] };
  const r = unsnoozeIssue(doc, 'c', { at: AT });
  assert.deepEqual(r, { id: 'c', snoozedUntil: '' });
  assert.deepEqual(doc.events, []);
});

test('clears snoozedUntil, stamps updatedAt and appends one event for a snoozed issue', () => {
  const doc = { issues: { d: { id: 'd', snoozedUntil: UNTIL, updatedAt: EARLIER } }, events: [] };
  const r = unsnoozeIssue(doc, 'd', { at: AT });
  assert.equal(r, doc.issues.d);
  assert.deepEqual(r, { id: 'd', snoozedUntil: null, updatedAt: AT });
  assert.deepEqual(eventsOf(doc), [
    { type: 'issue-unsnoozed', issueId: 'd', at: AT, data: { reason: 'unsnoozed' }, prevHash: null },
  ]);
});

test('includes by in the event data when it is provided', () => {
  const doc = { issues: { e: { id: 'e', snoozedUntil: UNTIL } }, events: [] };
  const r = unsnoozeIssue(doc, 'e', { at: AT, by: 'alice' });
  assert.deepEqual(r, { id: 'e', snoozedUntil: null, updatedAt: AT });
  assert.deepEqual(eventsOf(doc), [
    { type: 'issue-unsnoozed', issueId: 'e', at: AT, data: { reason: 'unsnoozed', by: 'alice' }, prevHash: null },
  ]);
});

test('uses the provided reason in the event data', () => {
  const doc = { issues: { f: { id: 'f', snoozedUntil: UNTIL } }, events: [] };
  const r = unsnoozeIssue(doc, 'f', { at: AT, reason: 'done' });
  assert.deepEqual(r, { id: 'f', snoozedUntil: null, updatedAt: AT });
  assert.deepEqual(eventsOf(doc), [
    { type: 'issue-unsnoozed', issueId: 'f', at: AT, data: { reason: 'done' }, prevHash: null },
  ]);
});

test('omits by from the event data when by is an empty string', () => {
  const doc = { issues: { g: { id: 'g', snoozedUntil: UNTIL } }, events: [] };
  const r = unsnoozeIssue(doc, 'g', { at: AT, by: '' });
  assert.deepEqual(r, { id: 'g', snoozedUntil: null, updatedAt: AT });
  assert.deepEqual(eventsOf(doc), [
    { type: 'issue-unsnoozed', issueId: 'g', at: AT, data: { reason: 'unsnoozed' }, prevHash: null },
  ]);
});

test('links the new event to the hash of the last existing event', () => {
  const doc = { issues: { h: { id: 'h', snoozedUntil: UNTIL } }, events: [{ hash: 'h0' }] };
  unsnoozeIssue(doc, 'h', { at: AT });
  assert.equal(doc.events.length, 2);
  assert.deepEqual(eventsOf(doc)[1], {
    type: 'issue-unsnoozed',
    issueId: 'h',
    at: AT,
    data: { reason: 'unsnoozed' },
    prevHash: 'h0',
  });
});

test('a second unsnooze changes nothing and adds no further event', () => {
  const doc = { issues: { i: { id: 'i', snoozedUntil: UNTIL } }, events: [] };
  unsnoozeIssue(doc, 'i', { at: AT });
  const r = unsnoozeIssue(doc, 'i', { at: '2025-03-01T00:00:00Z' });
  assert.deepEqual(r, { id: 'i', snoozedUntil: null, updatedAt: AT });
  assert.equal(doc.events.length, 1);
});
