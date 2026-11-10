// Parses JSON text and validates release evidence structure (bin/release-report.mjs parseEvidence).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEvidence } from '../release-report.mjs';

test('returns error when input is not valid JSON', () => {
  const result = parseEvidence('not json');
  assert.deepEqual(result, { errors: ["input: not JSON (Unexpected token 'o', \"not json\" is not valid JSON)"] });
});

test('returns error when generated_at is missing', () => {
  const input = JSON.stringify({ events: [], releases: [] });
  const result = parseEvidence(input);
  assert.deepEqual(result, { errors: ["input: (root): required key 'schema' is missing", "input: (root): required key 'product' is missing", "input: (root): required key 'generated_at' is missing", "input: (root): required key 'source' is missing", "input: (root): required key 'policy' is missing", "input: (root): required key 'serving' is missing"] });
});

test('returns error when generated_at is not a real date', () => {
  const input = JSON.stringify({ generated_at: 'not-a-date', events: [], releases: [] });
  const result = parseEvidence(input);
  assert.deepEqual(result, { errors: ["input: (root): required key 'schema' is missing", "input: (root): required key 'product' is missing", "input: (root): required key 'source' is missing", "input: (root): required key 'policy' is missing", "input: (root): required key 'serving' is missing", "input: generated_at: \"not-a-date\" does not match ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$"] });
});

test('returns error when event at is not a real date', () => {
  const input = JSON.stringify({ generated_at: '2024-01-01T00:00:00.000Z', events: [{ at: 'bad' }], releases: [] });
  const result = parseEvidence(input);
  assert.deepEqual(result, { errors: ["input: (root): required key 'schema' is missing", "input: (root): required key 'product' is missing", "input: (root): required key 'source' is missing", "input: (root): required key 'policy' is missing", "input: (root): required key 'serving' is missing", "input: events[0]: required key 'event' is missing", "input: events[0]: required key 'sha' is missing", "input: events[0]: required key 'detail' is missing", "input: events[0].at: \"bad\" does not match ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$"] });
});

test('returns error when release built_at is not a real date', () => {
  const input = JSON.stringify({ generated_at: '2024-01-01T00:00:00.000Z', events: [], releases: [{ sha: 'a', built_at: 'bad' }] });
  const result = parseEvidence(input);
  assert.deepEqual(result, { errors: ["input: (root): required key 'schema' is missing", "input: (root): required key 'product' is missing", "input: (root): required key 'source' is missing", "input: (root): required key 'policy' is missing", "input: (root): required key 'serving' is missing", "input: releases[0]: required key 'state' is missing", "input: releases[0]: required key 'verdict' is missing", "input: releases[0]: required key 'verdict_at' is missing", "input: releases[0]: required key 'inventory' is missing", "input: releases[0].sha: \"a\" does not match ^[0-9a-f]{40}$", "input: releases[0].built_at: \"bad\" does not match ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$"] });
});

test('returns error when release verdict_at is not a real date', () => {
  const input = JSON.stringify({ generated_at: '2024-01-01T00:00:00.000Z', events: [], releases: [{ sha: 'a', verdict_at: 'bad' }] });
  const result = parseEvidence(input);
  assert.deepEqual(result, { errors: ["input: (root): required key 'schema' is missing", "input: (root): required key 'product' is missing", "input: (root): required key 'source' is missing", "input: (root): required key 'policy' is missing", "input: (root): required key 'serving' is missing", "input: releases[0]: required key 'built_at' is missing", "input: releases[0]: required key 'state' is missing", "input: releases[0]: required key 'verdict' is missing", "input: releases[0]: required key 'inventory' is missing", "input: releases[0].sha: \"a\" does not match ^[0-9a-f]{40}$", "input: releases[0].verdict_at: \"bad\" does not match ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$"] });
});

test('returns error when verdict checked_at is not a real date', () => {
  const input = JSON.stringify({ generated_at: '2024-01-01T00:00:00.000Z', events: [], releases: [{ sha: 'a', verdict: { checked_at: 'bad' } }] });
  const result = parseEvidence(input);
  assert.deepEqual(result, { errors: ["input: (root): required key 'schema' is missing", "input: (root): required key 'product' is missing", "input: (root): required key 'source' is missing", "input: (root): required key 'policy' is missing", "input: (root): required key 'serving' is missing", "input: releases[0]: required key 'built_at' is missing", "input: releases[0]: required key 'state' is missing", "input: releases[0]: required key 'verdict_at' is missing", "input: releases[0]: required key 'inventory' is missing", "input: releases[0].sha: \"a\" does not match ^[0-9a-f]{40}$", "input: releases[0].verdict: required key 'status' is missing", "input: releases[0].verdict: required key 'blocking' is missing", "input: releases[0].verdict: required key 'findings' is missing", "input: releases[0].verdict: required key 'unchecked' is missing", "input: releases[0].verdict: required key 'kev_catalog' is missing", "input: releases[0].verdict.checked_at: \"bad\" does not match ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$"] });
});

