// taxonomy-distance: the measured second witness on a hand-assigned `origin` label.
// Asserts EFFECTS, not markers: that identical text measures zero, that a set with no internal pair
// refuses to invent a scale, that the bands come from the reference set rather than from a constant,
// and that two runs on one input are byte-identical.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BANDS, compare, cosine, embed, idfOver, internalBaseline, median, nearest, percentileOf, tokens, vec }
  from '../taxonomy-distance.mjs';

const T = (id, name, description) => ({ id, text: [name, description] });

test('tokens: drops function words and short tokens, splits machine names on their separators', () => {
  assert.deepEqual(tokens('The absence of a scan'), ['absence', 'scan']);
  assert.deepEqual(tokens('false_clean.absence_rendered'), ['false', 'clean', 'absence', 'rendered']);
  assert.deepEqual(tokens(null, undefined, ''), []);
});

test('idf: a token in every document scores lower than a token in one', () => {
  const idf = idfOver([['alpha', 'shared'], ['beta', 'shared'], ['gamma', 'shared']]);
  assert.ok(idf.get('alpha') > idf.get('shared'));
});

test('cosine: identical text is distance 0, disjoint text is distance 1', () => {
  const { sets } = embed({ a: [T('A1', 'ledger rotation', 'the chain breaks at the boundary')],
                           b: [T('B1', 'ledger rotation', 'the chain breaks at the boundary'),
                               T('B2', 'quorum independence', 'raters agree without measurement')] });
  const same = nearest(sets.a[0].vec, [sets.b[0]]);
  assert.equal(same.distance, 0, 'identical text must measure zero, not merely small');
  const other = nearest(sets.a[0].vec, [sets.b[1]]);
  assert.equal(other.distance, 1, 'disjoint vocabulary must measure one');
});

test('a document with no scoring token yields an empty vector and cosine 0, never a fabricated score', () => {
  const idf = idfOver([['alpha']]);
  const empty = vec(tokens('the of and to'), idf);
  assert.equal(empty.size, 0);
  assert.equal(cosine(empty, vec(['alpha'], idf)), 0);
});

test('internalBaseline: a set with fewer than two members has NO scale and says so', () => {
  const { sets } = embed({ one: [T('X1', 'solo', 'only member')] });
  const b = internalBaseline(sets.one);
  assert.equal(b.median, null, 'a borrowed scale would be a bound with no cause');
  assert.equal(b.n, 1);
  assert.match(b.why, /no scale of its own/);
  assert.deepEqual(b.sorted, []);
});

test('percentileOf: position within the reference distribution, 0 when nothing is closer', () => {
  assert.equal(percentileOf([0.2, 0.4, 0.6, 0.8], 0.1), 0);
  assert.equal(percentileOf([0.2, 0.4, 0.6, 0.8], 0.5), 50);
  assert.equal(percentileOf([0.2, 0.4, 0.6, 0.8], 0.9), 100);
  assert.equal(percentileOf([], 0.5), null);
});

test('the band is READ from the reference set, so ONE pair changes verdict when only the set around it changes', () => {
  const subject = [T('S1', 'ledger rotation boundary', 'the chain breaks across a generation boundary')];
  const R1 = T('R1', 'ledger rotation boundary', 'the chain breaks across a generation boundary and the reader stops');
  const twinText = ['ledger rotation boundary', 'the chain breaks across a generation boundary and the reader stops'];
  // TIGHT: R1's siblings are exact copies, so the set's own resolution is 0 — it distinguishes
  // nothing at this scale, and the subject is therefore FAR by that set's standard.
  const tight = compare({ subject, references: { r: [R1,
    { id: 'R2', text: twinText }, { id: 'R3', text: twinText }] } });
  // LOOSE: the same R1, among siblings sharing nothing with it.
  const loose = compare({ subject, references: { r: [R1,
    T('R2', 'quorum independence', 'raters agree without measurement'),
    T('R3', 'suppression ageing', 'a silence grows less visible over time')] } });

  assert.equal(tight.rows[0].against.r.nearest, 'R1');
  assert.equal(loose.rows[0].against.r.nearest, 'R1');
  assert.equal(tight.baselines.r.median, 0);
  assert.equal(loose.baselines.r.median, 1);
  assert.equal(tight.rows[0].against.r.verdict, 'distinct',
    'a set that resolves finer than this distance must not call it a duplicate');
  assert.equal(loose.rows[0].against.r.verdict, 'duplicate',
    'the same neighbour, inside a set whose members are far apart, is unusually close');
  // Stated limit, asserted rather than assumed: idf is fitted over the WHOLE corpus being compared,
  // so changing a reference set's other members changes the raw distance to an unchanged neighbour.
  // The band is what is comparable across sets; the raw number is not.
  assert.notEqual(tight.rows[0].against.r.distance, loose.rows[0].against.r.distance);
});

test('an exact textual twin is distance 0, the floor, and reads duplicate in any set', () => {
  const twin = T('R1', 'ledger rotation boundary', 'the chain breaks at the boundary');
  const r = compare({ subject: [T('S1', 'ledger rotation boundary', 'the chain breaks at the boundary')],
    references: { r: [twin, T('R2', 'quorum independence', 'raters agree without measurement')] } });
  assert.equal(r.rows[0].against.r.distance, 0);
  assert.equal(r.rows[0].against.r.verdict, 'duplicate');
});

test('BANDS are declared in one place and are percentiles, not distances', () => {
  assert.ok(BANDS.duplicate < BANDS.adjacent);
  assert.ok(BANDS.adjacent <= 100);
});

test('citations resolve only into the sets named by citationSets — an id namespace shared by two sets does not make one answer for the other', () => {
  const subject = [T('S1', 'rotation boundary', 'the chain breaks at the boundary')];
  const references = {
    parent: [T('D3', 'rotation blindness', 'a reader blind to rotation')],
    other: [T('D3', 'entirely unrelated', 'a completely different claim about colours')],
  };
  const r = compare({ subject, references, citations: { S1: ['D3'] }, citationSets: ['parent'] });
  const sets = new Set(r.cited.S1.map((c) => c.set));
  assert.deepEqual([...sets], ['parent'], 'a citation must not be scored against a set it does not point into');
  assert.equal(r.cited.S1.length, 1);
  assert.ok(typeof r.cited.S1[0].rank === 'number' && r.cited.S1[0].rank >= 1);
});

test('deterministic: the same input measured twice is byte-identical', () => {
  const mk = () => compare({
    subject: [T('S1', 'alpha beta', 'gamma delta'), T('S2', 'epsilon', 'zeta eta')],
    references: { r: [T('R1', 'alpha beta', 'gamma theta'), T('R2', 'iota kappa', 'lambda mu')] },
    citations: { S1: ['R1'] }, citationSets: ['r'],
  });
  assert.equal(JSON.stringify(mk()), JSON.stringify(mk()));
});

test('median: even and odd lengths, and empty is null rather than 0', () => {
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
});
