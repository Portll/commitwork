// The diagram is generated, so it can be checked: bin/verdict-flow.mjs reads the live constants,
// and these assert the drawing against the same constants the system uses — a map that omits a
// gate reads as complete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mermaid, svg } from '../verdict-flow.mjs';
import { JUDGEMENT_KINDS, TRUTHS, GATE_ROSTER } from '../lib/verdict-journal-core.mjs';

test('every gate on the roster appears in the diagram', () => {
  const m = mermaid();
  for (const { gate } of GATE_ROSTER) {
    assert.ok(m.includes(gate), `${gate} is on GATE_ROSTER and missing from the diagram — a map that omits a gate reads as complete`);
  }
});

test('every judgement kind that gets archived is named on the archive edge', () => {
  const m = mermaid();
  for (const k of JUDGEMENT_KINDS) {
    assert.ok(m.includes(k), `${k} is archived by appendRecord and absent from the diagram`);
  }
});

test('every truth value the ledger can hold is named', () => {
  const m = mermaid();
  for (const t of TRUTHS) assert.ok(m.includes(t), `${t} is a TRUTHS value and absent from the diagram`);
});

// The five exclusions are rules about what does NOT get counted — invisible in any output.
test('all five reader exclusions are drawn', () => {
  const m = mermaid();
  for (const guard of ['retracted', 'ambiguous', 'dangling', 'duplicate', 'pre-epoch']) {
    assert.ok(m.includes(guard), `the '${guard}' exclusion is enforced by computeMetrics and missing from the diagram`);
  }
});

// Constructed truth and adjudicated truth must never be drawn as the same evidence.
test('the canary cohort is drawn OUTSIDE the headline rate', () => {
  const m = mermaid();
  assert.match(m, /CANARY cohort/);
  assert.match(m, /never in the headline/);
  assert.match(m, /published beside/);
});

test('the undefined-vs-zero branch is drawn, since that is the defect the rates exist to avoid', () => {
  const m = mermaid();
  assert.match(m, /OBSERVABLE/);
  assert.match(m, /never 0%/);
});

// Determinism: a generated artifact that differs run to run cannot be committed or diffed.
test('generation is deterministic', () => {
  assert.equal(mermaid(), mermaid());
  const counts = { gates: { 'gate-tests': 12 }, judgements: 3, archive: 3, generations: 1, canary: 1, live: 2 };
  assert.equal(mermaid({ counts }), mermaid({ counts }));
});

// Absent is not zero, in the picture as everywhere else.
test('an unreadable count renders as ? rather than 0', () => {
  const m = mermaid({ counts: { gates: {}, judgements: null, archive: null, generations: null, canary: null, live: null } });
  assert.ok(m.includes('?'), 'a null count must render as unknown');
  assert.ok(!/<i>0 archived<\/i>/.test(m), 'and must never render as a zero, which reads as "nothing was archived"');
});

// ── THE SVG ─────────────────────────────────────────────────────────────────────────────────────
// Inline SVG is what lets the page obey the house rule (self-contained, file://-safe, no CDN)
// while still being something you can look at.
test('svg: every gate on the roster is drawn', () => {
  const s = svg();
  for (const { gate } of GATE_ROSTER) assert.ok(s.includes(gate), `${gate} is on the roster and missing from the drawing`);
});

test('svg: the five exclusions and both cohorts are drawn', () => {
  const s = svg();
  for (const g of ['retracted', 'ambiguous', 'dangling', 'duplicate', 'pre-epoch']) {
    assert.ok(s.includes(g), `the '${g}' exclusion is enforced and undrawn`);
  }
  assert.ok(s.includes('LIVE cohort') && s.includes('CANARY cohort'), 'the cohort split is the distinction the ledger turns on');
  assert.ok(s.includes('never in the headline'), 'and the drawing must say which side of the rate the canary sits on');
});

test('svg: it is a drawing, not an embedded document', () => {
  const s = svg();
  assert.match(s, /^<svg /, 'must be an svg element');
  assert.ok(!/<script/i.test(s), 'no script — the page must render with nothing loaded');
  assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(s), 'no external reference except the SVG namespace');
  assert.ok((s.match(/<rect /g) || []).length >= 20, 'the pipeline has more than a handful of nodes');
});

// Determinism, so the artifact can be committed and diffed like any other generated file.
test('svg: generation is deterministic', () => {
  assert.equal(svg(), svg());
  const counts = { gates: { 'gate-tests': 9 }, judgements: 3, archive: 3, generations: 2, canary: 1, live: 2 };
  assert.equal(svg({ counts }), svg({ counts }));
});

test('svg: an unreadable count draws ? and never 0', () => {
  const s = svg({ counts: { gates: {}, judgements: null, archive: null, generations: null, canary: null, live: null } });
  assert.ok(s.includes('? decisions'), 'a null gate count must draw as unknown');
  assert.ok(!s.includes('0 archived'), 'and must never draw a zero, which reads as "nothing was archived"');
});