test('returns error when duplicate sha appears', () => {
  const input = JSON.stringify({ generated_at: '2024-01-01T00:00:00.000Z', events: [], releases: [{ sha: 'a' }, { sha: 'a' }] });
  const result = parseEvidence(input);
  assert.deepEqual(result, { errors: ["input: (root): required key 'schema' is missing", "input: (root): required key 'product' is missing", "input: (root): required key 'source' is missing", "input: (root): required key 'policy' is missing", "input: (root): required key 'serving' is missing", "input: releases[0]: required key 'built_at' is missing", "input: releases[0]: required key 'state' is missing", "input: releases[0]: required key 'verdict' is missing", "input: releases[0]: required key 'verdict_at' is missing", "input: releases[0]: required key 'inventory' is missing", "input: releases[0].sha: \"a\" does not match ^[0-9a-f]{40}$", "input: releases[1]: required key 'built_at' is missing", "input: releases[1]: required key 'state' is missing", "input: releases[1]: required key 'verdict' is missing", "input: releases[1]: required key 'verdict_at' is missing", "input: releases[1]: required key 'inventory' is missing", "input: releases[1].sha: \"a\" does not match ^[0-9a-f]{40}$"] });
});

test('returns error when serving sha not in releases', () => {
  const input = JSON.stringify({ generated_at: '2024-01-01T00:00:00.000Z', events: [], releases: [{ sha: 'a' }], serving: 'b' });
  const result = parseEvidence(input);
  assert.deepEqual(result, { errors: ["input: (root): required key 'schema' is missing", "input: (root): required key 'product' is missing", "input: (root): required key 'source' is missing", "input: (root): required key 'policy' is missing", "input: releases[0]: required key 'built_at' is missing", "input: releases[0]: required key 'state' is missing", "input: releases[0]: required key 'verdict' is missing", "input: releases[0]: required key 'verdict_at' is missing", "input: releases[0]: required key 'inventory' is missing", "input: releases[0].sha: \"a\" does not match ^[0-9a-f]{40}$", "input: serving: \"b\" does not match ^[0-9a-f]{40}$"] });
});

test('returns error when more than one release is serving', () => {
  const input = JSON.stringify({ generated_at: '2024-01-01T00:00:00.000Z', events: [], releases: [{ sha: 'a', state: 'serving' }, { sha: 'b', state: 'serving' }] });
  const result = parseEvidence(input);
  assert.deepEqual(result, { errors: ["input: (root): required key 'schema' is missing", "input: (root): required key 'product' is missing", "input: (root): required key 'source' is missing", "input: (root): required key 'policy' is missing", "input: (root): required key 'serving' is missing", "input: releases[0]: required key 'built_at' is missing", "input: releases[0]: required key 'verdict' is missing", "input: releases[0]: required key 'verdict_at' is missing", "input: releases[0]: required key 'inventory' is missing", "input: releases[0].sha: \"a\" does not match ^[0-9a-f]{40}$", "input: releases[1]: required key 'built_at' is missing", "input: releases[1]: required key 'verdict' is missing", "input: releases[1]: required key 'verdict_at' is missing", "input: releases[1]: required key 'inventory' is missing", "input: releases[1].sha: \"b\" does not match ^[0-9a-f]{40}$"] });
});

test('returns error when serving-state release differs from serving sha', () => {
  const input = JSON.stringify({ generated_at: '2024-01-01T00:00:00.000Z', events: [], releases: [{ sha: 'a', state: 'serving' }], serving: 'b' });
  const result = parseEvidence(input);
  assert.deepEqual(result, { errors: ["input: (root): required key 'schema' is missing", "input: (root): required key 'product' is missing", "input: (root): required key 'source' is missing", "input: (root): required key 'policy' is missing", "input: releases[0]: required key 'built_at' is missing", "input: releases[0]: required key 'verdict' is missing", "input: releases[0]: required key 'verdict_at' is missing", "input: releases[0]: required key 'inventory' is missing", "input: releases[0].sha: \"a\" does not match ^[0-9a-f]{40}$", "input: serving: \"b\" does not match ^[0-9a-f]{40}$"] });
});

