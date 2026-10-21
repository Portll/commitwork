import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  validate,
  toObjects,
  subsumptions,
  singletonValues,
  collisions,
  loadAttributes,
  UNCONSTRAINED,
  mechanismControl,
  sameDefectShare,
  orderedDistinct,
  unbackedSubsumptions,
  fanOut,
  rcaEdges,
} from '../taxonomy-lattice.mjs';

const SCHEMA = {
  actor: { values: ['guard', 'reader'] },
  direction: { values: ['false-clean', 'loss'] },
};

test('an off-vocabulary value is refused, not absorbed', () => {
  // Absorbed, it would become its own attribute and separate two classes for a
  // reason nobody chose.
  const problems = validate({
    schema: SCHEMA,
    encodings: { X1: { actor: ['guard'], direction: ['invented'] } },
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /'invented' is not in the 'direction' vocabulary/);
});

test('a missing dimension is refused', () => {
  const problems = validate({ schema: SCHEMA, encodings: { X1: { actor: ['guard'] } } });
  assert.match(problems[0], /missing dimension 'direction'/);
});

test("'*' mixed with a concrete value is refused", () => {
  const problems = validate({
    schema: SCHEMA,
    encodings: { X1: { actor: ['guard', UNCONSTRAINED], direction: ['loss'] } },
  });
  assert.match(problems[0], /mixes '\*' with concrete values/);
});

test("'*' alone is accepted", () => {
  const problems = validate({
    schema: SCHEMA,
    encodings: { X1: { actor: [UNCONSTRAINED], direction: ['loss'] } },
  });
  assert.deepEqual(problems, []);
});

test("'*' contributes no attribute", () => {
  const objects = toObjects({ X1: { actor: [UNCONSTRAINED], direction: ['loss'] } });
  assert.deepEqual(objects.X1, ['direction:loss']);
});

test('subsumption is EMPTY when every class fixes every dimension', () => {
  // The defect this encoding hit on its first pass: equal-size intents cannot
  // contain one another, so the order the tool exists to find is precluded by
  // the schema rather than absent from the subject.
  const objects = toObjects({
    A: { actor: ['guard'], direction: ['loss'] },
    B: { actor: ['reader'], direction: ['false-clean'] },
    C: { actor: ['guard'], direction: ['false-clean'] },
  });
  assert.deepEqual(subsumptions(objects), []);
});

test("a class general in a dimension is subsumed by one that fixes it", () => {
  // Proves the '*' mechanism actually produces an order, rather than asserting it.
  const objects = toObjects({
    GENERAL: { actor: ['guard'], direction: [UNCONSTRAINED] },
    SPECIAL: { actor: ['guard'], direction: ['loss'] },
  });
  assert.deepEqual(subsumptions(objects), [['SPECIAL', 'GENERAL']]);
});

test('subsumption is antisymmetric — no pair points both ways', () => {
  const objects = toObjects({
    G: { actor: ['guard'], direction: [UNCONSTRAINED] },
    S: { actor: ['guard'], direction: ['loss'] },
    T: { actor: ['guard'], direction: ['false-clean'] },
  });
  const seen = new Set(subsumptions(objects).map(([a, b]) => `${a}>${b}`));
  for (const key of seen) {
    const [a, b] = key.split('>');
    assert.ok(!seen.has(`${b}>${a}`), `${a} and ${b} subsume each other`);
  }
});

test('singletonValues names the attributes that discriminate nothing', () => {
  const objects = toObjects({
    A: { actor: ['guard'], direction: ['loss'] },
    B: { actor: ['guard'], direction: ['false-clean'] },
  });
  // actor:guard is shared; both directions are carried by exactly one class.
  assert.deepEqual(singletonValues(objects), ['direction:false-clean', 'direction:loss']);
});

test('collisions reports a control pair the encoding failed to separate', () => {
  const objects = toObjects({
    A: { actor: ['guard'], direction: ['loss'] },
    B: { actor: ['guard'], direction: ['loss'] }, // identical encoding
  });
  assert.deepEqual(collisions([['A', 'B']], objects), [['A', 'B']]);
});

test('collisions ignores pairs outside the encoded slice', () => {
  const objects = toObjects({ A: { actor: ['guard'], direction: ['loss'] } });
  assert.deepEqual(collisions([['A', 'NOT_ENCODED']], objects), []);
});

test('a missing encoding file is refused, not treated as an empty store', () => {
  assert.throws(() => loadAttributes('/nonexistent/attributes.json'), /no encoding file/);
});

test('the env override is read at call time', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-lattice-'));
  const path = join(dir, 'attrs.json');
  writeFileSync(path, JSON.stringify({ schema: SCHEMA, encodings: {} }));
  const prev = process.env.CW_LATTICE_ATTRS;
  process.env.CW_LATTICE_ATTRS = path;
  try {
    assert.deepEqual(loadAttributes().encodings, {});
  } finally {
    if (prev === undefined) delete process.env.CW_LATTICE_ATTRS;
    else process.env.CW_LATTICE_ATTRS = prev;
  }
});


