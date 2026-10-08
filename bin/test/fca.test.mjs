import test from 'node:test';
import assert from 'node:assert/strict';

import { concepts, hasse, indistinguishable, extentOf, intentOf } from '../lib/fca.mjs';

// Hand-computed fixture. a:{1,2} b:{2,3} c:{1,2,3}
//
//   closure(empty) = {2}        extent {a,b,c}
//   closure({1})   = {1,2}      extent {a,c}
//   closure({3})   = {2,3}      extent {b,c}
//   closure({1,3}) = {1,2,3}    extent {c}
//
// Four concepts, no separate bottom: {1,2,3} still has c.
const FIXTURE = { a: ['1', '2'], b: ['2', '3'], c: ['1', '2', '3'] };

const intentsOf = (cs) => cs.map((c) => c.intent.join(',')).sort();

test('enumerates exactly the hand-computed concepts', () => {
  const cs = concepts(FIXTURE);
  assert.deepEqual(intentsOf(cs), ['1,2', '1,2,3', '2', '2,3']);

  const byIntent = new Map(cs.map((c) => [c.intent.join(','), c.extent.join(',')]));
  assert.equal(byIntent.get('2'), 'a,b,c');
  assert.equal(byIntent.get('1,2'), 'a,c');
  assert.equal(byIntent.get('2,3'), 'b,c');
  assert.equal(byIntent.get('1,2,3'), 'c');
});

test('hasse returns cover edges only, not the full order', () => {
  const cs = concepts(FIXTURE);
  const edges = hasse(cs);
  const label = ([i, j]) => `${cs[i].intent.join('')}>${cs[j].intent.join('')}`;
  const got = edges.map(label).sort();

  // {1,2}>{2}, {2,3}>{2}, {1,2,3}>{1,2}, {1,2,3}>{2,3}.
  assert.deepEqual(got, ['123>12', '123>23', '12>2', '23>2']);

  // The transitive pair {1,2,3} > {2} must NOT appear: it goes via {1,2}.
  assert.ok(!got.includes('123>2'), 'a transitive pair is not a cover edge');
});

test('an edge points from the more specific concept to the more general', () => {
  const cs = concepts(FIXTURE);
  for (const [child, parent] of hasse(cs)) {
    assert.ok(
      cs[child].intent.length > cs[parent].intent.length,
      'child intent must be strictly larger — more attributes is more specific',
    );
    assert.ok(
      cs[child].extent.length <= cs[parent].extent.length,
      'child extent must not exceed the parent — specialisation narrows the extent',
    );
  }
});

test('output does not depend on object insertion order', () => {
  // A Set/Map iteration order leaking into the result would make the lattice a
  // function of how the encodings happened to be written down.
  const forward = concepts({ a: ['1', '2'], b: ['2', '3'], c: ['1', '2', '3'] });
  const reverse = concepts({ c: ['1', '2', '3'], b: ['2', '3'], a: ['1', '2'] });
  assert.equal(JSON.stringify(forward), JSON.stringify(reverse));
});

test('output does not depend on attribute order within an object', () => {
  const a = concepts({ a: ['2', '1'], b: ['3', '2'], c: ['3', '1', '2'] });
  const b = concepts(FIXTURE);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('repeated runs are byte-identical', () => {
  assert.equal(JSON.stringify(concepts(FIXTURE)), JSON.stringify(concepts(FIXTURE)));
});

test('the concept cap refuses rather than truncating', () => {
  // 8 attributes, every subset realised -> 256 concepts, well over the cap of 10.
  const objects = {};
  for (let i = 0; i < 256; i++) {
    objects[`o${i}`] = [...Array(8).keys()].filter((b) => i & (1 << b)).map(String);
  }
  assert.throws(() => concepts(objects, { maxConcepts: 10 }), /exceeded 10/);
});

test('indistinguishable finds objects no attribute separates', () => {
  const groups = indistinguishable({
    x: ['1', '2'],
    y: ['2', '1'], // same set, written in the other order
    z: ['3'],
  });
  assert.deepEqual(groups, [['x', 'y']]);
});

test('indistinguishable is empty when every object differs', () => {
  assert.deepEqual(indistinguishable(FIXTURE), []);
});

test('extent and intent are mutually inverse on a closed set', () => {
  const objects = new Map(Object.entries(FIXTURE).map(([k, v]) => [k, new Set(v)]));
  const order = [...objects.keys()].sort();
  const ext = extentOf(new Set(['1']), objects, order);
  assert.deepEqual(ext, ['a', 'c']);
  assert.deepEqual([...intentOf(ext, objects)].sort(), ['1', '2']);
});

test('an empty extent yields no intent, so the caller can substitute', () => {
  const objects = new Map(Object.entries(FIXTURE).map(([k, v]) => [k, new Set(v)]));
  assert.equal(intentOf([], objects), null);
});

test('an unknown object id is refused, not skipped', () => {
  const objects = new Map(Object.entries(FIXTURE).map(([k, v]) => [k, new Set(v)]));
  assert.throws(() => intentOf(['nope'], objects), /unknown object/);
});
