// Groups scanner findings by lane and row identity into feed members (monitor/feed-groups.mjs feedGroupMembers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedGroupMembers } from '../feed-groups.mjs';

test('returns empty array when scannerFindings is null', () => {
  assert.deepEqual(feedGroupMembers(null, 'repoA\0laneX\0subjectY'), []);
});

test('returns empty array when scannerFindings is undefined', () => {
  assert.deepEqual(feedGroupMembers(undefined, 'repoA\0laneX\0subjectY'), []);
});

test('returns empty array when lane value is not an array', () => {
  const findings = { laneX: 'not-an-array' };
  assert.deepEqual(feedGroupMembers(findings, 'repoA\0laneX\0subjectY'), []);
});

test('returns empty array when row is null', () => {
  const findings = { laneX: [null] };
  assert.deepEqual(feedGroupMembers(findings, 'repoA\0laneX\0subjectY'), []);
});

test('returns empty array when row is a primitive string', () => {
  const findings = { laneX: ['just-a-string'] };
  assert.deepEqual(feedGroupMembers(findings, 'repoA\0laneX\0subjectY'), []);
});

test('returns empty array when row key does not match groupKey', () => {
  const row = { repo: 'repoA', rule: 'different' };
  const findings = { laneX: [row] };
  const key = 'repoA\0laneX\0different';
  assert.deepEqual(feedGroupMembers(findings, 'repoA\0laneX\0other'), []);
});

test('returns member with matching key and no annotation', () => {
  const row = { repo: 'repoA', rule: 'myRule' };
  const findings = { laneX: [row] };
  const key = 'repoA\0laneX\0myRule';
  assert.deepEqual(feedGroupMembers(findings, key), [{ lane: "laneX", subRowKey: "sc:repoA|laneX|myRule|", suppressed: false, sev: "unknown", row: { repo: "repoA", rule: "myRule" } }]);
});

test('returns member with suppressed annotation', () => {
  const row = { repo: 'repoA', rule: 'myRule', annotation: { action: 'accept' } };
  const findings = { laneX: [row] };
  const key = 'repoA\0laneX\0myRule';
  assert.deepEqual(feedGroupMembers(findings, key), [{ lane: "laneX", subRowKey: "sc:repoA|laneX|myRule|", suppressed: true, sev: "unknown", row: { repo: "repoA", rule: "myRule", annotation: { action: "accept" } } }]);
});

test('returns members from multiple lanes matching same groupKey', () => {
  const row1 = { repo: 'repoA', rule: 'shared' };
  const row2 = { repo: 'repoA', rule: 'shared' };
  const findings = { lane1: [row1], lane2: [row2] };
  const key1 = 'repoA\0lane1\0shared';
  const key2 = 'repoA\0lane2\0shared';
  assert.deepEqual(feedGroupMembers(findings, key1), [{ lane: "lane1", subRowKey: "sc:repoA|lane1|shared|", suppressed: false, sev: "unknown", row: { repo: "repoA", rule: "shared" } }]);
});

test('returns empty array when row is boolean false', () => {
  const findings = { laneX: [false] };
  assert.deepEqual(feedGroupMembers(findings, 'repoA\0laneX\0subjectY'), []);
});
