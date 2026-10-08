// Two facts a rollup could not previously state about itself.
//
// VINTAGE. rollup.json carries ONE `generated` stamp over lanes that ran at different times — 4.4
// hours apart on sweep-20260820120254, and days apart once a remediation programme starts
// re-running lanes one at a time. Two numbers from one rollup may not describe the same tree.
//
// KEV. `kevSet.has(id)` is false both for a CVE that was checked and is not listed AND for every
// CVE when kev.json failed to load. An unconsulted catalogue produced a fleet of confident
// `kev: false` — absence of evidence rendering as evidence of absence, one layer in.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// The vintage derivation, lifted verbatim from monitor/rollup.mjs. Kept as a pure function here so
// the classification can be tested without running a whole rollup; the pin below asserts the source
// still contains it, so a divergence is a test failure rather than a silent drift.
function vintageOf(scanners, sweepSecs) {
  const lanes = Object.entries(scanners || {})
    .filter(([, s]) => s && s.lastRunAt)
    .map(([k, s]) => ({ lane: k, at: s.lastRunAt, t: Date.parse(s.lastRunAt) }))
    .filter((x) => Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t);
  if (!lanes.length) return null;
  const spreadSecs = Math.round((lanes[lanes.length - 1].t - lanes[0].t) / 1000);
  return { lanes: lanes.length, spreadSecs, mixed: sweepSecs != null && spreadSecs > sweepSecs };
}

const at = (h) => new Date(Date.UTC(2026, 7, 21, h)).toISOString();

test('lanes within the sweep that produced them are NOT mixed', () => {
  const v = vintageOf({ a: { lastRunAt: at(1) }, b: { lastRunAt: at(5) } }, 61329); // 17h sweep
  assert.equal(v.lanes, 2);
  assert.equal(v.spreadSecs, 4 * 3600);
  assert.equal(v.mixed, false, '4.4h of spread inside a 17h sweep is one run, not a mix');
});

test('lanes further apart than the sweep ARE mixed — they cannot have seen one tree', () => {
  const v = vintageOf({ a: { lastRunAt: at(1) }, b: { lastRunAt: at(20) } }, 3600); // 1h sweep
  assert.equal(v.mixed, true);
});

test('with no sweep duration to compare against, `mixed` is not asserted', () => {
  const v = vintageOf({ a: { lastRunAt: at(1) }, b: { lastRunAt: at(20) } }, null);
  assert.equal(v.mixed, false,
    'unknown is not the same as fine, but inventing a threshold would be worse — the spread is still published');
  assert.equal(v.spreadSecs, 19 * 3600, 'and the spread itself is always reported');
});

test('a lane with no lastRunAt is excluded rather than treated as ancient', () => {
  const v = vintageOf({ a: { lastRunAt: at(1) }, b: {}, c: { lastRunAt: 'not-a-date' } }, 3600);
  assert.equal(v.lanes, 1, 'an unparseable or absent stamp is not a timestamp of zero');
});

test('no lane carries a stamp at all → no vintage claim is made', () => {
  assert.equal(vintageOf({ a: {}, b: {} }, 3600), null,
    'silence is correct here; a spread of 0 would assert that every lane ran together');
});

// ── the KEV tri-state ───────────────────────────────────────────────────────────────────────────
const kevOf = (kevSet, id) => (kevSet.size > 0 ? kevSet.has(id) : null);

test('an unconsulted KEV catalogue yields null, never false', () => {
  assert.equal(kevOf(new Set(), 'CVE-2026-1'), null,
    'false would credit a lookup that never ran — the exact shape of a false clean');
});

test('a consulted catalogue distinguishes listed from not-listed', () => {
  const s = new Set(['CVE-2026-1']);
  assert.equal(kevOf(s, 'CVE-2026-1'), true);
  assert.equal(kevOf(s, 'CVE-2026-2'), false, 'this false is EARNED — the catalogue was read');
});

test('null kev is falsy, so every existing consumer stays correct', () => {
  // The counters filter on truthiness and rankG subtracts. Both must survive a null without
  // counting an unconsulted finding as exploited, and without throwing.
  const findings = [{ kev: null }, { kev: true }, { kev: false }];
  assert.equal(findings.filter((f) => f.kev).length, 1, 'only the earned true counts');
  assert.equal(Number(true) - Number(null), 1, 'rankG arithmetic stays finite');
});

test('the rollup source still derives vintage the way this file models it', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'rollup.mjs'), 'utf8');
  assert.match(src, /spreadSecs > sweepSecs/, 'the mixed-vintage rule moved — update this model with it');
  assert.match(src, /kevUsable \? kevSet\.has\(f\.id\) : null/, 'the kev tri-state moved — update this model with it');
  assert.match(src, /kevConsulted/, 'the totals must still say whether the catalogue was read');
});
