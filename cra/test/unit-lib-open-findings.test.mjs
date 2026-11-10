// Open findings across the rollup, flattened with their repo. (cra/lib.mjs openFindings).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openFindings } from '../lib.mjs';

test('returns an empty array when the rollup is null', () => {
  assert.deepEqual(openFindings(null), []);
});

test('returns an empty array when the rollup has no repos property', () => {
  assert.deepEqual(openFindings({}), []);
});

test('returns an empty array when the rollup repos is an empty array', () => {
  assert.deepEqual(openFindings({ repos: [] }), []);
});

test('returns an empty array when a repo has no findings property', () => {
  assert.deepEqual(openFindings({ repos: [{ name: 'r1' }] }), []);
});

test('returns an empty array when a repo findings is an empty array', () => {
  assert.deepEqual(openFindings({ repos: [{ name: 'r1', findings: [] }] }), []);
});

test('includes a finding with no state or status as persisting and uses the repo name', () => {
  assert.deepEqual(openFindings({ repos: [{ name: 'r1', findings: [{ id: 'f1' }] }] }), [{ id: "f1", repo: "r1" }]);
});

test('includes a finding whose state is open and uses the finding repo when present', () => {
  assert.deepEqual(openFindings({ repos: [{ name: 'r1', findings: [{ id: 'f1', state: 'open', repo: 'fr1' }] }] }), [{ id: "f1", state: "open", repo: "fr1" }]);
});

test('excludes a finding whose state starts with resolved', () => {
  assert.deepEqual(openFindings({ repos: [{ name: 'r1', findings: [{ id: 'f1', state: 'resolved' }] }] }), []);
});

test('excludes a finding whose state is resolved with a suffix', () => {
  assert.deepEqual(openFindings({ repos: [{ name: 'r1', findings: [{ id: 'f1', state: 'resolved-2024' }] }] }), []);
});

test('includes a finding whose state is open and falls back to the repo name', () => {
  assert.deepEqual(openFindings({ repos: [{ name: 'r1', findings: [{ id: 'f1', state: 'open' }] }] }), [{ id: "f1", state: "open", repo: "r1" }]);
});
