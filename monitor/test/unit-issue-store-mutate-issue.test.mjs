// Applies a mutation to an issue, stamps updatedAt, and appends an event (monitor/issue-store.mjs mutateIssue).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mutateIssue } from '../issue-store.mjs';

test('throws when the issue id is not present in the document', () => {
  const doc = { issues: {}, events: [] };
  assert.throws(() => mutateIssue(doc, 'missing', () => {}, 'type', {}, '2024-01-01T00:00:00Z'), {
    name: 'Error',
    message: 'unknown issue missing'
  });
});

test('applies the mutation function to the issue and returns it', () => {
  const doc = { issues: { a: { id: 'a', status: 'open' } }, events: [] };
  const r = mutateIssue(doc, 'a', (iss) => { iss.status = 'closed'; }, 'status', {}, '2024-01-01T00:00:00Z');
  assert.deepEqual(r, { id: "a", status: "closed", updatedAt: "2024-01-01T00:00:00Z" });
});

test('sets updatedAt on the issue to the provided timestamp', () => {
  const doc = { issues: { b: { id: 'b' } }, events: [] };
  const r = mutateIssue(doc, 'b', () => {}, 'event', {}, '2024-06-15T12:30:45Z');
  assert.equal(r.updatedAt, "2024-06-15T12:30:45Z");
});

test('appends an event with the provided type and data to the document', () => {
  const doc = { issues: { c: { id: 'c' } }, events: [] };
  mutateIssue(doc, 'c', () => {}, 'lifecycle', { reason: 'done' }, '2024-02-02T00:00:00Z');
  assert.deepEqual(doc.events, [{ type: "lifecycle", issueId: "c", at: "2024-02-02T00:00:00Z", data: { reason: "done" }, prevHash: null, hash: "33de1d7e4c247210252367cf8fa4cc222b63dc271ec39cbb80862e834b720f82" }]);
});

test('uses an empty object for event data when data argument is undefined', () => {
  const doc = { issues: { d: { id: 'd' } }, events: [] };
  mutateIssue(doc, 'd', () => {}, 'note', undefined, '2024-03-03T00:00:00Z');
  assert.deepEqual(doc.events, [{ type: "note", issueId: "d", at: "2024-03-03T00:00:00Z", data: {}, prevHash: null, hash: "9499c935154df60aef5a3ed5bfbedf50cbe9f12a5091dc20b183a52dd6502c52" }]);
});

test('uses an empty object for event data when data argument is null', () => {
  const doc = { issues: { e: { id: 'e' } }, events: [] };
  mutateIssue(doc, 'e', () => {}, 'note', null, '2024-04-04T00:00:00Z');
  assert.deepEqual(doc.events, [{ type: "note", issueId: "e", at: "2024-04-04T00:00:00Z", data: {}, prevHash: null, hash: "d2d63cddb9927976b9eb5c923f0f76cb1d368f9c04f1342c0f18eb2b47821405" }]);
});

test('appends an event with the provided data object when data is truthy', () => {
  const doc = { issues: { f: { id: 'f' } }, events: [] };
  mutateIssue(doc, 'f', () => {}, 'assign', { user: 'alice' }, '2024-05-05T00:00:00Z');
  assert.deepEqual(doc.events, [{ type: "assign", issueId: "f", at: "2024-05-05T00:00:00Z", data: { user: "alice" }, prevHash: null, hash: "502239438280bd1a148d5ff875d5680509a010ea1bf9a1787d3f0fa3c489eaca" }]);
});

test('appends an event with an empty object when data is a falsy string', () => {
  const doc = { issues: { g: { id: 'g' } }, events: [] };
  mutateIssue(doc, 'g', () => {}, 'note', '', '2024-06-06T00:00:00Z');
  assert.deepEqual(doc.events, [{ type: "note", issueId: "g", at: "2024-06-06T00:00:00Z", data: {}, prevHash: null, hash: "a7a76cea884a4bf42936c7fc818cb5513247922bdb2971af808ddf47f8c71521" }]);
});

test('appends an event with an empty object when data is zero', () => {
  const doc = { issues: { h: { id: 'h' } }, events: [] };
  mutateIssue(doc, 'h', () => {}, 'note', 0, '2024-07-07T00:00:00Z');
  assert.deepEqual(doc.events, [{ type: "note", issueId: "h", at: "2024-07-07T00:00:00Z", data: {}, prevHash: null, hash: "d4638e4855a58c304d56809b1ede6e45b6e31c5eca865ad2f09f56f8b1e0d84d" }]);
});

test('appends an event with an empty object when data is false', () => {
  const doc = { issues: { i: { id: 'i' } }, events: [] };
  mutateIssue(doc, 'i', () => {}, 'note', false, '2024-08-08T00:00:00Z');
  assert.deepEqual(doc.events, [{ type: "note", issueId: "i", at: "2024-08-08T00:00:00Z", data: {}, prevHash: null, hash: "e64dd27d53e56d46e91c289c19e09b127abd707f0772989ee93b78e474711d4f" }]);
});
