// Rows where a class's origin label disagrees with its measured distance, plus a count of confirmed citations (bin/scanner-taxonomy-render.mjs labelVersusMeasurement).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { labelVersusMeasurement } from '../scanner-taxonomy-render.mjs';

const D = '\u2014';

const inh = (against, cited) => labelVersusMeasurement(
  { classes: [{ id: 'a', origin: 'inherited', inherits: ['x', 'y'] }] },
  { rows: [{ id: 'a', against }], cited: { a: cited } });

const underNote = (id, rank, of, nearest) =>
  `cites x y as applying verbatim, and the nearest of those (${id}) ranks ${rank} of ${of} by distance while ${nearest} ranks first ${D} either the citation is wrong or the text has drifted from what it cites`;

test('A missing report yields no rows and zero confirmed', () => {
  const doc = { classes: [{ id: 'a', origin: 'novel' }] };
  assert.deepEqual(labelVersusMeasurement(doc, null), { rows: [], confirmed: 0 });
  assert.deepEqual(labelVersusMeasurement(doc, undefined), { rows: [], confirmed: 0 });
});

test('A novel class measured as a duplicate is reported as the strongest over-claim', () => {
  const doc = { classes: [{ id: 'a', origin: 'novel' }] };
  const report = { rows: [{ id: 'a', against: { s1: { verdict: 'duplicate', nearest: 'b', distance: 0.1, pct: 5 } } }], cited: {} };
  assert.deepEqual(labelVersusMeasurement(doc, report), {
    rows: [{ id: 'a', set: 's1', direction: 'over-claimed', verdict: 'duplicate', nearest: 'b', distance: 0.1, pct: 5, origin: 'novel',
      note: `labelled novel and measured nearer to b than 95% of this set's own sibling pairs ${D} the strongest disagreement in the table` }],
    confirmed: 0,
  });
});

test('A transposed class measured as a duplicate is reported but its adjacent set is ignored', () => {
  const doc = { classes: [{ id: 'a', origin: 'transposed' }] };
  const report = { rows: [{ id: 'a', against: {
    s1: { verdict: 'duplicate', nearest: 'b', distance: 0.2, pct: 12 },
    s2: { verdict: 'adjacent', nearest: 'c', distance: 0.3, pct: 20 },
  } }], cited: {} };
  assert.deepEqual(labelVersusMeasurement(doc, report), {
    rows: [{ id: 'a', set: 's1', direction: 'over-claimed', verdict: 'duplicate', nearest: 'b', distance: 0.2, pct: 12, origin: 'transposed',
      note: `labelled transposed and measured nearer to b than 88% of this set's own sibling pairs ${D} legitimate only if the originNote names a difference the text does not already carry` }],
    confirmed: 0,
  });
});

test('A novel class measured adjacent is a weaker over-claim and a distinct measurement is ignored', () => {
  const doc = { classes: [{ id: 'a', origin: 'novel' }] };
  const report = { rows: [{ id: 'a', against: {
    s1: { verdict: 'adjacent', nearest: 'b', distance: 0.25, pct: 15 },
    s2: { verdict: 'distinct', nearest: 'c', distance: 0.8, pct: 70 },
  } }], cited: {} };
  assert.deepEqual(labelVersusMeasurement(doc, report), {
    rows: [{ id: 'a', set: 's1', direction: 'over-claimed', verdict: 'adjacent', nearest: 'b', distance: 0.25, pct: 15, origin: 'novel',
      note: `labelled novel and measured adjacent to b ${D} weaker than a duplicate, but a claim of no precedent deserves the second look` }],
    confirmed: 0,
  });
});

test('An unmeasured set is skipped while a duplicate in another set is still reported', () => {
  const doc = { classes: [{ id: 'a', origin: 'novel' }] };
  const report = { rows: [{ id: 'a', against: {
    s1: { verdict: 'unmeasured' },
    s2: { verdict: 'duplicate', nearest: 'b', distance: 0.05, pct: 2 },
  } }], cited: {} };
  assert.deepEqual(labelVersusMeasurement(doc, report), {
    rows: [{ id: 'a', set: 's2', direction: 'over-claimed', verdict: 'duplicate', nearest: 'b', distance: 0.05, pct: 2, origin: 'novel',
      note: `labelled novel and measured nearer to b than 98% of this set's own sibling pairs ${D} the strongest disagreement in the table` }],
    confirmed: 0,
  });
});

test('An inherited class whose best citation ranks eleventh and is measured distinct is under-claimed', () => {
  const r = inh({ s1: { verdict: 'distinct', nearest: 'z', distance: 0.9, pct: 60 } }, [{ set: 's1', id: 'x', rank: 11, of: 20 }]);
  assert.deepEqual(r, {
    rows: [{ id: 'a', set: 's1', direction: 'under-claimed', verdict: 'distinct', nearest: 'z', distance: 0.9, pct: 60, origin: 'inherited',
      note: underNote('x', 11, 20, 'z') }],
    confirmed: 0,
  });
});

test('An inherited class whose best citation ranks exactly tenth is confirmed', () => {
  const r = inh({ s1: { verdict: 'distinct', nearest: 'z', distance: 0.9, pct: 60 } }, [{ set: 's1', id: 'x', rank: 10, of: 20 }]);
  assert.deepEqual(r, { rows: [], confirmed: 1 });
});

test('An inherited class is judged by its lowest ranked citation into the same set only', () => {
  const r = inh({ s1: { verdict: 'distinct', nearest: 'z', distance: 0.7, pct: 50 } }, [
    { set: 's1', id: 'y', rank: 14, of: 30 },
    { set: 's1', id: 'x', rank: 12, of: 30 },
    { set: 's2', id: 'w', rank: 1, of: 30 },
  ]);
  assert.deepEqual(r, {
    rows: [{ id: 'a', set: 's1', direction: 'under-claimed', verdict: 'distinct', nearest: 'z', distance: 0.7, pct: 50, origin: 'inherited',
      note: underNote('x', 12, 30, 'z') }],
    confirmed: 0,
  });
});

test('An inherited class measured duplicate or adjacent is confirmed even with a far citation rank', () => {
  const r = inh({
    s1: { verdict: 'duplicate', nearest: 'z', distance: 0.1, pct: 3 },
    s2: { verdict: 'adjacent', nearest: 'z', distance: 0.2, pct: 8 },
  }, [{ set: 's1', id: 'x', rank: 15, of: 20 }, { set: 's2', id: 'y', rank: 15, of: 20 }]);
  assert.deepEqual(r, { rows: [], confirmed: 2 });
});

test('An inherited class with no citation into the measured set is skipped', () => {
  const doc = { classes: [
    { id: 'a', origin: 'inherited', inherits: ['x'] },
    { id: 'b', origin: 'inherited', inherits: ['y'] },
  ] };
  const report = {
    rows: [
      { id: 'a', against: { s1: { verdict: 'distinct', nearest: 'z', distance: 0.9, pct: 60 } } },
      { id: 'b', against: { s1: { verdict: 'distinct', nearest: 'z', distance: 0.9, pct: 60 } } },
    ],
    cited: { a: [{ set: 's2', id: 'x', rank: 1, of: 5 }] },
  };
  assert.deepEqual(labelVersusMeasurement(doc, report), { rows: [], confirmed: 0 });
});
