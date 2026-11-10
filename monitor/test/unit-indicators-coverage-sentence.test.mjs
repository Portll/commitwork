// human-readable summary of indicator application coverage (monitor/indicators.mjs coverageSentence).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverageSentence } from '../indicators.mjs';

test('returns the complete branch message when complete is true', () => {
  const r = coverageSentence({ complete: true, indicatorsApplied: 3 });
  assert.equal(r, "all 3 indicator(s) were applied");
});

test('returns the incomplete branch with an unknown fraction when appliedFraction is null', () => {
  const r = coverageSentence({ complete: false, indicatorsApplied: 2, indicatorsRejected: 3, appliedFraction: null, indicatorSetsUnreadable: 0 });
  assert.equal(r, "2 of 5 indicator(s) applied (an unknown fraction) \u2014 a zero here is a floor, not a clean result");
});

test('returns the incomplete branch with a one-decimal percentage when appliedFraction is 0.5', () => {
  const r = coverageSentence({ complete: false, indicatorsApplied: 1, indicatorsRejected: 1, appliedFraction: 0.5, indicatorSetsUnreadable: 0 });
  assert.equal(r, "1 of 2 indicator(s) applied (50.0%) \u2014 a zero here is a floor, not a clean result");
});

test('returns the incomplete branch with a one-decimal percentage when appliedFraction is 0.123', () => {
  const r = coverageSentence({ complete: false, indicatorsApplied: 1, indicatorsRejected: 7, appliedFraction: 0.123, indicatorSetsUnreadable: 0 });
  assert.equal(r, "1 of 8 indicator(s) applied (12.3%) \u2014 a zero here is a floor, not a clean result");
});

test('appends the unreadable sets clause when indicatorSetsUnreadable is nonzero', () => {
  const r = coverageSentence({ complete: false, indicatorsApplied: 0, indicatorsRejected: 4, appliedFraction: 0, indicatorSetsUnreadable: 2 });
  assert.equal(r, "0 of 4 indicator(s) applied (0.0%), and 2 whole set(s) were unreadable \u2014 a zero here is a floor, not a clean result");
});

test('omits the unreadable sets clause when indicatorSetsUnreadable is zero', () => {
  const r = coverageSentence({ complete: false, indicatorsApplied: 0, indicatorsRejected: 4, appliedFraction: 0, indicatorSetsUnreadable: 0 });
  assert.equal(r, "0 of 4 indicator(s) applied (0.0%) \u2014 a zero here is a floor, not a clean result");
});
