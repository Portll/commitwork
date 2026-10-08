// Every detector binding must name a class that EXISTS, and the coverage denominator must be
// derived from the registry rather than restated.
//
// WHY THIS IS NOT PARANOIA. bin/pattern-scan.mjs publishes a reach statement — "97 of 103 classes
// were NOT SCANNED. Their absence from these results is absence of evidence, not evidence of
// absence." That sentence is the most load-bearing thing the scanner says, and it is arithmetic over
// two files: the class registry and the bindings. A typo'd `classId` attributes findings to a
// phantom class AND silently shifts the denominator, so the honest-sounding statement becomes a
// false one — the failure this whole scanner exists to detect, committed by the scanner.
//
// Measured 2026-08-26 before writing this: 0 bad bindings, 0 bad withheld entries. So it is passing
// today. It is worth having precisely because it is passing today: the integrity was true and
// nothing made it HAVE to be, which is the difference between a fact and a streak.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const taxonomyPath = () => process.env.CW_TAXONOMY_JSON || join(CW, 'monitor', 'failure-taxonomy.json');
const bindingsPath = () => process.env.CW_PATTERN_BINDINGS || join(CW, 'monitor', 'detector-bindings.json');

const classIds = () => new Set(read(taxonomyPath()).classes.map((c) => c.id));
const bindings = () => read(bindingsPath());

describe('detector bindings refer to classes that exist', () => {
  test('every active binding names a real class', () => {
    const ids = classIds();
    const bad = bindings().detectors.filter((d) => !ids.has(d.classId)).map((d) => `${d.id} -> ${d.classId}`);
    assert.deepEqual(bad, [],
      'a binding naming a class the registry does not declare attributes findings to a phantom '
      + 'and corrupts the scanned/total denominator in the reach statement');
  });

  test('every WITHHELD binding names a real class too', () => {
    const ids = classIds();
    const bad = (bindings().withheld || []).filter((d) => !ids.has(d.classId)).map((d) => `${d.id} -> ${d.classId}`);
    assert.deepEqual(bad, [],
      'a withheld detector is still a declared intention to cover a class; naming a phantom one '
      + 'means the gap it documents does not exist');
  });

  test('every binding carries an id, a substrate and a covers statement', () => {
    const SUBSTRATES = new Set(['SRC', 'HIST', 'ART']);
    for (const d of bindings().detectors) {
      assert.ok(d.id && typeof d.id === 'string', `a binding has no id: ${JSON.stringify(d).slice(0, 120)}`);
      assert.ok(SUBSTRATES.has(d.substrate), `${d.id}: evidence substrate ${JSON.stringify(d.substrate)} is not one of SRC/HIST/ART`);
      assert.ok(typeof d.covers === 'string' && d.covers.trim().length > 20,
        `${d.id}: a detector that does not say WHAT it covers cannot have its coverage judged`);
    }
  });

  test('every withheld entry carries a reason — a silent withholding is just a gap', () => {
    for (const d of bindings().withheld || []) {
      assert.ok(typeof d.reason === 'string' && d.reason.trim().length > 30,
        `${d.id}: withheld with no substantive reason. The whole value of the withheld list is that `
        + 'it records a judgement rather than an absence.');
    }
  });

  test('binding ids are unique — two detectors sharing an id make one of them unreportable', () => {
    const seen = new Set(), dupes = [];
    for (const d of bindings().detectors) {
      if (seen.has(d.id)) dupes.push(d.id);
      seen.add(d.id);
    }
    assert.deepEqual(dupes, []);
  });
});

describe('the guard bites', () => {
  // The integrity above is currently true. These prove the assertions would NOTICE if it stopped
  // being — a passing test over a set that cannot fail is the shape this repository keeps finding.
  const idsOf = (bs) => new Set(read(taxonomyPath()).classes.map((c) => c.id));

  test('a phantom classId on an active binding is caught', () => {
    const ids = idsOf();
    const mutated = [...bindings().detectors, { id: 'x', version: 1, substrate: 'SRC', classId: 'ZZ99', covers: 'x'.repeat(30) }];
    const bad = mutated.filter((d) => !ids.has(d.classId)).map((d) => d.classId);
    assert.deepEqual(bad, ['ZZ99']);
  });

  test('a withheld entry with a one-word reason is caught', () => {
    const mutated = [{ id: 'y', classId: 'K8', reason: 'noisy' }];
    const bad = mutated.filter((d) => !(typeof d.reason === 'string' && d.reason.trim().length > 30)).map((d) => d.id);
    assert.deepEqual(bad, ['y']);
  });
});

