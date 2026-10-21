// Scorecard's score of -1 means "could not determine". This file pins the two ways that value
// must NOT be read, because both were observed in the lane it was built to complement.
//
//   unsupported finding   Prowler's GitHub provider returns FAIL for a control the API withheld from a
//                 non-admin token. On the 100randomrepos corpus that read as 100/100 repos failing
//                 "secret scanning enabled" — 1,080 published highs of which an unknown fraction
//                 were permission denials. An undetermined check must never enter a severity count.
//   unsupported pass      A run where everything came back -1 has zero failures and has measured nothing.
//                 Scoring that `ok` is the same defect with the sign flipped.
//
// The house invariant was written one-directionally ("explicit uncertainty"); this is the mirror.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseReport } from '../commitwork.mjs';
import { _scorecardCounts } from '../../monitor/extractors.mjs';

const T = mkdtempSync(join(tmpdir(), 'cw-scorecard-'));
const plant = (summary, raw) => {
  writeFileSync(join(T, 'scorecard.json'), JSON.stringify(summary));
  if (raw !== undefined) writeFileSync(join(T, 'scorecard.raw.json'), JSON.stringify(raw));
  return T;
};
const summaryOf = (counts, extra = {}) => ({ tool: 'scorecard', ran: true, repo: 'o/r',
  detail: 'scorecard.raw.json', counts, ...extra });

test('an undetermined check is counted as undetermined and scored in NO severity bucket', () => {
  const dir = plant(
    summaryOf({ checks: 3, scored: 2, inconclusive: 1, passing: 1, failing: 1 },
      { inconclusiveChecks: ['Branch-Protection'], aggregateScore: 5 }),
    { checks: [
      { name: 'Branch-Protection', score: -1, reason: 'internal error: token lacks admin scope' },
      { name: 'Token-Permissions', score: 0, reason: 'excessive permissions detected' },
      { name: 'License', score: 10, reason: 'license file detected' },
    ] });
  const c = _scorecardCounts(dir, 'scorecard.json');
  assert.equal(c.undetermined, 1, 'the -1 must be counted somewhere');
  assert.deepEqual(c.undeterminedChecks, ['Branch-Protection'], 'and it must be nameable');
  assert.equal(c.crit + c.high + c.med + c.low, 1, 'ONLY the score-0 check is a finding');
  assert.equal(c.high, 1, 'score 0 is high');
  assert.equal(c.total, 1);
  const names = (c.findings || []).map((f) => f.control);
  assert.ok(!names.includes('Branch-Protection'), 'an undetermined check must have NO detail row');
  assert.ok(!names.includes('License'), 'a passing check is not a finding either');
});

test('a run where NOTHING could be determined is noscan, never a pass', () => {
  const p = join(plant(summaryOf({ checks: 4, scored: 0, inconclusive: 4, passing: 0, failing: 0 })),
    'scorecard.json');
  const r = parseReport('scorecard', p);
  assert.equal(r.sev, 'noscan', 'zero failures out of zero measurements is not clean');
  assert.match(r.summary, /could be determined/);
});

test('undetermined checks alongside a clean scored set do not read as an unqualified pass', () => {
  const p = join(plant(summaryOf({ checks: 9, scored: 6, inconclusive: 3, passing: 6, failing: 0 })),
    'scorecard.json');
  const r = parseReport('scorecard', p);
  assert.notEqual(r.sev, 'ok', '6 passing and 3 unmeasurable is not the same claim as 9 passing');
  assert.match(r.summary, /3 undetermined/, 'the count the reader needs must be in the summary');
});

test('a self-gated skip is a void, not a repo with perfect posture', () => {
  writeFileSync(join(T, 'skipped.json'), JSON.stringify({ tool: 'scorecard', ran: false,
    skipped: true, reason: 'scorecard not installed' }));
  assert.equal(parseReport('scorecard', join(T, 'skipped.json')).sev, 'noscan');
  writeFileSync(join(T, 'scorecard.json'), JSON.stringify({ tool: 'scorecard', ran: false,
    skipped: true, reason: 'no credential' }));
  const c = _scorecardCounts(T, 'scorecard.json');
  assert.equal(c.nosrc, true, 'a skip is nosrc — a void — not zero findings');
  assert.equal(c.total, 0);
});

test('a detail file that exists but yields no checks falls back to the producer count, not to zero', () => {
  const dir = plant(summaryOf({ checks: 5, scored: 5, inconclusive: 0, passing: 2, failing: 3 }),
    { checks: 'not-an-array' });
  const c = _scorecardCounts(dir, 'scorecard.json');
  assert.equal(c.total, 3, 'the producer said 3 failing; an unreadable drill-down does not make them vanish');
  assert.equal(c.detailUnreadable, true, 'and the reader must be told the detail could not be read');
});
