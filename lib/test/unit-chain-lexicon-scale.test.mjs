// Every lexicon label with its band metadata, sorted by band order then label (lib/chain-lexicon.mjs scale).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scale } from '../chain-lexicon.mjs';

const META = {
  sound: { order: 0, rank: 0, means: 'positively verified' },
  degraded: { order: 1, rank: 1, means: 'honestly written, not chainable' },
  undetermined: { order: 2, rank: 1, means: 'no evidence either way \u2014 never sound, never forged' },
  damaged: { order: 3, rank: 1, means: 'physical loss, not an edit' },
  suspect: { order: 4, rank: 3, means: 'changed, cause undetermined' },
  forged: { order: 5, rank: 3, means: 'positively contradicted' },
};

const ORDERED = [
  ['intact', 'sound'],
  ['intact-extended', 'sound'],
  ['raced', 'sound'],
  ['renumbered', 'sound'],
  ['unchained', 'degraded'],
  ['unlinked', 'degraded'],
  ['absent', 'undetermined'],
  ['never-measured', 'undetermined'],
  ['no-subject', 'undetermined'],
  ['unreadable', 'undetermined'],
  ['unverifiable', 'undetermined'],
  ['gapped', 'damaged'],
  ['torn', 'damaged'],
  ['extended', 'suspect'],
  ['row-removed', 'suspect'],
  ['stale-baseline-moved', 'suspect'],
  ['broken', 'forged'],
  ['rewritten', 'forged'],
  ['truncated', 'forged'],
];

const EXPECTED = ORDERED.map(([label, band]) => ({ label, band, known: true, ...META[band] }));

test('returns every label as a known band entry sorted by band order then label', () => {
  assert.deepEqual(scale(), EXPECTED);
});

test('lists the labels in band order with ties broken alphabetically', () => {
  assert.deepEqual(
    scale().map((e) => e.label),
    ORDERED.map(([label]) => label),
  );
});

test('orders entries by ascending band order from 0 to 5', () => {
  assert.deepEqual(
    scale().map((e) => e.order),
    [0, 0, 0, 0, 1, 1, 2, 2, 2, 2, 2, 3, 3, 4, 4, 4, 5, 5, 5],
  );
});

test('groups the band names contiguously in band order', () => {
  assert.deepEqual(
    scale().map((e) => e.band),
    ORDERED.map(([, band]) => band),
  );
});

test('places raced before renumbered within the sound band despite insertion order', () => {
  assert.deepEqual(
    scale().filter((e) => e.band === 'sound').map((e) => e.label),
    ['intact', 'intact-extended', 'raced', 'renumbered'],
  );
});

test('places absent first within the undetermined band', () => {
  assert.deepEqual(
    scale().filter((e) => e.order === 2).map((e) => e.label),
    ['absent', 'never-measured', 'no-subject', 'unreadable', 'unverifiable'],
  );
});

test('carries each band rank onto its entries', () => {
  assert.deepEqual(
    scale().map((e) => e.rank),
    [0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 3, 3, 3, 3, 3, 3],
  );
});

test('marks all nineteen entries as known', () => {
  assert.deepEqual(
    scale().map((e) => e.known),
    Array.from({ length: 19 }, () => true),
  );
});

test('starts with intact and ends with truncated', () => {
  const r = scale();
  assert.equal(r[0].label, 'intact');
  assert.equal(r[18].label, 'truncated');
  assert.equal(r.length, 19);
});

test('returns a fresh array so mutating one result does not affect the next', () => {
  const first = scale();
  first.splice(0, 5);
  assert.deepEqual(scale(), EXPECTED);
});
