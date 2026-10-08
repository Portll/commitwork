// The Fleet tab's state renderers, lifted whole out of admin/index.html (the derived-rows /
// integrity-render pattern) and driven through every state the payload can carry.
//
// ONE RULE IS DOING ALL THE WORK HERE, and it is the one a hand-maintained client-side table gets
// wrong: monitor/liveness.mjs owns the vocabulary of sweep-health states and has grown it repeatedly
// (`paused`, `overrunning`, `unjournaled` and `tampered` all arrived after the first four). A panel
// holding its own copy of that vocabulary grades the NEXT state added by omission — it falls out of
// every branch and renders as unstyled text, which reads as nothing wrong. So the renderer keys on
// the RANK the server sends, and an unrecognised state must come out alarming rather than clean.
// That is what these tests hold in place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { panelSource } from './lib/panel-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = panelSource('index.html');

const from = (marker) => {
  const at = SRC.indexOf(marker);
  assert.ok(at > -1, `${marker} not found in admin/index.html`);
  return at;
};
const block = SRC.slice(from('// ── FLEET RENDERERS'), from('// ── END FLEET RENDERERS'));

const esc = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pill = (s, txt) => `<span class="pill ${s}">${txt || s}</span>`;
const R = new Function('esc', 'pill', `${block}\nreturn { flPill, flAge, flMemoryExport, FL_TONE, FL_QUIET, FL_KIND_TONE };`)(esc, pill);

// The green pill is the panel's "a check ran and came back clean". Nothing that is merely quiet,
// merely absent or merely unrecognised may ever wear it.
const notGreen = (html, what) => assert.ok(!html.includes('pill live'), `${what} rendered with the green pill`);

test('fresh — the one state that earned green', () => {
  assert.match(R.flPill({ state: 'fresh', rank: 0 }), /pill live/);
});

test('a rank-0 state that is merely QUIET is grey, never green', () => {
  // paused / unscheduled / pending rank 0 because nobody can act on them — an alarm nobody can
  // satisfy gets muted. That is not the same as a sweep having run and found nothing, and colouring
  // them green would claim a measurement that never happened.
  for (const s of ['paused', 'unscheduled', 'pending']) {
    const h = R.flPill({ state: s, rank: 0 });
    assert.match(h, /pill plan/, `${s} must be grey`);
    notGreen(h, s);
  }
});

test('ranked states escalate: 1 is amber, 2 and 3 are red', () => {
  assert.match(R.flPill({ state: 'stale', rank: 1 }), /pill part/);
  assert.match(R.flPill({ state: 'degraded', rank: 1 }), /pill part/);
  for (const s of [{ state: 'expired', rank: 3 }, { state: 'hung', rank: 3 }, { state: 'tampered', rank: 3 }]) {
    assert.match(R.flPill(s), /pill crit/, `${s.state} must be red`);
  }
});

test('A STATE THIS PAGE HAS NEVER HEARD OF RENDERS ALARMING, NOT CLEAN', () => {
  // The regression this file exists for. The server ranks an unknown state 3 (RANK[s] ?? 3), and the
  // renderer must carry that through rather than falling out of a branch into plain text.
  const h = R.flPill({ state: 'quarantined-by-a-future-lane', rank: 3 });
  assert.match(h, /pill crit/, 'an unrecognised ranked state must be red');
  assert.match(h, /quarantined-by-a-future-lane/, 'and must still name itself, so the gap is visible');
  notGreen(h, 'an unrecognised state');
});

test('no health object at all is UNKNOWN — its own dashed state, never clean', () => {
  for (const h of [null, undefined, {}, { rank: 0 }]) {
    const out = R.flPill(h);
    assert.match(out, /pill unk/, 'absence of a verdict is unknown');
    assert.match(out, /unknown/);
    notGreen(out, 'a missing health verdict');
  }
});

test('an unrecognised state with a MISSING rank still fails closed', () => {
  // The rank arrives from the payload; if it is absent the tone map misses and the fallback decides.
  // That fallback must be red, because the alternative is a state nobody classified reading as fine.
  const h = R.flPill({ state: 'something-new' });
  assert.match(h, /pill crit/);
  notGreen(h, 'a state with no rank');
});

