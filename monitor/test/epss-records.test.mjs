// The EPSS parse — the guard that did not exist when it started discarding two of three facts.
//
// monitor/rollup.mjs kept `+d.epss` and dropped `d.percentile` and `d.date`. Nothing caught it
// because the parse was an inline arrow inside a module that publishes on import, so no test could
// call it. It is now monitor/epss.mjs, and these are the assertions that make a second regression
// a failure rather than a silence.
//
// The response shape below is REAL, captured from api.first.org on 2026-08-26, not imagined.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { epssRecordsFrom } from '../epss.mjs';

// Verbatim from `curl https://api.first.org/data/v1/epss?cve=CVE-2026-53550`
const LIVE = {
  status: 'OK',
  data: [{ cve: 'CVE-2026-53550', epss: '0.003860000', percentile: '0.314200000', date: '2026-08-25' }],
};

describe('EPSS parse', () => {
  test('all THREE facts the feed returns are retained — this is the regression', () => {
    const { scores, detail } = epssRecordsFrom(LIVE);
    assert.equal(scores['CVE-2026-53550'], 0.00386, 'the score cache keeps its number contract');
    assert.deepEqual(detail['CVE-2026-53550'], {
      probability: '0.003860000', percentile: '0.314200000', date: '2026-08-25',
    }, 'percentile and date were dropped here for months; they must survive');
  });

  test('strings are VERBATIM, not round-tripped through a float', () => {
    const { detail } = epssRecordsFrom(LIVE);
    assert.equal(detail['CVE-2026-53550'].probability, '0.003860000',
      'CSAF 2.1 constrains this to a fixed decimal pattern; String(0.00386) would lose the form');
    // The concrete hazard, proven rather than asserted:
    assert.notEqual(String(3.86e-7), '0.000000386', 'a small float renders exponential, which 2.1 rejects');
  });

  test('a partial record yields a SCORE but no sidecar entry — never a padded triple', () => {
    const { scores, detail } = epssRecordsFrom({
      data: [{ cve: 'CVE-2026-0002', epss: '0.5' }], // no percentile, no date
    });
    assert.equal(scores['CVE-2026-0002'], 0.5, 'the older score contract must not regress');
    assert.equal(detail['CVE-2026-0002'], undefined, 'a percentile we invented is worse than a metric we omitted');
  });

  test('a non-numeric score is absent, never 0.0', () => {
    const { scores } = epssRecordsFrom({ data: [{ cve: 'CVE-2026-0003', epss: 'n/a', percentile: 'x', date: 'y' }] });
    assert.equal(scores['CVE-2026-0003'], undefined, '0.0 would read as measured-and-negligible');
  });

  test('feed-supplied keys are shape-validated — a hostile key never reaches a shared cache', () => {
    const { scores, detail } = epssRecordsFrom({
      data: [
        { cve: '__proto__', epss: '0.9', percentile: '0.9', date: '2026-08-25' },
        { cve: 'constructor', epss: '0.9', percentile: '0.9', date: '2026-08-25' },
        { cve: 'CVE-2026-0004', epss: '0.1', percentile: '0.1', date: '2026-08-25' },
      ],
    });
    assert.deepEqual(Object.keys(scores), ['CVE-2026-0004']);
    assert.deepEqual(Object.keys(detail), ['CVE-2026-0004']);
    assert.equal(Object.getPrototypeOf(scores), null, 'a null-prototype map cannot be polluted at all');
    assert.equal({}.polluted, undefined, 'and nothing leaked onto Object.prototype');
  });

  test('an empty or malformed response is empty, not a throw and not a fabricated entry', () => {
    for (const bad of [null, undefined, {}, { data: null }, { data: [] }, { data: [null] }]) {
      const { scores, detail } = epssRecordsFrom(bad);
      assert.deepEqual(Object.keys(scores), []);
      assert.deepEqual(Object.keys(detail), []);
    }
  });

  test('non-vacuity — the parser is not simply returning everything', () => {
    const { detail } = epssRecordsFrom({ data: [{ cve: 'not-a-cve', epss: '0.5', percentile: '0.5', date: 'd' }] });
    assert.deepEqual(Object.keys(detail), [], 'the shape guard did nothing, so the tests above prove nothing');
  });
});
