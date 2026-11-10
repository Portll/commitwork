// Computes taxonomy structure metrics including similarity, clustering, and evidence (bin/taxonomy-structure.mjs analyse).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyse } from '../taxonomy-structure.mjs';

test('fam uses first character of class id', () => {
  const doc = {
    classes: [
      { id: 'a1', name: 'alpha', predicate: 'p1', description: 'd1', stpa: [{ loop: 'L1', uca: 'U1', cause: 'C1' }], rca: [], closure: 1, gain: 1 },
      { id: 'b2', name: 'beta', predicate: 'p2', description: 'd2', stpa: [{ loop: 'L2', uca: 'U2', cause: 'C2' }], rca: [], closure: 2, gain: 2 }
    ],
    families: [{ prefix: 'a' }, { prefix: 'b' }],
    scaleBounds: { closureMax: 5, gainMax: 5 },
    evidencePredicate: { matchers: [] }
  };
  const r = analyse(doc);
  assert.deepEqual(r.fam, ["a", "b"]);
});

test('triple uses first stpa element for uca', () => {
  const doc = {
    classes: [
      { id: 'a1', name: 'alpha', predicate: 'p1', description: 'd1', stpa: [{ loop: 'L1', uca: 'U1', cause: 'C1' }, { loop: 'L1', uca: 'U2', cause: 'C1' }], rca: [], closure: 1, gain: 1 },
      { id: 'b2', name: 'beta', predicate: 'p2', description: 'd2', stpa: [{ loop: 'L2', uca: 'U2', cause: 'C2' }], rca: [], closure: 2, gain: 2 }
    ],
    families: [{ prefix: 'a' }, { prefix: 'b' }],
    scaleBounds: { closureMax: 5, gainMax: 5 },
    evidencePredicate: { matchers: [] }
  };
  const r = analyse(doc);
  assert.deepEqual(r.triples, ["L1|U1|C1", "L2|U2|C2"]);
});

test('edges are built from rca with valid targets', () => {
  const doc = {
    classes: [
      { id: 'a1', name: 'alpha', predicate: 'p1', description: 'd1', stpa: [{ loop: 'L1', uca: 'U1', cause: 'C1' }], rca: [{ to: 'b2', relation: 'causes' }], closure: 1, gain: 1 },
      { id: 'b2', name: 'beta', predicate: 'p2', description: 'd2', stpa: [{ loop: 'L2', uca: 'U2', cause: 'C2' }], rca: [], closure: 2, gain: 2 }
    ],
    families: [{ prefix: 'a' }, { prefix: 'b' }],
    scaleBounds: { closureMax: 5, gainMax: 5 },
    evidencePredicate: { matchers: [] }
  };
  const r = analyse(doc);
  assert.deepEqual(r.edges, [{ from: 0, to: 1, relation: "causes", sim: 0 }]);
});

test('nearest neighbour search stays within bounds', () => {
  const doc = {
    classes: [
      { id: 'a1', name: 'alpha', predicate: 'p1', description: 'd1', stpa: [{ loop: 'L1', uca: 'U1', cause: 'C1' }], rca: [], closure: 1, gain: 1 },
      { id: 'b2', name: 'beta', predicate: 'p2', description: 'd2', stpa: [{ loop: 'L2', uca: 'U2', cause: 'C2' }], rca: [], closure: 2, gain: 2 }
    ],
    families: [{ prefix: 'a' }, { prefix: 'b' }],
    scaleBounds: { closureMax: 5, gainMax: 5 },
    evidencePredicate: { matchers: [] }
  };
  const r = analyse(doc);
  assert.deepEqual(r.nearest, [{ id: "a1", nn: "b2", sim: 0, offFamily: true, sameTriple: false, declared: false }, { id: "b2", nn: "a1", sim: 0, offFamily: true, sameTriple: false, declared: false }]);
});

test('sameTriple is true when stpa triples match', () => {
  const doc = {
    classes: [
      { id: 'a1', name: 'alpha', predicate: 'p1', description: 'd1', stpa: [{ loop: 'L1', uca: 'U1', cause: 'C1' }], rca: [], closure: 1, gain: 1 },
      { id: 'b2', name: 'beta', predicate: 'p2', description: 'd2', stpa: [{ loop: 'L1', uca: 'U1', cause: 'C1' }], rca: [], closure: 2, gain: 2 }
    ],
    families: [{ prefix: 'a' }, { prefix: 'b' }],
    scaleBounds: { closureMax: 5, gainMax: 5 },
    evidencePredicate: { matchers: [] }
  };
  const r = analyse(doc);
  assert.deepEqual(r.nearest[0].sameTriple, true);
});