test('the state name is escaped — it reaches this renderer from a file on disk', () => {
  const h = R.flPill({ state: '<img src=x onerror=alert(1)>', rank: 1 });
  assert.doesNotMatch(h, /<img/, 'a state name is data, and rollups are files an operator can edit');
  assert.match(h, /&lt;img/);
});

// ── KIND OUTRANKS RANK FOR COLOUR ───────────────────────────────────────────────────────────────
// The regression these hold in place, measured 2026-09-11: the box was mid-sweep with 18 live sweep
// pids, and every one of those areas rendered amber beside the 3 whose sweeps had actually died,
// because `overrunning` and `stale` both rank 1. liveness.mjs split `overrunning` out of `hung` for
// precisely this reason; the panel had re-merged them at the colour.
test('a RUNNING sweep is grey, not amber — it is progress, not a missed run', () => {
  const h = R.flPill({ state: 'overrunning', rank: 1, kind: 'in-flight' });
  assert.match(h, /pill plan/, 'in-flight is grey: while a sweep rewrites an area the reading is unsettled, not bad');
  assert.doesNotMatch(h, /pill part/, 'amber would put a live sweep in the same colour as a missed one');
  notGreen(h, 'an in-flight sweep');
  assert.match(h, /overrunning/, 'and it still names the state');
});

test('same rank, different kind, different colour — which is the whole point', () => {
  // Both rank 1. Only the kind separates them, and the reader acts on one and not the other.
  assert.match(R.flPill({ state: 'overrunning', rank: 1, kind: 'in-flight' }), /pill plan/);
  assert.match(R.flPill({ state: 'stale', rank: 1, kind: 'behind' }), /pill part/);
  // And a broken one is red whatever its rank says.
  assert.match(R.flPill({ state: 'hung', rank: 3, kind: 'broken' }), /pill crit/);
});

test('an unrecognised KIND is red, not unstyled', () => {
  const h = R.flPill({ state: 'something', rank: 0, kind: 'a-kind-from-the-future' });
  assert.match(h, /pill crit/, 'the kind fallback fails closed exactly as the rank fallback does');
  notGreen(h, 'an unrecognised kind');
});

test('no kind at all falls back to rank, so an older payload still renders', () => {
  // Back-compat is load-bearing: the browser may hold a page older than the panel it is talking to.
  assert.match(R.flPill({ state: 'fresh', rank: 0 }), /pill live/);
  assert.match(R.flPill({ state: 'stale', rank: 1 }), /pill part/);
  assert.match(R.flPill({ state: 'hung', rank: 3 }), /pill crit/);
});

test('a QUIET state stays grey even when a kind says ok — paused is not a measurement', () => {
  // FL_QUIET is checked before the kind, deliberately: `paused` classifies `ok` because nobody can
  // act on it, but green would claim a sweep confirmed something and no sweep ran at all.
  for (const s of ['paused', 'unscheduled', 'pending']) {
    const h = R.flPill({ state: s, rank: 0, kind: 'ok' });
    assert.match(h, /pill plan/, `${s} must stay grey`);
    notGreen(h, s);
  }
});

test('flAge: an absent age is a dash, never a zero', () => {
  assert.equal(R.flAge(null), '—');
  assert.equal(R.flAge(undefined), '—');
  assert.equal(R.flAge(0), '0m', 'a MEASURED zero is written as a number — only absence is a dash');
});

test('flAge: minutes under an hour, hours under two days, days beyond', () => {
  assert.equal(R.flAge(90 * 1000), '2m');
  assert.equal(R.flAge(3 * 3.6e6), '3h');
  assert.equal(R.flAge(47 * 3.6e6), '47h');
  assert.equal(R.flAge(9 * 24 * 3.6e6), '9d');
});

