// Computes per-lane confidence bands, positive-control states, and tallies (monitor/lane-confidence.mjs buildLaneConfidence).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLaneConfidence } from '../lane-confidence.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty lanes and tallies when entries is null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildLaneConfidence-'));
  try {
    const r = buildLaneConfidence(null, { positiveControls: { source: 'x', read: true, lanes: {} } });
    assert.deepEqual(r, { at: null, note: "Bands are words, not numbers, and are keyed on DETECTOR rather than on any finding. A band may not be applied to a severity \u2014 see monitor/lane-confidence.mjs for why.", vocabulary: ["unmeasured", "anecdotal", "indicative", "provisional", "measured", "well-measured", "externally-verified"], positiveControls: { source: "x", read: true, vocabulary: ["absent", "missed", "stale", "current"], tally: {} }, lanes: [], tally: {} });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('maps a random sample with narrow interval to measured band', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildLaneConfidence-'));
  try {
    const r = buildLaneConfidence(
      [{ detector: 'd1', adjudicated: 10, sampling: 'random', intervalStated: true, intervalWide: false }],
      { positiveControls: { source: 'x', read: true, lanes: {} } }
    );
    assert.deepEqual(r, { at: null, note: "Bands are words, not numbers, and are keyed on DETECTOR rather than on any finding. A band may not be applied to a severity \u2014 see monitor/lane-confidence.mjs for why.", vocabulary: ["unmeasured", "anecdotal", "indicative", "provisional", "measured", "well-measured", "externally-verified"], positiveControls: { source: "x", read: true, vocabulary: ["absent", "missed", "stale", "current"], tally: { absent: 1 } }, lanes: [{ detector: "d1", band: "measured", condition: "sample with a stated interval", why: "stated interval", adjudicated: 10, sampling: "random", positiveControl: "absent", positiveControlAt: null }], tally: { measured: 1 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('caps non-random sampling at anecdotal regardless of count', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildLaneConfidence-'));
  try {
    const r = buildLaneConfidence(
      [{ detector: 'd2', adjudicated: 100, sampling: 'opportunistic' }],
      { positiveControls: { source: 'x', read: true, lanes: {} } }
    );
    assert.deepEqual(r, { at: null, note: "Bands are words, not numbers, and are keyed on DETECTOR rather than on any finding. A band may not be applied to a severity \u2014 see monitor/lane-confidence.mjs for why.", vocabulary: ["unmeasured", "anecdotal", "indicative", "provisional", "measured", "well-measured", "externally-verified"], positiveControls: { source: "x", read: true, vocabulary: ["absent", "missed", "stale", "current"], tally: { absent: 1 } }, lanes: [{ detector: "d2", band: "anecdotal", condition: "fewer than 5 adjudicated findings", why: "sampling is 'opportunistic' \u2014 a selection cannot become a measurement by growing, so this lane is capped at anecdotal regardless of count (100 adjudicated)", adjudicated: 100, sampling: "opportunistic", positiveControl: "absent", positiveControlAt: null }], tally: { anecdotal: 1 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('marks lane as unmeasured when zero findings and control is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildLaneConfidence-'));
  try {
    const r = buildLaneConfidence(
      [{ detector: 'd3', adjudicated: 0, sweepFindings: 0 }],
      { positiveControls: { source: 'x', read: true, lanes: {} } }
    );
    assert.deepEqual(r, { at: null, note: "Bands are words, not numbers, and are keyed on DETECTOR rather than on any finding. A band may not be applied to a severity \u2014 see monitor/lane-confidence.mjs for why.", vocabulary: ["unmeasured", "anecdotal", "indicative", "provisional", "measured", "well-measured", "externally-verified"], positiveControls: { source: "x", read: true, vocabulary: ["absent", "missed", "stale", "current"], tally: { absent: 1 } }, lanes: [{ detector: "d3", band: "unmeasured", condition: "no adjudicated findings in this lane", why: "no adjudicated findings", adjudicated: 0, sampling: "opportunistic", positiveControl: "absent", positiveControlAt: null, sweepResult: "unmeasured", sweepResultWhy: "zero findings, but the positive control is absent: the lane has not been shown to fire, so its silence is not a measurement" }], tally: { unmeasured: 1 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('marks lane as clean when zero findings and control is current', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildLaneConfidence-'));
  try {
    const r = buildLaneConfidence(
      [{ detector: 'd4', adjudicated: 0, sweepFindings: 0 }],
      { positiveControls: { source: 'x', read: true, lanes: { d4: { ranAt: '2024-01-01T00:00:00Z', outcome: 'detected' } } }, now: '2024-01-02T00:00:00Z', maxAgeDays: 30 }
    );
    assert.deepEqual(r, { at: null, note: "Bands are words, not numbers, and are keyed on DETECTOR rather than on any finding. A band may not be applied to a severity \u2014 see monitor/lane-confidence.mjs for why.", vocabulary: ["unmeasured", "anecdotal", "indicative", "provisional", "measured", "well-measured", "externally-verified"], positiveControls: { source: "x", read: true, vocabulary: ["absent", "missed", "stale", "current"], tally: { current: 1 } }, lanes: [{ detector: "d4", band: "unmeasured", condition: "no adjudicated findings in this lane", why: "no adjudicated findings", adjudicated: 0, sampling: "opportunistic", positiveControl: "current", positiveControlAt: "2024-01-01T00:00:00Z", sweepResult: "clean", sweepResultWhy: "zero findings under a current positive control" }], tally: { unmeasured: 1 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('marks lane as findings when sweepFindings is positive', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildLaneConfidence-'));
  try {
    const r = buildLaneConfidence(
      [{ detector: 'd5', adjudicated: 0, sweepFindings: 3 }],
      { positiveControls: { source: 'x', read: true, lanes: {} } }
    );
    assert.deepEqual(r, { at: null, note: "Bands are words, not numbers, and are keyed on DETECTOR rather than on any finding. A band may not be applied to a severity \u2014 see monitor/lane-confidence.mjs for why.", vocabulary: ["unmeasured", "anecdotal", "indicative", "provisional", "measured", "well-measured", "externally-verified"], positiveControls: { source: "x", read: true, vocabulary: ["absent", "missed", "stale", "current"], tally: { absent: 1 } }, lanes: [{ detector: "d5", band: "unmeasured", condition: "no adjudicated findings in this lane", why: "no adjudicated findings", adjudicated: 0, sampling: "opportunistic", positiveControl: "absent", positiveControlAt: null, sweepResult: "findings", sweepResultWhy: "3 finding(s) this sweep" }], tally: { unmeasured: 1 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('matches defect signatures by lane for lane-level detectors', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildLaneConfidence-'));
  try {
    const r = buildLaneConfidence(
      [{ detector: 'd6', adjudicated: 10, sampling: 'random', intervalStated: true, intervalWide: false }],
      { positiveControls: { source: 'x', read: true, lanes: {} }, defectSignatures: [{ detector: 'other', lane: 'd6' }] }
    );
    assert.deepEqual(r, { at: null, note: "Bands are words, not numbers, and are keyed on DETECTOR rather than on any finding. A band may not be applied to a severity \u2014 see monitor/lane-confidence.mjs for why.", vocabulary: ["unmeasured", "anecdotal", "indicative", "provisional", "measured", "well-measured", "externally-verified"], positiveControls: { source: "x", read: true, vocabulary: ["absent", "missed", "stale", "current"], tally: { absent: 1 } }, lanes: [{ detector: "d6", band: "measured", condition: "sample with a stated interval", why: "stated interval", adjudicated: 10, sampling: "random", positiveControl: "absent", positiveControlAt: null, defectSignature: false }], tally: { measured: 1 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('includes refutations matching the detector', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildLaneConfidence-'));
  try {
    const r = buildLaneConfidence(
      [{ detector: 'd7', adjudicated: 10, sampling: 'random', intervalStated: true, intervalWide: false }],
      { positiveControls: { source: 'x', read: true, lanes: {} }, refutations: [{ detector: 'd7', note: 'x' }] }
    );
    assert.deepEqual(r, { at: null, note: "Bands are words, not numbers, and are keyed on DETECTOR rather than on any finding. A band may not be applied to a severity \u2014 see monitor/lane-confidence.mjs for why.", vocabulary: ["unmeasured", "anecdotal", "indicative", "provisional", "measured", "well-measured", "externally-verified"], positiveControls: { source: "x", read: true, vocabulary: ["absent", "missed", "stale", "current"], tally: { absent: 1 } }, lanes: [{ detector: "d7", band: "measured", condition: "sample with a stated interval", why: "stated interval", adjudicated: 10, sampling: "random", positiveControl: "absent", positiveControlAt: null, refutations: [{ detector: "d7", note: "x" }] }], tally: { measured: 1 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tallies bands and positive-control states across multiple lanes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildLaneConfidence-'));
  try {
    const r = buildLaneConfidence(
      [
        { detector: 'a', adjudicated: 0 },
        { detector: 'b', adjudicated: 10, sampling: 'random', intervalStated: true, intervalWide: false },
        { detector: 'c', adjudicated: 10, sampling: 'random', intervalStated: true, intervalWide: false },
      ],
      { positiveControls: { source: 'x', read: true, lanes: {} } }
    );
    assert.deepEqual(r, { at: null, note: "Bands are words, not numbers, and are keyed on DETECTOR rather than on any finding. A band may not be applied to a severity \u2014 see monitor/lane-confidence.mjs for why.", vocabulary: ["unmeasured", "anecdotal", "indicative", "provisional", "measured", "well-measured", "externally-verified"], positiveControls: { source: "x", read: true, vocabulary: ["absent", "missed", "stale", "current"], tally: { absent: 3 } }, lanes: [{ detector: "a", band: "unmeasured", condition: "no adjudicated findings in this lane", why: "no adjudicated findings", adjudicated: 0, sampling: "opportunistic", positiveControl: "absent", positiveControlAt: null }, { detector: "b", band: "measured", condition: "sample with a stated interval", why: "stated interval", adjudicated: 10, sampling: "random", positiveControl: "absent", positiveControlAt: null }, { detector: "c", band: "measured", condition: "sample with a stated interval", why: "stated interval", adjudicated: 10, sampling: "random", positiveControl: "absent", positiveControlAt: null }], tally: { unmeasured: 1, measured: 2 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses positive control state from provided lanes map', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildLaneConfidence-'));
  try {
    const r = buildLaneConfidence(
      [{ detector: 'd8', adjudicated: 10, sampling: 'random', intervalStated: true, intervalWide: false }],
      { positiveControls: { source: 'x', read: true, lanes: { d8: { ranAt: '2024-01-01T00:00:00Z', outcome: 'detected' } } }, now: '2024-01-02T00:00:00Z', maxAgeDays: 30 }
    );
    assert.deepEqual(r, { at: null, note: "Bands are words, not numbers, and are keyed on DETECTOR rather than on any finding. A band may not be applied to a severity \u2014 see monitor/lane-confidence.mjs for why.", vocabulary: ["unmeasured", "anecdotal", "indicative", "provisional", "measured", "well-measured", "externally-verified"], positiveControls: { source: "x", read: true, vocabulary: ["absent", "missed", "stale", "current"], tally: { current: 1 } }, lanes: [{ detector: "d8", band: "measured", condition: "sample with a stated interval", why: "stated interval", adjudicated: 10, sampling: "random", positiveControl: "current", positiveControlAt: "2024-01-01T00:00:00Z" }], tally: { measured: 1 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