const OBJ = {
  GEN: ['observation:x', 'remedy:r'],
  SPEC: ['actor:guard', 'observation:x', 'remedy:r'],
  PEER: ['actor:reader', 'observation:x', 'remedy:r'],
  OTHER: ['actor:guard', 'observation:y', 'remedy:q'],
};

test('mechanismControl accepts a subject that specialises its target', () => {
  const r = mechanismControl([{ from: 'SPEC', relation: 'mechanism-of', to: 'GEN' }], OBJ);
  assert.equal(r.specialised.length, 1);
  assert.deepEqual(r.missed, []);
});

test('mechanismControl names an inverted edge', () => {
  const r = mechanismControl([{ from: 'GEN', relation: 'mechanism-of', to: 'SPEC' }], OBJ);
  assert.equal(r.missed[0].outcome, 'inverted');
});

test('mechanismControl names what an unrelated target still needs', () => {
  const r = mechanismControl([{ from: 'OTHER', relation: 'mechanism-of', to: 'GEN' }], OBJ);
  assert.match(r.missed[0].outcome, /unrelated, target needs observation:x remedy:r/);
});

test('mechanismControl ignores edges outside the slice', () => {
  const r = mechanismControl([{ from: 'SPEC', relation: 'mechanism-of', to: 'NOPE' }], OBJ);
  assert.equal(r.all.length, 0);
});

test('sameDefectShare counts a symmetric edge once and splits by shared mechanism', () => {
  const edges = [
    { from: 'SPEC', relation: 'same-defect-as', to: 'PEER' },
    { from: 'PEER', relation: 'same-defect-as', to: 'SPEC' },
    { from: 'SPEC', relation: 'same-defect-as', to: 'OTHER' },
  ];
  const r = sameDefectShare(edges, OBJ);
  assert.equal(r.all.length, 2);
  assert.deepEqual(r.sharing, [['PEER', 'SPEC']]);
  assert.deepEqual(r.apart, [['OTHER', 'SPEC']]);
});

test('orderedDistinct reports a prose-distinct pair in either direction', () => {
  assert.deepEqual(orderedDistinct([['GEN', 'SPEC']], [['SPEC', 'GEN']]), [['SPEC', 'GEN']]);
});

test('unbackedSubsumptions drops relations an rca mechanism-of edge supports', () => {
  const subs = [['SPEC', 'GEN'], ['PEER', 'GEN']];
  const edges = [{ from: 'SPEC', relation: 'mechanism-of', to: 'GEN' }];
  assert.deepEqual(unbackedSubsumptions(subs, edges), [['PEER', 'GEN']]);
});

test('fanOut ranks general classes by descendant count', () => {
  assert.deepEqual(fanOut([['A', 'G'], ['B', 'G'], ['C', 'H']]), [['G', 2], ['H', 1]]);
});

test('rcaEdges keeps judged relations and drops unassessed ones', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-rca-'));
  const path = join(dir, 'tax.json');
  writeFileSync(path, JSON.stringify({ classes: [
    { id: 'A', rca: [{ relation: 'mechanism-of', to: 'B' }, { relation: 'unassessed' }] },
    { id: 'B', rca: [{ relation: 'assessed-none' }] },
  ] }));
  assert.deepEqual(rcaEdges(path), [{ from: 'A', relation: 'mechanism-of', to: 'B' }]);
});

test('a contested mechanism-of edge is reported with its basis and not gated', () => {
  const edges = [
    { from: 'SPEC', relation: 'mechanism-of', to: 'GEN' },
    { from: 'OTHER', relation: 'mechanism-of', to: 'GEN' },
  ];
  const r = mechanismControl(edges, OBJ, [{ from: 'OTHER', relation: 'mechanism-of', to: 'GEN', basis: 'raters rejected it' }]);
  assert.equal(r.all.length, 1);
  assert.deepEqual(r.missed, []);
  assert.equal(r.contested.length, 1);
  assert.equal(r.contested[0].basis, 'raters rejected it');
});

test('an uncontested edge the encoding misses still fails the control', () => {
  const r = mechanismControl([{ from: 'OTHER', relation: 'mechanism-of', to: 'GEN' }], OBJ, [{ from: 'SPEC', to: 'GEN', basis: 'unrelated pair' }]);
  assert.equal(r.missed.length, 1);
  assert.equal(r.contested.length, 0);
});
