// Nearest-neighbour verdicts and cited-class ranks of subject classes against reference sets (lib/taxonomy-distance.mjs compare).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare } from '../taxonomy-distance.mjs';

const one = (id, word) => ({ id, text: [word] });
const uniques = (n, p) => Array.from({ length: n }, (_, i) => one(`${p}${String(i).padStart(2, '0')}`, `${p}tok${i}`));
const pairs = (words) => words.flatMap((w, i) => [one(`p${i}a`, w), one(`p${i}b`, w)]);
const strip = ({ why, ...rest }) => rest;

test('a reference set with no internal pair yields an unmeasured verdict that still names the nearest member', () => {
  const r = compare({
    subject: [one('s1', 'apple')],
    references: { solo: [one('r1', 'apple')], empty: [] },
  });
  assert.deepEqual(r.rows, [{ id: 's1', against: {
    empty: { nearest: null, distance: null, pct: null, verdict: 'unmeasured' },
    solo: { nearest: 'r1', distance: 0, pct: null, verdict: 'unmeasured' },
  } }]);
  assert.deepEqual(strip(r.baselines.solo), { n: 1, median: null, min: null, max: null, sorted: [] });
  assert.deepEqual(strip(r.baselines.empty), { n: 0, median: null, min: null, max: null, sorted: [] });
  assert.deepEqual(r.cited, {});
  assert.deepEqual(strip(r.subjectInternal), { n: 1, median: null, min: null, max: null, sorted: [] });
});

test('a subject identical to a paired set is a duplicate at percentile zero', () => {
  const r = compare({
    subject: [one('s1', 'apple')],
    references: { pair: [one('a1', 'apple'), one('a2', 'apple')] },
  });
  assert.deepEqual(r.rows, [{ id: 's1', against: { pair: { nearest: 'a1', distance: 0, pct: 0, verdict: 'duplicate' } } }]);
  assert.deepEqual(r.baselines.pair, {
    n: 2, median: 0, min: 0, max: 0, sorted: [0, 0],
    rows: [{ id: 'a1', nearest: 'a2', distance: 0 }, { id: 'a2', nearest: 'a1', distance: 0 }],
  });
});

test('a percentile of exactly ten is adjacent rather than duplicate', () => {
  const r = compare({
    subject: [one('s1', 'zebra')],
    references: { mix: [...pairs(['apple']), ...uniques(18, 'u')] },
  });
  assert.deepEqual(r.rows, [{ id: 's1', against: { mix: { nearest: 'p0a', distance: 1, pct: 10, verdict: 'adjacent' } } }]);
  assert.deepEqual(r.baselines.mix.sorted, [0, 0, ...Array(18).fill(1)]);
  assert.equal(r.baselines.mix.median, 1);
  assert.equal(r.baselines.mix.min, 0);
  assert.equal(r.baselines.mix.max, 1);
});

test('a percentile of exactly fifty is distinct while forty is adjacent', () => {
  const r = compare({
    subject: [one('s1', 'zebra')],
    references: {
      half: [...pairs(['apple', 'berry', 'cherry', 'grape', 'lemon']), ...uniques(10, 'u')],
      part: [...pairs(['apple', 'berry', 'cherry', 'grape']), ...uniques(12, 'v')],
    },
  });
  assert.deepEqual(r.rows, [{ id: 's1', against: {
    half: { nearest: 'p0a', distance: 1, pct: 50, verdict: 'distinct' },
    part: { nearest: 'p0a', distance: 1, pct: 40, verdict: 'adjacent' },
  } }]);
});

test('cited classes report their distance and rank among the set ordered by distance then id, skipping unknown ids', () => {
  const r = compare({
    subject: [one('s1', 'apple')],
    references: { ref: [one('r1', 'zebra'), one('r2', 'apple'), one('r3', 'mango')] },
    citations: { s1: ['r3', 'missing', 'r2'] },
  });
  assert.deepEqual(r.cited, { s1: [
    { set: 'ref', id: 'r3', distance: 1, rank: 3, of: 3 },
    { set: 'ref', id: 'r2', distance: 0, rank: 1, of: 3 },
  ] });
  assert.deepEqual(r.rows, [{ id: 's1', against: { ref: { nearest: 'r2', distance: 0, pct: 0, verdict: 'duplicate' } } }]);
  assert.deepEqual(r.baselines.ref.sorted, [1, 1, 1]);
});

test('citationSets restricts which registries a citation is resolved against', () => {
  const input = {
    subject: [one('s1', 'apple'), one('s2', 'mango')],
    references: {
      alpha: [one('x1', 'apple'), one('x2', 'mango')],
      beta: [one('x1', 'mango'), one('x2', 'apple')],
    },
    citations: { s1: ['x1'] },
  };
  const all = compare(input);
  assert.deepEqual(all.cited, { s1: [
    { set: 'alpha', id: 'x1', distance: 0, rank: 1, of: 2 },
    { set: 'beta', id: 'x1', distance: 1, rank: 2, of: 2 },
  ] });
  assert.deepEqual(compare({ ...input, citationSets: ['beta'] }).cited, { s1: [{ set: 'beta', id: 'x1', distance: 1, rank: 2, of: 2 }] });
  assert.deepEqual(compare({ ...input, citationSets: ['gamma'] }).cited, { s1: [] });
  assert.deepEqual(all.subjectInternal, {
    n: 2, median: 1, min: 1, max: 1, sorted: [1, 1],
    rows: [{ id: 's1', nearest: 's2', distance: 1 }, { id: 's2', nearest: 's1', distance: 1 }],
  });
});
