// node --test monitor/test/ — denominator.mjs: a count and its population as one value. The
// asymmetry is the subject: a non-zero under partial coverage is a floor and reads as one; a zero
// under partial coverage is a different KIND of value and must never render as a clean result.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { claim, render, publishable, combine } from '../denominator.mjs';
import { isUnknown } from '../unknown.mjs';

describe('claim — construction refuses shapes that would render as certainty', () => {
  test('a negative or non-finite count throws', () => {
    assert.throws(() => claim({ count: -1 }), /non-negative finite/);
    assert.throws(() => claim({ count: NaN }), /non-negative finite/);
    assert.throws(() => claim({ count: undefined }), /non-negative finite/);
  });

  test('observed above population throws — coverage over 1 would render as certainty', () => {
    assert.throws(() => claim({ count: 1, observed: 11, population: 10 }), /exceeds population/);
  });

  test('a missing population is ALLOWED and renders as unknown — a lane must still be able to publish', () => {
    const c = claim({ count: 3, observed: 5 });
    assert.equal(c.coverage, null);
    assert.equal(c.complete, false);
  });
});

describe('the asymmetry', () => {
  test('full coverage: a zero IS a population zero', () => {
    const c = claim({ count: 0, observed: 100, population: 100, unit: 'repo', of: 'critical' });
    assert.equal(c.complete, true);
    assert.equal(c.zeroIsPopulationZero, true);
    assert.equal(c.floor, false);
    assert.match(render(c), /^0 criticals across all 100 repos$/);
  });

  test('partial coverage: a zero is NOT a population zero, and says so in the sentence', () => {
    const c = claim({ count: 0, observed: 60, population: 100, unit: 'repo', of: 'critical' });
    assert.equal(c.zeroIsPopulationZero, false);
    const s = render(c);
    assert.match(s, /NOT a population zero/);
    assert.doesNotMatch(s, /clean/i, 'the word this module exists to prevent');
  });

  test('partial coverage: a NON-zero renders as a floor, which is the graceful case', () => {
    const c = claim({ count: 47, observed: 60, population: 100, unit: 'repo', of: 'critical' });
    assert.match(render(c), /^at least 47 criticals in 60 of 100 repo\(s\)/);
    assert.equal(c.floor, true);
  });

  test('zeroIsPopulationZero is null for a non-zero — the field means nothing there', () => {
    assert.equal(claim({ count: 5, observed: 5, population: 5 }).zeroIsPopulationZero, null);
  });
});

describe('undetermined units are not covered units', () => {
  test('a scanned-but-unanswered unit reduces DETERMINED coverage, not examined coverage', () => {
    const c = claim({ count: 0, observed: 100, population: 100, undetermined: 40, unit: 'repo' });
    assert.equal(c.coverage, 1, 'every repo was examined');
    assert.equal(c.determinedCoverage, 0.6, 'and only 60 of them answered');
    assert.equal(c.complete, false);
    assert.equal(c.zeroIsPopulationZero, false, 'a scan that ran and did not answer is, for a zero, a scan that did not run');
  });

  test('with nothing undetermined the two coverages agree', () => {
    const c = claim({ count: 0, observed: 100, population: 100 });
    assert.equal(c.coverage, c.determinedCoverage);
    assert.equal(c.complete, true);
  });
});

describe('publishable — the guard', () => {
  test('a partial zero becomes an explicit unknown with the claim PRESERVED beside it', () => {
    const c = claim({ count: 0, observed: 60, population: 100, unit: 'repo', of: 'critical' });
    const p = publishable(c);
    assert.equal(isUnknown(p), true);
    assert.equal(p.unknownReason, 'unexaminable');
    assert.equal(p.claim.count, 0, 'the original claim is never erased — house rule');
    assert.equal(p.claim.population, 100);
  });

  test('a complete zero passes through untouched', () => {
    const c = claim({ count: 0, observed: 10, population: 10 });
    assert.equal(publishable(c), c);
  });

  test('a partial NON-zero passes through — over-reporting an unknown is the mirror defect', () => {
    const c = claim({ count: 3, observed: 6, population: 10 });
    assert.equal(publishable(c), c, 'a floor is a legitimate publishable value; only the zero is not');
  });

  test('a zero over an unknown population is unknown, and says the fraction is unknown', () => {
    const p = publishable(claim({ count: 0, observed: 5 }));
    assert.equal(isUnknown(p), true);
    assert.match(p.unknownDetail, /an unknown fraction/);
  });
});

describe('combine — one unknown population poisons the denominator', () => {
  test('complete sub-populations sum to a complete total', () => {
    const t = combine([
      claim({ count: 2, observed: 10, population: 10 }),
      claim({ count: 3, observed: 20, population: 20 }),
    ], { unit: 'repo', of: 'critical' });
    assert.equal(t.count, 5);
    assert.equal(t.population, 30);
    assert.equal(t.complete, true);
  });

  test('ONE unknown-population member makes the total unknown, never silently excluded', () => {
    const t = combine([
      claim({ count: 2, observed: 10, population: 10 }),
      claim({ count: 1, observed: 4 }),
    ]);
    assert.equal(t.count, 3);
    assert.equal(t.population, null, 'excluding the unmeasurable member would flatter the coverage');
    assert.equal(t.complete, false);
  });

  test('undetermined units accumulate across members', () => {
    const t = combine([
      claim({ count: 0, observed: 10, population: 10, undetermined: 3 }),
      claim({ count: 0, observed: 10, population: 10, undetermined: 2 }),
    ]);
    assert.equal(t.undetermined, 5);
    assert.equal(t.determinedCoverage, 0.75);
    assert.equal(publishable(t).unknown, true);
  });

  test('an empty set is a complete zero over a zero population, not an error', () => {
    const t = combine([]);
    assert.equal(t.count, 0);
    assert.equal(t.population, 0);
  });
});

describe('render never emits a bare integer', () => {
  test('every shape mentions its population or says the population is unknown', () => {
    const shapes = [
      claim({ count: 0, observed: 10, population: 10 }),
      claim({ count: 0, observed: 6, population: 10 }),
      claim({ count: 4, observed: 6, population: 10 }),
      claim({ count: 4, observed: 6 }),
      claim({ count: 0, observed: 0, population: 0 }),
    ];
    for (const c of shapes) {
      const s = render(c);
      assert.match(s, /population|of \d+ |across all \d+/, `bare count rendered: ${s}`);
    }
  });

  test('singular and plural read correctly', () => {
    assert.match(render(claim({ count: 1, observed: 1, population: 1, of: 'critical', unit: 'repo' })), /1 critical across all 1 repo$/);
  });
});
