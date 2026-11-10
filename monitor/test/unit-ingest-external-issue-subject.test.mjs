// Canonical structured subject of an issue (monitor/ingest-external.mjs issueSubject).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueSubject } from '../ingest-external.mjs';

test('returns nulls when source is missing', () => {
  const r = issueSubject({ repo: 'r', title: 't', severity: 's', anchor: { hash: 'h' }, groupMembers: ['a', 'b'] });
  assert.deepEqual(r, { sourceKind: null, sourceKey: null, tool: null, rule: null, repo: "r", title: "t", severity: "s", anchorHash: "h", groupMembers: ["a", "b"] });
});

test('returns nulls when source is null', () => {
  const r = issueSubject({ source: null, repo: 'r', title: 't', severity: 's', anchor: { hash: 'h' }, groupMembers: ['a', 'b'] });
  assert.deepEqual(r, { sourceKind: null, sourceKey: null, tool: null, rule: null, repo: "r", title: "t", severity: "s", anchorHash: "h", groupMembers: ["a", "b"] });
});

test('returns nulls when source is undefined', () => {
  const r = issueSubject({ source: undefined, repo: 'r', title: 't', severity: 's', anchor: { hash: 'h' }, groupMembers: ['a', 'b'] });
  assert.deepEqual(r, { sourceKind: null, sourceKey: null, tool: null, rule: null, repo: "r", title: "t", severity: "s", anchorHash: "h", groupMembers: ["a", "b"] });
});

test('returns nulls when source is empty object', () => {
  const r = issueSubject({ source: {}, repo: 'r', title: 't', severity: 's', anchor: { hash: 'h' }, groupMembers: ['a', 'b'] });
  assert.deepEqual(r, { sourceKind: null, sourceKey: null, tool: null, rule: null, repo: "r", title: "t", severity: "s", anchorHash: "h", groupMembers: ["a", "b"] });
});

test('returns source fields when source has all keys', () => {
  const r = issueSubject({ source: { kind: 'k', key: 'key', tool: 'tool', rule: 'rule' }, repo: 'r', title: 't', severity: 's', anchor: { hash: 'h' }, groupMembers: ['b', 'a'] });
  assert.deepEqual(r, { sourceKind: "k", sourceKey: "key", tool: "tool", rule: "rule", repo: "r", title: "t", severity: "s", anchorHash: "h", groupMembers: ["a", "b"] });
});

test('returns null for anchor when anchor is missing', () => {
  const r = issueSubject({ source: { kind: 'k' }, repo: 'r', title: 't', severity: 's', groupMembers: ['a'] });
  assert.deepEqual(r, { sourceKind: "k", sourceKey: null, tool: null, rule: null, repo: "r", title: "t", severity: "s", anchorHash: null, groupMembers: ["a"] });
});

test('returns null for anchor when anchor is null', () => {
  const r = issueSubject({ source: { kind: 'k' }, repo: 'r', title: 't', severity: 's', anchor: null, groupMembers: ['a'] });
  assert.deepEqual(r, { sourceKind: "k", sourceKey: null, tool: null, rule: null, repo: "r", title: "t", severity: "s", anchorHash: null, groupMembers: ["a"] });
});

test('returns null for anchor when anchor has no hash', () => {
  const r = issueSubject({ source: { kind: 'k' }, repo: 'r', title: 't', severity: 's', anchor: {}, groupMembers: ['a'] });
  assert.deepEqual(r, { sourceKind: "k", sourceKey: null, tool: null, rule: null, repo: "r", title: "t", severity: "s", anchorHash: null, groupMembers: ["a"] });
});

test('returns null for groupMembers when not an array', () => {
  const r = issueSubject({ source: { kind: 'k' }, repo: 'r', title: 't', severity: 's', anchor: { hash: 'h' }, groupMembers: 'not-array' });
  assert.deepEqual(r, { sourceKind: "k", sourceKey: null, tool: null, rule: null, repo: "r", title: "t", severity: "s", anchorHash: "h", groupMembers: null });
});

test('returns sorted copy of groupMembers when array', () => {
  const r = issueSubject({ source: { kind: 'k' }, repo: 'r', title: 't', severity: 's', anchor: { hash: 'h' }, groupMembers: ['z', 'm', 'a'] });
  assert.deepEqual(r, { sourceKind: "k", sourceKey: null, tool: null, rule: null, repo: "r", title: "t", severity: "s", anchorHash: "h", groupMembers: ["a", "m", "z"] });
});
