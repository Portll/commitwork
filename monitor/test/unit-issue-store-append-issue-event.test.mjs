// computes a chained hash event and appends it to doc.events (monitor/issue-store.mjs appendIssueEvent).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendIssueEvent } from '../issue-store.mjs';

test('appends event with null prevHash when doc.events is empty', () => {
  const doc = { events: [] };
  const r = appendIssueEvent(doc, 'typeA', 'ISSUE-1', { foo: 'bar' }, '2023-01-01T00:00:00Z');
  assert.deepEqual(r, { type: "typeA", issueId: "ISSUE-1", at: "2023-01-01T00:00:00Z", data: { foo: "bar" }, prevHash: null, hash: "26d73d774541b37528b80195aa668e01ca121b32bbfbd2f1a77e3b55a6478b72" });
});

test('appends event with prevHash equal to last hash when doc.events has one entry', () => {
  const first = { type: 't', issueId: 'I1', at: 't', data: {}, prevHash: null, hash: 'hash1' };
  const doc = { events: [first] };
  const r = appendIssueEvent(doc, 'typeB', 'ISSUE-2', null, '2023-01-02T00:00:00Z');
  assert.deepEqual(r, { type: "typeB", issueId: "ISSUE-2", at: "2023-01-02T00:00:00Z", data: {}, prevHash: "hash1", hash: "c93636d2b42efafc4e51bd9e2eb3c2b2bfa4bfef34f4eb0fe4dd0f84d1e32fad" });
});

test('appends event with prevHash equal to last hash when doc.events has two entries', () => {
  const ev1 = { type: 't', issueId: 'I1', at: 't', data: {}, prevHash: null, hash: 'hash1' };
  const ev2 = { type: 't', issueId: 'I2', at: 't', data: {}, prevHash: 'hash1', hash: 'hash2' };
  const doc = { events: [ev1, ev2] };
  const r = appendIssueEvent(doc, 'typeC', 'ISSUE-3', { a: 1 }, '2023-01-03T00:00:00Z');
  assert.deepEqual(r, { type: "typeC", issueId: "ISSUE-3", at: "2023-01-03T00:00:00Z", data: { a: 1 }, prevHash: "hash2", hash: "a489dbeed2ac160841b033fa83043022b1c6b7e3fbc2fbe104dd6cd1988608bb" });
});

test('event data defaults to empty object when data argument is undefined', () => {
  const doc = { events: [] };
  const r = appendIssueEvent(doc, 'typeD', 'ISSUE-4', undefined, '2023-01-04T00:00:00Z');
  assert.deepEqual(r, { type: "typeD", issueId: "ISSUE-4", at: "2023-01-04T00:00:00Z", data: {}, prevHash: null, hash: "fcad1b2bed7b4696a4b207f2544f56e89fe0f0170fcbb5bd038ad015a3deaf54" });
});

test('event data preserves provided object when data argument is truthy', () => {
  const doc = { events: [] };
  const payload = { key: 'value' };
  const r = appendIssueEvent(doc, 'typeE', 'ISSUE-5', payload, '2023-01-05T00:00:00Z');
  assert.deepEqual(r, { type: "typeE", issueId: "ISSUE-5", at: "2023-01-05T00:00:00Z", data: { key: "value" }, prevHash: null, hash: "a8acb3f67a38b75f829475457a1dbbcaab521ed3646e2c749ced768d765a668b" });
});

test('throws TypeError when doc is null', () => {
  assert.throws(() => appendIssueEvent(null, 'typeF', 'ISSUE-6', {}, '2023-01-06T00:00:00Z'), { name: "TypeError", message: "Cannot read properties of null (reading 'events')" });
});

test('throws TypeError when doc.events is not an array', () => {
  const doc = { events: null };
  assert.throws(() => appendIssueEvent(doc, 'typeG', 'ISSUE-7', {}, '2023-01-07T00:00:00Z'), { name: "TypeError", message: "Cannot read properties of null (reading 'length')" });
});