describe('the reach denominator is the registry, never a restated number', () => {
  test('pattern-scan computes classesTotal from the taxonomy rather than a literal', () => {
    const src = readFileSync(join(CW, 'bin', 'pattern-scan.mjs'), 'utf8')
      + readFileSync(join(CW, 'bin', 'lib', 'pattern-core.mjs'), 'utf8');
    assert.ok(!/classesTotal:\s*\d+/.test(src),
      'a literal classesTotal would go stale the moment a class is added — monitor/taxonomy-substrates.json '
      + 'already records that the registry grew 97 -> 103 and that the map had to be re-derived, not restated');
  });

  test('the registry has more classes than are bound, so the reach statement is not vacuous', () => {
    const total = classIds().size;
    const bound = new Set(bindings().detectors.map((d) => d.classId)).size;
    assert.ok(bound > 0, 'no bindings at all — the scanner would report a clean tree it never read');
    assert.ok(bound < total,
      'if every class were bound the reach statement would be trivially complete; it is not, and the '
      + 'statement must keep saying so');
  });
});

// ── THE BASELINE'S PROVENANCE IS COMPARED, NOT MERELY CARRIED ───────────────────────────────────
// monitor/pattern-baseline.json records `bindingsSha256` so a reader can tell whether it was seeded
// against THIS detector set. Until 2026-08-26 nothing read it back, which made the field a
// provenance claim that provenance never checked — and it went stale the same day it shipped:
// binding G12 moved the digest while the baseline went on suppressing 68 identities against a set
// it was not seeded from.
//
// The sharp case is a NARROWED predicate. An identity seeded when a detector matched broadly stays
// suppressed after the detector narrows, so the baseline can hold down a finding the current rules
// would raise. Class R4, a structurally frozen metric.
describe('the baseline digest is checked at read time, not just written at seed time', () => {
  const SRC = readFileSync(join(CW, 'bin', 'pattern-scan.mjs'), 'utf8');

  test('pattern-scan COMPARES the recorded digest against the current bindings', () => {
    assert.match(SRC, /baseline\.value\.bindingsSha256\s*!==\s*sha256\(bindingsRaw\)/,
      'a recorded digest nobody compares is provenance that provenance never checks');
  });

  test('a mismatch is reported as UNDETERMINED, never refused and never ignored', () => {
    const block = SRC.slice(SRC.indexOf('const baselineStale'), SRC.indexOf('let results = adjudicate'));
    assert.match(block, /classId: 'R4'/, 'the class is R4 — a structurally frozen metric');
    assert.match(block, /confidence: 'inferred'/,
      'the digest mismatch is structural but its IMPLICATION for any one suppression is not — '
      + 'inferred is the tier that routes this to undetermined rather than to the finding count');
    assert.ok(!/throw new Error\([^)]*bindingsSha256/.test(block),
      'a binding change is ordinary and legitimate; refusing the run would make every legitimate '
      + 'binding edit a stoppage');
  });

  test('the run record surfaces it so a JSON consumer need not parse observations', () => {
    assert.match(SRC, /record\.baselineProvenance\s*=/);
    assert.match(SRC, /stale:\s*!!baselineStale/);
  });
});

// ── THE BASELINE SCHEMA'S PREFIX SET IS A COPY, SO IT IS COMPARED ───────────────────────────────
// schema/pattern-baseline.schema.json pins identity ids to the taxonomy's family prefixes with a
// character class. That is a hand-kept second copy of families[].prefix, and it drifted: family XI
// (L, collective_action) was numbered in taxonomy v9 and the schema still listed ten prefixes on
// 2026-09-01, by which point the registry held 173 classes across 11 families.
//
// It was LATENT rather than live — no L detector is bound, so no L identity could be produced — and
// the failure shape is what makes it worth a guard: `--seed` writes the identity, and the NEXT run's
// validation refuses the entire baseline. The cost lands on a later, unrelated run.
describe('the baseline schema knows every family prefix the taxonomy declares', () => {
  const prefixSet = () => {
    const pat = read(join(CW, 'schema', 'pattern-baseline.schema.json'))
      .properties.identities.items.pattern;
    const m = /\[([A-Z]+)\]/.exec(pat);
    assert.ok(m, `no character class found in the identity pattern: ${pat}`);
    return new Set(m[1].split(''));
  };
  const taxonomyPrefixes = () => new Set(read(taxonomyPath()).families.map((f) => f.prefix));

  test('every taxonomy family prefix is accepted by the schema', () => {
    const inSchema = prefixSet();
    const missing = [...taxonomyPrefixes()].filter((p) => !inSchema.has(p)).sort();
    assert.deepEqual(missing, [],
      'a family the schema cannot spell makes every identity in it unwritable — and unwritable only '
      + 'on the READ, one run after the seed that produced it');
  });

  test('and the schema accepts no prefix the taxonomy does not declare', () => {
    const declared = taxonomyPrefixes();
    const extra = [...prefixSet()].filter((p) => !declared.has(p)).sort();
    assert.deepEqual(extra, [],
      'a prefix with no family behind it would let a malformed id validate — the pattern is a '
      + 'closed set on purpose, in both directions');
  });

  test('the counts agree, so neither assertion above is vacuous', () => {
    assert.equal(prefixSet().size, taxonomyPrefixes().size);
    assert.ok(taxonomyPrefixes().size >= 11, 'the registry had 11 families on 2026-09-01');
  });
});
