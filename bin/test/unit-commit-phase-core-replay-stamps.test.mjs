// Replays version stamps across a sequence of change sets (bin/commit-phase-core.mjs replayStamps).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replayStamps } from '../commit-phase-core.mjs';

test('returns ok with empty stamps when there are no steps', () => {
  const r = replayStamps({ baseText: null, steps: [] });
  assert.deepEqual(r, { ok: true, stamps: [] });
});

test('stamps a single step that bumps the parent version', () => {
  const base = '{"name":"x","version":"1.0.0"}';
  const after = '{"name":"x","version":"1.0.1"}';
  const r = replayStamps({ baseText: base, steps: [{ before: base, after }] });
  assert.deepEqual(r, { ok: true, stamps: [{ ok: true, from: "1.0.0", version: "1.0.1", kept: false, text: "{\"name\":\"x\",\"version\":\"1.0.1\"}" }] });
});

test('fails when the parent text is not valid semver', () => {
  const base = '{"name":"x","version":"not-semver"}';
  const after = '{"name":"x","version":"1.0.1"}';
  const r = replayStamps({ baseText: base, steps: [{ before: base, after }] });
  assert.deepEqual(r, { ok: false, at: 0, why: "package.json at the parent commit has version \"not-semver\", which is not semver. Every commit stamps bumpPatch(parent version), so there is nothing to bump from." });
});

test('fails when the author text is absent', () => {
  const base = '{"name":"x","version":"1.0.0"}';
  const r = replayStamps({ baseText: base, steps: [{ before: base, after: null }] });
  assert.deepEqual(r, { ok: false, at: 0, why: "this change set deletes package.json, which carries the version every commit stamps." });
});

test('keeps the author version when it is higher than the bump', () => {
  const base = '{"name":"x","version":"1.0.0"}';
  const after = '{"name":"x","version":"1.0.5"}';
  const r = replayStamps({ baseText: base, steps: [{ before: base, after }] });
  assert.deepEqual(r, { ok: true, stamps: [{ ok: true, from: "1.0.0", version: "1.0.5", kept: true, text: "{\"name\":\"x\",\"version\":\"1.0.5\"}" }] });
});

test('uses the bumped version when the author version is lower', () => {
  const base = '{"name":"x","version":"1.0.0"}';
  const after = '{"name":"x","version":"1.0.0"}';
  const r = replayStamps({ baseText: base, steps: [{ before: base, after }] });
  assert.deepEqual(r, { ok: true, stamps: [{ ok: true, from: "1.0.0", version: "1.0.1", kept: false, text: "{\"name\":\"x\",\"version\":\"1.0.1\"}" }] });
});

test('fails at the correct index when a later step is invalid', () => {
  const base = '{"name":"x","version":"1.0.0"}';
  const good = '{"name":"x","version":"1.0.1"}';
  const bad = '{"name":"x","version":"bad"}';
  const r = replayStamps({ baseText: base, steps: [{ before: base, after: good }, { before: good, after: bad }] });
  assert.deepEqual(r, { ok: false, at: 1, why: "package.json in this change set has version \"bad\", which is not semver." });
});

test('handles multiple valid steps in sequence', () => {
  const base = '{"name":"x","version":"1.0.0"}';
  const s1 = '{"name":"x","version":"1.0.1"}';
  const s2 = '{"name":"x","version":"1.0.2"}';
  const r = replayStamps({ baseText: base, steps: [{ before: base, after: s1 }, { before: s1, after: s2 }] });
  assert.deepEqual(r, { ok: true, stamps: [{ ok: true, from: "1.0.0", version: "1.0.1", kept: false, text: "{\"name\":\"x\",\"version\":\"1.0.1\"}" }, { ok: true, from: "1.0.1", version: "1.0.2", kept: false, text: "{\"name\":\"x\",\"version\":\"1.0.2\"}" }] });
});
