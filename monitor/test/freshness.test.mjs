// node --test monitor/test/  — the sweep-liveness deadman (freshness.mjs).
// Pure, deterministic: a fixed `now` is passed in, so no clock flakiness.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyFreshness, freshnessSummary, DAY_MS } from '../freshness.mjs';

const NOW = Date.parse('2026-07-25T12:00:00.000Z');
const ago = (ms) => new Date(NOW - ms).toISOString();

test('a sweep from this morning is fresh', () => {
  const f = classifyFreshness(ago(6 * 3.6e6), NOW); // 6h ago
  assert.equal(f.state, 'fresh');
  assert.equal(f.ageHours, 6);
});

test('just inside one cadence + grace is still fresh', () => {
  const f = classifyFreshness(ago(DAY_MS + 2 * 3.6e6 - 1000), NOW); // ~25h59m
  assert.equal(f.state, 'fresh');
});

test('one missed wake → stale', () => {
  const f = classifyFreshness(ago(DAY_MS + 5 * 3.6e6), NOW); // ~29h — past cadence+grace
  assert.equal(f.state, 'stale');
  assert.match(freshnessSummary(f), /STALE/);
});

test('two missed wakes → expired (the deadman trips)', () => {
  const f = classifyFreshness(ago(3 * DAY_MS), NOW); // 3 days
  assert.equal(f.state, 'expired');
  assert.match(freshnessSummary(f), /EXPIRED.*not current/);
});

test('a missing generation timestamp is UNKNOWN, never silently fresh', () => {
  for (const bad of [undefined, null, '', 'not-a-date']) {
    const f = classifyFreshness(bad, NOW);
    assert.equal(f.state, 'unknown', `"${bad}" must be unknown, not fresh`);
    assert.equal(f.ageMs, null);
  }
});

test('a future timestamp clamps to age 0 (fresh), never negative', () => {
  const f = classifyFreshness(new Date(NOW + 3.6e6).toISOString(), NOW);
  assert.equal(f.ageMs, 0);
  assert.equal(f.state, 'fresh');
});

test('thresholds are overridable (a faster cadence flips fresh→stale sooner)', () => {
  const gen = ago(3 * 3.6e6); // 3h
  assert.equal(classifyFreshness(gen, NOW).state, 'fresh');
  // an hourly cadence with 30m grace: 3h old is well past → expired
  assert.equal(classifyFreshness(gen, NOW, { cadenceMs: 3.6e6, graceMs: 1.8e6, expireMs: 2 * 3.6e6 }).state, 'expired');
});

// ── CR-3 ────────────────────────────────────────────────────────────────────────────────────────
// sliceId carries the true scan time; `generated` is re-stamped at aggregation and can lag it —
// a 75h-old slice must classify expired even beside a fresh `generated`.
const sliceAt = (msAgo) => `sweep-${new Date(NOW - msAgo).toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;

test('CR-3: a 75h-old sliceId classifies expired regardless of a fresh generated (the audit incident)', () => {
  const generated = ago(2 * 3.6e6);      // aggregation re-stamped 2h ago — looks fresh
  const sliceId = sliceAt(75 * 3.6e6);   // but the scan that produced it ran 75h ago
  const f = classifyFreshness(generated, NOW, { sliceId });
  assert.equal(f.state, 'expired');
  assert.equal(f.ageHours, 75);
  // the aggregation stamp is reported, not discarded, so both numbers stay legible
  assert.equal(f.lastRolledUp, generated);
  assert.equal(f.lastRolledUpAgeHours, 2);
  assert.equal(f.generated, generated);
});

test('CR-3: a fresh sliceId classifies fresh even if generated is (implausibly) older', () => {
  const generated = ago(30 * 3.6e6);     // older than one cadence+grace on its own
  const sliceId = sliceAt(1 * 3.6e6);    // but the scan itself ran 1h ago
  const f = classifyFreshness(generated, NOW, { sliceId });
  assert.equal(f.state, 'fresh');
  assert.equal(f.ageHours, 1);
});

test('CR-3: sliceId with an -area suffix still parses (sweep-<stamp>-<area>)', () => {
  const raw = sliceAt(5 * 3.6e6);
  const f = classifyFreshness(ago(5 * 3.6e6), NOW, { sliceId: `${raw}-client-a` });
  assert.equal(f.state, 'fresh');
  assert.equal(f.ageHours, 5);
  assert.equal(f.scanTime, new Date(NOW - 5 * 3.6e6).toISOString());
});

test('CR-3: an unparseable sliceId fails CLOSED to unknown — never silently reuses generated', () => {
  const generated = ago(1 * 3.6e6); // generated looks perfectly fresh
  for (const bad of ['not-a-slice', 'adhoc-20260101000000', 'v0-20260101000000', '']) {
    const f = classifyFreshness(generated, NOW, { sliceId: bad });
    assert.equal(f.state, 'unknown', `sliceId "${bad}" must not silently fall back to generated`);
    assert.equal(f.ageMs, null);
    // generated is not discarded even though it isn't trusted for classification
    assert.equal(f.lastRolledUp, generated);
  }
});

test('CR-3: a missing sliceId (key present, value absent) also fails CLOSED to unknown', () => {
  const generated = ago(1 * 3.6e6);
  for (const missing of [undefined, null]) {
    const f = classifyFreshness(generated, NOW, { sliceId: missing });
    assert.equal(f.state, 'unknown');
    assert.equal(f.sliceId, null);
    assert.equal(f.lastRolledUp, generated);
  }
});

test('CR-3: omitting the sliceId key entirely keeps the pre-fix behaviour byte-for-byte', () => {
  // no sliceId key — rollup's write-time calling convention; classifies on generatedISO as before
  const gen = ago(6 * 3.6e6);
  const f = classifyFreshness(gen, NOW);
  assert.equal(f.state, 'fresh');
  assert.equal(f.ageHours, 6);
  assert.equal(f.sliceId, null);
  assert.equal(f.scanTime, null);
  assert.equal(f.lastRolledUp, gen);
});

// ── the restated regex must not drift from the one it mirrors ────────────────────────────────────
// freshness.mjs is a zero-import leaf, so it restates the batch-dir pattern rather than importing
// area.mjs — and a restatement with nothing checking it is how two spellings quietly diverge.
test('the sliceId stamp pattern still matches area.mjs sweepBatches()', () => {
  const areaSrc = readFileSync(new URL('../area.mjs', import.meta.url), 'utf8');
  const freshSrc = readFileSync(new URL('../freshness.mjs', import.meta.url), 'utf8');
  // matches the literal in SOURCE TEXT, capturing the stamp width; the optional paren keeps a
  // group-dropping edit comparable rather than skipped
  const STAMP = /\/\^sweep-\(?\\d\{(\d+)\}/;
  const areaRe = areaSrc.match(STAMP);
  const freshRe = freshSrc.match(STAMP);
  assert.ok(areaRe, 'area.mjs no longer carries a /^sweep-\\d{N}/ stamp pattern — find where it moved and repoint this guard');
  assert.ok(freshRe, 'freshness.mjs no longer carries the mirrored stamp pattern');
  assert.equal(freshRe[1], areaRe[1], 'the stamp width diverged between area.mjs and freshness.mjs — a slice stamp would parse in one and not the other');
});
