// Roster freshness, liveness, and single-session resolution (bin/session-roster.mjs assess).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assess } from '../session-roster.mjs';

test('a single live row resolves to that row as the answer', () => {
  const row = { id: 'a', ref: 'main', name: 's', pid: 1, tree: 't', at: '2024-01-01T00:00:00Z' };
  const r = assess([row], { live: new Set(['1']), self: 't', now: Date.parse('2024-01-01T00:00:00Z') });
  assert.deepEqual(r, { scored: [{ row: { id: "a", ref: "main", name: "s", pid: 1, tree: "t", at: "2024-01-01T00:00:00Z" }, verdict: "live", reasons: ["socket-live"] }], live: 1, unverifiable: 0, stale: 0, answer: { id: "a", ref: "main", name: "s", pid: 1, tree: "t", at: "2024-01-01T00:00:00Z" }, name: "s", ids: ["a"], refs: ["main"], verdict: "single", complete: true });
});

test('a dead socket row is stale and the answer is null', () => {
  const row = { id: 'a', ref: 'main', name: 's', pid: 1, tree: 't', at: '2024-01-01T00:00:00Z' };
  const r = assess([row], { live: new Set(['2']), self: 't', now: Date.parse('2024-01-01T00:00:00Z') });
  assert.deepEqual(r, { scored: [{ row: { id: "a", ref: "main", name: "s", pid: 1, tree: "t", at: "2024-01-01T00:00:00Z" }, verdict: "stale", reasons: ["socket-gone"] }], live: 0, unverifiable: 0, stale: 1, answer: null, name: "s", ids: ["a"], refs: ["main"], verdict: "single", complete: true });
});

test('a foreign tree row is stale and the answer is null', () => {
  const row = { id: 'a', ref: 'main', name: 's', pid: 1, tree: 'other', at: '2024-01-01T00:00:00Z' };
  const r = assess([row], { live: new Set(['1']), self: 't', now: Date.parse('2024-01-01T00:00:00Z') });
  assert.deepEqual(r, { scored: [{ row: { id: "a", ref: "main", name: "s", pid: 1, tree: "other", at: "2024-01-01T00:00:00Z" }, verdict: "live", reasons: ["socket-live", "foreign-tree"] }], live: 1, unverifiable: 0, stale: 0, answer: { id: "a", ref: "main", name: "s", pid: 1, tree: "other", at: "2024-01-01T00:00:00Z" }, name: "s", ids: ["a"], refs: ["main"], verdict: "single", complete: true });
});

test('an aged row without a pid is stale and the answer is null', () => {
  const row = { id: 'a', ref: 'main', name: 's', tree: 't', at: '2020-01-01T00:00:00Z' };
  const r = assess([row], { live: new Set(), self: 't', now: Date.parse('2024-01-01T00:00:00Z') });
  assert.deepEqual(r, { scored: [{ row: { id: "a", ref: "main", name: "s", tree: "t", at: "2020-01-01T00:00:00Z" }, verdict: "stale", reasons: ["aged"] }], live: 0, unverifiable: 0, stale: 1, answer: null, name: "s", ids: ["a"], refs: ["main"], verdict: "single", complete: true });
});

test('an undated row with no pid is unverifiable and the answer is null', () => {
  const row = { id: 'a', ref: 'main', name: 's', tree: 't' };
  const r = assess([row], { live: new Set(), self: 't', now: Date.parse('2024-01-01T00:00:00Z') });
  assert.deepEqual(r, { scored: [{ row: { id: "a", ref: "main", name: "s", tree: "t" }, verdict: "unverifiable", reasons: ["undated"] }], live: 0, unverifiable: 1, stale: 0, answer: null, name: "s", ids: ["a"], refs: ["main"], verdict: "single", complete: true });
});

