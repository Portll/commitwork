// Human-readable provenance summary for adjudication records (monitor/adjudication-provenance.mjs statementFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statementFor } from '../adjudication-provenance.mjs';

test('singular closure and act with no overstatement', () => {
  const r = statementFor({ rowCount: 1, actCount: 1, readingCount: null, byTiming: { live: 1, retro: 0, undetermined: 0 }, largest: null, withBasis: 0, corruptEvidence: 0 });
  assert.equal(r, "1 closure across 1 distinct adjudication act. Timing: 1 judged live, 0 reconstructed after the fact, 0 undetermined \u2014 the record does not establish when or on what basis these were judged, which is neither a pass nor a failing mark against them. Derived-vs-judged split: UNKNOWN \u2014 no closure carries a recorded defect basis, so nothing here says whether a classification was derived from a commit or judged by a person. Adjudication is internal. The operator is the primary adjudicator, and naming that does not remove the conflict \u2014 it records it.");
});

test('plural closures and acts with overstatement ratio', () => {
  const r = statementFor({ rowCount: 2, actCount: 1, readingCount: null, byTiming: { live: 0, retro: 2, undetermined: 0 }, largest: null, withBasis: 1, corruptEvidence: 0 });
  assert.equal(r, "2 closures across 1 distinct adjudication act \u2014 publishing the closure count would over-state the judgements by 2.00x, because records sharing one instant, verdict and evidence string are one reading. Timing: 0 judged live, 2 reconstructed after the fact, 0 undetermined \u2014 the record does not establish when or on what basis these were judged, which is neither a pass nor a failing mark against them. 1 closure carry a recorded defect basis. Adjudication is internal. The operator is the primary adjudicator, and naming that does not remove the conflict \u2014 it records it.");
});

test('plural closures and acts without overstatement', () => {
  const r = statementFor({ rowCount: 2, actCount: 2, readingCount: null, byTiming: { live: 0, retro: 0, undetermined: 2 }, largest: null, withBasis: 2, corruptEvidence: 0 });
  assert.equal(r, "2 closures across 2 distinct adjudication acts. Timing: 0 judged live, 0 reconstructed after the fact, 2 undetermined \u2014 the record does not establish when or on what basis these were judged, which is neither a pass nor a failing mark against them. 2 closures carry a recorded defect basis. Adjudication is internal. The operator is the primary adjudicator, and naming that does not remove the conflict \u2014 it records it.");
});

test('singular reading count with corrupt evidence', () => {
  const r = statementFor({ rowCount: 3, actCount: 2, readingCount: 1, byTiming: { live: 1, retro: 1, undetermined: 1 }, largest: { members: [1, 2], at: '2024-01-01' }, withBasis: 1, corruptEvidence: 1 });
  assert.equal(r, "3 closures across 2 distinct adjudication acts \u2014 publishing the closure count would over-state the judgements by 1.50x, because records sharing one instant, verdict and evidence string are one reading. Those closures cite 1 distinct evidence string, so the number of independent judgements lies between 1 and 2 \u2014 the record does not resolve which. 1 closure carry a CORRUPT evidence field (an object reached String() and became `[object Object]`). The judgements behind them may have been sound; the record of them is gone, and they are counted as undetermined rather than as either a pass or a defect. Timing: 1 judged live, 1 reconstructed after the fact, 1 undetermined \u2014 the record does not establish when or on what basis these were judged, which is neither a pass nor a failing mark against them. Largest single act closed 2 findings at 2024-01-01. 1 closure carry a recorded defect basis. Adjudication is internal. The operator is the primary adjudicator, and naming that does not remove the conflict \u2014 it records it.");
});

test('plural reading count with plural corrupt evidence', () => {
  const r = statementFor({ rowCount: 5, actCount: 3, readingCount: 2, byTiming: { live: 2, retro: 2, undetermined: 1 }, largest: { members: [1, 2, 3], at: '2024-01-02' }, withBasis: 3, corruptEvidence: 2 });
  assert.equal(r, "5 closures across 3 distinct adjudication acts \u2014 publishing the closure count would over-state the judgements by 1.67x, because records sharing one instant, verdict and evidence string are one reading. Those closures cite 2 distinct evidence strings, so the number of independent judgements lies between 2 and 3 \u2014 the record does not resolve which. 2 closures carry a CORRUPT evidence field (an object reached String() and became `[object Object]`). The judgements behind them may have been sound; the record of them is gone, and they are counted as undetermined rather than as either a pass or a defect. Timing: 2 judged live, 2 reconstructed after the fact, 1 undetermined \u2014 the record does not establish when or on what basis these were judged, which is neither a pass nor a failing mark against them. Largest single act closed 3 findings at 2024-01-02. 3 closures carry a recorded defect basis. Adjudication is internal. The operator is the primary adjudicator, and naming that does not remove the conflict \u2014 it records it.");
});

test('largest with single member and zero basis', () => {
  const r = statementFor({ rowCount: 1, actCount: 1, readingCount: null, byTiming: { live: 1, retro: 0, undetermined: 0 }, largest: { members: [1], at: '2024-01-03' }, withBasis: 0, corruptEvidence: 0 });
  assert.equal(r, "1 closure across 1 distinct adjudication act. Timing: 1 judged live, 0 reconstructed after the fact, 0 undetermined \u2014 the record does not establish when or on what basis these were judged, which is neither a pass nor a failing mark against them. Derived-vs-judged split: UNKNOWN \u2014 no closure carries a recorded defect basis, so nothing here says whether a classification was derived from a commit or judged by a person. Adjudication is internal. The operator is the primary adjudicator, and naming that does not remove the conflict \u2014 it records it.");
});

test('largest null and non-zero basis', () => {
  const r = statementFor({ rowCount: 4, actCount: 2, readingCount: 3, byTiming: { live: 4, retro: 0, undetermined: 0 }, largest: null, withBasis: 4, corruptEvidence: 0 });
  assert.equal(r, "4 closures across 2 distinct adjudication acts \u2014 publishing the closure count would over-state the judgements by 2.00x, because records sharing one instant, verdict and evidence string are one reading. Those closures cite 3 distinct evidence strings, so the number of independent judgements lies between 3 and 2 \u2014 the record does not resolve which. Timing: 4 judged live, 0 reconstructed after the fact, 0 undetermined \u2014 the record does not establish when or on what basis these were judged, which is neither a pass nor a failing mark against them. 4 closures carry a recorded defect basis. Adjudication is internal. The operator is the primary adjudicator, and naming that does not remove the conflict \u2014 it records it.");
});

test('zero act count avoids division', () => {
  const r = statementFor({ rowCount: 1, actCount: 0, readingCount: null, byTiming: { live: 0, retro: 0, undetermined: 1 }, largest: null, withBasis: 0, corruptEvidence: 0 });
  assert.equal(r, "1 closure across 0 distinct adjudication acts. Timing: 0 judged live, 0 reconstructed after the fact, 1 undetermined \u2014 the record does not establish when or on what basis these were judged, which is neither a pass nor a failing mark against them. Derived-vs-judged split: UNKNOWN \u2014 no closure carries a recorded defect basis, so nothing here says whether a classification was derived from a commit or judged by a person. Adjudication is internal. The operator is the primary adjudicator, and naming that does not remove the conflict \u2014 it records it.");
});