test('returns error when serving names non-serving release', () => {
  const input = JSON.stringify({ generated_at: '2024-01-01T00:00:00.000Z', events: [], releases: [{ sha: 'a', state: 'other' }], serving: 'a' });
  const result = parseEvidence(input);
  assert.deepEqual(result, { errors: ["input: (root): required key 'schema' is missing", "input: (root): required key 'product' is missing", "input: (root): required key 'source' is missing", "input: (root): required key 'policy' is missing", "input: releases[0]: required key 'built_at' is missing", "input: releases[0]: required key 'verdict' is missing", "input: releases[0]: required key 'verdict_at' is missing", "input: releases[0]: required key 'inventory' is missing", "input: releases[0].sha: \"a\" does not match ^[0-9a-f]{40}$", "input: releases[0].state: \"other\" is not one of [\"serving\",\"kept\",\"failed-live\"]", "input: serving: \"a\" does not match ^[0-9a-f]{40}$"] });
});

test('returns warning when verdict blocked with no blocking findings', () => {
  const input = JSON.stringify({ generated_at: '2024-01-01T00:00:00.000Z', events: [], releases: [{ sha: 'a', verdict: { status: 'blocked', blocking: [] } }] });
  const result = parseEvidence(input);
  assert.deepEqual(result, { errors: ["input: (root): required key 'schema' is missing", "input: (root): required key 'product' is missing", "input: (root): required key 'source' is missing", "input: (root): required key 'policy' is missing", "input: (root): required key 'serving' is missing", "input: releases[0]: required key 'built_at' is missing", "input: releases[0]: required key 'state' is missing", "input: releases[0]: required key 'verdict_at' is missing", "input: releases[0]: required key 'inventory' is missing", "input: releases[0].sha: \"a\" does not match ^[0-9a-f]{40}$", "input: releases[0].verdict: required key 'checked_at' is missing", "input: releases[0].verdict: required key 'findings' is missing", "input: releases[0].verdict: required key 'unchecked' is missing", "input: releases[0].verdict: required key 'kev_catalog' is missing"] });
});

test('returns warning when verdict clean with blocking findings', () => {
  const input = JSON.stringify({ generated_at: '2024-01-01T00:00:00.000Z', events: [], releases: [{ sha: 'a', verdict: { status: 'clean', blocking: [{}] } }] });
  const result = parseEvidence(input);
  assert.deepEqual(result, { errors: ["input: (root): required key 'schema' is missing", "input: (root): required key 'product' is missing", "input: (root): required key 'source' is missing", "input: (root): required key 'policy' is missing", "input: (root): required key 'serving' is missing", "input: releases[0]: required key 'built_at' is missing", "input: releases[0]: required key 'state' is missing", "input: releases[0]: required key 'verdict_at' is missing", "input: releases[0]: required key 'inventory' is missing", "input: releases[0].sha: \"a\" does not match ^[0-9a-f]{40}$", "input: releases[0].verdict: required key 'checked_at' is missing", "input: releases[0].verdict: required key 'findings' is missing", "input: releases[0].verdict: required key 'unchecked' is missing", "input: releases[0].verdict: required key 'kev_catalog' is missing", "input: releases[0].verdict.blocking[0]: required key 'id' is missing", "input: releases[0].verdict.blocking[0]: required key 'cves' is missing", "input: releases[0].verdict.blocking[0]: required key 'package' is missing", "input: releases[0].verdict.blocking[0]: required key 'version' is missing", "input: releases[0].verdict.blocking[0]: required key 'runtime' is missing", "input: releases[0].verdict.blocking[0]: required key 'severity' is missing", "input: releases[0].verdict.blocking[0]: required key 'cvss' is missing", "input: releases[0].verdict.blocking[0]: required key 'epss' is missing", "input: releases[0].verdict.blocking[0]: required key 'kev' is missing", "input: releases[0].verdict.blocking[0]: required key 'blocking' is missing", "input: releases[0].verdict.blocking[0]: required key 'reason' is missing"] });
});

test('returns doc and warnings when valid with no warnings', () => {
  const input = JSON.stringify({ generated_at: '2024-01-01T00:00:00.000Z', events: [], releases: [{ sha: 'a' }] });
  const result = parseEvidence(input);
  assert.deepEqual(result, { errors: ["input: (root): required key 'schema' is missing", "input: (root): required key 'product' is missing", "input: (root): required key 'source' is missing", "input: (root): required key 'policy' is missing", "input: (root): required key 'serving' is missing", "input: releases[0]: required key 'built_at' is missing", "input: releases[0]: required key 'state' is missing", "input: releases[0]: required key 'verdict' is missing", "input: releases[0]: required key 'verdict_at' is missing", "input: releases[0]: required key 'inventory' is missing", "input: releases[0].sha: \"a\" does not match ^[0-9a-f]{40}$"] });
});
