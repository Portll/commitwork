// Parses a repository dependency-update policy JSON document (bin/lib/update-policy.mjs parseRepoPolicy).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRepoPolicy } from '../lib/update-policy.mjs';

test('rejects a JSON array as the top-level value', () => {
  const r = parseRepoPolicy('[1, 2]');
  assert.deepEqual(r, { error: ".github/dependency-updates.json must be a JSON object" });
});

test('rejects a JSON null as the top-level value', () => {
  const r = parseRepoPolicy('null');
  assert.deepEqual(r, { error: ".github/dependency-updates.json must be a JSON object" });
});

test('rejects a version that does not match the supported policy version', () => {
  const r = parseRepoPolicy('{"version": 2}');
  assert.deepEqual(r, { error: ".github/dependency-updates.json declares version 2; this reads version 1" });
});

test('rejects an unknown top-level field', () => {
  const r = parseRepoPolicy('{"version": 1, "bogus": 1}');
  assert.deepEqual(r, { error: ".github/dependency-updates.json: unknown field(s) bogus \u2014 known: version, note, zeroRuntimeDependencies, cooldownDays, update, automerge" });
});

test('rejects an update section that is not an object', () => {
  const r = parseRepoPolicy('{"version": 1, "update": "patch"}');
  assert.deepEqual(r, { error: ".github/dependency-updates.json: update must be an object" });
});

test('rejects an automerge section that is not an object', () => {
  const r = parseRepoPolicy('{"version": 1, "automerge": 42}');
  assert.deepEqual(r, { error: ".github/dependency-updates.json: automerge must be an object" });
});

test('rejects an unknown key inside the update section', () => {
  const r = parseRepoPolicy('{"version": 1, "update": {"prod": ["patch"], "weird": ["patch"]}}');
  assert.deepEqual(r, { error: ".github/dependency-updates.json: update.weird is not prod, dev or actions" });
});

test('rejects an invalid kind inside the update section', () => {
  const r = parseRepoPolicy('{"version": 1, "update": {"prod": ["patch", "weird"]}}');
  assert.deepEqual(r, { error: ".github/dependency-updates.json: update.prod: unknown update kind(s) weird \u2014 known: patch, minor, major, lockfile, advisories" });
});

test('rejects an invalid kind inside the automerge actions section', () => {
  const r = parseRepoPolicy('{"version": 1, "automerge": {"actions": ["patch", "weird"]}}');
  assert.deepEqual(r, { error: ".github/dependency-updates.json: automerge.actions must list only patch, minor, major" });
});

test('rejects a cooldownDays value that is out of range', () => {
  const r = parseRepoPolicy('{"version": 1, "cooldownDays": 400}');
  assert.deepEqual(r, { error: ".github/dependency-updates.json: cooldownDays must be 0\u2013365 days" });
});

test('rejects a zeroRuntimeDependencies value that is not a boolean', () => {
  const r = parseRepoPolicy('{"version": 1, "zeroRuntimeDependencies": "yes"}');
  assert.deepEqual(r, { error: ".github/dependency-updates.json: zeroRuntimeDependencies must be true or false" });
});

test('rejects a note value that is not a string', () => {
  const r = parseRepoPolicy('{"version": 1, "note": 123}');
  assert.deepEqual(r, { error: ".github/dependency-updates.json: note must be a string" });
});

test('accepts a minimal valid policy object', () => {
  const r = parseRepoPolicy('{"version": 1}');
  assert.deepEqual(r, { policy: { version: 1 } });
});

test('accepts a fully populated valid policy object', () => {
  const r = parseRepoPolicy('{"version": 1, "note": "hi", "zeroRuntimeDependencies": true, "cooldownDays": 7, "update": {"prod": ["patch"], "dev": ["minor"], "actions": ["patch"]}, "automerge": {"prod": ["patch"], "actions": ["minor"]}}');
  assert.deepEqual(r, { policy: { version: 1, note: "hi", zeroRuntimeDependencies: true, cooldownDays: 7, update: { prod: ["patch"], dev: ["minor"], actions: ["patch"] }, automerge: { prod: ["patch"], actions: ["minor"] } } });
});
