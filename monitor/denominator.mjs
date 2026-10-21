// monitor/denominator.mjs — a count and the population it was drawn from, as ONE value.
//
// THE DISCIPLINE, AND WHERE IT COMES FROM. Amnesty International's Pegasus report states the
// coverage of every number it publishes, inside the sentence that publishes it: 1,748 observed
// subdomains are "less than 7% of the 379 Pegasus Installation Server domains"; passive DNS
// "represents only a small subset"; no resolutions at all were recorded for the Morocco domains.
// That is why the report's several no-evidence-found cases were never written up as clean, and it
// is the single practice that makes the rest of the document survive being checked.
//
// commitwork already computes coverage — monitor/coverage-manifest.mjs knows which ecosystems have
// no lane, monitor/unknown.mjs gives every undetermined result a reason. What it does not do is
// make the coverage TRAVEL with the count. A number computed honestly and rendered bare becomes a
// dishonest number one function call later, and nothing in the type system objects.
//
// THE ASYMMETRY THIS EXISTS FOR. Every headline number degrades gracefully under partial coverage
// except zero. "47 criticals over 60% of the fleet" is obviously a floor and reads as one. "0
// criticals over 60% of the fleet" reads, to every human who sees it, as "0 criticals" — because
// a sample's silence and a population's silence are the same shape. So a zero drawn from partial
// coverage is not a small number here; it is a DIFFERENT KIND of value, and `zeroIsPopulationZero`
// is false for it.
//
// This module is pure and has no I/O. It is meant to be cheap enough that a lane has no excuse.

import { unknown } from './unknown.mjs';

/**
 * Build a claim.
 *
 * @param {object} spec
 * @param {number} spec.count       what was found
 * @param {number} [spec.observed]  units actually examined
 * @param {number} [spec.population] units that COULD have been examined; null when not knowable
 * @param {number} [spec.undetermined] units examined whose result is unknown (see monitor/unknown.mjs)
 * @param {string} [spec.unit]      what a unit IS — 'repo', 'package', 'indicator'
 * @param {string} [spec.of]        what is being counted, for rendering
 *
 * Throws when `count` is not a finite number. It does NOT throw on a missing population: a lane
 * that genuinely cannot know its denominator must still be able to publish, and `coverage: null`
 * plus `complete: false` is the honest rendering of that. What it must not do is publish a bare
 * integer, and that is what this type prevents.
 */
export function claim({ count, observed = null, population = null, undetermined = 0, unit = 'unit', of = 'finding' } = {}) {
  if (!Number.isFinite(count) || count < 0) {
    throw new Error(`denominator: count must be a non-negative finite number, got ${JSON.stringify(count)}`);
  }
  for (const [k, v] of Object.entries({ observed, population })) {
    if (v !== null && (!Number.isFinite(v) || v < 0)) {
      throw new Error(`denominator: ${k} must be a non-negative finite number or null, got ${JSON.stringify(v)}`);
    }
  }
  if (observed !== null && population !== null && observed > population) {
    throw new Error(`denominator: observed (${observed}) exceeds population (${population}) — the denominator is wrong, and a coverage above 1 would render as certainty`);
  }

  const coverage = (observed !== null && population !== null && population > 0)
    ? round4(observed / population)
    : (population === 0 ? 0 : null);

  // Determined coverage is stricter than examined coverage: a unit that was scanned and yielded an
  // undetermined result has been LOOKED AT and not ANSWERED, which for a zero is the same as not
  // having been looked at.
  const determined = observed === null ? null : Math.max(0, observed - undetermined);
  const determinedCoverage = (determined !== null && population !== null && population > 0)
    ? round4(determined / population)
    : (population === 0 ? 0 : null);

  const complete = determinedCoverage === 1;
  const isZero = count === 0;

  return {
    count, observed, population, undetermined, unit, of,
    coverage, determinedCoverage, complete,
    // The whole reason the module exists.
    zeroIsPopulationZero: isZero ? complete : null,
    // A non-zero count under partial coverage is a floor; that is unsurprising and still worth
    // saying, because a reader comparing two periods needs to know the denominators differed.
    floor: !complete,
  };
}

/**
 * The one-line rendering. Every caller that prints a count should print THIS instead, and the
 * house style is that the coverage clause is part of the sentence rather than a footnote.
 */
export function render(c) {
  const noun = `${c.of}${c.count === 1 ? '' : 's'}`;
  if (c.complete) return `${c.count} ${noun} across all ${c.population} ${c.unit}${c.population === 1 ? '' : 's'}`;

  const scope = c.population === null
    ? `${c.observed ?? 'an unstated number of'} ${c.unit}(s) of an unknown population`
    : `${c.observed ?? 0} of ${c.population} ${c.unit}(s)` + (c.determinedCoverage !== null ? ` (${pct(c.determinedCoverage)} determined)` : '');

  if (c.count === 0) {
    // Never the bare word "zero", and never "clean".
    return `no ${c.of} found in ${scope} — this is silence over a partial population, NOT a population zero`;
  }
  return `at least ${c.count} ${noun} in ${scope} — a floor, not a total`;
}

/**
 * The guard. Call before publishing a count anywhere a reader will treat it as a fact.
 * Returns the claim unchanged, or an `unknown` when the claim is a zero that cannot bear the
 * reading it will inevitably get.
 *
 * This is deliberately NOT a throw. A lane whose coverage is partial must still emit something,
 * and the correct something is an explicit unknown with the count preserved beside it — the house
 * rule is that an undetermined belongs in its own field with the original claim intact, never
 * erased and never promoted into a verdict bucket.
 */
export function publishable(c) {
  if (c.count === 0 && !c.complete) {
    return {
      ...unknown('unexaminable',
        `0 ${c.of}(s) over ${c.determinedCoverage === null ? 'an unknown fraction' : pct(c.determinedCoverage)} of ${c.population ?? 'an unknown'} ${c.unit}(s)`),
      claim: c,
    };
  }
  return c;
}

/**
 * Sum claims over sub-populations — the fleet-level rollup. Coverage composes as the sum of
 * observed over the sum of populations, and ONE unknown population poisons the whole denominator
 * rather than being treated as zero. A sub-population of unknown size cannot be added to a total
 * and must not be quietly excluded from it.
 */
export function combine(claims, { unit = 'unit', of = 'finding' } = {}) {
  if (!claims.length) return claim({ count: 0, observed: 0, population: 0, unit, of });
  const anyUnknownPopulation = claims.some((c) => c.population === null);
  return claim({
    count: claims.reduce((n, c) => n + c.count, 0),
    observed: claims.some((c) => c.observed === null) ? null : claims.reduce((n, c) => n + c.observed, 0),
    population: anyUnknownPopulation ? null : claims.reduce((n, c) => n + c.population, 0),
    undetermined: claims.reduce((n, c) => n + (c.undetermined || 0), 0),
    unit, of,
  });
}

const round4 = (n) => Math.round(n * 10000) / 10000;
const pct = (f) => `${(f * 100).toFixed(1)}%`;
