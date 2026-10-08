// The lexicon's floor. Not "does it export what I typed" — that is a streak, not a check. These
// assert the two properties the module exists FOR, and one of them reads the consumer's source so
// the pair cannot drift apart silently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BANDS, LABELS, ALIASES, canonical, bandOf, rankOf, scale } from '../chain-lexicon.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('every label names a band that exists', () => {
  for (const [label, band] of Object.entries(LABELS)) {
    assert.ok(BANDS[band], `label ${label} names band ${band}, which is not in BANDS`);
  }
});

test('every alias resolves to a canonical label, not to another alias', () => {
  for (const [alias, target] of Object.entries(ALIASES)) {
    assert.ok(LABELS[target], `alias ${alias} -> ${target}, which is not a canonical label`);
    assert.equal(canonical(target), target, `${target} must not itself be an alias`);
  }
});

// THE CENTRAL PROPERTY. An unclassified label is a thing we know nothing about. Sending it to
// `forged` publishes a critical about a state nobody assessed; sending it to `sound` publishes a
// pass. Both are fabrication. monitor/liveness.mjs:314 did the first with `?? 3`.
test('an UNKNOWN label lands in undetermined — never forged, never sound', () => {
  const r = bandOf('a-state-that-has-never-existed');
  assert.equal(r.band, 'undetermined');
  assert.equal(r.known, false, 'an unknown label must be marked unknown, not silently adopted');
  assert.notEqual(r.rank, BANDS.forged.rank, 'grey must not read as red');
  assert.notEqual(r.rank, BANDS.sound.rank, 'grey must not read as green');
});

test('a KNOWN label is marked known, so callers can tell it from a fallback', () => {
  assert.equal(bandOf('broken').known, true);
  assert.equal(bandOf('broken').band, 'forged');
});

test('undetermined is visible but never fatal', () => {
  // Visible: liveness alarms at rank >= 1, so 0 would make an unmeasured gate look healthy.
  assert.ok(BANDS.undetermined.rank >= 1, 'undetermined must not rank as sound');
  assert.ok(BANDS.undetermined.rank < BANDS.forged.rank, 'undetermined must not rank as forged');
});

// REGRESSION GUARD for the silent-blanking defect. admin/routes/verdicts.mjs:42 reads
// `h.state !== 'ok' && h.state !== 'torn'` to decide whether records are fetched AT ALL. If 'ok'
// stopped resolving, the panel would show no records for any healthy gate — no error, no log.
test('the four state strings live consumers compare by value all resolve', () => {
  for (const legacy of ['ok', 'torn', 'chain-broken', 'absent-not-running']) {
    assert.equal(bandOf(legacy).known, true, `${legacy} must resolve — a live consumer compares it`);
  }
});

// The grey-reads-as-green half of the GATE_RANK defect: a gate that never ran ranked 0, exactly as
// healthy as one that passed.
test('a gate that never ran no longer ranks as sound', () => {
  assert.equal(canonical('absent-not-running'), 'never-measured');
  assert.notEqual(rankOf('absent-not-running'), BANDS.sound.rank);
});

// SECOND WITNESS. This read monitor/liveness.mjs's GATE_RANK literal; that literal is now GONE,
// replaced by bandOf(), and the check correctly failed with "this test has lost its subject" rather
// than passing over an absence. Its durable subject is the PRODUCER, not the consumer: every state
// journalHealth can emit must have a label, or the panel renders a state the lexicon cannot band.
// Reading the source is the point — a hard-coded list here would agree with itself forever.
test('every state journalHealth can emit resolves through the lexicon', () => {
  const src = readFileSync(join(REPO, 'bin', 'lib', 'verdict-journal-core.mjs'), 'utf8');
  const body = src.slice(src.indexOf('export function journalHealth'));
  const block = body.slice(0, body.indexOf('\nexport '));
  assert.ok(block.length > 0, 'journalHealth body not found — this test has lost its subject');
  // Only actual state ASSIGNMENTS. A looser sweep of every quoted token on a line mentioning
  // "state" also catches `detail: e.code || 'error'` — and 'error' is a detail, not a state. The
  // first cut did exactly that and failed, which is the check working: an over-broad extractor
  // manufactures subjects, and a test that invents its own inputs proves nothing about the code.
  const states = new Set();
  for (const m of block.matchAll(/state:\s*'([a-z][a-z-]+)'/g)) states.add(m[1]);
  for (const line of block.split('\n')) {
    if (!/^\s*const state =/.test(line)) continue;
    for (const m of line.matchAll(/'([a-z][a-z-]+)'/g)) states.add(m[1]);
  }
  assert.ok(states.size >= 4, `parsed ${states.size} states — a check with no subject is not a check`);
  for (const st of states) {
    assert.equal(bandOf(st).known, true, `journalHealth can emit '${st}', which has no label`);
  }
});

// REGRESSION GUARD. The defect was a rank table keyed on the LABEL with a `?? 3` default, so every
// label added downstream alarmed the fleet. If one comes back, this fails.
test('monitor/liveness.mjs does not re-introduce a label-keyed gate rank table', () => {
  const src = readFileSync(join(REPO, 'monitor', 'liveness.mjs'), 'utf8');
  assert.equal(/const GATE_RANK\s*=/.test(src), false,
    'GATE_RANK is back — rank on the band, not the label');
  assert.ok(src.includes('bandOf('), 'liveness must resolve gate state through the lexicon');
});

test('scale() is deterministic and covers every label exactly once', () => {
  const a = JSON.stringify(scale());
  const b = JSON.stringify(scale());
  assert.equal(a, b, 'same inputs must produce byte-identical output');
  assert.equal(scale().length, Object.keys(LABELS).length);
  assert.equal(new Set(scale().map((s) => s.label)).size, Object.keys(LABELS).length);
});

test('scale() is ordered sound-first, forged-last', () => {
  const orders = scale().map((s) => s.order);
  assert.deepEqual(orders, [...orders].sort((x, y) => x - y), 'scale must be monotonically ordered');
  assert.equal(scale()[0].band, 'sound');
  assert.equal(scale().at(-1).band, 'forged');
});
