// byKind must reach a READER, not just a writer.
//
// The kind partition landed (2026-08-26) with a commit message calling it "the mechanism D15 needs".
// It was computed, conservation-tested, and serialised into every rollup on the fleet — and a grep
// for consumers returned NOTHING outside its own module and tests. Built, tested, fed by nothing,
// which is this repository's own top defect class, in the commit that claimed to fix the headline.
// It went unnoticed for a day because every check asked whether the arithmetic was right and none
// asked whether anybody could see it.
//
// So this asserts the READ side, and it asserts it two ways that cannot share a failure mode:
//   1. the source of monitor/rollup.mjs actually references byKind on a path that emits output
//   2. the derived sentence is correct for known inputs, and EMPTY when there is nothing to say
// A marker-only version of (1) would stay green if the wiring were deleted from the emitting line
// and left in a comment; (2) alone would stay green while nothing called it. Neither is sufficient.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sumTotals } from '../extractors.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROLLUP = readFileSync(join(HERE, '..', 'rollup.mjs'), 'utf8');

// The derivation, lifted from rollup.mjs by shape rather than re-implemented from memory: a copy
// that drifts would certify the copy. This is the same expression the source uses.
const kindLineOf = (totals) => Object.entries(totals.byKind || {})
  .map(([k, b]) => [k, ['crit', 'high', 'med', 'low'].reduce((n, s) => n + (b[s] || 0), 0), b.undetermined || 0])
  .filter(([, graded, undet]) => graded || undet)
  .sort((a, b) => b[1] - a[1] || b[2] - a[2])
  .map(([k, graded, undet]) => `${graded} ${k}${undet ? ` (+${undet} undetermined)` : ''}`);

const cve = (o = {}) => ({ crit: 0, high: 0, med: 0, low: 0, undetermined: 0, cves: 0, kev: 0, repos: 1, ...o });

describe('the partition has consumers, and they emit', () => {
  test('rollup.mjs derives a kind line at all', () => {
    assert.match(ROLLUP, /const kindLine = Object\.entries\(totals\.byKind/,
      'the derivation is gone — byKind is back to being written and never read');
  });

  test('AT LEAST TWO consumers emit it, and each is on a line that produces output', () => {
    // Counting `kindLine` mentions would pass on two comments. These are the emitting shapes.
    const consoleUse = /console\.log\([^\n]*kindLine\.join/.test(ROLLUP);
    const docUse = /kindLine\.join[^\n]*\)\]\s*:\s*\[\]\)/.test(ROLLUP)
      || /\*\*By kind:\*\*[^\n]*kindLine\.join/.test(ROLLUP);
    assert.ok(consoleUse, 'the sweep console no longer prints it');
    assert.ok(docUse, 'REMEDIATION.md no longer carries it');
  });

  test('the declaration precedes both uses — the first wiring threw on a temporal dead zone', () => {
    const decl = ROLLUP.indexOf('const kindLine =');
    const uses = [...ROLLUP.matchAll(/kindLine\.(join|length)/g)].map((m) => m.index);
    assert.ok(decl > -1 && uses.length >= 2);
    for (const u of uses) assert.ok(u > decl, `kindLine used at ${u}, declared at ${decl}`);
  });
});

describe('the sentence it derives is true', () => {
  test('a mixed fleet names each kind with its graded count and its undetermined tail', () => {
    const t = sumTotals(cve({ crit: 1, high: 2 }), {
      secrets: { high: 5 },                    // vulnerability
      cspm: { med: 40 },                       // posture
      supplyChain: { low: 13, undetermined: 37953, byKind: { policy: { crit: 0, high: 0, med: 0, low: 0, undetermined: 37296 }, integrity: { crit: 0, high: 0, med: 0, low: 13, undetermined: 591 }, vulnerability: { crit: 0, high: 0, med: 0, low: 0, undetermined: 66 } } },
    });
    const line = kindLineOf(t);
    const joined = line.join(' · ');
    assert.match(joined, /vulnerability/);
    assert.match(joined, /policy/);
    assert.match(joined, /37296 undetermined/, 'the licence tail must be stated, not swallowed');
    // Ordering is by graded count, so the loudest GRADED kind leads — not the biggest raw pile.
    assert.match(line[0], /posture|vulnerability/, `led with ${line[0]}`);
  });

  test('a kind that carries nothing is not mentioned — a fleet with one kind says one thing', () => {
    const t = sumTotals(cve({ high: 3 }), {});
    const line = kindLineOf(t);
    assert.deepEqual(line, ['3 vulnerability'], `said ${JSON.stringify(line)}`);
  });

  test('EMPTY when there is nothing to say, so a clean fleet gets no decorative line', () => {
    assert.deepEqual(kindLineOf(sumTotals(cve(), {})), []);
    assert.deepEqual(kindLineOf({}), [], 'a totals object with no byKind must not throw');
  });

  test('an undetermined-only kind still appears — grey must be visible, not merely out of red', () => {
    const t = sumTotals(cve(), { supplyChain: { undetermined: 42 } });
    assert.deepEqual(kindLineOf(t), ['0 policy (+42 undetermined)']);
  });

  test('an unclassified lane is NAMED, not folded into vulnerability', () => {
    const t = sumTotals(cve(), { somethingNewLandedTonight: { crit: 4 } });
    assert.deepEqual(kindLineOf(t), ['4 unclassified']);
  });

  test('non-vacuity: the derived line really tracks the partition', () => {
    // If byKind were empty the tests above could pass on a coincidence of empty arrays.
    const t = sumTotals(cve({ high: 1 }), { cspm: { high: 1 }, shellLint: { low: 1 } });
    assert.equal(kindLineOf(t).length, 3, `only ${kindLineOf(t).length} kinds carried anything`);
  });
});
