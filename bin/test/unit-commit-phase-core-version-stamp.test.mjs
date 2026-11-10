// Stamps the bumped or kept semver version into the package.json text (bin/commit-phase-core.mjs versionStamp).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { versionStamp } from '../commit-phase-core.mjs';

test('returns none when there is no parent commit', () => {
  const r = versionStamp({ parentText: null, authorText: '{"name":"x","version":"1.0.0"}' });
  assert.deepEqual(r, { ok: true, none: true, text: "{\"name\":\"x\",\"version\":\"1.0.0\"}" });
});

test('fails when the parent package.json is not parseable', () => {
  const r = versionStamp({ parentText: 'not json', authorText: '{"name":"x","version":"1.0.0"}' });
  assert.deepEqual(r, { ok: false, why: "package.json at the parent commit is not a parseable JSON object. Every commit stamps bumpPatch(parent version), so there is nothing to bump from." });
});

test('fails when the change set deletes the package.json', () => {
  const r = versionStamp({ parentText: '{"name":"x","version":"1.0.0"}', authorText: null });
  assert.deepEqual(r, { ok: false, why: "this change set deletes package.json, which carries the version every commit stamps." });
});

test('fails when the author package.json is not parseable', () => {
  const r = versionStamp({ parentText: '{"name":"x","version":"1.0.0"}', authorText: 'garbage' });
  assert.deepEqual(r, { ok: false, why: "package.json in this change set is not a parseable JSON object." });
});

test('bumps the patch when the author version is lower than the bumped version', () => {
  const r = versionStamp({ parentText: '{"name":"x","version":"1.2.3"}', authorText: '{"name":"x","version":"1.2.0"}' });
  assert.deepEqual(r, { ok: true, from: "1.2.3", version: "1.2.4", kept: false, text: "{\"name\":\"x\",\"version\":\"1.2.4\"}" });
});

test('keeps the author version when it is higher than the bumped version', () => {
  const r = versionStamp({ parentText: '{"name":"x","version":"1.2.3"}', authorText: '{"name":"x","version":"1.3.0"}' });
  assert.deepEqual(r, { ok: true, from: "1.2.3", version: "1.3.0", kept: true, text: "{\"name\":\"x\",\"version\":\"1.3.0\"}" });
});

test('bumps the patch when the author version equals the bumped version', () => {
  const r = versionStamp({ parentText: '{"name":"x","version":"1.2.3"}', authorText: '{"name":"x","version":"1.2.4"}' });
  assert.deepEqual(r, { ok: true, from: "1.2.3", version: "1.2.4", kept: false, text: "{\"name\":\"x\",\"version\":\"1.2.4\"}" });
});

test('bumps the patch when the author version is one less than the bumped version', () => {
  const r = versionStamp({ parentText: '{"name":"x","version":"1.2.3"}', authorText: '{"name":"x","version":"1.2.3"}' });
  assert.deepEqual(r, { ok: true, from: "1.2.3", version: "1.2.4", kept: false, text: "{\"name\":\"x\",\"version\":\"1.2.4\"}" });
});
