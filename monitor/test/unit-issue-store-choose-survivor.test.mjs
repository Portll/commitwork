// Survivor election: live beats closed, then oldest createdAt, then most evidence, then smallest id (monitor/issue-store.mjs chooseSurvivor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseSurvivor } from '../issue-store.mjs';

test('returns null when members is null', () => {
  const r = chooseSurvivor(null);
  assert.equal(r, null);
});

test('returns null when members is an empty array', () => {
  const r = chooseSurvivor([]);
  assert.equal(r, null);
});

test('returns null when all members are falsy', () => {
  const r = chooseSurvivor([null, undefined, false]);
  assert.equal(r, null);
});

test('prefers live issues over closed ones', () => {
  const closed = { id: 'a', state: 'closed', createdAt: '2024-01-01T00:00:00Z', evidence: [] };
  const live = { id: 'b', state: 'open', createdAt: '2024-01-02T00:00:00Z', evidence: [] };
  const r = chooseSurvivor([closed, live]);
  assert.deepStrictEqual(r, { id: "b", state: "open", createdAt: "2024-01-02T00:00:00Z", evidence: [] });
});

test('falls back to closed pool when no live issues exist', () => {
  const c1 = { id: 'x', state: 'closed', createdAt: '2024-01-01T00:00:00Z', evidence: [] };
  const c2 = { id: 'y', state: 'closed', createdAt: '2024-01-02T00:00:00Z', evidence: [] };
  const r = chooseSurvivor([c1, c2]);
  assert.deepStrictEqual(r, { id: "x", state: "closed", createdAt: "2024-01-01T00:00:00Z", evidence: [] });
});

test('breaks createdAt tie by most evidence', () => {
  const a = { id: 'a', state: 'open', createdAt: '2024-01-01T00:00:00Z', evidence: ['e1', 'e2'] };
  const b = { id: 'b', state: 'open', createdAt: '2024-01-01T00:00:00Z', evidence: ['e1'] };
  const r = chooseSurvivor([a, b]);
  assert.deepStrictEqual(r, { id: "a", state: "open", createdAt: "2024-01-01T00:00:00Z", evidence: ["e1", "e2"] });
});

test('breaks createdAt and evidence tie by smallest id', () => {
  const a = { id: 'z', state: 'open', createdAt: '2024-01-01T00:00:00Z', evidence: ['e1'] };
  const b = { id: 'a', state: 'open', createdAt: '2024-01-01T00:00:00Z', evidence: ['e1'] };
  const r = chooseSurvivor([a, b]);
  assert.deepStrictEqual(r, { id: "a", state: "open", createdAt: "2024-01-01T00:00:00Z", evidence: ["e1"] });
});

test('treats missing evidence as zero length in comparison', () => {
  const a = { id: 'a', state: 'open', createdAt: '2024-01-01T00:00:00Z' };
  const b = { id: 'b', state: 'open', createdAt: '2024-01-01T00:00:00Z', evidence: ['e1'] };
  const r = chooseSurvivor([a, b]);
  assert.deepStrictEqual(r, { id: "b", state: "open", createdAt: "2024-01-01T00:00:00Z", evidence: ["e1"] });
});

test('treats missing createdAt as empty string in comparison', () => {
  const a = { id: 'a', state: 'open', evidence: [] };
  const b = { id: 'b', state: 'open', createdAt: '2024-01-01T00:00:00Z', evidence: [] };
  const r = chooseSurvivor([a, b]);
  assert.deepStrictEqual(r, { id: "a", state: "open", evidence: [] });
});

test('returns single member when only one is provided', () => {
  const only = { id: 'solo', state: 'open', createdAt: '2024-06-15T12:00:00Z', evidence: ['x'] };
  const r = chooseSurvivor([only]);
  assert.deepStrictEqual(r, { id: "solo", state: "open", createdAt: "2024-06-15T12:00:00Z", evidence: ["x"] });
});
