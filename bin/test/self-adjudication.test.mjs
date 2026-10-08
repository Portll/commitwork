// G12 — an adjudication with no independent party on the record.
//
// The verdict journal states the hazard in prose on every record `adjudicate-gates` writes:
// "the operator of this tool may have authored the gates being judged". 593 records carried that
// sentence and nothing counted it. A risk named in a header and repeated in a field is not a
// control.
//
// The two things worth asserting are the ones a lazy version of this detector would get wrong:
// that a CANARY is not self-adjudication (its planted expectation is the second party), and that
// an empty journal is UNDETERMINED rather than clean.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { detectSelfAdjudication, detectCatchEmptyReturn } from '../lib/pattern-core.mjs';

const rec = (over = {}) => ({ kind: 'adjudication', at: '2026-08-26T00:00:00.000Z', gate: 'gate-tests', adjudicatedBy: 'some-tool', ...over });

describe('an adjudication with no second party is observed', () => {
  test('a tool judging with no human and no attribution check is flagged', () => {
    const r = detectSelfAdjudication({ records: [rec(), rec()] });
    assert.equal(r.observations.length, 1, 'one party, one observation — grouped, not one row per record');
    assert.equal(r.observations[0].classId, 'G12');
    assert.equal(r.observations[0].extra.count, 2);
  });

  test('the same record with a human hand is NOT flagged', () => {
    const r = detectSelfAdjudication({ records: [rec({ who: 'operator' }), rec({ who: 'operator' })] });
    assert.equal(r.observations.length, 0, 'a human on the record is the second party');
  });

  test('the same record with an attribution check is NOT flagged', () => {
    const r = detectSelfAdjudication({ records: [rec({ attributionCorrect: true })] });
    assert.equal(r.observations.length, 0);
  });

  test('a party named as human in the caller-supplied list is NOT flagged', () => {
    const r = detectSelfAdjudication({ records: [rec({ adjudicatedBy: 'jane' })], humanParties: ['jane'] });
    assert.equal(r.observations.length, 0);
  });

  test('parties are separated — two instruments are two observations, not one blur', () => {
    const r = detectSelfAdjudication({ records: [rec(), rec({ adjudicatedBy: 'other-tool' })] });
    assert.equal(r.observations.length, 2);
  });
});

describe('a canary is not self-adjudication', () => {
  test('canary records are excluded from the observation', () => {
    const r = detectSelfAdjudication({ records: [rec({ canary: true }), rec({ canary: true }), rec()] });
    assert.equal(r.observations.length, 1);
    assert.equal(r.observations[0].extra.count, 1, 'only the non-canary record counts');
  });

  test('and the denominator SAYS they were excluded, with a number', () => {
    const r = detectSelfAdjudication({ records: [rec({ canary: true }), rec({ canary: true }), rec()] });
    assert.equal(r.denominator.scanned, 1, 'the denominator must not include what was excluded');
    assert.equal(r.denominator.skipped.length, 1);
    assert.match(r.denominator.skipped[0].reason, /2 canary records excluded/,
      'a bound that is not stated has not been paid, it has been hidden');
  });

  test('an all-canary journal yields nothing — and that is correct, not a miss', () => {
    const r = detectSelfAdjudication({ records: [rec({ canary: true }), rec({ canary: true })] });
    assert.equal(r.observations.length, 0);
    assert.equal(r.denominator.scanned, 0);
  });
});

describe('absence is undetermined, never clean', () => {
  test('a journal with no adjudications at all is UNDETERMINED', () => {
    const r = detectSelfAdjudication({ records: [] });
    assert.equal(r.observations.length, 0);
    assert.equal(r.undetermined.length, 1,
      'no adjudications is not a journal free of self-adjudication — it is a question that could not be asked');
    assert.equal(r.undetermined[0].classId, 'G12');
  });

  test('records of other kinds do not count as adjudications', () => {
    const r = detectSelfAdjudication({ records: [{ kind: 'suppression-label', who: 'hook-once' }] });
    assert.equal(r.denominator.scanned, 0);
    assert.equal(r.undetermined.length, 1);
  });

  test('a missing records array does not throw', () => {
    for (const bad of [undefined, null]) {
      const r = detectSelfAdjudication({ records: bad });
      assert.equal(r.undetermined.length, 1);
    }
  });
});

describe('it emits observations, never verdicts', () => {
  test('no observation carries a severity — impact comes off the registry', () => {
    const r = detectSelfAdjudication({ records: [rec()] });
    for (const o of r.observations) {
      assert.equal(o.severity, undefined, 'a detector that can mint a severity can mint a CRITICAL');
      assert.equal(o.confidence, 'structural');
    }
  });

  test('identity excludes the line number, like every other observation', () => {
    const r = detectSelfAdjudication({ records: [rec()] });
    assert.ok(!/::\d+::/.test(r.observations[0].identity), r.observations[0].identity);
  });
});

// ── C11 precision: failing closed is not a false clean ──────────────────────────────────────────
// Lives here rather than in pattern-core.test.mjs because it is the same 2026-08-26 adjudication
// pass: monitor/forensics.mjs:69 was published at `structural` confidence for a catch that assigns
// `{ failed: true, error: ... }` and says so in a comment on the line above. That is the house
// fail-closed rule being obeyed, reported as the class that exists to catch disobeying it.
describe('C11 does not fire on a catch that assigns a structured failure state', () => {
  const wrap = (body) => `async function f() {\n  try { g(); } catch (e) {\n${body}\n  }\n}\n`;
  const run = (body) => detectCatchEmptyReturn({ rel: 'x.mjs', src: wrap(body), stripped: wrap(body) });

  test('the real forensics shape is NOT flagged', () => {
    const out = run('    lanes[name] = { failed: true, error: String((e && e.message) || e) };\n    return null;');
    assert.equal(out.length, 0,
      'assigning a failure state the caller can branch on IS discrimination — the return value is '
      + 'not the only channel a catch has');
  });

  test('the same body WITHOUT the failure state IS flagged — the pair, differing in one fact', () => {
    const out = run('    lanes[name] = {};\n    return null;');
    assert.equal(out.length, 1, 'a genuinely empty catch must still fire, or the fix suppressed the class');
    assert.equal(out[0].classId, 'C11');
  });

  test('a failure marker that does not mention the bound error does NOT clear it', () => {
    const out = run('    lanes[name] = { failed: true };\n    return null;');
    assert.equal(out.length, 1,
      'swallowing the error while flagging failure still loses which failure it was — narrow on purpose');
  });

  test('a rethrow still short-circuits, as before', () => {
    assert.equal(run('    throw e;').length, 0);
  });
});