// ── THE MEMORY EXPORT TILE ──────────────────────────────────────────────────────────────────────
// The lane this tile reports exits 0 on every outcome, so every other number on the Fleet tab is
// identical whether a slice's records reached the backend or not. Measured 2026-10-03 on the live
// box: 42 writes across 6 areas had FAILED and nothing on the page said so. The rule under test is
// the three-way one — failed is red, degraded is amber, and UNMEASURED is grey, because an area
// with no receipt must not be published as a pass and must not be published as a finding either.

const denom = (n) => `over ${n} of ${n} areas`;
const tile = (mx) => {
  const [cl, , v, s] = R.flMemoryExport(mx, denom);
  return { cl, v, s };
};

test('failed writes are RED and the count is the headline figure', () => {
  const t = tile({ areasCounted: 34, failedReceipts: 42, unverifiedReceipts: 269,
    byState: { verified: 18, degraded: 10, failed: 6, absent: 0, stale: 0, unreadable: 0 } });
  assert.equal(t.cl, 'bad');
  assert.match(t.v, /42/);
  assert.match(t.s, /269 accepted and never read back/);
});

test('accepted-but-never-read-back is amber and is never counted as a failure', () => {
  const t = tile({ areasCounted: 10, failedReceipts: 0, unverifiedReceipts: 4,
    byState: { verified: 7, degraded: 3, failed: 0, absent: 0, stale: 0, unreadable: 0 } });
  assert.equal(t.cl, 'warn');
  assert.match(t.v, /^0</, 'zero failed writes is the truth and stays the headline figure');
  assert.match(t.s, /neither a pass nor a failure/);
});

test('an area with NO receipt is grey and absent from the clean count, not a zero in it', () => {
  const t = tile({ areasCounted: 8, failedReceipts: 0, unverifiedReceipts: 0,
    byState: { verified: 5, degraded: 0, failed: 0, absent: 3, stale: 0, unreadable: 0 } });
  assert.equal(t.cl, '', 'unmeasured is grey — not amber, which would publish it as a finding');
  assert.match(t.s, /5 of 8 area\(s\) measured a clean export/);
  assert.match(t.s, /3 wrote no receipt/);
  assert.match(t.s, /excluded from the clean count/);
});

test('receipts older than the rollup they exported are named as stale, not as clean', () => {
  const t = tile({ areasCounted: 4, failedReceipts: 0, unverifiedReceipts: 0,
    byState: { verified: 3, degraded: 0, failed: 0, absent: 0, stale: 1, unreadable: 0 } });
  assert.equal(t.cl, '');
  assert.match(t.s, /1 carry receipts older than their own rollup/);
});

test('an unreadable receipts file is a FAULT — amber, and the outcome stated as unknown', () => {
  const t = tile({ areasCounted: 4, failedReceipts: 0, unverifiedReceipts: 0,
    byState: { verified: 3, degraded: 0, failed: 0, absent: 0, stale: 0, unreadable: 1 } });
  assert.equal(t.cl, 'warn', 'a fault must not render quieter than a degradation');
  assert.match(t.s, /UNKNOWN/);
});

test('an all-clean fleet does NOT wear the green tile class — the tile reports work, not virtue', () => {
  // Deliberate: the KPI strip's green is used for measured-clean elsewhere, and this tile's value
  // is a failure count. A green "0 writes failed" over three unmeasured areas is the shape being
  // avoided, so the clean case is neutral and the sub-line carries the denominator.
  const t = tile({ areasCounted: 6, failedReceipts: 0, unverifiedReceipts: 0,
    byState: { verified: 6, degraded: 0, failed: 0, absent: 0, stale: 0, unreadable: 0 } });
  assert.equal(t.cl, '');
  assert.match(t.s, /6 of 6 area\(s\) measured a clean export/);
});

test('no payload at all says UNOBSERVED, never a confident zero', () => {
  for (const mx of [undefined, null, {}, { areasCounted: 0, byState: {} }]) {
    const t = tile(mx);
    assert.equal(t.v, '&mdash;', 'an em-dash, not 0 — a panel older than this lane sends nothing');
    assert.match(t.s, /never been observed|not a clean run/);
    notGreen(`<span class="kpi ${t.cl}">`, 'an unobserved export');
  }
});
