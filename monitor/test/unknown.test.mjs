// One predicate for "this is not a result". The fifteen sibling adjectives that preceded it were
// each locally correct and collectively unqueryable — G7 (verdict recorded, unqueryable), C4
// (unstable identity: undetermined/unadjudicated/unproven/not-produced are ONE state under four
// keys) and M5 (the fleet's unknown-rate unmeasurable by construction).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  unknown, isUnknown, unknownReasonOf, tallyUnknown,
  UNKNOWN_REASONS, LEGACY_STATE_TO_REASON, DETERMINATION_FIELDS,
} from '../unknown.mjs';
import { stampUnknown } from '../extractors.mjs';

test('one predicate answers for every lane', () => {
  assert.equal(isUnknown(unknown('not-run')), true);
  assert.equal(isUnknown({ crit: 0, high: 0, total: 0 }), false, 'a real zero is a RESULT, not an unknown');
  assert.equal(isUnknown(null), false);
  assert.equal(isUnknown({ unknown: 'yes' }), false, 'only the boolean counts — a truthy string is not a state');
});

test('an undeclared reason THROWS rather than passing through', () => {
  // A silent default is exactly how a vocabulary fragments into fifteen adjectives. The throw is
  // the same design choice as CLASS_FOR_CATEGORY, which threw in production today and was right to.
  assert.throws(() => unknown('mysteriously-absent'), /not a declared reason/);
  assert.throws(() => unknown('mysteriously-absent'), /do not coin a new adjective at the call site/);
});

test('every legacy word resolves to a declared reason — this map IS the missing correspondence', () => {
  for (const [legacy, reason] of Object.entries(LEGACY_STATE_TO_REASON)) {
    assert.ok(Object.prototype.hasOwnProperty.call(UNKNOWN_REASONS, reason),
      `legacy '${legacy}' maps to '${reason}', which is not a declared reason`);
  }
});

test('the four keys that were ONE state collapse to one reason — the C4 fix', () => {
  const keys = ['undetermined', 'unadjudicated', 'unproven'];
  const reasons = new Set(keys.map((k) => LEGACY_STATE_TO_REASON[k]));
  assert.equal(reasons.size, 1, `${keys.join('/')} are one state and must share one reason`);
  assert.equal([...reasons][0], 'not-adjudicated');
});

test('legacy artifacts are readable without testing fifteen fields', () => {
  assert.equal(unknownReasonOf({ ran: true, nosrc: true }), 'no-subject');
  assert.equal(unknownReasonOf({ ran: true, unparseable: true }), 'unparseable');
  assert.equal(unknownReasonOf({ ran: true, norules: true }), 'no-rules');
  // value-shaped, not flag-shaped — three of my own lanes wrote it this way
  assert.equal(unknownReasonOf({ checksumCheck: 'no-reference-list' }), 'no-reference');
  assert.equal(unknownReasonOf({ reachabilityState: 'not-produced' }), 'not-produced');
  assert.equal(unknownReasonOf({ versionState: 'unstated' }), 'unstated');
});

test('a FALSE legacy flag is a producer saying "not this", not an unknown', () => {
  // The trap in the other direction: `nosrc: false` is an explicit denial. Reading truthiness
  // rather than presence is what keeps a denial from becoming an unknown.
  assert.equal(unknownReasonOf({ ran: true, nosrc: false, total: 3 }), null);
  assert.equal(unknownReasonOf({ ran: true, unparseable: false, crit: 1 }), null);
});

test('a genuine clean result is never an unknown', () => {
  assert.equal(unknownReasonOf({ ran: true, crit: 0, high: 0, med: 0, low: 0, total: 0 }), null,
    'explicit uncertainty, and green is not grey either — a scanned-and-clean lane must not be counted as unknown');
});

test('the aggregate question now HAS an answer — the G7 fix', () => {
  const t = tallyUnknown([
    { ran: true, total: 5 },
    { ran: true, nosrc: true },
    unknown('not-permitted', 'GitHub withheld security_and_analysis'),
    { reachabilityState: 'not-produced' },
    unknown('not-adjudicated'),
  ]);
  assert.equal(t.total, 5);
  assert.equal(t.unknown, 4);
  assert.deepEqual(t.byReason, { 'no-subject': 1, 'not-permitted': 1, 'not-produced': 1, 'not-adjudicated': 1 });
});

test('detail is carried and bounded', () => {
  const u = unknown('not-permitted', 'x'.repeat(1000));
  assert.equal(u.unknownReason, 'not-permitted');
  assert.ok(u.unknownDetail.length <= 400, 'detail is bounded — these reach a browser');
});

test('every declared reason says what a reader should DO about it', () => {
  // A reason whose text is just its own name restates the key and helps nobody.
  for (const [k, v] of Object.entries(UNKNOWN_REASONS)) {
    assert.ok(typeof v === 'string' && v.length > 25, `reason '${k}' needs a real sentence, got: ${v}`);
    assert.notEqual(v.toLowerCase(), k.replace(/-/g, ' '), `reason '${k}' just restates its own key`);
  }
});

test('a REAL result is never turned into an unknown by an unrelated field — explicit uncertainty', () => {
  // The defect this pins, found 2026-08-23 while wiring stampUnknown into the rollup and NOT by
  // reading: unknownReasonOf scanned every VALUE in the block, and _toolProvenance returns
  // `{provenance:'not-recorded'}` for every category whose tool-version stamp is missing. So a lane
  // that had scanned cleanly and found two HIGHs came back `unknown: not-recorded`. A fabricated
  // grey over a real finding is the over-reporting direction — the one that cost this fleet 1,311
  // false CRITICALs — and it would have shipped across most of the corpus.
  const scanned = { ran: true, crit: 0, high: 2, med: 0, low: 0, total: 2, provenance: 'not-recorded' };
  assert.equal(unknownReasonOf(scanned), null,
    'an unrecorded TOOL VERSION says nothing about whether the scan found things — provenance describes the stamp, not the result');
  assert.equal(isUnknown(stampUnknown(scanned)), false, 'and the stamper must not mark it either');

  // Same shape, other provenance states.
  assert.equal(unknownReasonOf({ ran: true, total: 7, provenance: 'unreadable' }), null);

  // The determination fields still work — narrowing must not have silently disabled them.
  assert.equal(unknownReasonOf({ ran: true, checksumCheck: 'no-reference-list' }), 'no-reference');
  assert.equal(unknownReasonOf({ ran: true, reachabilityState: 'not-produced' }), 'not-produced');
  for (const f of DETERMINATION_FIELDS) {
    assert.ok(f !== 'provenance', 'provenance must never be a determination field');
  }
});

test('a legacy flag must be an actual boolean true, not merely truthy', () => {
  // `unparseable: 'the file was cut short'` is a producer explaining itself, not asserting a state
  // twice. Reading truthiness would take the explanation as the flag.
  assert.equal(unknownReasonOf({ ran: true, total: 3, noscan: 'scheduled for tonight' }), null,
    'a descriptive string in a flag-named field is not the flag being set');
  assert.equal(unknownReasonOf({ ran: true, noscan: true }), 'not-run');
});