test('sharedTriples includes groups with exactly two members', () => {
  const doc = {
    classes: [
      { id: 'a1', name: 'alpha', predicate: 'p1', description: 'd1', stpa: [{ loop: 'L1', uca: 'U1', cause: 'C1' }], rca: [], closure: 1, gain: 1 },
      { id: 'b2', name: 'beta', predicate: 'p2', description: 'd2', stpa: [{ loop: 'L1', uca: 'U1', cause: 'C1' }], rca: [], closure: 2, gain: 2 },
      { id: 'c3', name: 'gamma', predicate: 'p3', description: 'd3', stpa: [{ loop: 'L3', uca: 'U3', cause: 'C3' }], rca: [], closure: 3, gain: 3 }
    ],
    families: [{ prefix: 'a' }, { prefix: 'b' }, { prefix: 'c' }],
    scaleBounds: { closureMax: 5, gainMax: 5 },
    evidencePredicate: { matchers: [] }
  };
  const r = analyse(doc);
  assert.deepEqual(r.sharedTriples, [{ triple: "L1|U1|C1", pairs: [{ a: "a1", b: "b2", sim: 0, declared: false }], max: 0 }]);
});

test('undeclared pairs are collected for all i<j', () => {
  const doc = {
    classes: [
      { id: 'a1', name: 'alpha', predicate: 'p1', description: 'd1', stpa: [{ loop: 'L1', uca: 'U1', cause: 'C1' }], rca: [], closure: 1, gain: 1 },
      { id: 'b2', name: 'beta', predicate: 'p2', description: 'd2', stpa: [{ loop: 'L2', uca: 'U2', cause: 'C2' }], rca: [], closure: 2, gain: 2 },
      { id: 'c3', name: 'gamma', predicate: 'p3', description: 'd3', stpa: [{ loop: 'L3', uca: 'U3', cause: 'C3' }], rca: [], closure: 3, gain: 3 }
    ],
    families: [{ prefix: 'a' }, { prefix: 'b' }, { prefix: 'c' }],
    scaleBounds: { closureMax: 5, gainMax: 5 },
    evidencePredicate: { matchers: [] }
  };
  const r = analyse(doc);
  assert.deepEqual(r.undeclaredTop, [{ from: 0, to: 1, sim: 0 }, { from: 0, to: 2, sim: 0 }, { from: 1, to: 2, sim: 0 }]);
});

test('famStats includes index 0 in within-family mean', () => {
  const doc = {
    classes: [
      { id: 'a1', name: 'alpha', predicate: 'p1', description: 'd1', stpa: [{ loop: 'L1', uca: 'U1', cause: 'C1' }], rca: [], closure: 1, gain: 1 },
      { id: 'a2', name: 'alpha2', predicate: 'p1', description: 'd1', stpa: [{ loop: 'L1', uca: 'U1', cause: 'C1' }], rca: [], closure: 1, gain: 1 },
      { id: 'b1', name: 'beta', predicate: 'p2', description: 'd2', stpa: [{ loop: 'L2', uca: 'U2', cause: 'C2' }], rca: [], closure: 2, gain: 2 }
    ],
    families: [{ prefix: 'a' }, { prefix: 'b' }],
    scaleBounds: { closureMax: 5, gainMax: 5 },
    evidencePredicate: { matchers: [] }
  };
  const r = analyse(doc);
  assert.deepEqual(r.famStats, [{ prefix: "a", n: 2, within: 0, nearest: { q: "b", m: 0 } }, { prefix: "b", n: 1, within: 0, nearest: { q: "a", m: 0 } }]);
});

test('nearest family is the first in sorted others', () => {
  const doc = {
    classes: [
      { id: 'a1', name: 'alpha', predicate: 'p1', description: 'd1', stpa: [{ loop: 'L1', uca: 'U1', cause: 'C1' }], rca: [], closure: 1, gain: 1 },
      { id: 'b1', name: 'beta', predicate: 'p2', description: 'd2', stpa: [{ loop: 'L2', uca: 'U2', cause: 'C2' }], rca: [], closure: 2, gain: 2 },
      { id: 'c1', name: 'gamma', predicate: 'p3', description: 'd3', stpa: [{ loop: 'L3', uca: 'U3', cause: 'C3' }], rca: [], closure: 3, gain: 3 }
    ],
    families: [{ prefix: 'a' }, { prefix: 'b' }, { prefix: 'c' }],
    scaleBounds: { closureMax: 5, gainMax: 5 },
    evidencePredicate: { matchers: [] }
  };
  const r = analyse(doc);
  assert.deepEqual(r.famStats[0].nearest, { q: "b", m: 0 });
});

test('kappa is computed from first-pass and current scores', () => {
  const doc = {
    classes: [
      { id: 'a1', name: 'alpha', predicate: 'p1', description: 'd1', stpa: [{ loop: 'L1', uca: 'U1', cause: 'C1' }], rca: [], closure: 1, gain: 1, scoreBasis: 'RE-RATED: closure 1\u21922, gain 1\u21922' },
      { id: 'b2', name: 'beta', predicate: 'p2', description: 'd2', stpa: [{ loop: 'L2', uca: 'U2', cause: 'C2' }], rca: [], closure: 2, gain: 2, scoreBasis: 'RE-RATED: closure 2\u21923, gain 2\u21923' }
    ],
    families: [{ prefix: 'a' }, { prefix: 'b' }],
    scaleBounds: { closureMax: 5, gainMax: 5 },
    evidencePredicate: { matchers: [] }
  };
  const r = analyse(doc);
  assert.deepEqual(r.kappa, { closure: 1, gain: 1, changed: 0 });
});