test('two live rows with equal rank sort by descending at and the answer is null', () => {
  const a = { id: 'a', ref: 'main', name: 's', pid: 1, tree: 't', at: '2024-01-01T00:00:00Z' };
  const b = { id: 'b', ref: 'main', name: 's', pid: 2, tree: 't', at: '2024-01-02T00:00:00Z' };
  const r = assess([a, b], { live: new Set(['1', '2']), self: 't', now: Date.parse('2024-01-01T00:00:00Z') });
  assert.deepEqual(r, { scored: [{ row: { id: "b", ref: "main", name: "s", pid: 2, tree: "t", at: "2024-01-02T00:00:00Z" }, verdict: "live", reasons: ["socket-live"] }, { row: { id: "a", ref: "main", name: "s", pid: 1, tree: "t", at: "2024-01-01T00:00:00Z" }, verdict: "live", reasons: ["socket-live"] }], live: 2, unverifiable: 0, stale: 0, answer: null, name: "s", ids: ["a", "b"], refs: ["main"], verdict: "reused", complete: false });
});

test('two live rows with different ranks sort by rank and the answer is null', () => {
  const a = { id: 'a', ref: 'main', name: 's', pid: 1, tree: 't', at: '2024-01-01T00:00:00Z', via: 'observed' };
  const b = { id: 'b', ref: 'main', name: 's', pid: 2, tree: 't', at: '2024-01-02T00:00:00Z', via: 'peer-header' };
  const r = assess([a, b], { live: new Set(['1', '2']), self: 't', now: Date.parse('2024-01-01T00:00:00Z') });
  assert.deepEqual(r, { scored: [{ row: { id: "a", ref: "main", name: "s", pid: 1, tree: "t", at: "2024-01-01T00:00:00Z", via: "observed" }, verdict: "live", reasons: ["socket-live"] }, { row: { id: "b", ref: "main", name: "s", pid: 2, tree: "t", at: "2024-01-02T00:00:00Z", via: "peer-header" }, verdict: "live", reasons: ["socket-live"] }], live: 2, unverifiable: 0, stale: 0, answer: null, name: "s", ids: ["a", "b"], refs: ["main"], verdict: "reused", complete: false });
});

test('two rows with distinct ids are summarised as reused', () => {
  const a = { id: 'a', ref: 'main', name: 's', pid: 1, tree: 't', at: '2024-01-01T00:00:00Z' };
  const b = { id: 'b', ref: 'main', name: 's', pid: 2, tree: 't', at: '2024-01-02T00:00:00Z' };
  const r = assess([a, b], { live: new Set(['1', '2']), self: 't', now: Date.parse('2024-01-01T00:00:00Z') });
  assert.deepEqual(r, { scored: [{ row: { id: "b", ref: "main", name: "s", pid: 2, tree: "t", at: "2024-01-02T00:00:00Z" }, verdict: "live", reasons: ["socket-live"] }, { row: { id: "a", ref: "main", name: "s", pid: 1, tree: "t", at: "2024-01-01T00:00:00Z" }, verdict: "live", reasons: ["socket-live"] }], live: 2, unverifiable: 0, stale: 0, answer: null, name: "s", ids: ["a", "b"], refs: ["main"], verdict: "reused", complete: false });
});

test('two rows with distinct refs and no ids are summarised as ambiguous', () => {
  const a = { ref: 'main', name: 's', pid: 1, tree: 't', at: '2024-01-01T00:00:00Z' };
  const b = { ref: 'dev', name: 's', pid: 2, tree: 't', at: '2024-01-02T00:00:00Z' };
  const r = assess([a, b], { live: new Set(['1', '2']), self: 't', now: Date.parse('2024-01-01T00:00:00Z') });
  assert.deepEqual(r, { scored: [{ row: { ref: "dev", name: "s", pid: 2, tree: "t", at: "2024-01-02T00:00:00Z" }, verdict: "live", reasons: ["socket-live"] }, { row: { ref: "main", name: "s", pid: 1, tree: "t", at: "2024-01-01T00:00:00Z" }, verdict: "live", reasons: ["socket-live"] }], live: 2, unverifiable: 0, stale: 0, answer: null, name: "s", ids: [], refs: ["main", "dev"], verdict: "ambiguous", complete: false });
});

test('an empty roster returns zero counts and a null answer', () => {
  const r = assess([], { live: new Set(), self: 't', now: Date.parse('2024-01-01T00:00:00Z') });
  assert.deepEqual(r, { scored: [], live: 0, unverifiable: 0, stale: 0, answer: null, name: null, ids: [], refs: [], verdict: "single", complete: false });
});
